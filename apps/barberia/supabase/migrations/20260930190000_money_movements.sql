-- ============================================================
-- 20260930190000_money_movements.sql — Contabilidad: movimientos de plata
--
-- - get_money_movements(desde, hasta): TODO lo que entró y salió de verdad
--   en el negocio, en fechas de Colombia. Solo admin; el negocio sale de la
--   sesión (no se recibe del navegador).
--     Entradas: pagos de ventas cobradas (por medio de pago, con la propina
--               aparte), venta de equipos.
--     Salidas:  gastos, anticipos y pagos al equipo, compras de inventario,
--               compras de equipos.
-- - get_accounting_summary: ahora verifica negocio y admin (antes cualquier
--   usuario con sesión podía pedir los totales de otra barbería).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_money_movements(p_date_from DATE, p_date_to DATE)
RETURNS TABLE (
  kind          TEXT,     -- 'in' | 'out'
  source        TEXT,     -- sale | asset_sale | expense | team_advance | team_payment | inventory_purchase | asset_purchase
  occurred_on   DATE,     -- día en Colombia
  occurred_time TEXT,     -- 'HH24:MI' en Colombia (NULL si solo hay fecha)
  description   TEXT,
  category      TEXT,
  method        TEXT,     -- cash | card | transfer | mercadopago | loyalty_points | mixed | other
  amount        INTEGER,  -- siempre positivo
  tip           INTEGER,  -- propina incluida en el monto (solo ventas)
  reference_id  UUID
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bid   UUID;
  v_start TIMESTAMPTZ;
  v_end   TIMESTAMPTZ;
BEGIN
  BEGIN
    v_bid := (auth.jwt() -> 'app_metadata' ->> 'business_id')::UUID;
  EXCEPTION WHEN OTHERS THEN v_bid := NULL;
  END;
  IF v_bid IS NULL OR NOT public._is_business_admin(v_bid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from OR p_date_to - p_date_from > 400 THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  v_start := p_date_from::TIMESTAMP AT TIME ZONE 'America/Bogota';
  v_end   := (p_date_to + 1)::TIMESTAMP AT TIME ZONE 'America/Bogota';

  RETURN QUERY
  -- Ventas cobradas: un renglón por pago; la propina va en el primer pago de la venta
  SELECT 'in'::TEXT, 'sale'::TEXT,
         (p.created_at AT TIME ZONE 'America/Bogota')::DATE,
         to_char(p.created_at AT TIME ZONE 'America/Bogota', 'HH24:MI'),
         'Venta' || COALESCE(' · ' || c.full_name, ''),
         NULL::TEXT,
         p.payment_method::TEXT,
         p.amount::INTEGER,
         CASE WHEN ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY p.created_at, p.id) = 1
              THEN COALESCE(s.tip_amount, 0)::INTEGER ELSE 0 END,
         s.id
    FROM payments p
    JOIN sales s ON s.id = p.sale_id
    LEFT JOIN customers c ON c.id = s.customer_id
   WHERE p.business_id = v_bid AND s.business_id = v_bid
     AND s.status IN ('paid', 'completed')
     AND p.created_at >= v_start AND p.created_at < v_end

  UNION ALL
  -- Venta de equipos
  SELECT 'in', 'asset_sale', a.disposed_at, NULL,
         'Venta de equipo · ' || a.name, NULL,
         CASE a.disposal_payment_method WHEN 'cash_register' THEN 'cash' ELSE a.disposal_payment_method END,
         a.disposal_price, 0, a.id
    FROM fixed_assets a
   WHERE a.business_id = v_bid AND a.disposal_reason = 'sold' AND COALESCE(a.disposal_price, 0) > 0
     AND a.disposed_at BETWEEN p_date_from AND p_date_to

  UNION ALL
  -- Gastos
  SELECT 'out', 'expense', e.expense_date, NULL,
         e.description, COALESCE(ec.name, e.category::TEXT),
         CASE e.payment_method WHEN 'cash_register' THEN 'cash' ELSE COALESCE(e.payment_method, 'other') END,
         e.amount::INTEGER, 0, e.id
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.business_id = e.business_id AND ec.slug = e.category::TEXT
   WHERE e.business_id = v_bid AND e.expense_date BETWEEN p_date_from AND p_date_to

  UNION ALL
  -- Anticipos y pagos al equipo
  SELECT 'out', CASE l.entry_type WHEN 'advance' THEN 'team_advance' ELSE 'team_payment' END,
         (l.created_at AT TIME ZONE 'America/Bogota')::DATE,
         to_char(l.created_at AT TIME ZONE 'America/Bogota', 'HH24:MI'),
         CASE l.entry_type WHEN 'advance' THEN 'Anticipo · ' ELSE 'Pago · ' END || COALESCE(st.full_name, 'profesional'),
         NULL,
         CASE l.payment_method WHEN 'cash_register' THEN 'cash' ELSE COALESCE(l.payment_method, 'other') END,
         l.amount::INTEGER, 0, l.id
    FROM staff_ledger l
    LEFT JOIN staff st ON st.id = l.staff_id
   WHERE l.business_id = v_bid AND l.entry_type IN ('advance', 'payment')
     AND l.created_at >= v_start AND l.created_at < v_end

  UNION ALL
  -- Compras de inventario
  SELECT 'out', 'inventory_purchase',
         (m.created_at AT TIME ZONE 'America/Bogota')::DATE,
         to_char(m.created_at AT TIME ZONE 'America/Bogota', 'HH24:MI'),
         'Compra · ' || m.quantity || ' ' || COALESCE(i.name, 'producto') || COALESCE(' · ' || m.supplier, ''),
         NULL,
         CASE m.payment_method WHEN 'cash_register' THEN 'cash' ELSE COALESCE(m.payment_method, 'other') END,
         m.total_cost::INTEGER, 0, m.id
    FROM inventory_movements m
    LEFT JOIN inventory_items i ON i.id = m.item_id
   WHERE m.business_id = v_bid AND m.movement_type = 'purchase' AND COALESCE(m.total_cost, 0) > 0
     AND m.created_at >= v_start AND m.created_at < v_end

  UNION ALL
  -- Compras de equipos
  SELECT 'out', 'asset_purchase', a.purchase_date, NULL,
         'Compra de equipo · ' || a.name, NULL,
         CASE a.payment_method WHEN 'cash_register' THEN 'cash' ELSE COALESCE(a.payment_method, 'other') END,
         a.purchase_price, 0, a.id
    FROM fixed_assets a
   WHERE a.business_id = v_bid AND a.purchase_date BETWEEN p_date_from AND p_date_to;
END;
$$;
REVOKE ALL ON FUNCTION public.get_money_movements(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_money_movements(DATE, DATE) TO authenticated;

-- ── Resumen viejo: ahora con verificación de negocio y admin ─────────────────
CREATE OR REPLACE FUNCTION public.get_accounting_summary(
  p_business_id UUID,
  p_date_from   DATE,
  p_date_to     DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in  INTEGER;
  v_out INTEGER;
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  IF NOT public._is_business_admin(p_business_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'in' AND method <> 'loyalty_points'), 0),
         COALESCE(SUM(amount) FILTER (WHERE kind = 'out'), 0)
    INTO v_in, v_out
    FROM public.get_money_movements(p_date_from, p_date_to);

  RETURN json_build_object(
    'total_income',  v_in,
    'total_expense', v_out,
    'net_position',  v_in - v_out,
    'period_from',   p_date_from,
    'period_to',     p_date_to
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_accounting_summary(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_accounting_summary(UUID, DATE, DATE) TO authenticated;
