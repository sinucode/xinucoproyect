-- ============================================================
-- 20260930180000_fixed_assets_v2.sql — Activos fijos útiles y seguros
--
-- Antes: las funciones de valor recibían el negocio del navegador sin
-- verificarlo (otra barbería podía consultar tus valores), cualquier
-- usuario del negocio escribía directo, la compra no tocaba la caja, la
-- depreciación no llegaba al estado de resultados y "eliminar" solo
-- escondía el activo.
--
-- Ahora:
--   - Solo el admin ve y maneja activos. Crear y dar de baja: por funciones
--     (register_fixed_asset, dispose_fixed_asset); editar datos: admin.
--   - La compra dice cómo se pagó; si fue con efectivo de la caja, se
--     descuenta del cuadre del turno abierto.
--   - Dar de baja con motivo (vendido/dañado/robado/regalado/otro): guarda lo
--     que valía ese día y, si se vendió, el precio (y si entró a la caja).
--   - Estado de resultados: "desgaste de equipos" (depreciación del período)
--     y resultado de las bajas.
--   - Fechas de Colombia. Auditoría automática.
-- ============================================================

ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS payment_method          TEXT CHECK (payment_method IS NULL OR payment_method IN ('cash_register', 'transfer', 'other')),
  ADD COLUMN IF NOT EXISTS shift_id                UUID REFERENCES public.cash_register_shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disposed_at             DATE,
  ADD COLUMN IF NOT EXISTS disposal_reason         TEXT CHECK (disposal_reason IS NULL OR disposal_reason IN ('sold', 'damaged', 'stolen', 'donated', 'other')),
  ADD COLUMN IF NOT EXISTS disposal_price          INTEGER CHECK (disposal_price IS NULL OR disposal_price >= 0),
  ADD COLUMN IF NOT EXISTS disposal_payment_method TEXT CHECK (disposal_payment_method IS NULL OR disposal_payment_method IN ('cash_register', 'transfer', 'other')),
  ADD COLUMN IF NOT EXISTS disposal_shift_id       UUID REFERENCES public.cash_register_shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disposal_notes          TEXT,
  ADD COLUMN IF NOT EXISTS book_value_at_disposal  INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_fixed_assets_shift          ON public.fixed_assets (shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fixed_assets_disposal_shift ON public.fixed_assets (disposal_shift_id) WHERE disposal_shift_id IS NOT NULL;

-- ── RLS: solo el admin ───────────────────────────────────────────────────────
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'fixed_assets' AND NOT ('service_role' = ANY (roles))
  LOOP
    EXECUTE format('DROP POLICY %I ON public.fixed_assets', p.policyname);
  END LOOP;
END $$;

ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY xin_admin_select ON public.fixed_assets FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));
CREATE POLICY xin_admin_update ON public.fixed_assets FOR UPDATE TO authenticated
  USING      (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id))
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));
-- Sin INSERT/DELETE directos: se crea con register_fixed_asset y se da de baja con dispose_fixed_asset.

-- Lo que un usuario NO cambia editando: pago, turno, baja, negocio
CREATE OR REPLACE FUNCTION public._guard_fixed_asset_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  NEW.updated_at := NOW();
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.business_id             IS DISTINCT FROM OLD.business_id
  OR NEW.payment_method          IS DISTINCT FROM OLD.payment_method
  OR NEW.shift_id                IS DISTINCT FROM OLD.shift_id
  OR NEW.is_active               IS DISTINCT FROM OLD.is_active
  OR NEW.disposed_at             IS DISTINCT FROM OLD.disposed_at
  OR NEW.disposal_reason         IS DISTINCT FROM OLD.disposal_reason
  OR NEW.disposal_price          IS DISTINCT FROM OLD.disposal_price
  OR NEW.disposal_payment_method IS DISTINCT FROM OLD.disposal_payment_method
  OR NEW.disposal_shift_id       IS DISTINCT FROM OLD.disposal_shift_id
  OR NEW.book_value_at_disposal  IS DISTINCT FROM OLD.book_value_at_disposal
  OR NEW.created_by              IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'forbidden_field';
  END IF;
  IF OLD.disposed_at IS NOT NULL THEN
    RAISE EXCEPTION 'asset_disposed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_fixed_asset_update ON public.fixed_assets;
