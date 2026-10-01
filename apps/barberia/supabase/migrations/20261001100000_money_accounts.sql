-- ============================================================
-- 20261001100000_money_accounts.sql — Medios de pago y cuentas de dinero
--
-- Cada barbería define sus medios (Efectivo, Nequi, Bancolombia, Daviplata,
-- Mercado Pago…). Efectivo es la caja y siempre existe.
--
-- - money_accounts: los medios del negocio, con saldo inicial y fecha.
-- - account_id en cada cobro y pago (payments, expenses, staff_ledger,
--   inventory_movements, fixed_assets compra/baja). Un trigger lo completa
--   solo a partir del payment_method de siempre, así que todo lo que ya
--   existe sigue funcionando sin cambios; y si llega account_id, deduce el
--   payment_method para la caja y los reportes de siempre.
-- - account_movements: aportes, préstamos y retiros del dueño, devoluciones,
--   traslados entre medios y ajustes. No son ventas ni gastos.
-- - Saldo:
--     Efectivo = lo que debe haber en la caja (turno abierto: efectivo
--     esperado; sin turno: lo contado al cerrar + movimientos posteriores).
--     Otros    = saldo inicial + entradas − salidas desde la fecha inicial.
-- - get_money_accounts_status(): saldo acumulado y resultado de HOY por medio.
-- - Lo que se registra como "otro medio" (fuera de las cuentas) no afecta saldos.
-- Datos existentes: se crean "Efectivo" y "Transferencia" por negocio con
-- saldo 0 desde HOY (el admin ajusta el saldo real en Configuración).
-- ============================================================

-- ── Medios / cuentas ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.money_accounts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 40),
  method_kind     TEXT        NOT NULL CHECK (method_kind IN ('cash', 'transfer', 'card', 'mercadopago')),
  is_cash_drawer  BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order      INTEGER     NOT NULL DEFAULT 0,
  opening_balance INTEGER     NOT NULL DEFAULT 0 CHECK (opening_balance BETWEEN -2000000000 AND 2000000000),
  opening_date    DATE        NOT NULL DEFAULT ((NOW() AT TIME ZONE 'America/Bogota')::DATE),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NOT is_cash_drawer OR method_kind = 'cash')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_money_accounts_drawer ON public.money_accounts (business_id) WHERE is_cash_drawer;
