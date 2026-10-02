-- ============================================================
-- 20261001140000_barber_access_part1.sql — Acceso del barbero, parte 1 (ANTES del deploy)
--
-- Contexto: el barbero y la manicurista no deben ver ni mover la plata del negocio.
-- Decisiones de producto: (1) SOLO el administrador cobra (checkout) y vende (POS); el
-- barbero nunca ve el turno de caja abierto. (2) En Clientes el barbero ve a TODOS los
-- clientes con teléfono e historial de visitas, pero SIN montos (gasto total, ticket,
-- monto por visita, precio de productos comprados). El admin ve todo como hasta hoy.
--
-- Esta parte es ADITIVA y segura de correr ANTES de subir el código: no borra ni cambia
-- ninguna política de tablas (eso es la parte 2, 20261001150000, que se corre DESPUÉS
-- del deploy). El código actual sigue funcionando igual con estas funciones:
--
-- 1. get_public_staff(business): el equipo activo para la reserva pública, sin correo,
--    teléfono ni user_id. Reemplaza la lectura directa de `staff` con el cliente anónimo
--    (la parte 2 quita esa política pública).
-- 2. CRM sin plata para el barbero:
--      · list_customers pasa a SECURITY DEFINER (con RLS estricta en sales el INVOKER
--        daría gasto 0 al barbero); el gasto sale NULL si no es admin y el orden "spent"
--        cae a "última visita" para no filtrar el ranking.
--      · get_customer_sales_summary(cliente): totales, monto por visita, productos
--        comprados y productos apartados de las próximas citas. Los montos solo para el
--        admin (NULL para el resto); nombres, cantidades y fechas para todos.
-- 3. Guardas de rol en las funciones DEFINER de dinero: solo el admin (o super_admin) del
--    negocio puede cobrar una cita, vender en el POS, ver el resumen de caja, canjear
--    lealtad en una venta y ver el resumen de lealtad. Se copió la ÚLTIMA definición de
--    cada una y solo se agregó la guarda `admin_required` tras validar el negocio.
--    Verificado: ninguna ruta de barbero ni anónima llama a estas funciones (el cobro,
--    el POS, el turno y el panel de lealtad ya son solo admin en el código).
--
-- Las funciones DEFINER corren como `postgres`; en producción algunas tablas aplican RLS
-- también a ese rol, así que se asegura la política xin_internal_definer en las tablas
-- que leen las funciones nuevas (patrón de 20260930090000_definer_policies.sql).
-- ============================================================

-- ── 0. Política interna para las funciones DEFINER (solo rol postgres) ───────
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'customers', 'appointments', 'sales', 'sale_items',
    'appointment_products', 'inventory_items', 'customer_tags', 'staff', 'businesses'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS xin_internal_definer ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY xin_internal_definer ON public.%I FOR ALL TO postgres USING (TRUE) WITH CHECK (TRUE)', t);
  END LOOP;
END $$;

