-- ============================================================
-- 20261001110000_money_accounts_part2.sql — Cobrar y pagar con el medio exacto
--
-- Las funciones de cobro y compra reciben un medio (p_account_id) opcional.
-- Si no llega, todo sigue como antes (el medio se asigna solo). Si llega:
--   - debe ser un medio activo del negocio,
--   - Efectivo (la caja) exige turno abierto y equivale a "efectivo",
--   - cualquier otro medio equivale a transferencia/tarjeta/Mercado Pago
--     según lo que diga el medio (para la caja y los reportes de siempre).
-- Funciones: checkout_appointment_secure, create_pos_sale,
-- record_stock_movement, register_fixed_asset, dispose_fixed_asset.
-- Gastos y pagos al equipo se insertan directo desde la app con account_id.
-- ============================================================

-- Valida el medio y dice si es la caja
CREATE OR REPLACE FUNCTION public._check_account(p_business_id UUID, p_account_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_drawer BOOLEAN;
BEGIN
  SELECT is_cash_drawer INTO v_drawer FROM money_accounts
   WHERE id = p_account_id AND business_id = p_business_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_account'; END IF;
  RETURN v_drawer;
END;
$$;
REVOKE ALL ON FUNCTION public._check_account(UUID, UUID) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.checkout_appointment_secure(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, JSONB);
CREATE FUNCTION public.checkout_appointment_secure(
  p_appointment_id  UUID,
  p_business_id     UUID,
  p_shift_id        UUID,
  p_payment_method  TEXT,
  p_tip_amount      NUMERIC DEFAULT 0,
  p_discount_amount NUMERIC DEFAULT 0,
  p_items           JSONB   DEFAULT '[]'::JSONB,
  p_account_id      UUID    DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_res    JSONB;
  v_sale   UUID;
  v_drawer BOOLEAN;
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  PERFORM 1 FROM appointments WHERE id = p_appointment_id AND business_id = p_business_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  PERFORM 1 FROM cash_register_shifts WHERE id = p_shift_id AND business_id = p_business_id AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'shift_not_open'; END IF;

  IF p_account_id IS NOT NULL THEN
    v_drawer := public._check_account(p_business_id, p_account_id);
    -- La caja solo con efectivo; un medio digital nunca con efectivo
    IF v_drawer <> (p_payment_method = 'cash') THEN RAISE EXCEPTION 'account_method_mismatch'; END IF;
  END IF;

  v_res := public.checkout_appointment(p_appointment_id, p_business_id, p_shift_id, p_payment_method,
                                       p_tip_amount, p_discount_amount, p_items);

  IF p_account_id IS NOT NULL THEN
    v_sale := NULLIF(v_res ->> 'sale_id', '')::UUID;
    IF v_sale IS NULL THEN
      SELECT id INTO v_sale FROM sales
       WHERE appointment_id = p_appointment_id AND business_id = p_business_id
       ORDER BY created_at DESC LIMIT 1;
    END IF;
    UPDATE payments SET account_id = p_account_id
     WHERE sale_id = v_sale AND business_id = p_business_id AND payment_method <> 'loyalty_points';
  END IF;
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.checkout_appointment_secure(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkout_appointment_secure(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, JSONB, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.create_pos_sale(UUID, UUID, UUID, UUID, TEXT, INTEGER, JSONB, INTEGER);
CREATE FUNCTION public.create_pos_sale(
  p_business_id     UUID,
  p_shift_id        UUID,
  p_customer_id     UUID,
  p_seller_staff_id UUID,
  p_payment_method  TEXT,
  p_discount        INTEGER,
  p_items           JSONB,              -- [{ "item_id": uuid, "quantity": int }]
  p_loyalty_units   INTEGER DEFAULT 0,
  p_account_id      UUID    DEFAULT NULL
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
  IF p_account_id IS NOT NULL
     AND public._check_account(p_business_id, p_account_id) <> (p_payment_method = 'cash') THEN
    RAISE EXCEPTION 'account_method_mismatch';
  END IF;

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
    INSERT INTO payments (business_id, sale_id, shift_id, amount, payment_method, account_id)
    VALUES (p_business_id, v_sale, p_shift_id, v_total, p_payment_method, p_account_id);
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
REVOKE ALL ON FUNCTION public.create_pos_sale(UUID, UUID, UUID, UUID, TEXT, INTEGER, JSONB, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pos_sale(UUID, UUID, UUID, UUID, TEXT, INTEGER, JSONB, INTEGER, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.record_stock_movement(UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT);
CREATE FUNCTION public.record_stock_movement(
  p_item_id        UUID,
  p_kind           TEXT,              -- 'purchase' | 'count' | 'waste'
  p_quantity       INTEGER,           -- purchase/waste: unidades; count: cantidad contada
  p_unit_cost      INTEGER DEFAULT NULL,
  p_supplier       TEXT    DEFAULT NULL,
  p_payment_method TEXT    DEFAULT NULL,
  p_notes          TEXT    DEFAULT NULL,
  p_account_id     UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it       RECORD;
  v_delta  INTEGER;
  v_type   TEXT;
  v_cost   INTEGER;
  v_shift  UUID;
  v_notes  TEXT := NULLIF(LEFT(btrim(COALESCE(p_notes, '')), 200), '');
  v_new    INTEGER;
  v_pm     TEXT;
BEGIN
  SELECT id, business_id, name, current_stock, COALESCE(unit_cost, 0) AS unit_cost, is_active
    INTO it FROM inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found'; END IF;
  PERFORM public._assert_business_access(it.business_id);
  IF NOT public._is_business_admin(it.business_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT it.is_active THEN RAISE EXCEPTION 'item_inactive'; END IF;
  IF p_quantity IS NULL OR p_quantity < 0 OR p_quantity > 100000 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;

  IF p_kind = 'purchase' THEN
    IF p_quantity = 0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
    IF p_unit_cost IS NULL OR p_unit_cost < 0 OR p_unit_cost > 10000000 THEN RAISE EXCEPTION 'invalid_cost'; END IF;
    IF COALESCE(p_payment_method, 'transfer') NOT IN ('cash_register', 'transfer', 'other') THEN
      RAISE EXCEPTION 'invalid_payment_method';
    END IF;
    -- Con medio exacto: la caja = efectivo de la caja; otro medio = transferencia
    IF p_account_id IS NOT NULL THEN
      v_pm := CASE WHEN public._check_account(it.business_id, p_account_id) THEN 'cash_register' ELSE 'transfer' END;
    ELSE
      v_pm := COALESCE(p_payment_method, 'transfer');
    END IF;
    IF v_pm = 'cash_register' THEN
      SELECT id INTO v_shift FROM cash_register_shifts
       WHERE business_id = it.business_id AND status = 'open'
       ORDER BY opened_at DESC LIMIT 1;
      IF v_shift IS NULL THEN RAISE EXCEPTION 'shift_not_open'; END IF;
    END IF;
    v_delta := p_quantity;
    v_type  := 'purchase';
    -- Costo promedio ponderado (lo que ya había + lo que llega)
    v_cost  := CASE WHEN it.current_stock + p_quantity > 0
                    THEN ROUND((it.current_stock::NUMERIC * it.unit_cost + p_quantity::NUMERIC * p_unit_cost)
                               / (it.current_stock + p_quantity))::INTEGER
                    ELSE p_unit_cost END;
  ELSIF p_kind = 'count' THEN
    IF v_notes IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
    v_delta := p_quantity - it.current_stock;
    IF v_delta = 0 THEN RAISE EXCEPTION 'no_change'; END IF;
    v_type  := 'adjustment';
  ELSIF p_kind = 'waste' THEN
    IF v_notes IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
    IF p_quantity = 0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
    IF p_quantity > it.current_stock THEN RAISE EXCEPTION 'insufficient_stock'; END IF;
    v_delta := -p_quantity;
    v_type  := 'waste';
  ELSE
    RAISE EXCEPTION 'invalid_kind';
  END IF;

  v_new := it.current_stock + v_delta;

  UPDATE inventory_items
     SET current_stock = v_new,
         unit_cost     = CASE WHEN p_kind = 'purchase' THEN v_cost ELSE unit_cost END,
         updated_at    = NOW()
   WHERE id = it.id;

  INSERT INTO inventory_movements (business_id, item_id, quantity, movement_type, notes, created_by,
                                   unit_cost, total_cost, supplier, payment_method, shift_id, account_id)
  VALUES (it.business_id, it.id, v_delta, v_type,
          COALESCE(v_notes, CASE WHEN p_kind = 'purchase' THEN 'Compra' END),
          auth.uid(),
          CASE WHEN p_kind = 'purchase' THEN p_unit_cost ELSE it.unit_cost END,
          CASE WHEN p_kind = 'purchase' THEN p_unit_cost * p_quantity ELSE ABS(v_delta) * it.unit_cost END,
          CASE WHEN p_kind = 'purchase' THEN NULLIF(LEFT(btrim(COALESCE(p_supplier, '')), 80), '') END,
          CASE WHEN p_kind = 'purchase' THEN v_pm END,
          v_shift,
          CASE WHEN p_kind = 'purchase' THEN p_account_id END);

  RETURN jsonb_build_object('item_id', it.id, 'new_stock', v_new, 'delta', v_delta,
                            'unit_cost', CASE WHEN p_kind = 'purchase' THEN v_cost ELSE it.unit_cost END);
END;
$$;
REVOKE ALL ON FUNCTION public.record_stock_movement(UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_movement(UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.register_fixed_asset(TEXT, TEXT, DATE, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE FUNCTION public.register_fixed_asset(
  p_name               TEXT,
  p_category           TEXT,
  p_purchase_date      DATE,
  p_purchase_price     INTEGER,
  p_salvage_value      INTEGER,
  p_useful_life_months INTEGER,
  p_method             TEXT DEFAULT 'straight_line',
  p_payment_method     TEXT DEFAULT 'transfer',
  p_serial_number      TEXT DEFAULT NULL,
  p_location           TEXT DEFAULT NULL,
  p_description        TEXT DEFAULT NULL,
  p_account_id         UUID DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bid   UUID;
  v_shift UUID;
  v_id    UUID;
  v_name  TEXT := NULLIF(LEFT(btrim(COALESCE(p_name, '')), 150), '');
  v_pm    TEXT;
BEGIN
  BEGIN
    v_bid := (auth.jwt() -> 'app_metadata' ->> 'business_id')::UUID;
  EXCEPTION WHEN OTHERS THEN v_bid := NULL;
  END;
  IF v_bid IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT public._is_business_admin(v_bid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required'; END IF;
  IF COALESCE(p_category, '') NOT IN ('furniture', 'equipment', 'technology', 'improvements', 'vehicle', 'other') THEN
    RAISE EXCEPTION 'invalid_category';
  END IF;
  IF p_purchase_date IS NULL OR p_purchase_date > public._bogota_today() OR p_purchase_date < DATE '2000-01-01' THEN
    RAISE EXCEPTION 'invalid_date';
  END IF;
  IF p_purchase_price IS NULL OR p_purchase_price <= 0 OR p_purchase_price > 2000000000 THEN RAISE EXCEPTION 'invalid_price'; END IF;
  IF p_salvage_value IS NULL OR p_salvage_value < 0 OR p_salvage_value >= p_purchase_price THEN RAISE EXCEPTION 'invalid_salvage'; END IF;
  IF p_useful_life_months IS NULL OR p_useful_life_months < 1 OR p_useful_life_months > 600 THEN RAISE EXCEPTION 'invalid_life'; END IF;
  IF COALESCE(p_method, '') NOT IN ('straight_line', 'declining_balance') THEN RAISE EXCEPTION 'invalid_method'; END IF;
  IF COALESCE(p_payment_method, '') NOT IN ('cash_register', 'transfer', 'other') THEN RAISE EXCEPTION 'invalid_payment_method'; END IF;
  v_pm := p_payment_method;
  IF p_account_id IS NOT NULL THEN
    v_pm := CASE WHEN public._check_account(v_bid, p_account_id) THEN 'cash_register' ELSE 'transfer' END;
  END IF;

  IF v_pm = 'cash_register' THEN
    SELECT id INTO v_shift FROM cash_register_shifts
     WHERE business_id = v_bid AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
    IF v_shift IS NULL THEN RAISE EXCEPTION 'shift_not_open'; END IF;
  END IF;

  INSERT INTO fixed_assets (business_id, name, category, description, serial_number, location,
                            purchase_date, purchase_price, salvage_value, depreciation_method,
                            useful_life_months, is_active, created_by, payment_method, shift_id, account_id)
  VALUES (v_bid, v_name, p_category,
          NULLIF(LEFT(btrim(COALESCE(p_description, '')), 500), ''),
          NULLIF(LEFT(btrim(COALESCE(p_serial_number, '')), 100), ''),
          NULLIF(LEFT(btrim(COALESCE(p_location, '')), 100), ''),
          p_purchase_date, p_purchase_price, p_salvage_value, p_method,
          p_useful_life_months, TRUE, auth.uid(), v_pm, v_shift, CASE WHEN v_pm = 'other' THEN NULL ELSE p_account_id END)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_fixed_asset(TEXT, TEXT, DATE, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_fixed_asset(TEXT, TEXT, DATE, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.dispose_fixed_asset(UUID, DATE, TEXT, INTEGER, TEXT, TEXT);
CREATE FUNCTION public.dispose_fixed_asset(
  p_asset_id       UUID,
  p_date           DATE,
  p_reason         TEXT,
  p_price          INTEGER DEFAULT NULL,
  p_payment_method TEXT    DEFAULT NULL,
  p_notes          TEXT    DEFAULT NULL,
  p_account_id     UUID    DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a       public.fixed_assets;
  v_shift UUID;
  v_price INTEGER;
  v_pm    TEXT;
  v_book  INTEGER;
BEGIN
  SELECT * INTO a FROM fixed_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public._assert_business_access(a.business_id);
  IF NOT public._is_business_admin(a.business_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF a.disposed_at IS NOT NULL OR NOT a.is_active THEN RAISE EXCEPTION 'already_disposed'; END IF;

  IF COALESCE(p_reason, '') NOT IN ('sold', 'damaged', 'stolen', 'donated', 'other') THEN RAISE EXCEPTION 'invalid_reason'; END IF;
  IF p_date IS NULL OR p_date > public._bogota_today() OR p_date < a.purchase_date THEN RAISE EXCEPTION 'invalid_date'; END IF;

  IF p_reason = 'sold' THEN
    IF p_price IS NULL OR p_price < 0 OR p_price > 2000000000 THEN RAISE EXCEPTION 'invalid_price'; END IF;
    IF COALESCE(p_payment_method, '') NOT IN ('cash_register', 'transfer', 'other') THEN RAISE EXCEPTION 'invalid_payment_method'; END IF;
    v_price := p_price;
    v_pm    := p_payment_method;
    IF p_account_id IS NOT NULL THEN
      v_pm := CASE WHEN public._check_account(a.business_id, p_account_id) THEN 'cash_register' ELSE 'transfer' END;
    END IF;
    IF v_pm = 'cash_register' THEN
      SELECT id INTO v_shift FROM cash_register_shifts
       WHERE business_id = a.business_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
      IF v_shift IS NULL THEN RAISE EXCEPTION 'shift_not_open'; END IF;
    END IF;
  END IF;

  IF p_reason IN ('damaged', 'stolen', 'other') AND NULLIF(btrim(COALESCE(p_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  v_book := public._asset_value_on(a, p_date);

  UPDATE fixed_assets
     SET is_active               = FALSE,
         disposed_at             = p_date,
         disposal_reason         = p_reason,
         disposal_price          = v_price,
         disposal_payment_method = v_pm,
         disposal_shift_id       = v_shift,
         disposal_account_id     = CASE WHEN p_reason = 'sold' AND v_pm <> 'other' THEN p_account_id END,
         disposal_notes          = NULLIF(LEFT(btrim(COALESCE(p_notes, '')), 300), ''),
         book_value_at_disposal  = v_book
   WHERE id = a.id;

  RETURN jsonb_build_object('asset_id', a.id, 'book_value', v_book, 'price', v_price,
                            'result', COALESCE(v_price, 0) - v_book);
END;
$$;
REVOKE ALL ON FUNCTION public.dispose_fixed_asset(UUID, DATE, TEXT, INTEGER, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset(UUID, DATE, TEXT, INTEGER, TEXT, TEXT, UUID) TO authenticated;

-- ── Contabilidad: movimientos con el nombre del medio y los movimientos del dueño ──
DROP FUNCTION IF EXISTS public.get_money_movements(DATE, DATE);
CREATE FUNCTION public.get_money_movements(p_date_from DATE, p_date_to DATE)
RETURNS TABLE (
  kind          TEXT,     -- 'in' | 'out'
  source        TEXT,     -- sale | asset_sale | expense | team_advance | team_payment | inventory_purchase | asset_purchase
                          -- | owner_contribution | owner_loan | loan_repayment | owner_withdrawal | transfer_in | transfer_out | adjustment
  occurred_on   DATE,     -- día en Colombia
  occurred_time TEXT,     -- 'HH24:MI' en Colombia (NULL si solo hay fecha)
  description   TEXT,
  category      TEXT,
  method        TEXT,     -- cash | card | transfer | mercadopago | loyalty_points | mixed | other
  account       TEXT,     -- nombre del medio del negocio (NULL = fuera de las cuentas / puntos)
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
         pa.name::TEXT,
         p.amount::INTEGER,
         CASE WHEN ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY p.created_at, p.id) = 1
              THEN COALESCE(s.tip_amount, 0)::INTEGER ELSE 0 END,
         s.id
    FROM payments p
    JOIN sales s ON s.id = p.sale_id
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN money_accounts pa ON pa.id = p.account_id
   WHERE p.business_id = v_bid AND s.business_id = v_bid
     AND s.status IN ('paid', 'completed')
     AND p.created_at >= v_start AND p.created_at < v_end

  UNION ALL
  -- Venta de equipos
  SELECT 'in', 'asset_sale', a.disposed_at, NULL,
         'Venta de equipo · ' || a.name, NULL,
         CASE a.disposal_payment_method WHEN 'cash_register' THEN 'cash' ELSE a.disposal_payment_method END,
         da.name,
         a.disposal_price, 0, a.id
    FROM fixed_assets a
    LEFT JOIN money_accounts da ON da.id = a.disposal_account_id
   WHERE a.business_id = v_bid AND a.disposal_reason = 'sold' AND COALESCE(a.disposal_price, 0) > 0
     AND a.disposed_at BETWEEN p_date_from AND p_date_to

  UNION ALL
  -- Gastos
  SELECT 'out', 'expense', e.expense_date, NULL,
         e.description, COALESCE(ec.name, e.category::TEXT),
         CASE e.payment_method WHEN 'cash_register' THEN 'cash' ELSE COALESCE(e.payment_method, 'other') END,
         ea.name,
         e.amount::INTEGER, 0, e.id
    FROM expenses e
    LEFT JOIN money_accounts ea ON ea.id = e.account_id
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
         la.name,
         l.amount::INTEGER, 0, l.id
    FROM staff_ledger l
    LEFT JOIN money_accounts la ON la.id = l.account_id
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
         ma.name,
         m.total_cost::INTEGER, 0, m.id
    FROM inventory_movements m
    LEFT JOIN money_accounts ma ON ma.id = m.account_id
    LEFT JOIN inventory_items i ON i.id = m.item_id
   WHERE m.business_id = v_bid AND m.movement_type = 'purchase' AND COALESCE(m.total_cost, 0) > 0
     AND m.created_at >= v_start AND m.created_at < v_end

  UNION ALL
  -- Compras de equipos
  SELECT 'out', 'asset_purchase', a.purchase_date, NULL,
         'Compra de equipo · ' || a.name, NULL,
         CASE a.payment_method WHEN 'cash_register' THEN 'cash' ELSE COALESCE(a.payment_method, 'other') END,
         pa2.name,
         a.purchase_price, 0, a.id
    FROM fixed_assets a
    LEFT JOIN money_accounts pa2 ON pa2.id = a.account_id
   WHERE a.business_id = v_bid AND a.purchase_date BETWEEN p_date_from AND p_date_to

  UNION ALL
  -- Movimientos del dueño y traslados: entrada al medio destino
  SELECT 'in', CASE am.kind WHEN 'transfer' THEN 'transfer_in' ELSE am.kind END,
         (am.occurred_at AT TIME ZONE 'America/Bogota')::DATE,
         to_char(am.occurred_at AT TIME ZONE 'America/Bogota', 'HH24:MI'),
         CASE am.kind
           WHEN 'owner_contribution' THEN 'Aporte del dueño'
           WHEN 'owner_loan'         THEN 'Préstamo del dueño'
           WHEN 'transfer'           THEN 'Traslado desde ' || COALESCE(fa.name, 'otro medio')
           ELSE 'Ajuste de saldo' END || COALESCE(' · ' || am.notes, ''),
         NULL,
         CASE WHEN ta.is_cash_drawer THEN 'cash' ELSE ta.method_kind END,
         ta.name,
         am.amount, 0, am.id
    FROM account_movements am
    JOIN money_accounts ta ON ta.id = am.to_account_id
    LEFT JOIN money_accounts fa ON fa.id = am.from_account_id
   WHERE am.business_id = v_bid AND am.occurred_at >= v_start AND am.occurred_at < v_end

  UNION ALL
  -- … y salida del medio origen
  SELECT 'out', CASE am.kind WHEN 'transfer' THEN 'transfer_out' ELSE am.kind END,
         (am.occurred_at AT TIME ZONE 'America/Bogota')::DATE,
         to_char(am.occurred_at AT TIME ZONE 'America/Bogota', 'HH24:MI'),
         CASE am.kind
           WHEN 'loan_repayment'   THEN 'Devolución de préstamo al dueño'
           WHEN 'owner_withdrawal' THEN 'Retiro del dueño'
           WHEN 'transfer'         THEN 'Traslado hacia ' || COALESCE(ta.name, 'otro medio')
           ELSE 'Ajuste de saldo' END || COALESCE(' · ' || am.notes, ''),
         NULL,
         CASE WHEN fa.is_cash_drawer THEN 'cash' ELSE fa.method_kind END,
         fa.name,
         am.amount, 0, am.id
    FROM account_movements am
    JOIN money_accounts fa ON fa.id = am.from_account_id
    LEFT JOIN money_accounts ta ON ta.id = am.to_account_id
   WHERE am.business_id = v_bid AND am.occurred_at >= v_start AND am.occurred_at < v_end;
END;
$$;
REVOKE ALL ON FUNCTION public.get_money_movements(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_money_movements(DATE, DATE) TO authenticated;