CREATE UNIQUE INDEX IF NOT EXISTS uq_money_accounts_name   ON public.money_accounts (business_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_money_accounts_business     ON public.money_accounts (business_id, is_active, sort_order);

-- Un medio por negocio para empezar: Efectivo (caja) y Transferencia
INSERT INTO public.money_accounts (business_id, name, method_kind, is_cash_drawer, sort_order)
SELECT b.id, 'Efectivo', 'cash', TRUE, 0 FROM public.businesses b
 WHERE NOT EXISTS (SELECT 1 FROM public.money_accounts a WHERE a.business_id = b.id AND a.is_cash_drawer);
INSERT INTO public.money_accounts (business_id, name, method_kind, is_cash_drawer, sort_order)
SELECT b.id, 'Transferencia', 'transfer', FALSE, 1 FROM public.businesses b
 WHERE NOT EXISTS (SELECT 1 FROM public.money_accounts a WHERE a.business_id = b.id AND NOT a.is_cash_drawer);

-- Negocios nuevos nacen con sus dos medios
CREATE OR REPLACE FUNCTION public._trg_business_default_accounts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO money_accounts (business_id, name, method_kind, is_cash_drawer, sort_order)
  VALUES (NEW.id, 'Efectivo', 'cash', TRUE, 0), (NEW.id, 'Transferencia', 'transfer', FALSE, 1)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._trg_business_default_accounts() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_business_default_accounts ON public.businesses;
CREATE TRIGGER trg_business_default_accounts AFTER INSERT ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public._trg_business_default_accounts();

-- ── Movimientos del dueño y traslados ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_movements (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind            TEXT        NOT NULL CHECK (kind IN ('owner_contribution', 'owner_loan', 'loan_repayment',
                                                     'owner_withdrawal', 'transfer', 'adjustment')),
  from_account_id UUID        REFERENCES public.money_accounts(id),
  to_account_id   UUID        REFERENCES public.money_accounts(id),
  amount          INTEGER     NOT NULL CHECK (amount > 0 AND amount <= 2000000000),
  notes           TEXT        CHECK (notes IS NULL OR char_length(notes) <= 200),
  shift_id        UUID        REFERENCES public.cash_register_shifts(id) ON DELETE SET NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (kind IN ('owner_contribution', 'owner_loan')        AND to_account_id IS NOT NULL AND from_account_id IS NULL) OR
    (kind IN ('loan_repayment', 'owner_withdrawal')     AND from_account_id IS NOT NULL AND to_account_id IS NULL) OR
    (kind = 'transfer'   AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL AND from_account_id <> to_account_id) OR
    (kind = 'adjustment' AND (from_account_id IS NULL) <> (to_account_id IS NULL))
  )
);
CREATE INDEX IF NOT EXISTS idx_account_movements_business ON public.account_movements (business_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_movements_shift    ON public.account_movements (shift_id) WHERE shift_id IS NOT NULL;

-- ── account_id en cobros y pagos ─────────────────────────────────────────────
ALTER TABLE public.payments            ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.money_accounts(id);
ALTER TABLE public.expenses            ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.money_accounts(id);
ALTER TABLE public.staff_ledger        ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.money_accounts(id);
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.money_accounts(id);
ALTER TABLE public.fixed_assets        ADD COLUMN IF NOT EXISTS account_id          UUID REFERENCES public.money_accounts(id),
                                       ADD COLUMN IF NOT EXISTS disposal_account_id UUID REFERENCES public.money_accounts(id);

CREATE INDEX IF NOT EXISTS idx_payments_account     ON public.payments (account_id, created_at) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_account     ON public.expenses (account_id, expense_date) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_ledger_account ON public.staff_ledger (account_id, created_at) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_mov_account      ON public.inventory_movements (account_id, created_at) WHERE account_id IS NOT NULL;

-- Medio por defecto para un payment_method de siempre (NULL = fuera de las cuentas)
CREATE OR REPLACE FUNCTION public._default_account(p_business_id UUID, p_method TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_method IS NULL OR p_method IN ('other', 'loyalty_points') THEN NULL
    WHEN p_method IN ('cash', 'cash_register') THEN
      (SELECT id FROM money_accounts WHERE business_id = p_business_id AND is_cash_drawer LIMIT 1)
    ELSE
      (SELECT id FROM money_accounts
        WHERE business_id = p_business_id AND NOT is_cash_drawer AND is_active
        ORDER BY (method_kind = p_method) DESC, sort_order, created_at LIMIT 1)
  END
$$;
REVOKE ALL ON FUNCTION public._default_account(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- payment_method que corresponde a un medio (para la caja y reportes de siempre)
CREATE OR REPLACE FUNCTION public._account_method(p_account_id UUID, p_table TEXT, p_current TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Caja → efectivo. Otro medio → conserva el detalle que ya traiga (tarjeta, Mercado Pago, mixto…)
  -- salvo que venga vacío o diga efectivo/otro.
  SELECT CASE
    WHEN a.is_cash_drawer THEN CASE WHEN p_table = 'payments' THEN 'cash' ELSE 'cash_register' END
    WHEN p_current IS NOT NULL AND p_current NOT IN ('cash', 'cash_register', 'other') THEN p_current
    WHEN p_table = 'payments' THEN a.method_kind
    WHEN p_table = 'expenses' AND a.method_kind = 'card' THEN 'card'
    ELSE 'transfer'
  END
  FROM money_accounts a WHERE a.id = p_account_id
$$;
REVOKE ALL ON FUNCTION public._account_method(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._trg_fill_account()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_biz UUID;
BEGIN
  IF TG_TABLE_NAME = 'fixed_assets' THEN
    -- Compra
    IF NEW.account_id IS NOT NULL THEN
      SELECT business_id INTO v_biz FROM money_accounts WHERE id = NEW.account_id;
      IF v_biz IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'invalid_account'; END IF;
      NEW.payment_method := public._account_method(NEW.account_id, 'fixed_assets', NEW.payment_method);
    ELSIF TG_OP = 'INSERT' OR NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
      NEW.account_id := public._default_account(NEW.business_id, NEW.payment_method);
    END IF;
    -- Baja (venta)
    IF NEW.disposal_account_id IS NOT NULL THEN
      SELECT business_id INTO v_biz FROM money_accounts WHERE id = NEW.disposal_account_id;
      IF v_biz IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'invalid_account'; END IF;
      NEW.disposal_payment_method := public._account_method(NEW.disposal_account_id, 'fixed_assets', NEW.disposal_payment_method);
    ELSIF NEW.disposal_payment_method IS NOT NULL
      AND (TG_OP = 'INSERT' OR NEW.disposal_payment_method IS DISTINCT FROM OLD.disposal_payment_method) THEN
      NEW.disposal_account_id := public._default_account(NEW.business_id, NEW.disposal_payment_method);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.account_id IS NOT NULL THEN
    SELECT business_id INTO v_biz FROM money_accounts WHERE id = NEW.account_id;
    IF v_biz IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'invalid_account'; END IF;
    IF TG_TABLE_NAME <> 'payments' OR NEW.payment_method IS DISTINCT FROM 'loyalty_points' THEN
      NEW.payment_method := public._account_method(NEW.account_id, TG_TABLE_NAME, NEW.payment_method);
    END IF;
  ELSIF TG_OP = 'INSERT' OR NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
    NEW.account_id := public._default_account(NEW.business_id, NEW.payment_method);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._trg_fill_account() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['payments', 'expenses', 'staff_ledger', 'inventory_movements', 'fixed_assets'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_account ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_fill_account BEFORE INSERT OR UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public._trg_fill_account()', t);
  END LOOP;
END $$;

-- Lo existente: a su medio por defecto (sin disparar triggers de auditoría)
UPDATE public.payments p SET account_id = public._default_account(p.business_id, p.payment_method)
 WHERE p.account_id IS NULL;
UPDATE public.expenses e SET account_id = public._default_account(e.business_id, e.payment_method)
 WHERE e.account_id IS NULL;
UPDATE public.staff_ledger l SET account_id = public._default_account(l.business_id, l.payment_method)
 WHERE l.account_id IS NULL AND l.entry_type IN ('advance', 'payment');
UPDATE public.inventory_movements m SET account_id = public._default_account(m.business_id, m.payment_method)
 WHERE m.account_id IS NULL AND m.movement_type = 'purchase';
UPDATE public.fixed_assets f
   SET account_id          = COALESCE(f.account_id, public._default_account(f.business_id, f.payment_method)),
       disposal_account_id = COALESCE(f.disposal_account_id,
                               CASE WHEN f.disposal_payment_method IS NOT NULL
                                    THEN public._default_account(f.business_id, f.disposal_payment_method) END)
 WHERE f.account_id IS NULL OR (f.disposal_account_id IS NULL AND f.disposal_payment_method IS NOT NULL);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.money_accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_movements ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t TEXT; p RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['money_accounts', 'account_movements'] LOOP
    FOR p IN SELECT policyname FROM pg_policies
              WHERE schemaname = 'public' AND tablename = t AND NOT ('service_role' = ANY (roles)) LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
  END LOOP;
END $$;
-- Todo el negocio ve sus medios (para cobrar); solo el admin ve los movimientos del dueño
CREATE POLICY xin_select ON public.money_accounts FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id')
         OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE));
CREATE POLICY xin_admin_select ON public.account_movements FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));
-- Escrituras solo por funciones

-- ── Helpers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._my_admin_business()
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v UUID;
BEGIN
  BEGIN
    v := (auth.jwt() -> 'app_metadata' ->> 'business_id')::UUID;
  EXCEPTION WHEN OTHERS THEN v := NULL;
  END;
  IF v IS NULL OR NOT public._is_business_admin(v) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public._my_admin_business() FROM PUBLIC, anon, authenticated;

-- ── Administrar medios ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_money_account(
  p_id              UUID,      -- NULL = crear
  p_name            TEXT,
  p_method_kind     TEXT,
  p_opening_balance INTEGER,
  p_opening_date    DATE,
  p_is_active       BOOLEAN DEFAULT TRUE,
  p_sort_order      INTEGER DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bid  UUID := public._my_admin_business();
  a      money_accounts;
  v_id   UUID;
  v_name TEXT := btrim(COALESCE(p_name, ''));
BEGIN
  IF char_length(v_name) NOT BETWEEN 2 AND 40 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF p_opening_balance IS NULL OR p_opening_balance NOT BETWEEN -2000000000 AND 2000000000 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF p_opening_date IS NULL OR p_opening_date > (NOW() AT TIME ZONE 'America/Bogota')::DATE THEN RAISE EXCEPTION 'invalid_date'; END IF;

  IF p_id IS NULL THEN
    IF COALESCE(p_method_kind, '') NOT IN ('transfer', 'card', 'mercadopago') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
    INSERT INTO money_accounts (business_id, name, method_kind, opening_balance, opening_date, is_active, sort_order)
    VALUES (v_bid, v_name, p_method_kind, p_opening_balance, p_opening_date, COALESCE(p_is_active, TRUE),
            COALESCE(p_sort_order, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM money_accounts WHERE business_id = v_bid)))
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  SELECT * INTO a FROM money_accounts WHERE id = p_id AND business_id = v_bid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF a.is_cash_drawer AND NOT COALESCE(p_is_active, TRUE) THEN RAISE EXCEPTION 'cash_required'; END IF;
  IF NOT a.is_cash_drawer AND COALESCE(p_method_kind, a.method_kind) NOT IN ('transfer', 'card', 'mercadopago') THEN
    RAISE EXCEPTION 'invalid_kind';
  END IF;
  UPDATE money_accounts
     SET name            = v_name,
         method_kind     = CASE WHEN a.is_cash_drawer THEN 'cash' ELSE COALESCE(p_method_kind, a.method_kind) END,
         opening_balance = CASE WHEN a.is_cash_drawer THEN 0 ELSE p_opening_balance END,
         opening_date    = p_opening_date,
         is_active       = CASE WHEN a.is_cash_drawer THEN TRUE ELSE COALESCE(p_is_active, a.is_active) END,
         sort_order      = COALESCE(p_sort_order, a.sort_order),
         updated_at      = NOW()
   WHERE id = a.id;
  RETURN a.id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'duplicate_name';
END;
$$;
REVOKE ALL ON FUNCTION public.save_money_account(UUID, TEXT, TEXT, INTEGER, DATE, BOOLEAN, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_money_account(UUID, TEXT, TEXT, INTEGER, DATE, BOOLEAN, INTEGER) TO authenticated;

-- ── Saldos ───────────────────────────────────────────────────────────────────
-- Entradas y salidas de un medio entre dos instantes (fechas-solo se comparan por día local)
CREATE OR REPLACE FUNCTION public._account_flows(p_account_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (money_in BIGINT, money_out BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (
    SELECT (p_from AT TIME ZONE 'America/Bogota')::DATE AS dfrom,
           (p_to   AT TIME ZONE 'America/Bogota')::DATE AS dto_excl   -- p_to es exclusivo
  )
  SELECT
    ( (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN sales s ON s.id = p.sale_id
        WHERE p.account_id = p_account_id AND s.status <> 'voided'
          AND p.created_at >= p_from AND p.created_at < p_to)
    + (SELECT COALESCE(SUM(f.disposal_price), 0) FROM fixed_assets f, d
        WHERE f.disposal_account_id = p_account_id AND f.disposed_at >= d.dfrom AND f.disposed_at < d.dto_excl)
    + (SELECT COALESCE(SUM(m.amount), 0) FROM account_movements m
        WHERE m.to_account_id = p_account_id AND m.occurred_at >= p_from AND m.occurred_at < p_to)
    )::BIGINT,
    ( (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e, d
        WHERE e.account_id = p_account_id AND e.expense_date >= d.dfrom AND e.expense_date < d.dto_excl)
    + (SELECT COALESCE(SUM(l.amount), 0) FROM staff_ledger l
        WHERE l.account_id = p_account_id AND l.entry_type IN ('advance', 'payment')
          AND l.created_at >= p_from AND l.created_at < p_to)
    + (SELECT COALESCE(SUM(i.total_cost), 0) FROM inventory_movements i
        WHERE i.account_id = p_account_id AND i.movement_type = 'purchase'
          AND i.created_at >= p_from AND i.created_at < p_to)
    + (SELECT COALESCE(SUM(f.purchase_price), 0) FROM fixed_assets f, d
        WHERE f.account_id = p_account_id AND f.purchase_date >= d.dfrom AND f.purchase_date < d.dto_excl)
    + (SELECT COALESCE(SUM(m.amount), 0) FROM account_movements m
        WHERE m.from_account_id = p_account_id AND m.occurred_at >= p_from AND m.occurred_at < p_to)
    )::BIGINT
$$;
REVOKE ALL ON FUNCTION public._account_flows(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- Efectivo: lo que debe haber en la caja ahora
CREATE OR REPLACE FUNCTION public._cash_drawer_balance(p_business_id UUID)
RETURNS BIGINT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_open   UUID;
  v_last   RECORD;
  v_cash   UUID;
BEGIN
  SELECT id INTO v_open FROM cash_register_shifts
   WHERE business_id = p_business_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF v_open IS NOT NULL THEN RETURN public._shift_expected_cash(v_open); END IF;

  SELECT id INTO v_cash FROM money_accounts WHERE business_id = p_business_id AND is_cash_drawer;
  SELECT id, COALESCE(actual_closing_balance, 0)::BIGINT AS counted, closed_at INTO v_last
    FROM cash_register_shifts
   WHERE business_id = p_business_id AND status = 'closed' ORDER BY closed_at DESC NULLS LAST LIMIT 1;

  RETURN COALESCE(v_last.counted, 0)
       + (SELECT COALESCE(SUM(amount), 0) FROM account_movements
           WHERE to_account_id = v_cash AND shift_id IS NULL AND occurred_at > COALESCE(v_last.closed_at, '-infinity'))
       - (SELECT COALESCE(SUM(amount), 0) FROM account_movements
           WHERE from_account_id = v_cash AND shift_id IS NULL AND occurred_at > COALESCE(v_last.closed_at, '-infinity'));
END;
$$;
REVOKE ALL ON FUNCTION public._cash_drawer_balance(UUID) FROM PUBLIC, anon, authenticated;

-- Estado de todos los medios: saldo acumulado y resultado de hoy
CREATE OR REPLACE FUNCTION public.get_money_accounts_status()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bid    UUID := public._my_admin_business();
  v_today  DATE := (NOW() AT TIME ZONE 'America/Bogota')::DATE;
  v_t0     TIMESTAMPTZ := v_today::TIMESTAMP AT TIME ZONE 'America/Bogota';
  v_t1     TIMESTAMPTZ := (v_today + 1)::TIMESTAMP AT TIME ZONE 'America/Bogota';
  v_rows   JSONB := '[]'::JSONB;
  a        RECORD;
  t        RECORD;
  acc      RECORD;
  v_bal    BIGINT;
BEGIN
  FOR a IN SELECT * FROM money_accounts WHERE business_id = v_bid AND is_active ORDER BY sort_order, created_at LOOP
    SELECT * INTO t FROM public._account_flows(a.id, v_t0, v_t1);
    IF a.is_cash_drawer THEN
      v_bal := public._cash_drawer_balance(v_bid);
    ELSE
      SELECT * INTO acc FROM public._account_flows(a.id, a.opening_date::TIMESTAMP AT TIME ZONE 'America/Bogota', 'infinity');
      v_bal := a.opening_balance + acc.money_in - acc.money_out;
    END IF;
    v_rows := v_rows || jsonb_build_object(
      'id', a.id, 'name', a.name, 'method_kind', a.method_kind, 'is_cash_drawer', a.is_cash_drawer,
      'opening_balance', a.opening_balance, 'opening_date', a.opening_date,
      'today_in', t.money_in, 'today_out', t.money_out, 'today_net', t.money_in - t.money_out,
      'balance', v_bal);
  END LOOP;

  RETURN jsonb_build_object(
    'today', v_today,
    'accounts', v_rows,
    'owner_loans_pending',
      (SELECT COALESCE(SUM(CASE WHEN kind = 'owner_loan' THEN amount WHEN kind = 'loan_repayment' THEN -amount ELSE 0 END), 0)
         FROM account_movements WHERE business_id = v_bid),
    'open_shift_id',
      (SELECT id FROM cash_register_shifts WHERE business_id = v_bid AND status = 'open' ORDER BY opened_at DESC LIMIT 1)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_money_accounts_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_money_accounts_status() TO authenticated;

-- ── Mover plata ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_account_movement(
  p_kind    TEXT,
  p_amount  INTEGER,
  p_from    UUID,
  p_to      UUID,
  p_notes   TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bid    UUID := public._my_admin_business();
  v_shift  UUID;
  v_id     UUID;
  v_cash   UUID;
  v_notes  TEXT := NULLIF(LEFT(btrim(COALESCE(p_notes, '')), 200), '');
BEGIN
  IF COALESCE(p_kind, '') NOT IN ('owner_contribution', 'owner_loan', 'loan_repayment', 'owner_withdrawal', 'transfer', 'adjustment') THEN
    RAISE EXCEPTION 'invalid_kind';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 2000000000 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF p_from IS NOT NULL AND NOT EXISTS (SELECT 1 FROM money_accounts WHERE id = p_from AND business_id = v_bid AND is_active) THEN
    RAISE EXCEPTION 'invalid_account';
  END IF;
  IF p_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM money_accounts WHERE id = p_to AND business_id = v_bid AND is_active) THEN
    RAISE EXCEPTION 'invalid_account';
  END IF;
  IF p_kind = 'adjustment' AND v_notes IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_kind = 'loan_repayment' AND p_amount > (
       SELECT COALESCE(SUM(CASE WHEN kind = 'owner_loan' THEN amount WHEN kind = 'loan_repayment' THEN -amount ELSE 0 END), 0)
         FROM account_movements WHERE business_id = v_bid) THEN
    RAISE EXCEPTION 'exceeds_loan';
  END IF;

  -- Si toca la caja con un turno abierto, queda en ese turno (cuadra el arqueo)
  SELECT id INTO v_cash FROM money_accounts WHERE business_id = v_bid AND is_cash_drawer;
  IF v_cash IN (p_from, p_to) THEN
    SELECT id INTO v_shift FROM cash_register_shifts
     WHERE business_id = v_bid AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
  END IF;

  INSERT INTO account_movements (business_id, kind, from_account_id, to_account_id, amount, notes, shift_id, created_by)
  VALUES (v_bid, p_kind, p_from, p_to, p_amount, v_notes, v_shift, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'invalid_accounts';
END;
$$;
REVOKE ALL ON FUNCTION public.record_account_movement(TEXT, INTEGER, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_account_movement(TEXT, INTEGER, UUID, UUID, TEXT) TO authenticated;

-- ── Caja: los movimientos del turno cuentan en el efectivo esperado ──────────
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
        WHERE disposal_shift_id = s.id AND disposal_payment_method = 'cash_register')
    + (SELECT COALESCE(SUM(m.amount), 0) FROM account_movements m JOIN money_accounts a ON a.id = m.to_account_id
        WHERE m.shift_id = s.id AND a.is_cash_drawer)
    - (SELECT COALESCE(SUM(m.amount), 0) FROM account_movements m JOIN money_accounts a ON a.id = m.from_account_id
        WHERE m.shift_id = s.id AND a.is_cash_drawer))::INTEGER
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
        WHERE disposal_shift_id = p_shift_id AND business_id = v_business AND disposal_payment_method = 'cash_register'),
    'cash_movements_in',
      (SELECT COALESCE(SUM(m.amount), 0) FROM account_movements m JOIN money_accounts a ON a.id = m.to_account_id
        WHERE m.shift_id = p_shift_id AND a.is_cash_drawer),
    'cash_movements_out',
      (SELECT COALESCE(SUM(m.amount), 0) FROM account_movements m JOIN money_accounts a ON a.id = m.from_account_id
        WHERE m.shift_id = p_shift_id AND a.is_cash_drawer)
  );
END;
$$;

-- ── Auditoría ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_audit_account_movements()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from TEXT; v_to TEXT;
BEGIN
  SELECT name INTO v_from FROM money_accounts WHERE id = NEW.from_account_id;
  SELECT name INTO v_to   FROM money_accounts WHERE id = NEW.to_account_id;
  PERFORM public._audit(NEW.business_id, 'money', 'account.' || NEW.kind, 'account_movement', NEW.id,
    CASE NEW.kind
      WHEN 'owner_contribution' THEN 'registró un aporte del dueño de ' || public._m(NEW.amount) || ' a ' || v_to
      WHEN 'owner_loan'         THEN 'registró un préstamo del dueño de ' || public._m(NEW.amount) || ' a ' || v_to
      WHEN 'loan_repayment'     THEN 'devolvió ' || public._m(NEW.amount) || ' del préstamo del dueño desde ' || v_from
      WHEN 'owner_withdrawal'   THEN 'registró un retiro del dueño de ' || public._m(NEW.amount) || ' desde ' || v_from
      WHEN 'transfer'           THEN 'trasladó ' || public._m(NEW.amount) || ' de ' || v_from || ' a ' || v_to
      ELSE 'ajustó el saldo de ' || COALESCE(v_to, v_from) || ' en '
           || CASE WHEN NEW.to_account_id IS NOT NULL THEN '+' ELSE '−' END || public._m(NEW.amount)
    END || COALESCE(' · ' || NEW.notes, ''),
    CASE WHEN NEW.kind IN ('owner_withdrawal', 'adjustment') THEN 'warning' ELSE 'info' END,
    NEW.amount, NULL,
    jsonb_build_object('tipo', NEW.kind, 'monto', NEW.amount, 'desde', v_from, 'hacia', v_to, 'nota', NEW.notes));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._trg_audit_account_movements() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_audit_account_movements ON public.account_movements;
CREATE TRIGGER trg_audit_account_movements AFTER INSERT ON public.account_movements
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_account_movements();

CREATE OR REPLACE FUNCTION public._trg_audit_money_accounts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL THEN RETURN NEW; END IF;   -- los creados por la migración/negocio nuevo no se registran
    PERFORM public._audit(NEW.business_id, 'settings', 'account.created', 'money_account', NEW.id,
      'creó el medio de pago "' || NEW.name || '" con saldo inicial ' || public._m(NEW.opening_balance), 'info', NULL, NULL, NULL);
  ELSIF NEW.opening_balance IS DISTINCT FROM OLD.opening_balance OR NEW.opening_date IS DISTINCT FROM OLD.opening_date THEN
    PERFORM public._audit(NEW.business_id, 'money', 'account.opening_changed', 'money_account', NEW.id,
      'cambió el saldo inicial de "' || NEW.name || '": ' || public._m(OLD.opening_balance) || ' (' || to_char(OLD.opening_date, 'DD/MM/YYYY')
        || ') → ' || public._m(NEW.opening_balance) || ' (' || to_char(NEW.opening_date, 'DD/MM/YYYY') || ')',
      'warning', NULL, NULL, NULL);
  ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active OR NEW.name IS DISTINCT FROM OLD.name THEN
    PERFORM public._audit(NEW.business_id, 'settings', 'account.updated', 'money_account', NEW.id,
      CASE WHEN NEW.is_active IS DISTINCT FROM OLD.is_active
           THEN CASE WHEN NEW.is_active THEN 'activó' ELSE 'desactivó' END || ' el medio de pago "' || NEW.name || '"'
           ELSE 'renombró el medio de pago "' || OLD.name || '" a "' || NEW.name || '"' END,
      'info', NULL, NULL, NULL);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._trg_audit_money_accounts() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_audit_money_accounts ON public.money_accounts;
CREATE TRIGGER trg_audit_money_accounts AFTER INSERT OR UPDATE ON public.money_accounts
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_money_accounts();