-- ── 1. Equipo público para la reserva en línea ───────────────────────────────
-- Solo profesionales activos de un negocio ACTIVO. Nunca correo, teléfono ni user_id.
CREATE OR REPLACE FUNCTION public.get_public_staff(p_business_id UUID)
RETURNS TABLE (id UUID, full_name TEXT, specialty_role TEXT, is_active BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.full_name::TEXT, s.specialty_role::TEXT, s.is_active
    FROM staff s
    JOIN businesses b ON b.id = s.business_id
   WHERE s.business_id = p_business_id
     AND s.is_active = TRUE
     AND COALESCE(b.is_active, TRUE) = TRUE
   ORDER BY s.full_name
$$;
REVOKE ALL ON FUNCTION public.get_public_staff(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_staff(UUID) TO anon, authenticated;

-- ── 2a. list_customers: DEFINER, sin plata para quien no es admin ────────────
-- Misma firma y mismo JSON que antes. total_spent = NULL si no es admin.
CREATE OR REPLACE FUNCTION public.list_customers(
  p_business_id UUID,
  p_query       TEXT    DEFAULT NULL,
  p_filter      TEXT    DEFAULT 'all',
  p_sort        TEXT    DEFAULT 'recent',
  p_limit       INTEGER DEFAULT 30,
  p_offset      INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin BOOLEAN;
  v_sort  TEXT;
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  v_admin := public._is_business_admin(p_business_id);
  -- Ordenar por gasto filtraría el ranking de gasto: el no-admin cae a "última visita"
  v_sort := CASE WHEN p_sort = 'spent' AND NOT v_admin THEN 'recent' ELSE p_sort END;

  RETURN (
    WITH now_l AS (
      SELECT (NOW() AT TIME ZONE 'America/Bogota') AS local_ts,
             ((NOW() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'UTC') AS wall_utc
    ),
    base AS (
      SELECT c.*
        FROM customers c
       WHERE c.business_id = p_business_id
         AND (
           COALESCE(TRIM(p_query), '') = ''
           OR c.full_name ILIKE '%' || TRIM(p_query) || '%'
           OR c.phone     ILIKE '%' || TRIM(p_query) || '%'
           OR c.email     ILIKE '%' || TRIM(p_query) || '%'
         )
    ),
    stats AS (
      SELECT b.id,
        (SELECT COUNT(*) FROM appointments a
          WHERE a.customer_id = b.id AND a.business_id = p_business_id AND a.status = 'completed')   AS visits,
        (SELECT COUNT(*) FROM appointments a, now_l n
          WHERE a.customer_id = b.id AND a.business_id = p_business_id AND a.status = 'completed'
            AND a.start_time >= n.wall_utc - INTERVAL '90 days')                                     AS visits_90d,
        (SELECT MAX(a.start_time) FROM appointments a
          WHERE a.customer_id = b.id AND a.business_id = p_business_id AND a.status = 'completed')   AS last_visit,
        (SELECT MIN(a.start_time) FROM appointments a, now_l n
          WHERE a.customer_id = b.id AND a.business_id = p_business_id
            AND a.status IN ('payment_pending', 'scheduled')
            AND a.start_time >= n.wall_utc)                                                          AS next_appointment,
        (SELECT COALESCE(SUM(s.total_amount::NUMERIC), 0) FROM sales s
          WHERE s.customer_id = b.id AND s.business_id = p_business_id AND s.status = 'paid')        AS total_spent,
        (SELECT COALESCE(array_agg(t.tag ORDER BY t.tag), '{}') FROM customer_tags t
          WHERE t.customer_id = b.id AND t.business_id = p_business_id)                              AS tags
      FROM base b
    ),
    filtered AS (
      SELECT b.*, s.visits, s.visits_90d, s.last_visit, s.next_appointment, s.total_spent, s.tags
        FROM base b
        JOIN stats s ON s.id = b.id
        CROSS JOIN now_l n
       WHERE CASE COALESCE(p_filter, 'all')
               WHEN 'frequent' THEN s.visits_90d >= 3
               WHEN 'inactive' THEN s.last_visit IS NOT NULL AND s.last_visit < n.wall_utc - INTERVAL '30 days'
                                    AND s.next_appointment IS NULL
               WHEN 'new'      THEN b.created_at >= date_trunc('month', n.local_ts) AT TIME ZONE 'America/Bogota'
               WHEN 'birthday' THEN b.birthday IS NOT NULL
                                    AND EXTRACT(MONTH FROM b.birthday) = EXTRACT(MONTH FROM n.local_ts)
               ELSE TRUE
             END
    )
    SELECT jsonb_build_object(
      'total', (SELECT COUNT(*) FROM filtered),
      'items', COALESCE((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.ord)
          FROM (
            SELECT f.id, f.full_name, f.phone, f.email, f.birthday, f.preferred_staff_id, f.created_at,
                   f.visits, f.last_visit, f.next_appointment,
                   CASE WHEN v_admin THEN f.total_spent END AS total_spent,
                   f.tags,
                   ROW_NUMBER() OVER (ORDER BY
                     CASE WHEN v_sort = 'spent'   THEN f.total_spent END DESC NULLS LAST,
                     CASE WHEN v_sort = 'name'    THEN f.full_name   END ASC,
                     CASE WHEN v_sort = 'created' THEN f.created_at  END DESC,
                     f.last_visit DESC NULLS LAST,
                     f.updated_at DESC
                   ) AS ord
              FROM filtered f
             ORDER BY ord
             LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100)
            OFFSET GREATEST(COALESCE(p_offset, 0), 0)
          ) p
      ), '[]'::JSONB)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.list_customers(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_customers(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

-- ── 2b. Resumen de compras del cliente (expediente) ──────────────────────────
-- total_spent / paid_sales / paid_by_appointment / total_price de cada producto: SOLO admin
-- (NULL para el resto). Productos (nombre, cantidad, fecha) y apartados: para todos.
-- Convención horaria: appointments.start_time = hora LOCAL como UTC.
CREATE OR REPLACE FUNCTION public.get_customer_sales_summary(p_customer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business UUID;
  v_admin    BOOLEAN;
  v_wall     TIMESTAMPTZ := ((NOW() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'UTC');
BEGIN
  SELECT business_id INTO v_business FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public._assert_business_access(v_business);
  v_admin := public._is_business_admin(v_business);

  RETURN jsonb_build_object(
    'total_spent',
      CASE WHEN v_admin THEN
        (SELECT COALESCE(SUM(s.total_amount::NUMERIC), 0) FROM sales s
          WHERE s.business_id = v_business AND s.customer_id = p_customer_id AND s.status = 'paid')
      END,
    'paid_sales',
      CASE WHEN v_admin THEN
        (SELECT COUNT(*) FROM sales s
          WHERE s.business_id = v_business AND s.customer_id = p_customer_id AND s.status = 'paid')
      END,
    'paid_by_appointment',
      CASE WHEN v_admin THEN
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object('appointment_id', x.appointment_id, 'amount', x.amount))
            FROM (
              SELECT s.appointment_id, SUM(s.total_amount::NUMERIC) AS amount
                FROM sales s
               WHERE s.business_id = v_business AND s.customer_id = p_customer_id
                 AND s.status = 'paid' AND s.appointment_id IS NOT NULL
               GROUP BY s.appointment_id
            ) x
        ), '[]'::JSONB)
      END,
    'purchased_products',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'description', y.description,
                 'quantity',    y.quantity,
                 'total_price', CASE WHEN v_admin THEN y.total_price END,
                 'created_at',  y.created_at
               ) ORDER BY y.created_at DESC)
          FROM (
            SELECT si.description, si.quantity, si.total_price, si.created_at
              FROM sale_items si
              JOIN sales s ON s.id = si.sale_id
             WHERE si.business_id = v_business AND si.item_type = 'product'
               AND s.business_id = v_business AND s.customer_id = p_customer_id AND s.status = 'paid'
             ORDER BY si.created_at DESC
             LIMIT 10
          ) y
      ), '[]'::JSONB),
    'upcoming_products',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'appointment_id', ap.appointment_id,
                 'name',           COALESCE(i.name, 'Producto'),
                 'quantity',       ap.quantity
               ) ORDER BY a.start_time, ap.created_at)
          FROM appointment_products ap
          JOIN appointments a ON a.id = ap.appointment_id
          LEFT JOIN inventory_items i ON i.id = ap.item_id AND i.business_id = v_business
         WHERE a.business_id = v_business AND a.customer_id = p_customer_id
           AND ap.business_id = v_business
           AND a.status IN ('scheduled', 'payment_pending')
           AND a.start_time >= v_wall
      ), '[]'::JSONB)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_customer_sales_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_sales_summary(UUID) TO authenticated;

