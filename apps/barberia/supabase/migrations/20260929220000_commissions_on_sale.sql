-- ============================================================
-- 20260929220000_commissions_on_sale.sql — Comisiones reales al cobrar
--
-- Antes: el "motor" calculaba y descartaba el resultado → staff_ledger vacío.
-- Ahora: cada venta pagada genera, por línea con profesional, su comisión en
-- staff_ledger (y la propina, 100% del profesional). Queda CONGELADA: cambiar
-- una regla después no altera lo ya cobrado.
--
-- Reglas (commission_rules), de más específica a más general:
--   Servicios: profesional+servicio > servicio (todos) > profesional > general
--              → commission_percentage (%) o fixed_amount (por unidad)
--   Productos: profesional > general → product_percentage (%)
-- Base = total de la línea menos su parte proporcional del descuento.
--
-- Seguridad: las funciones viejas (calculate_commission, process_commission_queue,
-- record_commission_to_ledger) aceptaban cualquier business_id → sin EXECUTE
-- para usuarios. Todo se hace por trigger (SECURITY DEFINER interno) y por
-- apply_pending_commissions (solo admin del propio negocio).
-- ============================================================

-- ── 1. Esquema ───────────────────────────────────────────────────────────────
ALTER TABLE public.commission_rules
  ADD COLUMN IF NOT EXISTS product_percentage INTEGER NOT NULL DEFAULT 0
    CHECK (product_percentage BETWEEN 0 AND 100);

-- Una sola regla por combinación (NULL = "todos").
CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_rules_scope
  ON public.commission_rules (
    business_id,
    COALESCE(staff_id,   '00000000-0000-0000-0000-000000000000'::UUID),
    COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::UUID)
  );

ALTER TABLE public.staff_ledger
  ADD COLUMN IF NOT EXISTS sale_id      UUID REFERENCES public.sales(id)      ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_item_id UUID REFERENCES public.sale_items(id) ON DELETE SET NULL;

-- Idempotencia: una comisión por línea y una propina por venta.
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_ledger_item_commission
  ON public.staff_ledger (sale_item_id) WHERE entry_type = 'commission' AND sale_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_ledger_sale_tip
  ON public.staff_ledger (sale_id) WHERE entry_type = 'tip' AND sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_ledger_sale ON public.staff_ledger (sale_id);

-- ── 2. Cálculo de una venta (interno, idempotente) ───────────────────────────
CREATE OR REPLACE FUNCTION public._money_cop(p_amount NUMERIC)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT '$' || REPLACE(TO_CHAR(ROUND(COALESCE(p_amount, 0)), 'FM999,999,999,990'), ',', '.')
$$;

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
    v_factor := GREATEST(s.subtotal - COALESCE(s.discount_amount, 0), 0) / s.subtotal;
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
REVOKE ALL ON FUNCTION public._money_cop(NUMERIC) FROM PUBLIC, anon, authenticated;

-- ── 3. Triggers: al insertar líneas de una venta pagada o al pasar a 'paid' ──
-- Un error aquí NUNCA bloquea el cobro: se avisa y se puede reaplicar luego.
CREATE OR REPLACE FUNCTION public._trg_sale_commissions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'sale_items' THEN
    v_sale_id := NEW.sale_id;
  ELSE
    v_sale_id := NEW.id;
  END IF;
  BEGIN
    PERFORM public._record_sale_commissions(v_sale_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'commissions: % (sale %)', SQLERRM, v_sale_id;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._trg_sale_commissions() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sale_items_commissions ON public.sale_items;
CREATE TRIGGER trg_sale_items_commissions
  AFTER INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public._trg_sale_commissions();

DROP TRIGGER IF EXISTS trg_sales_paid_commissions ON public.sales;
CREATE TRIGGER trg_sales_paid_commissions
  AFTER UPDATE OF status ON public.sales
  FOR EACH ROW
  WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
  EXECUTE FUNCTION public._trg_sale_commissions();

-- ── 4. Aplicar reglas a ventas pagadas que aún no tienen comisión ────────────
-- Solo admin del propio negocio. p_from / p_to: fechas locales (inclusive).
CREATE OR REPLACE FUNCTION public.apply_pending_commissions(
  p_business_id UUID,
  p_from        DATE DEFAULT NULL,
  p_to          DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale    RECORD;
  v_sales   INTEGER := 0;
  v_entries INTEGER := 0;
  v_n       INTEGER;
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  IF NOT COALESCE(
       (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
    OR EXISTS (SELECT 1 FROM profiles p
                WHERE p.id = auth.uid() AND p.business_id = p_business_id
                  AND p.role IN ('admin', 'super_admin')),
    FALSE
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR v_sale IN
    SELECT id FROM sales
     WHERE business_id = p_business_id
       AND status = 'paid'
       AND (p_from IS NULL OR (created_at AT TIME ZONE 'America/Bogota')::DATE >= p_from)
       AND (p_to   IS NULL OR (created_at AT TIME ZONE 'America/Bogota')::DATE <= p_to)
     ORDER BY created_at
  LOOP
    v_n := public._record_sale_commissions(v_sale.id);
    IF v_n > 0 THEN
      v_sales   := v_sales + 1;
      v_entries := v_entries + v_n;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('sales', v_sales, 'entries', v_entries);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_pending_commissions(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_pending_commissions(UUID, DATE, DATE) TO authenticated;

-- ── 5. Cerrar las funciones viejas ───────────────────────────────────────────
REVOKE ALL ON FUNCTION public.calculate_commission(UUID, UUID)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_commission_queue(UUID)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_commission_to_ledger(UUID, UUID, UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
