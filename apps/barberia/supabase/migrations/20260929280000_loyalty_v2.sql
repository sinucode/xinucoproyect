-- ============================================================
-- 20260929280000_loyalty_v2.sql — Lealtad: Puntos o Sellos (cada barbería elige)
--
-- Antes: un solo valor para ganar y canjear (1 punto por $X y 1 punto = $X →
-- devolvía el 100%), RPCs que aceptaban cualquier business_id, propinas
-- sumando puntos, saldo con vencimiento mal calculado y sin canje al cobrar.
--
-- Ahora:
--   businesses.loyalty_mode = 'points' | 'stamps'
--   Puntos: gana 1 punto por cada loyalty_earn_per_cop pagados (sin propinas,
--           después de descuentos); cada punto vale loyalty_point_value_cop al
--           canjear; mínimo para canjear loyalty_min_redeem_points; vencen a
--           los loyalty_expiry_months (FIFO: se canjea primero lo más viejo).
--   Sellos: 1 sello por cada visita pagada con un servicio; con
--           loyalty_stamps_required sellos el siguiente servicio es gratis
--           (tope opcional loyalty_stamp_max_reward_cop; 0 = sin tope). No vencen.
--   Se gana por TRIGGER al pagar la venta (una sola vez por venta).
--   Se canjea al cobrar (redeem_loyalty_for_sale) y el admin puede ajustar.
-- ============================================================

-- ── 1. Configuración ─────────────────────────────────────────────────────────
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS loyalty_mode TEXT NOT NULL DEFAULT 'points'
    CHECK (loyalty_mode IN ('points', 'stamps')),
  ADD COLUMN IF NOT EXISTS loyalty_earn_per_cop INTEGER NOT NULL DEFAULT 1000
    CHECK (loyalty_earn_per_cop BETWEEN 100 AND 1000000),
  ADD COLUMN IF NOT EXISTS loyalty_min_redeem_points INTEGER NOT NULL DEFAULT 0
    CHECK (loyalty_min_redeem_points BETWEEN 0 AND 1000000),
  ADD COLUMN IF NOT EXISTS loyalty_stamps_required INTEGER NOT NULL DEFAULT 10
    CHECK (loyalty_stamps_required BETWEEN 2 AND 50),
  ADD COLUMN IF NOT EXISTS loyalty_stamp_max_reward_cop INTEGER NOT NULL DEFAULT 0
    CHECK (loyalty_stamp_max_reward_cop BETWEEN 0 AND 10000000);

-- El valor del punto ahora es SOLO para canjear. El anterior se usaba también
-- para ganar (100% de devolución): se lleva a $50 (5% con 1 punto por $1.000).
UPDATE public.businesses
   SET loyalty_point_value_cop = 50
 WHERE loyalty_point_value_cop IS NULL OR loyalty_point_value_cop >= loyalty_earn_per_cop;

-- ── 2. Movimientos ───────────────────────────────────────────────────────────
ALTER TABLE public.loyalty_ledgers
  ADD COLUMN IF NOT EXISTS kind       TEXT NOT NULL DEFAULT 'points' CHECK (kind IN ('points', 'stamps')),
  ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'earn'   CHECK (entry_type IN ('earn', 'redeem', 'adjust')),
  ADD COLUMN IF NOT EXISTS sale_id    UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes      TEXT CHECK (notes IS NULL OR char_length(notes) <= 200),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_cop INTEGER;

UPDATE public.loyalty_ledgers SET entry_type = 'redeem'
 WHERE entry_type = 'earn' AND COALESCE(points_redeemed, 0) > 0 AND COALESCE(points_added, 0) = 0;

-- Recalcular los puntos ya otorgados con la regla nueva (se ganaban al 100%).
-- A la fecha solo existen en el negocio demo; nunca se canjearon.
UPDATE public.loyalty_ledgers l
   SET sale_id      = s.id,
       notes        = 'Compra',
       points_added = FLOOR(GREATEST(COALESCE(s.subtotal, 0) - COALESCE(s.discount_amount, 0), 0)
                            / GREATEST(b.loyalty_earn_per_cop, 1))
  FROM public.sales s
  JOIN public.businesses b ON b.id = s.business_id
 WHERE l.sale_id IS NULL
   AND l.entry_type = 'earn'
   AND l.kind = 'points'
   AND l.transaction_reference::TEXT = s.id::TEXT;