CREATE TRIGGER trg_guard_fixed_asset_update
  BEFORE UPDATE ON public.fixed_assets
  FOR EACH ROW EXECUTE FUNCTION public._guard_fixed_asset_update();

-- ── Valor de un activo en una fecha (Colombia) ───────────────────────────────
-- Meses completos desde la compra (tope: vida útil); después de la baja, el
-- valor queda congelado en el de ese día.
CREATE OR REPLACE FUNCTION public._asset_value_on(a public.fixed_assets, p_on DATE)
RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_on     DATE := p_on;
  v_months INTEGER;
  v_value  NUMERIC;
  v_rate   NUMERIC;
  i        INTEGER;
BEGIN
  IF a.disposed_at IS NOT NULL AND v_on > a.disposed_at THEN v_on := a.disposed_at; END IF;
  IF v_on <= a.purchase_date THEN RETURN a.purchase_price; END IF;

  v_months := (EXTRACT(YEAR FROM AGE(v_on, a.purchase_date)) * 12
             + EXTRACT(MONTH FROM AGE(v_on, a.purchase_date)))::INTEGER;
  v_months := LEAST(GREATEST(v_months, 0), a.useful_life_months);

  IF a.depreciation_method = 'declining_balance' THEN
    v_rate  := (2.0 / (a.useful_life_months / 12.0)) / 12.0;
    v_value := a.purchase_price;
    FOR i IN 1..v_months LOOP
      v_value := GREATEST(FLOOR(v_value * (1.0 - v_rate)), a.salvage_value);
    END LOOP;
    IF v_months >= a.useful_life_months THEN v_value := a.salvage_value; END IF;
    RETURN v_value::INTEGER;
  END IF;

  RETURN (a.purchase_price
          - FLOOR((a.purchase_price - a.salvage_value)::NUMERIC * v_months / a.useful_life_months))::INTEGER;
