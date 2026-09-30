-- ============================================================
-- 20260930100000_fix_commission_discount_factor.sql
--
-- Bug: en producción sales.subtotal y sales.discount_amount son INTEGER, así
-- que (subtotal − descuento) / subtotal era una división ENTERA → 0 con
-- cualquier descuento (15.000 / 25.000 = 0). Toda venta con descuento quedaba
-- sin comisión. Se castea a NUMERIC y se recalculan las ventas afectadas
-- (idempotente: solo crea lo que falta).
--
-- Además se quitan las políticas "xin_internal_definer" de 20260930090000:
-- el diagnóstico mostró que postgres ya ignora la RLS (dueño con BYPASSRLS),
-- así que no hacían falta.
-- ============================================================

CREATE OR REPLACE FUNCTION public._record_sale_commissions(p_sale_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s            RECORD;
  it           RECORD;
  r            RECORD;
  v_service    UUID;
  v_appt_staff UUID;
  v_factor     NUMERIC := 1;
  v_base       INTEGER;
  v_amount     INTEGER;
  v_note       TEXT;
  v_tip_staff  UUID;
  v_created    INTEGER := 0;
BEGIN
  SELECT id, business_id, appointment_id, subtotal, discount_amount, tip_amount, status
    INTO s FROM sales WHERE id = p_sale_id;
  IF NOT FOUND OR s.status <> 'paid' THEN RETURN 0; END IF;

  IF s.appointment_id IS NOT NULL THEN
    SELECT service_id, staff_id INTO v_service, v_appt_staff
      FROM appointments WHERE id = s.appointment_id;
  END IF;

  IF COALESCE(s.subtotal, 0) > 0 THEN
    v_factor := GREATEST(s.subtotal - COALESCE(s.discount_amount, 0), 0)::NUMERIC / s.subtotal::NUMERIC;
  END IF;

  FOR it IN
    SELECT id, staff_id, item_type, description, quantity, total_price
      FROM sale_items
     WHERE sale_id = s.id AND staff_id IS NOT NULL AND item_type IN ('service', 'product')
     ORDER BY created_at, id
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM staff_ledger l
                           WHERE l.sale_item_id = it.id AND l.entry_type = 'commission');

    v_base   := FLOOR(COALESCE(it.total_price, 0) * v_factor);
    v_amount := 0;

    IF it.item_type = 'service' THEN
      SELECT cr.commission_percentage, cr.fixed_amount INTO r
        FROM commission_rules cr
       WHERE cr.business_id = s.business_id
         AND (cr.staff_id IS NULL OR cr.staff_id = it.staff_id)
         AND (cr.service_id IS NULL OR cr.service_id = v_service)
       ORDER BY CASE
                  WHEN cr.staff_id IS NOT NULL AND cr.service_id IS NOT NULL THEN 1
                  WHEN cr.staff_id IS NULL     AND cr.service_id IS NOT NULL THEN 2
                  WHEN cr.staff_id IS NOT NULL AND cr.service_id IS NULL     THEN 3
                  ELSE 4
                END
       LIMIT 1;

      IF FOUND THEN
        IF r.commission_percentage > 0 THEN
          v_amount := FLOOR(v_base * r.commission_percentage / 100.0);
          v_note   := it.description || ' - ' || r.commission_percentage || '% de ' || public._money_cop(v_base);
        ELSIF r.fixed_amount > 0 THEN
          v_amount := r.fixed_amount * GREATEST(COALESCE(it.quantity, 1), 1);
          v_note   := it.description || ' - monto fijo ' || public._money_cop(r.fixed_amount)
                      || CASE WHEN COALESCE(it.quantity, 1) > 1 THEN ' x ' || it.quantity ELSE '' END;
        END IF;
      END IF;
    ELSE
      SELECT cr.product_percentage INTO r
        FROM commission_rules cr
       WHERE cr.business_id = s.business_id
         AND cr.service_id IS NULL
         AND (cr.staff_id IS NULL OR cr.staff_id = it.staff_id)
       ORDER BY (cr.staff_id IS NULL)   -- la del profesional primero
       LIMIT 1;

      IF FOUND AND r.product_percentage > 0 THEN
        v_amount := FLOOR(v_base * r.product_percentage / 100.0);
        v_note   := it.description || ' - ' || r.product_percentage || '% de ' || public._money_cop(v_base);
      END IF;
    END IF;

    IF v_amount > 0 THEN
      INSERT INTO staff_ledger (business_id, staff_id, entry_type, amount, notes, reference_id, sale_id, sale_item_id)
      VALUES (s.business_id, it.staff_id, 'commission', v_amount, LEFT(v_note, 300), s.id, s.id, it.id)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN v_created := v_created + 1; END IF;
    END IF;
  END LOOP;

  -- Propina: 100% del profesional de la cita (o del primer servicio de la venta)
  IF COALESCE(s.tip_amount, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM staff_ledger l WHERE l.sale_id = s.id AND l.entry_type = 'tip') THEN
    v_tip_staff := COALESCE(
      v_appt_staff,
      (SELECT si.staff_id FROM sale_items si
        WHERE si.sale_id = s.id AND si.staff_id IS NOT NULL
        ORDER BY (si.item_type <> 'service'), si.created_at, si.id LIMIT 1)
    );
    IF v_tip_staff IS NOT NULL THEN
      INSERT INTO staff_ledger (business_id, staff_id, entry_type, amount, notes, reference_id, sale_id)
      VALUES (s.business_id, v_tip_staff, 'tip', ROUND(s.tip_amount)::INTEGER, 'Propina', s.id, s.id)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN v_created := v_created + 1; END IF;
    END IF;
  END IF;

  RETURN v_created;
END;
$$;
REVOKE ALL ON FUNCTION public._record_sale_commissions(UUID) FROM PUBLIC, anon, authenticated;

-- Recalcular ventas pagadas con descuento que quedaron sin comisión
DO $$
DECLARE v RECORD;
BEGIN
  FOR v IN
    SELECT s.id FROM public.sales s
     WHERE s.status = 'paid' AND COALESCE(s.discount_amount, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM public.staff_ledger l
                        WHERE l.sale_id = s.id AND l.entry_type = 'commission')
  LOOP
    PERFORM public._record_sale_commissions(v.id);
  END LOOP;
END $$;

-- Limpiar políticas innecesarias
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies
            WHERE schemaname = 'public' AND policyname = 'xin_internal_definer'
  LOOP
    EXECUTE format('DROP POLICY xin_internal_definer ON public.%I', t);
  END LOOP;
END $$;