DELETE FROM public.loyalty_ledgers
 WHERE entry_type = 'earn' AND COALESCE(points_added, 0) = 0 AND COALESCE(points_redeemed, 0) = 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_earn_per_sale
  ON public.loyalty_ledgers (sale_id, kind) WHERE entry_type = 'earn' AND sale_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_redeem_per_sale
  ON public.loyalty_ledgers (sale_id, kind) WHERE entry_type = 'redeem' AND sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loyalty_client ON public.loyalty_ledgers (business_id, client_id, kind, created_at);

-- ── 3. Saldo FIFO con vencimiento ────────────────────────────────────────────
-- Recorre los movimientos en orden: cada débito consume los lotes más viejos
-- que seguían vigentes en ese momento. Saldo = lo que queda de lotes vigentes hoy.
CREATE OR REPLACE FUNCTION public._loyalty_balance(p_business_id UUID, p_client_id UUID, p_kind TEXT)
RETURNS TABLE (balance INTEGER, expiring_30d INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e        RECORD;
  lot_amt  INTEGER[] := '{}';
  lot_exp  TIMESTAMPTZ[] := '{}';
  i        INTEGER;
  need     INTEGER;
  take     INTEGER;
  v_bal    INTEGER := 0;
  v_soon   INTEGER := 0;
BEGIN
  FOR e IN
    SELECT COALESCE(points_added, 0) AS added, COALESCE(points_redeemed, 0) AS redeemed,
           expires_at, created_at
      FROM loyalty_ledgers
     WHERE business_id = p_business_id AND client_id = p_client_id AND kind = p_kind
     ORDER BY created_at, id
  LOOP
    IF e.added > 0 THEN
      lot_amt := lot_amt || e.added;
      lot_exp := lot_exp || e.expires_at;
    END IF;
    need := e.redeemed;
    i := 1;
    WHILE need > 0 AND i <= COALESCE(array_length(lot_amt, 1), 0) LOOP
      IF lot_amt[i] > 0 AND (lot_exp[i] IS NULL OR lot_exp[i] > e.created_at) THEN
        take := LEAST(lot_amt[i], need);
        lot_amt[i] := lot_amt[i] - take;
        need := need - take;
      END IF;
      i := i + 1;
    END LOOP;
  END LOOP;

  FOR i IN 1 .. COALESCE(array_length(lot_amt, 1), 0) LOOP
    IF lot_amt[i] > 0 AND (lot_exp[i] IS NULL OR lot_exp[i] > NOW()) THEN
      v_bal := v_bal + lot_amt[i];
      IF lot_exp[i] IS NOT NULL AND lot_exp[i] <= NOW() + INTERVAL '30 days' THEN
        v_soon := v_soon + lot_amt[i];
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_bal, v_soon;
END;
$$;
REVOKE ALL ON FUNCTION public._loyalty_balance(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ── 4. Ganar al pagar (interno, idempotente) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._record_sale_loyalty(p_sale_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s        RECORD;
  b        RECORD;
  v_client UUID;
  v_base   NUMERIC;
  v_units  INTEGER := 0;
BEGIN
  SELECT id, business_id, appointment_id, customer_id, subtotal, discount_amount, status, created_at
    INTO s FROM sales WHERE id = p_sale_id;
  IF NOT FOUND OR s.status <> 'paid' THEN RETURN 0; END IF;

  SELECT loyalty_mode, loyalty_earn_per_cop, loyalty_expiry_months,
         COALESCE((features_enabled ->> 'loyalty')::BOOLEAN, FALSE) AS enabled
    INTO b FROM businesses WHERE id = s.business_id;
  IF NOT FOUND OR NOT b.enabled THEN RETURN 0; END IF;

  v_client := s.customer_id;
  IF v_client IS NULL AND s.appointment_id IS NOT NULL THEN
    SELECT customer_id INTO v_client FROM appointments WHERE id = s.appointment_id;
  END IF;
  IF v_client IS NULL THEN RETURN 0; END IF;

  IF EXISTS (SELECT 1 FROM loyalty_ledgers
              WHERE sale_id = s.id AND kind = b.loyalty_mode AND entry_type = 'earn') THEN
    RETURN 0;
  END IF;

  IF b.loyalty_mode = 'points' THEN
    v_base  := GREATEST(COALESCE(s.subtotal, 0) - COALESCE(s.discount_amount, 0), 0);  -- sin propina
    v_units := FLOOR(v_base / GREATEST(b.loyalty_earn_per_cop, 1));
  ELSE
    IF EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.item_type = 'service') THEN
      v_units := 1;
    END IF;
  END IF;

  IF v_units <= 0 THEN RETURN 0; END IF;

  INSERT INTO loyalty_ledgers (business_id, client_id, kind, entry_type, points_added, points_redeemed,
                               transaction_reference, sale_id, expires_at, created_at, notes)
  VALUES (s.business_id, v_client, b.loyalty_mode, 'earn', v_units, 0, s.id, s.id,
          CASE WHEN b.loyalty_mode = 'points'
               THEN s.created_at + make_interval(months => COALESCE(b.loyalty_expiry_months, 12))
               ELSE NULL END,
          s.created_at,
          CASE WHEN b.loyalty_mode = 'points' THEN 'Compra' ELSE 'Visita' END)
  ON CONFLICT DO NOTHING;

  RETURN v_units;
END;
$$;
REVOKE ALL ON FUNCTION public._record_sale_loyalty(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._trg_sale_loyalty()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sale UUID;
BEGIN
  IF TG_TABLE_NAME = 'sale_items' THEN v_sale := NEW.sale_id; ELSE v_sale := NEW.id; END IF;
  BEGIN
    PERFORM public._record_sale_loyalty(v_sale);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'loyalty: % (sale %)', SQLERRM, v_sale;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._trg_sale_loyalty() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sale_items_loyalty ON public.sale_items;
CREATE TRIGGER trg_sale_items_loyalty
  AFTER INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public._trg_sale_loyalty();

DROP TRIGGER IF EXISTS trg_sales_paid_loyalty ON public.sales;
CREATE TRIGGER trg_sales_paid_loyalty
  AFTER UPDATE OF status ON public.sales
  FOR EACH ROW
  WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
  EXECUTE FUNCTION public._trg_sale_loyalty();

-- ── 5. RPCs para la app (todas verifican el negocio) ─────────────────────────
-- Saldo del cliente en el modo activo del negocio
CREATE OR REPLACE FUNCTION public.get_customer_loyalty(p_customer_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c   RECORD;
  b   RECORD;
  bal RECORD;
BEGIN
  SELECT id, business_id INTO c FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public._assert_business_access(c.business_id);

  SELECT loyalty_mode, loyalty_earn_per_cop, loyalty_point_value_cop, loyalty_min_redeem_points,
         loyalty_expiry_months, loyalty_stamps_required, loyalty_stamp_max_reward_cop,
         COALESCE((features_enabled ->> 'loyalty')::BOOLEAN, FALSE) AS enabled
    INTO b FROM businesses WHERE id = c.business_id;

  SELECT * INTO bal FROM public._loyalty_balance(c.business_id, c.id, b.loyalty_mode);

  RETURN jsonb_build_object(
    'enabled',        b.enabled,
    'mode',           b.loyalty_mode,
    'balance',        bal.balance,
    'expiring_30d',   bal.expiring_30d,
    'point_value_cop', b.loyalty_point_value_cop,
    'value_cop',      CASE WHEN b.loyalty_mode = 'points' THEN bal.balance * b.loyalty_point_value_cop ELSE NULL END,
    'min_redeem',     b.loyalty_min_redeem_points,
    'stamps_required', b.loyalty_stamps_required,
    'stamp_max_reward_cop', b.loyalty_stamp_max_reward_cop,
    'can_redeem',     b.enabled AND CASE WHEN b.loyalty_mode = 'points'
                                         THEN bal.balance > 0 AND bal.balance >= b.loyalty_min_redeem_points
                                         ELSE bal.balance >= b.loyalty_stamps_required END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_customer_loyalty(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_loyalty(UUID) TO authenticated;

-- Canje ligado a una venta ya pagada (el descuento ya se aplicó en el cobro).
-- points: p_units = puntos a descontar; stamps: descuenta loyalty_stamps_required.
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

-- Ajuste manual (solo admin), p_delta positivo suma, negativo resta
CREATE OR REPLACE FUNCTION public.adjust_customer_loyalty(p_customer_id UUID, p_delta INTEGER, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c   RECORD;
  b   RECORD;
  bal RECORD;
BEGIN
  SELECT id, business_id INTO c FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public._assert_business_access(c.business_id);
  IF NOT public._is_business_admin(c.business_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_delta IS NULL OR p_delta = 0 OR ABS(p_delta) > 1000000 THEN RAISE EXCEPTION 'invalid_delta'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT loyalty_mode, loyalty_expiry_months INTO b FROM businesses WHERE id = c.business_id;
  PERFORM pg_advisory_xact_lock(hashtext('loyalty:' || c.id::TEXT));
  SELECT * INTO bal FROM public._loyalty_balance(c.business_id, c.id, b.loyalty_mode);
  IF p_delta < 0 AND bal.balance < ABS(p_delta) THEN RAISE EXCEPTION 'insufficient_balance'; END IF;

  INSERT INTO loyalty_ledgers (business_id, client_id, kind, entry_type, points_added, points_redeemed,
                               expires_at, created_by, notes)
  VALUES (c.business_id, c.id, b.loyalty_mode, 'adjust',
          GREATEST(p_delta, 0), GREATEST(-p_delta, 0),
          CASE WHEN p_delta > 0 AND b.loyalty_mode = 'points'
               THEN NOW() + make_interval(months => COALESCE(b.loyalty_expiry_months, 12)) ELSE NULL END,
          auth.uid(), LEFT(btrim(p_reason), 200));

  RETURN jsonb_build_object('balance', bal.balance + p_delta);
END;
$$;
REVOKE ALL ON FUNCTION public.adjust_customer_loyalty(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_customer_loyalty(UUID, INTEGER, TEXT) TO authenticated;

-- Resumen para el panel: clientes con saldo, total vigente, canjeado (modo activo)
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

-- Aplicar a ventas pagadas sin movimiento de lealtad (solo admin)
CREATE OR REPLACE FUNCTION public.apply_pending_loyalty(p_business_id UUID, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale  RECORD;
  v_sales INTEGER := 0;
  v_units INTEGER := 0;
  v_n     INTEGER;
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  IF NOT public._is_business_admin(p_business_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  FOR v_sale IN
    SELECT id FROM sales
     WHERE business_id = p_business_id AND status = 'paid'
       AND (p_from IS NULL OR (created_at AT TIME ZONE 'America/Bogota')::DATE >= p_from)
       AND (p_to   IS NULL OR (created_at AT TIME ZONE 'America/Bogota')::DATE <= p_to)
     ORDER BY created_at
  LOOP
    v_n := public._record_sale_loyalty(v_sale.id);
    IF v_n > 0 THEN v_sales := v_sales + 1; v_units := v_units + v_n; END IF;
  END LOOP;

  RETURN jsonb_build_object('sales', v_sales, 'units', v_units);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_pending_loyalty(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_pending_loyalty(UUID, DATE, DATE) TO authenticated;

-- ── 6. Cerrar las funciones viejas y la tabla ────────────────────────────────
REVOKE ALL ON FUNCTION public.earn_loyalty_points(UUID, UUID, INTEGER, UUID)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_loyalty_points(UUID, UUID, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_client_loyalty_balance(UUID, UUID)          FROM PUBLIC, anon, authenticated;

-- Los movimientos solo se escriben por las funciones de arriba; los usuarios leen.
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'loyalty_ledgers'
              AND NOT ('service_role' = ANY (roles))
  LOOP
    EXECUTE format('DROP POLICY %I ON public.loyalty_ledgers', p.policyname);
  END LOOP;
END $$;

ALTER TABLE public.loyalty_ledgers ENABLE ROW LEVEL SECURITY;
CREATE POLICY xin_select ON public.loyalty_ledgers
  FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id')
         OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE));
