-- ============================================================
-- 20260930120000_pos_sales_and_void.sql — Punto de Venta real + anulación + seguridad
--
-- 1. create_pos_sale: venta de productos del inventario (precio del catálogo,
--    existencias con bloqueo y respetando lo apartado por reservas, descuenta
--    stock), cliente opcional (gana/canjea puntos), vendedor opcional (comisión
--    de productos por trigger). Todo o nada.
-- 2. void_sale (solo admin, caja abierta): anula una venta pagada → devuelve
--    inventario, revierte comisiones/propinas (descuento en la cuenta del
--    profesional), revierte puntos ganados y devuelve los canjeados, y la cita
--    vuelve a "lista para pagar". Resuelve TD-011.
-- 3. Caja y estado de resultados ignoran ventas anuladas.
-- 4. Seguridad (TD-012): checkout_appointment_secure verifica el negocio y la
--    caja; create_retail_sale y checkout_appointment directos quedan cerrados;
--    record_inventory_movement verifica el negocio; ventas/pagos no se escriben
--    directo por la API; caja e inventario solo los escribe el admin.
-- ============================================================

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT CHECK (void_reason IS NULL OR char_length(void_reason) <= 200),
  ADD COLUMN IF NOT EXISTS seller_staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL;

-- ── 1. Venta de punto de venta ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_pos_sale(
  p_business_id     UUID,
  p_shift_id        UUID,
  p_customer_id     UUID,
  p_seller_staff_id UUID,
  p_payment_method  TEXT,
  p_discount        INTEGER,
  p_items           JSONB,              -- [{ "item_id": uuid, "quantity": int }]
  p_loyalty_units   INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r          RECORD;
  v_item     RECORD;
  l          JSONB;
  b          RECORD;
  bal        RECORD;
  v_sale     UUID;
  v_sub      INTEGER := 0;
  v_disc     INTEGER := GREATEST(COALESCE(p_discount, 0), 0);
  v_units    INTEGER := GREATEST(COALESCE(p_loyalty_units, 0), 0);
  v_loy_disc INTEGER := 0;
  v_total    INTEGER;
  v_lines    JSONB := '[]'::JSONB;
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  IF p_payment_method NOT IN ('cash', 'card', 'transfer') THEN RAISE EXCEPTION 'invalid_payment_method'; END IF;

  PERFORM 1 FROM cash_register_shifts WHERE id = p_shift_id AND business_id = p_business_id AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'shift_not_open'; END IF;

  IF p_customer_id IS NOT NULL THEN
    PERFORM 1 FROM customers WHERE id = p_customer_id AND business_id = p_business_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'customer_not_found'; END IF;
  END IF;
  IF p_seller_staff_id IS NOT NULL THEN
    PERFORM 1 FROM staff WHERE id = p_seller_staff_id AND business_id = p_business_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'empty_cart';
  END IF;
  IF jsonb_array_length(p_items) > 50 THEN RAISE EXCEPTION 'too_many_items'; END IF;

  -- Validar y bloquear cada producto (orden estable → sin interbloqueos)
  FOR r IN
    SELECT (e->>'item_id')::UUID AS item_id, SUM((e->>'quantity')::INTEGER)::INTEGER AS qty
      FROM jsonb_array_elements(p_items) e
     GROUP BY 1 ORDER BY 1
  LOOP
    IF r.qty IS NULL OR r.qty <= 0 OR r.qty > 999 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
    SELECT id, name, current_stock, unit_price INTO v_item
      FROM inventory_items
     WHERE id = r.item_id AND business_id = p_business_id AND is_active
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found'; END IF;
    IF COALESCE(v_item.unit_price, 0) <= 0 THEN RAISE EXCEPTION 'item_without_price:%', v_item.name; END IF;
    IF v_item.current_stock - public._inventory_reserved_qty(r.item_id) < r.qty THEN
      RAISE EXCEPTION 'insufficient_stock:%', v_item.name;
    END IF;
    v_sub   := v_sub + (v_item.unit_price * r.qty)::INTEGER;
    v_lines := v_lines || jsonb_build_object('item_id', v_item.id, 'name', v_item.name,
                                             'qty', r.qty, 'price', v_item.unit_price::INTEGER);
  END LOOP;

  IF v_disc > v_sub THEN RAISE EXCEPTION 'discount_too_high'; END IF;

  -- Canje de puntos (solo modo puntos, con cliente)
  IF v_units > 0 THEN
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'loyalty_requires_customer'; END IF;
    SELECT loyalty_mode, loyalty_point_value_cop, loyalty_min_redeem_points,
           COALESCE((features_enabled ->> 'loyalty')::BOOLEAN, FALSE) AS enabled
      INTO b FROM businesses WHERE id = p_business_id;
    IF NOT b.enabled OR b.loyalty_mode <> 'points' THEN RAISE EXCEPTION 'loyalty_not_available'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('loyalty:' || p_customer_id::TEXT));
    SELECT * INTO bal FROM public._loyalty_balance(p_business_id, p_customer_id, 'points');
    v_units := LEAST(v_units, bal.balance,
                     FLOOR((v_sub - v_disc)::NUMERIC / GREATEST(b.loyalty_point_value_cop, 1))::INTEGER);
    IF v_units <= 0 OR v_units < b.loyalty_min_redeem_points THEN RAISE EXCEPTION 'loyalty_below_minimum'; END IF;
    v_loy_disc := v_units * b.loyalty_point_value_cop;
  END IF;

  v_total := v_sub - v_disc - v_loy_disc;

  INSERT INTO sales (business_id, shift_id, appointment_id, customer_id, subtotal, discount_amount,
                     tip_amount, total_amount, status, seller_staff_id)
  VALUES (p_business_id, p_shift_id, NULL, p_customer_id, v_sub, v_disc + v_loy_disc,
          0, v_total, 'paid', p_seller_staff_id)
  RETURNING id INTO v_sale;

  -- Líneas (los triggers registran comisión del vendedor y puntos del cliente)
  FOR l IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    INSERT INTO sale_items (business_id, sale_id, staff_id, item_type, description, quantity, unit_price, total_price)
    VALUES (p_business_id, v_sale, p_seller_staff_id, 'product', l->>'name',
            (l->>'qty')::INTEGER, (l->>'price')::INTEGER, (l->>'price')::INTEGER * (l->>'qty')::INTEGER);

    UPDATE inventory_items
       SET current_stock = current_stock - (l->>'qty')::INTEGER, updated_at = NOW()
     WHERE id = (l->>'item_id')::UUID AND business_id = p_business_id;

    INSERT INTO inventory_movements (business_id, item_id, quantity, movement_type, reference_id, notes, created_by)
    VALUES (p_business_id, (l->>'item_id')::UUID, -((l->>'qty')::INTEGER), 'sale', v_sale, 'Punto de venta', auth.uid());
  END LOOP;

  IF v_total > 0 THEN
    INSERT INTO payments (business_id, sale_id, shift_id, amount, payment_method)
    VALUES (p_business_id, v_sale, p_shift_id, v_total, p_payment_method);
  END IF;

  IF v_units > 0 THEN
    INSERT INTO loyalty_ledgers (business_id, client_id, kind, entry_type, points_added, points_redeemed,
                                 transaction_reference, sale_id, expires_at, discount_cop, created_by, notes)
    VALUES (p_business_id, p_customer_id, 'points', 'redeem', 0, v_units, v_sale, v_sale, NULL,
            v_loy_disc, auth.uid(), 'Canje en punto de venta');
  END IF;

  RETURN jsonb_build_object('sale_id', v_sale, 'subtotal', v_sub, 'discount', v_disc,
                            'loyalty_discount', v_loy_disc, 'loyalty_units', v_units, 'total', v_total);