-- ── 3. Guardas de rol (solo admin) en las funciones DEFINER de dinero ────────
-- Copia de la última definición de cada una; la única diferencia es la línea
--   IF NOT public._is_business_admin(...) THEN RAISE EXCEPTION 'admin_required'; END IF;
-- justo después de validar el acceso al negocio.

-- checkout_appointment_secure (última: 20261001120000_checkout_account_guard.sql)
CREATE OR REPLACE FUNCTION public.checkout_appointment_secure(
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
  IF NOT public._is_business_admin(p_business_id) THEN RAISE EXCEPTION 'admin_required'; END IF;
  PERFORM 1 FROM appointments WHERE id = p_appointment_id AND business_id = p_business_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  PERFORM 1 FROM cash_register_shifts WHERE id = p_shift_id AND business_id = p_business_id AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'shift_not_open'; END IF;

  IF p_account_id IS NOT NULL THEN
    v_drawer := public._check_account(p_business_id, p_account_id);
    IF v_drawer <> (p_payment_method = 'cash') THEN RAISE EXCEPTION 'account_method_mismatch'; END IF;
  END IF;

  v_res := public.checkout_appointment(p_appointment_id, p_business_id, p_shift_id, p_payment_method,
                                       p_tip_amount, p_discount_amount, p_items);

  IF p_account_id IS NOT NULL THEN
    IF v_res ? 'error' THEN RETURN v_res; END IF;
    v_sale := NULLIF(v_res ->> 'sale_id', '')::UUID;
    IF v_sale IS NULL THEN RAISE EXCEPTION 'sale_not_created'; END IF;
    UPDATE payments SET account_id = p_account_id
     WHERE sale_id = v_sale AND business_id = p_business_id AND payment_method <> 'loyalty_points';
  END IF;
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.checkout_appointment_secure(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkout_appointment_secure(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, JSONB, UUID) TO authenticated;

-- create_pos_sale (última: 20261001110000_money_accounts_part2.sql)
CREATE OR REPLACE FUNCTION public.create_pos_sale(
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
  IF NOT public._is_business_admin(p_business_id) THEN RAISE EXCEPTION 'admin_required'; END IF;
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

-- get_shift_cash_summary (última: 20261001100000_money_accounts.sql)
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
  IF NOT public._is_business_admin(v_business) THEN RAISE EXCEPTION 'admin_required'; END IF;

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
          AND payment_method = 'cash_register' AND entry_type IN ('advance', 'payment')),
    'cash_inventory_purchases',
      (SELECT COALESCE(SUM(total_cost), 0) FROM inventory_movements
        WHERE shift_id = p_shift_id AND business_id = v_business
          AND payment_method = 'cash_register' AND movement_type = 'purchase'),
    'cash_asset_purchases',
      (SELECT COALESCE(SUM(purchase_price), 0) FROM fixed_assets
        WHERE shift_id = p_shift_id AND business_id = v_business AND payment_method = 'cash_register'),
    'cash_asset_sales',
      (SELECT COALESCE(SUM(disposal_price), 0) FROM fixed_assets
        WHERE disposal_shift_id = p_shift_id AND business_id = v_business AND disposal_payment_method = 'cash_register'),
    'cash_movements_in',
      (SELECT COALESCE(SUM(m.amount), 0) FROM account_movements m JOIN money_accounts a ON a.id = m.to_account_id
        WHERE m.shift_id = p_shift_id AND a.is_cash_drawer
          AND m.business_id = v_business AND a.business_id = v_business),
    'cash_movements_out',
      (SELECT COALESCE(SUM(m.amount), 0) FROM account_movements m JOIN money_accounts a ON a.id = m.from_account_id
        WHERE m.shift_id = p_shift_id AND a.is_cash_drawer
          AND m.business_id = v_business AND a.business_id = v_business)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_shift_cash_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shift_cash_summary(UUID) TO authenticated;

-- redeem_loyalty_for_sale (última: 20260929280000_loyalty_v2.sql)
CREATE OR REPLACE FUNCTION public.redeem_loyalty_for_sale(
  p_sale_id      UUID,
  p_units        INTEGER,
  p_discount_cop INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s        RECORD;
  b        RECORD;
  v_client UUID;
  bal      RECORD;
  v_units  INTEGER;
BEGIN
  SELECT id, business_id, appointment_id, customer_id, status INTO s FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public._assert_business_access(s.business_id);
  IF NOT public._is_business_admin(s.business_id) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF s.status <> 'paid' THEN RAISE EXCEPTION 'sale_not_paid'; END IF;

  SELECT loyalty_mode, loyalty_min_redeem_points, loyalty_stamps_required,
         COALESCE((features_enabled ->> 'loyalty')::BOOLEAN, FALSE) AS enabled
    INTO b FROM businesses WHERE id = s.business_id;
  IF NOT b.enabled THEN RAISE EXCEPTION 'loyalty_disabled'; END IF;

  v_client := s.customer_id;
  IF v_client IS NULL AND s.appointment_id IS NOT NULL THEN
    SELECT customer_id INTO v_client FROM appointments WHERE id = s.appointment_id;
  END IF;
  IF v_client IS NULL THEN RAISE EXCEPTION 'no_customer'; END IF;

  -- Serializa canjes del mismo cliente
  PERFORM pg_advisory_xact_lock(hashtext('loyalty:' || v_client::TEXT));

  IF EXISTS (SELECT 1 FROM loyalty_ledgers WHERE sale_id = s.id AND entry_type = 'redeem') THEN
    RAISE EXCEPTION 'already_redeemed';
  END IF;

  SELECT * INTO bal FROM public._loyalty_balance(s.business_id, v_client, b.loyalty_mode);

  IF b.loyalty_mode = 'points' THEN
    v_units := COALESCE(p_units, 0);
    IF v_units <= 0 THEN RAISE EXCEPTION 'invalid_units'; END IF;
    IF v_units < b.loyalty_min_redeem_points THEN RAISE EXCEPTION 'below_minimum'; END IF;
  ELSE
    v_units := b.loyalty_stamps_required;
  END IF;
  IF bal.balance < v_units THEN RAISE EXCEPTION 'insufficient_balance'; END IF;

  INSERT INTO loyalty_ledgers (business_id, client_id, kind, entry_type, points_added, points_redeemed,
                               transaction_reference, sale_id, expires_at, discount_cop, created_by, notes)
  VALUES (s.business_id, v_client, b.loyalty_mode, 'redeem', 0, v_units, s.id, s.id, NULL,
          GREATEST(COALESCE(p_discount_cop, 0), 0), auth.uid(),
          CASE WHEN b.loyalty_mode = 'points' THEN 'Canje en cobro' ELSE 'Servicio gratis (sellos)' END);

  RETURN jsonb_build_object('redeemed', v_units, 'balance', bal.balance - v_units);
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_loyalty_for_sale(UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_loyalty_for_sale(UUID, INTEGER, INTEGER) TO authenticated;

-- get_loyalty_summary (última: 20260929280000_loyalty_v2.sql)
CREATE OR REPLACE FUNCTION public.get_loyalty_summary(p_business_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b       RECORD;
  cl      RECORD;
  bal     RECORD;
  v_cnt   INTEGER := 0;
  v_total INTEGER := 0;
  v_ready INTEGER := 0;
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  IF NOT public._is_business_admin(p_business_id) THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT loyalty_mode, loyalty_stamps_required, loyalty_min_redeem_points INTO b
    FROM businesses WHERE id = p_business_id;

  FOR cl IN SELECT DISTINCT client_id FROM loyalty_ledgers
             WHERE business_id = p_business_id AND kind = b.loyalty_mode LOOP
    SELECT * INTO bal FROM public._loyalty_balance(p_business_id, cl.client_id, b.loyalty_mode);
    IF bal.balance > 0 THEN
      v_cnt := v_cnt + 1;
      v_total := v_total + bal.balance;
      IF (b.loyalty_mode = 'stamps' AND bal.balance >= b.loyalty_stamps_required)
         OR (b.loyalty_mode = 'points' AND bal.balance >= GREATEST(b.loyalty_min_redeem_points, 1)) THEN
        v_ready := v_ready + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'mode', b.loyalty_mode,
    'customers_with_balance', v_cnt,
    'total_balance', v_total,
    'customers_ready', v_ready,
    'redeemed_total', (SELECT COALESCE(SUM(points_redeemed), 0) FROM loyalty_ledgers
                        WHERE business_id = p_business_id AND kind = b.loyalty_mode AND entry_type = 'redeem'),
    'discount_given_cop', (SELECT COALESCE(SUM(discount_cop), 0) FROM loyalty_ledgers
                            WHERE business_id = p_business_id AND entry_type = 'redeem')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_loyalty_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_loyalty_summary(UUID) TO authenticated;