END;
$$;
REVOKE ALL ON FUNCTION public._asset_value_on(public.fixed_assets, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._bogota_today()
RETURNS DATE LANGUAGE sql STABLE AS $$ SELECT (NOW() AT TIME ZONE 'America/Bogota')::DATE $$;

-- ── Ficha de un activo ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_depreciation_schedule(p_business_id UUID, p_asset_id UUID)
RETURNS JSON LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a        public.fixed_assets;
  v_today  DATE := public._bogota_today();
  v_on     DATE;
  v_value  INTEGER;
  v_months INTEGER;
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  IF NOT public._is_business_admin(p_business_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO a FROM fixed_assets WHERE id = p_asset_id AND business_id = p_business_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;

  v_on     := LEAST(v_today, COALESCE(a.disposed_at, v_today));
  v_value  := public._asset_value_on(a, v_on);
  v_months := CASE WHEN v_on <= a.purchase_date THEN 0 ELSE LEAST(
                (EXTRACT(YEAR FROM AGE(v_on, a.purchase_date)) * 12
               + EXTRACT(MONTH FROM AGE(v_on, a.purchase_date)))::INTEGER, a.useful_life_months) END;

  RETURN json_build_object(
    'asset_id',                 a.id,
    'name',                     a.name,
    'purchase_price',           a.purchase_price,
    'salvage_value',            a.salvage_value,
    'current_value',            v_value,
    'accumulated_depreciation', a.purchase_price - v_value,
    'months_elapsed',           v_months,
    'months_remaining',         GREATEST(a.useful_life_months - v_months, 0),
    'monthly_depreciation',     CASE WHEN a.depreciation_method = 'straight_line'
                                     THEN FLOOR((a.purchase_price - a.salvage_value)::NUMERIC / a.useful_life_months)::INTEGER
                                     ELSE (v_value - public._asset_value_on(a, (v_on + INTERVAL '1 month')::DATE)) END,
    'fully_depreciated_on',     (a.purchase_date + make_interval(months => a.useful_life_months))::DATE,
    'is_fully_depreciated',     v_months >= a.useful_life_months,
    'disposed_at',              a.disposed_at,
    'book_value_at_disposal',   a.book_value_at_disposal
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_depreciation_schedule(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_depreciation_schedule(UUID, UUID) TO authenticated, service_role;

-- ── Resumen de los activos en uso ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_total_asset_value(p_business_id UUID)
RETURNS JSON LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today DATE := public._bogota_today();
  r       RECORD;
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  IF NOT public._is_business_admin(p_business_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COALESCE(SUM(public._asset_value_on(a, v_today)), 0)::INTEGER                   AS book,
         COALESCE(SUM(a.purchase_price), 0)::INTEGER                                     AS purchase,
         COALESCE(SUM(a.purchase_price - public._asset_value_on(a, v_today)), 0)::INTEGER AS dep,
         COALESCE(SUM(public._asset_value_on(a, v_today)
                    - public._asset_value_on(a, (v_today + INTERVAL '1 month')::DATE)), 0)::INTEGER AS next_month,
         COUNT(*)::INTEGER                                                               AS cnt
    INTO r
    FROM fixed_assets a
   WHERE a.business_id = p_business_id AND a.is_active AND a.disposed_at IS NULL;

  RETURN json_build_object(
    'total_book_value',       r.book,
    'total_purchase_price',   r.purchase,
    'total_depreciation',     r.dep,
    'monthly_depreciation',   r.next_month,
    'asset_count',            r.cnt
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_total_asset_value(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_total_asset_value(UUID) TO authenticated, service_role;

-- ── Registrar un activo (compra) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_fixed_asset(
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
  p_description        TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bid   UUID;
  v_shift UUID;
  v_id    UUID;
  v_name  TEXT := NULLIF(LEFT(btrim(COALESCE(p_name, '')), 150), '');
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

  IF p_payment_method = 'cash_register' THEN
    SELECT id INTO v_shift FROM cash_register_shifts
     WHERE business_id = v_bid AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
    IF v_shift IS NULL THEN RAISE EXCEPTION 'shift_not_open'; END IF;
  END IF;

  INSERT INTO fixed_assets (business_id, name, category, description, serial_number, location,
                            purchase_date, purchase_price, salvage_value, depreciation_method,
                            useful_life_months, is_active, created_by, payment_method, shift_id)
  VALUES (v_bid, v_name, p_category,
          NULLIF(LEFT(btrim(COALESCE(p_description, '')), 500), ''),
          NULLIF(LEFT(btrim(COALESCE(p_serial_number, '')), 100), ''),
          NULLIF(LEFT(btrim(COALESCE(p_location, '')), 100), ''),
          p_purchase_date, p_purchase_price, p_salvage_value, p_method,
          p_useful_life_months, TRUE, auth.uid(), p_payment_method, v_shift)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_fixed_asset(TEXT, TEXT, DATE, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_fixed_asset(TEXT, TEXT, DATE, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ── Dar de baja ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dispose_fixed_asset(
  p_asset_id       UUID,
  p_date           DATE,
  p_reason         TEXT,
  p_price          INTEGER DEFAULT NULL,
  p_payment_method TEXT    DEFAULT NULL,
  p_notes          TEXT    DEFAULT NULL
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
         disposal_notes          = NULLIF(LEFT(btrim(COALESCE(p_notes, '')), 300), ''),
         book_value_at_disposal  = v_book
   WHERE id = a.id;

  RETURN jsonb_build_object('asset_id', a.id, 'book_value', v_book, 'price', v_price,
                            'result', COALESCE(v_price, 0) - v_book);
END;
$$;
REVOKE ALL ON FUNCTION public.dispose_fixed_asset(UUID, DATE, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset(UUID, DATE, TEXT, INTEGER, TEXT, TEXT) TO authenticated;

-- ── Caja: compras y ventas de equipos en efectivo ────────────────────────────
CREATE OR REPLACE FUNCTION public._shift_expected_cash(p_shift_id UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (COALESCE(s.opening_balance, 0)
    + (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN sales x ON x.id = p.sale_id
        WHERE p.shift_id = s.id AND p.payment_method = 'cash' AND x.status <> 'voided')
    - (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE shift_id = s.id AND payment_method = 'cash_register')
    - (SELECT COALESCE(SUM(amount), 0) FROM staff_ledger
        WHERE shift_id = s.id AND payment_method = 'cash_register' AND entry_type IN ('advance', 'payment'))
    - (SELECT COALESCE(SUM(total_cost), 0) FROM inventory_movements
        WHERE shift_id = s.id AND payment_method = 'cash_register' AND movement_type = 'purchase')
    - (SELECT COALESCE(SUM(purchase_price), 0) FROM fixed_assets
        WHERE shift_id = s.id AND payment_method = 'cash_register')
    + (SELECT COALESCE(SUM(disposal_price), 0) FROM fixed_assets
        WHERE disposal_shift_id = s.id AND disposal_payment_method = 'cash_register'))::INTEGER
  FROM cash_register_shifts s WHERE s.id = p_shift_id
$$;
REVOKE ALL ON FUNCTION public._shift_expected_cash(UUID) FROM PUBLIC, anon, authenticated;

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
        WHERE disposal_shift_id = p_shift_id AND business_id = v_business AND disposal_payment_method = 'cash_register')
  );
END;
$$;

-- El registro de auditoría del cierre usa el mismo cálculo
CREATE OR REPLACE FUNCTION public._trg_audit_shifts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_expected INTEGER; v_diff INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._audit(NEW.business_id, 'cash', 'shift.opened', 'shift', NEW.id,
      'abrió la caja con una base de ' || public._m(NEW.opening_balance::INTEGER),
      'info', NEW.opening_balance::INTEGER, NULL, NULL);
  ELSIF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    v_expected := public._shift_expected_cash(NEW.id);
    v_diff := COALESCE(NEW.actual_closing_balance, 0)::INTEGER - v_expected;
    PERFORM public._audit(NEW.business_id, 'cash', 'shift.closed', 'shift', NEW.id,
      'cerró la caja: contó ' || public._m(COALESCE(NEW.actual_closing_balance, 0)::INTEGER)
        || ', se esperaban ' || public._m(v_expected)
        || CASE WHEN v_diff = 0 THEN ' · cuadró'
                WHEN v_diff < 0 THEN ' · faltaron ' || public._m(-v_diff)
                ELSE ' · sobraron ' || public._m(v_diff) END,
      CASE WHEN v_diff <> 0 THEN 'warning' ELSE 'info' END, v_diff, NULL,
      jsonb_build_object('esperado', v_expected, 'contado', NEW.actual_closing_balance, 'diferencia', v_diff));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Auditoría de activos ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_audit_fixed_assets()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reason TEXT; v_res INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._audit(NEW.business_id, 'money', 'fixed_asset.created', 'fixed_asset', NEW.id,
      'registró el equipo "' || NEW.name || '" por ' || public._m(NEW.purchase_price)
        || CASE NEW.payment_method WHEN 'cash_register' THEN ' (efectivo de la caja)'
                                   WHEN 'transfer' THEN ' (transferencia)' ELSE '' END,
      CASE WHEN NEW.payment_method = 'cash_register' THEN 'warning' ELSE 'info' END,
      NEW.purchase_price, NULL,
      jsonb_build_object('nombre', NEW.name, 'precio', NEW.purchase_price, 'fecha', NEW.purchase_date,
                         'vida_util_meses', NEW.useful_life_months, 'medio_de_pago', NEW.payment_method));
  ELSIF NEW.disposed_at IS NOT NULL AND OLD.disposed_at IS NULL THEN
    v_reason := CASE NEW.disposal_reason WHEN 'sold' THEN 'vendido' WHEN 'damaged' THEN 'dañado'
                  WHEN 'stolen' THEN 'robado' WHEN 'donated' THEN 'regalado' ELSE 'otro motivo' END;
    v_res := COALESCE(NEW.disposal_price, 0) - COALESCE(NEW.book_value_at_disposal, 0);
    PERFORM public._audit(NEW.business_id, 'money', 'fixed_asset.disposed', 'fixed_asset', NEW.id,
      'dio de baja "' || NEW.name || '" (' || v_reason
        || CASE WHEN NEW.disposal_reason = 'sold' THEN ' por ' || public._m(NEW.disposal_price)
                  || CASE WHEN NEW.disposal_payment_method = 'cash_register' THEN ' en efectivo a la caja' ELSE '' END
                ELSE '' END
        || '; valía ' || public._m(NEW.book_value_at_disposal)
        || CASE WHEN v_res > 0 THEN ', ganancia ' || public._m(v_res)
                WHEN v_res < 0 THEN ', pérdida ' || public._m(-v_res) ELSE '' END || ')'
        || COALESCE(' · ' || NEW.disposal_notes, ''),
      'warning', v_res,
      jsonb_build_object('estado', 'en uso'),
      jsonb_build_object('estado', 'dado de baja', 'motivo', v_reason, 'precio', NEW.disposal_price,
                         'valor_en_libros', NEW.book_value_at_disposal, 'nota', NEW.disposal_notes));
  ELSIF NEW.purchase_price IS DISTINCT FROM OLD.purchase_price
     OR NEW.useful_life_months IS DISTINCT FROM OLD.useful_life_months
     OR NEW.salvage_value IS DISTINCT FROM OLD.salvage_value
     OR NEW.purchase_date IS DISTINCT FROM OLD.purchase_date
     OR NEW.depreciation_method IS DISTINCT FROM OLD.depreciation_method THEN
    PERFORM public._audit(NEW.business_id, 'money', 'fixed_asset.updated', 'fixed_asset', NEW.id,
      'cambió los valores del equipo "' || NEW.name || '"'
        || CASE WHEN NEW.purchase_price IS DISTINCT FROM OLD.purchase_price
                THEN ': precio ' || public._m(OLD.purchase_price) || ' → ' || public._m(NEW.purchase_price) ELSE '' END,
      'warning', NULL,
      jsonb_build_object('precio', OLD.purchase_price, 'fecha', OLD.purchase_date, 'vida_util_meses', OLD.useful_life_months,
                         'valor_residual', OLD.salvage_value, 'metodo', OLD.depreciation_method),
      jsonb_build_object('precio', NEW.purchase_price, 'fecha', NEW.purchase_date, 'vida_util_meses', NEW.useful_life_months,
                         'valor_residual', NEW.salvage_value, 'metodo', NEW.depreciation_method));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public._trg_audit_fixed_assets() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_fixed_assets ON public.fixed_assets;
CREATE TRIGGER trg_audit_fixed_assets AFTER INSERT OR UPDATE ON public.fixed_assets
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_fixed_assets();

-- ── Estado de resultados con desgaste de equipos ─────────────────────────────
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
  v_depr       INTEGER := 0;
  v_disposals  INTEGER := 0;
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
  -- Desgaste de equipos (depreciación) del período: valor al inicio − valor al final
  SELECT COALESCE(SUM(
           public._asset_value_on(a, p_date_from) - public._asset_value_on(a, p_date_to + 1)
         ), 0)::INTEGER
    INTO v_depr
    FROM fixed_assets a
   WHERE a.business_id = p_business_id
     AND a.purchase_date <= p_date_to
     AND (a.disposed_at IS NULL OR a.disposed_at >= p_date_from)
     AND (a.is_active OR a.disposed_at IS NOT NULL);

  -- Resultado de dar de baja equipos: lo que se recibió − lo que valían
  SELECT COALESCE(SUM(COALESCE(disposal_price, 0) - COALESCE(book_value_at_disposal, 0)), 0)::INTEGER
    INTO v_disposals
    FROM fixed_assets
   WHERE business_id = p_business_id
     AND disposed_at BETWEEN p_date_from AND p_date_to;

  v_net   := v_gross - v_comm - v_expenses - v_depr + v_disposals;   -- utilidad neta

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
    'depreciation',      v_depr,
    'asset_disposals',   v_disposals,
    'net_profit',        v_net,
    'margin_pct',        CASE WHEN v_revenue > 0 THEN ROUND(v_net * 100.0 / v_revenue, 1) ELSE NULL END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_profit_loss(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profit_loss(UUID, DATE, DATE) TO authenticated;