END;
$$;
REVOKE ALL ON FUNCTION public.create_pos_sale(UUID, UUID, UUID, UUID, TEXT, INTEGER, JSONB, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pos_sale(UUID, UUID, UUID, UUID, TEXT, INTEGER, JSONB, INTEGER) TO authenticated;

-- ── 2. Anular una venta (TD-011) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_sale(p_sale_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s        RECORD;
  m        RECORD;
  e        RECORD;
  y        RECORD;
  bal      RECORD;
  b        RECORD;
  v_reason TEXT := LEFT(btrim(COALESCE(p_reason, '')), 200);
  v_client UUID;
  v_items  INTEGER := 0;
  v_ledger INTEGER := 0;
  v_take   INTEGER;
BEGIN
  SELECT * INTO s FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public._assert_business_access(s.business_id);
  IF NOT public._is_business_admin(s.business_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF s.status <> 'paid' THEN RAISE EXCEPTION 'not_paid'; END IF;
  IF char_length(v_reason) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF s.shift_id IS NOT NULL THEN
    PERFORM 1 FROM cash_register_shifts WHERE id = s.shift_id AND status = 'open';
    IF NOT FOUND THEN RAISE EXCEPTION 'shift_closed'; END IF;
  END IF;

  UPDATE sales SET status = 'voided', voided_at = NOW(), voided_by = auth.uid(), void_reason = v_reason
   WHERE id = s.id;

  -- Inventario: devolver lo que salió por esta venta
  FOR m IN
    SELECT item_id, SUM(quantity)::INTEGER AS qty
      FROM inventory_movements
     WHERE reference_id = s.id AND business_id = s.business_id AND movement_type = 'sale'
     GROUP BY item_id
    HAVING SUM(quantity) < 0
  LOOP
    UPDATE inventory_items SET current_stock = current_stock + (-m.qty), updated_at = NOW()
     WHERE id = m.item_id AND business_id = s.business_id;
    INSERT INTO inventory_movements (business_id, item_id, quantity, movement_type, reference_id, notes, created_by)
    VALUES (s.business_id, m.item_id, -m.qty, 'sale', s.id, 'Devolución por anulación', auth.uid());
    v_items := v_items + 1;
  END LOOP;

  -- Comisiones y propinas: descuento en la cuenta del profesional
  FOR e IN
    SELECT id, staff_id, amount, notes FROM staff_ledger
     WHERE sale_id = s.id AND entry_type IN ('commission', 'tip')
       AND NOT EXISTS (SELECT 1 FROM staff_ledger d WHERE d.reference_id = staff_ledger.id AND d.entry_type = 'deduction')
  LOOP
    INSERT INTO staff_ledger (business_id, staff_id, entry_type, amount, notes, reference_id, sale_id, created_by)
    VALUES (s.business_id, e.staff_id, 'deduction', e.amount,
            LEFT('Anulación de venta: ' || COALESCE(e.notes, ''), 300), e.id, s.id, auth.uid());
    v_ledger := v_ledger + 1;
  END LOOP;

  -- Lealtad: quitar lo ganado (hasta el saldo) y devolver lo canjeado
  v_client := s.customer_id;
  IF v_client IS NULL AND s.appointment_id IS NOT NULL THEN
    SELECT customer_id INTO v_client FROM appointments WHERE id = s.appointment_id;
  END IF;
  IF v_client IS NOT NULL THEN
    SELECT loyalty_expiry_months INTO b FROM businesses WHERE id = s.business_id;
    PERFORM pg_advisory_xact_lock(hashtext('loyalty:' || v_client::TEXT));
    FOR y IN
      SELECT kind, entry_type, SUM(points_added)::INTEGER AS added, SUM(points_redeemed)::INTEGER AS redeemed
        FROM loyalty_ledgers
       WHERE sale_id = s.id AND entry_type IN ('earn', 'redeem')
       GROUP BY kind, entry_type
    LOOP
      IF y.entry_type = 'redeem' AND y.redeemed > 0 THEN
        INSERT INTO loyalty_ledgers (business_id, client_id, kind, entry_type, points_added, points_redeemed,
                                     expires_at, created_by, notes)
        VALUES (s.business_id, v_client, y.kind, 'adjust', y.redeemed, 0,
                CASE WHEN y.kind = 'points' THEN NOW() + make_interval(months => COALESCE(b.loyalty_expiry_months, 12)) END,
                auth.uid(), 'Devolución por anulación de venta');
      ELSIF y.entry_type = 'earn' AND y.added > 0 THEN
        SELECT * INTO bal FROM public._loyalty_balance(s.business_id, v_client, y.kind);
        v_take := LEAST(y.added, GREATEST(bal.balance, 0));
        IF v_take > 0 THEN
          INSERT INTO loyalty_ledgers (business_id, client_id, kind, entry_type, points_added, points_redeemed,
                                       expires_at, created_by, notes)
          VALUES (s.business_id, v_client, y.kind, 'adjust', 0, v_take, NULL, auth.uid(),
                  'Anulación de venta');
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- La cita vuelve a quedar lista para cobrar
  IF s.appointment_id IS NOT NULL THEN
    UPDATE appointments SET status = 'ready_to_pay', updated_at = NOW()
     WHERE id = s.appointment_id AND status = 'completed';
  END IF;

  RETURN jsonb_build_object('sale_id', s.id, 'items_returned', v_items, 'ledger_reversed', v_ledger);
END;
$$;
REVOKE ALL ON FUNCTION public.void_sale(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_sale(UUID, TEXT) TO authenticated;

-- ── 3. Caja y estado de resultados sin ventas anuladas ───────────────────────
CREATE OR REPLACE FUNCTION public.get_shift_cash_summary(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business UUID;
BEGIN
  SELECT business_id INTO v_business FROM cash_register_shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public._assert_business_access(v_business);

  RETURN jsonb_build_object(
    'total_sales',
      (SELECT COALESCE(SUM(total_amount), 0) FROM sales
        WHERE shift_id = p_shift_id AND business_id = v_business AND status <> 'voided'),
    'cash_collected',
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
         JOIN sales s ON s.id = p.sale_id
        WHERE p.shift_id = p_shift_id AND p.business_id = v_business AND p.payment_method = 'cash'
          AND s.status <> 'voided'),
    'cash_expenses',
      (SELECT COALESCE(SUM(amount), 0) FROM expenses
        WHERE shift_id = p_shift_id AND business_id = v_business AND payment_method = 'cash_register'),
    'cash_team_payments',
      (SELECT COALESCE(SUM(amount), 0) FROM staff_ledger
        WHERE shift_id = p_shift_id AND business_id = v_business
          AND payment_method = 'cash_register' AND entry_type IN ('advance', 'payment'))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_profit_loss(
  p_business_id UUID,
  p_date_from   DATE,
  p_date_to     DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start      TIMESTAMPTZ;
  v_end        TIMESTAMPTZ;
  v_services   INTEGER := 0;
  v_retail     INTEGER := 0;
  v_discounts  INTEGER := 0;
  v_revenue    INTEGER := 0;
  v_tips       INTEGER := 0;
  v_cogs       INTEGER := 0;
  v_comm       INTEGER := 0;
  v_expenses   INTEGER := 0;
  v_by_cat     JSONB   := '[]'::JSONB;
  v_gross      INTEGER := 0;
  v_net        INTEGER := 0;
  v_sales_cnt  INTEGER := 0;
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

  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  -- Días locales de Colombia → instantes reales
  v_start := p_date_from::TIMESTAMP AT TIME ZONE 'America/Bogota';
  v_end   := (p_date_to + 1)::TIMESTAMP AT TIME ZONE 'America/Bogota';

  -- Ingresos por tipo, con el descuento de cada venta repartido por línea
  WITH s AS (
    SELECT id, subtotal, discount_amount, tip_amount
      FROM sales
     WHERE business_id = p_business_id AND status = 'paid'
       AND created_at >= v_start AND created_at < v_end
  ), lines AS (
    SELECT si.item_type,
           si.total_price,
           CASE WHEN COALESCE(s.subtotal, 0) > 0
                THEN si.total_price * GREATEST(s.subtotal - COALESCE(s.discount_amount, 0), 0) / s.subtotal
                ELSE 0 END AS net_price
      FROM sale_items si JOIN s ON s.id = si.sale_id
  )
  SELECT COALESCE(ROUND(SUM(net_price) FILTER (WHERE item_type = 'service')), 0)::INTEGER,
         COALESCE(ROUND(SUM(net_price) FILTER (WHERE item_type <> 'service')), 0)::INTEGER,
         COALESCE(ROUND(SUM(total_price - net_price)), 0)::INTEGER
    INTO v_services, v_retail, v_discounts
    FROM lines;

  SELECT COALESCE(ROUND(SUM(tip_amount)), 0)::INTEGER, COUNT(*)
    INTO v_tips, v_sales_cnt
    FROM sales
   WHERE business_id = p_business_id AND status = 'paid'
     AND created_at >= v_start AND created_at < v_end;

  v_revenue := v_services + v_retail;

  -- Costo de productos vendidos: salidas por venta menos devoluciones por anulación
  SELECT GREATEST(COALESCE(ROUND(SUM(-m.quantity * COALESCE(i.unit_cost, 0))), 0), 0)::INTEGER
    INTO v_cogs
    FROM inventory_movements m
    JOIN inventory_items i ON i.id = m.item_id
   WHERE m.business_id = p_business_id
     AND m.movement_type = 'sale'
     AND m.created_at >= v_start AND m.created_at < v_end;

  -- Comisiones reales (por fecha de la venta), menos las revertidas por anulación
  SELECT COALESCE(SUM(CASE WHEN l.entry_type = 'commission' THEN l.amount ELSE -l.amount END), 0)::INTEGER
    INTO v_comm
    FROM staff_ledger l
    JOIN sales s ON s.id = l.sale_id
   WHERE l.business_id = p_business_id
     AND (l.entry_type = 'commission'
          OR (l.entry_type = 'deduction' AND l.notes LIKE 'Anulación de venta%' AND l.reference_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM staff_ledger c WHERE c.id = l.reference_id AND c.entry_type = 'commission')))
     AND s.created_at >= v_start AND s.created_at < v_end;

  -- Gastos (expense_date ya es fecha local)
  SELECT COALESCE(SUM(amount), 0)::INTEGER
    INTO v_expenses
    FROM expenses
   WHERE business_id = p_business_id
     AND expense_date BETWEEN p_date_from AND p_date_to;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'total', cat_total)
                            ORDER BY cat_total DESC), '[]'::JSONB)
    INTO v_by_cat
    FROM (
      SELECT category, SUM(amount)::INTEGER AS cat_total
        FROM expenses
       WHERE business_id = p_business_id
         AND expense_date BETWEEN p_date_from AND p_date_to
       GROUP BY category
    ) g;

  v_gross := v_revenue - v_cogs;                       -- utilidad bruta
  v_net   := v_gross - v_comm - v_expenses;            -- utilidad neta

  RETURN jsonb_build_object(
    'revenue', jsonb_build_object(
      'services',  v_services,
      'retail',    v_retail,
      'total',     v_revenue,
      'discounts', v_discounts,
      'sales_count', v_sales_cnt
    ),
    'tips',              v_tips,
    'cost_of_goods',     v_cogs,
    'expenses', jsonb_build_object(
      'total',       v_expenses,
      'by_category', v_by_cat
    ),
    'gross_profit',      v_gross,
    'commissions',       v_comm,
    'net_profit',        v_net,
    'margin_pct',        CASE WHEN v_revenue > 0 THEN ROUND(v_net * 100.0 / v_revenue, 1) ELSE NULL END
  );
END;
$$;

-- ── 4. Seguridad ─────────────────────────────────────────────────────────────
-- Cobro de citas: verifica negocio y caja abierta antes del cobro original
CREATE OR REPLACE FUNCTION public.checkout_appointment_secure(
  p_appointment_id  UUID,
  p_business_id     UUID,
  p_shift_id        UUID,
  p_payment_method  TEXT,
  p_tip_amount      NUMERIC DEFAULT 0,
  p_discount_amount NUMERIC DEFAULT 0,
  p_items           JSONB   DEFAULT '[]'::JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  PERFORM 1 FROM appointments WHERE id = p_appointment_id AND business_id = p_business_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  PERFORM 1 FROM cash_register_shifts WHERE id = p_shift_id AND business_id = p_business_id AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'shift_not_open'; END IF;
  RETURN public.checkout_appointment(p_appointment_id, p_business_id, p_shift_id, p_payment_method,
                                     p_tip_amount, p_discount_amount, p_items);
END;
$$;
REVOKE ALL ON FUNCTION public.checkout_appointment_secure(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkout_appointment_secure(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, JSONB) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.checkout_appointment(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_retail_sale(UUID, UUID, TEXT, UUID, INTEGER, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;

-- Movimientos de inventario: solo dentro del propio negocio
CREATE OR REPLACE FUNCTION public.record_inventory_movement(
  p_business_id  UUID,
  p_item_id      UUID,
  p_quantity     INTEGER,
  p_type         TEXT,
  p_notes        TEXT     DEFAULT NULL,
  p_reference_id UUID     DEFAULT NULL,
  p_user_id      UUID     DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item      RECORD;
  v_new_stock INTEGER;
BEGIN
  PERFORM public._assert_business_access(p_business_id);

  SELECT current_stock, min_stock, name INTO v_item
    FROM public.inventory_items
   WHERE id = p_item_id AND business_id = p_business_id AND is_active = TRUE
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Item not found or does not belong to this business');
  END IF;

  v_new_stock := v_item.current_stock + p_quantity;
  IF v_new_stock < 0 THEN
    RETURN json_build_object('error', 'Insufficient stock', 'current_stock', v_item.current_stock, 'requested', p_quantity);
  END IF;

  INSERT INTO public.inventory_movements (business_id, item_id, quantity, movement_type, reference_id, notes, created_by)
  VALUES (p_business_id, p_item_id, p_quantity, p_type, p_reference_id, p_notes, COALESCE(p_user_id, auth.uid()));

  UPDATE public.inventory_items SET current_stock = v_new_stock, updated_at = NOW()
   WHERE id = p_item_id AND business_id = p_business_id;

  RETURN json_build_object('item_id', p_item_id, 'new_stock', v_new_stock, 'low_stock_warn', v_new_stock <= v_item.min_stock);
END;
$$;
REVOKE ALL ON FUNCTION public.record_inventory_movement(UUID, UUID, INTEGER, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_inventory_movement(UUID, UUID, INTEGER, TEXT, TEXT, UUID, UUID) TO authenticated;

-- Tablas: ventas/líneas/pagos solo por funciones; caja e inventario solo admin
DO $$
DECLARE
  t   TEXT;
  p   RECORD;
  tenant TEXT := $q$(business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id')
                   OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE))$q$;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales', 'sale_items', 'payments', 'cash_register_shifts', 'inventory_items', 'inventory_movements'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR p IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t
         AND NOT ('service_role' = ANY (roles))
         AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS xin_select ON public.%I', t);
    EXECUTE format('CREATE POLICY xin_select ON public.%I FOR SELECT TO authenticated USING %s', t, tenant);
    IF t IN ('cash_register_shifts', 'inventory_items', 'inventory_movements') THEN
      EXECUTE format('DROP POLICY IF EXISTS xin_admin_insert ON public.%I', t);
      EXECUTE format('CREATE POLICY xin_admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public._is_business_admin(business_id))', t);
      EXECUTE format('DROP POLICY IF EXISTS xin_admin_update ON public.%I', t);
      EXECUTE format('CREATE POLICY xin_admin_update ON public.%I FOR UPDATE TO authenticated USING (public._is_business_admin(business_id)) WITH CHECK (public._is_business_admin(business_id))', t);
    END IF;
  END LOOP;
END $$;
