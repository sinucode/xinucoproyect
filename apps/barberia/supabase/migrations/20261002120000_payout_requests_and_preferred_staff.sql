-- ============================================================
-- 20261002120000_payout_requests_and_preferred_staff.sql
--
-- ORDEN DE EJECUCIÓN: 1) deploy del código  2) ESTA migración (todo es aditivo; el código nuevo
-- tolera que aún no exista: Mi cuenta y Clientes siguen funcionando sin solicitudes ni "Mis clientes").
--
-- 1. Clientes · filtro "Mis clientes": list_customers acepta p_filter = 'mine'.
-- 2. Clientes · barbero preferido: solo el admin lo cambia (trigger en customers).
-- 3. Mi cuenta · solicitudes de pago / anticipo: tabla payout_requests + RPCs DEFINER.
--    UNA solicitud NUNCA mueve plata: solo el flujo existente de "Pagos al equipo" (staff_ledger)
--    registra pagos y anticipos. La solicitud se marca como pagada apuntando a ese movimiento.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 1. list_customers con el filtro 'mine'
-- ════════════════════════════════════════════════════════════
-- Misma definición que 20261001140000 (DEFINER, total_spent = NULL si no es admin) más UN cambio:
-- el filtro 'mine' ("Mis clientes"): clientes con alguna cita (cualquier estado menos 'cancelled')
-- con el profesional vinculado al usuario que consulta. Sin profesional vinculado = lista vacía.
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
  v_my_staff UUID[];
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  v_admin := public._is_business_admin(p_business_id);
  -- Ordenar por gasto filtraría el ranking de gasto: el no-admin cae a "última visita"
  v_sort := CASE WHEN p_sort = 'spent' AND NOT v_admin THEN 'recent' ELSE p_sort END;
  -- Profesional(es) del usuario en este negocio (para el filtro 'mine')
  SELECT COALESCE(array_agg(s.id), '{}'::UUID[]) INTO v_my_staff
    FROM staff s
   WHERE s.business_id = p_business_id AND s.user_id = auth.uid() AND auth.uid() IS NOT NULL;

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
               WHEN 'mine'     THEN EXISTS (
                                      SELECT 1 FROM appointments a
                                       WHERE a.customer_id = b.id AND a.business_id = p_business_id
                                         AND a.status <> 'cancelled'
                                         AND a.staff_id = ANY (v_my_staff))
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

-- ════════════════════════════════════════════════════════════
-- 2. Barbero preferido: solo el administrador del negocio
--
-- Se verificó en las migraciones que NINGUNA función SECURITY DEFINER escribe
-- customers.preferred_staff_id (create_public_booking y el resto no la tocan). Quien la cambia hoy
-- es la app con el cliente del usuario (updateCustomerPreferences). Por eso la regla es:
--   · sin sesión de usuario (auth.uid() IS NULL: service role, reserva pública anónima,
--     SQL Editor) → se permite;
--   · cambios anidados (pg_trigger_depth() > 1: p. ej. el ON DELETE SET NULL de la FK cuando se
--     borra un profesional) → se permite;
--   · cualquier otro cambio exige ser admin/super_admin del negocio del cliente.
-- (current_setting('role') no sirve para distinguir: dentro de una función DEFINER sigue siendo
-- 'authenticated'.)
-- Solo dispara si la columna cambia de verdad (BEFORE UPDATE OF + IS DISTINCT FROM).
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_customers_preferred_staff_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.preferred_staff_id IS DISTINCT FROM OLD.preferred_staff_id
     AND auth.uid() IS NOT NULL
     AND pg_trigger_depth() <= 1
     AND NOT public._is_business_admin(NEW.business_id) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501',
      DETAIL = 'Solo un administrador puede cambiar el barbero preferido de un cliente.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._trg_customers_preferred_staff_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_customers_preferred_staff_guard ON public.customers;
CREATE TRIGGER trg_customers_preferred_staff_guard
  BEFORE UPDATE OF preferred_staff_id ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public._trg_customers_preferred_staff_guard();

-- ════════════════════════════════════════════════════════════
-- 3. Solicitudes de pago / anticipo
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.payout_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  staff_id        UUID        NOT NULL REFERENCES public.staff(id)      ON DELETE CASCADE,
  kind            TEXT        NOT NULL CHECK (kind IN ('payout', 'advance')),
  -- NUMERIC: en producción hay columnas de dinero INTEGER; aquí no se asume nada
  amount          NUMERIC     NOT NULL CHECK (amount > 0 AND amount <= 50000000),
  note            TEXT        CHECK (note IS NULL OR char_length(note) <= 200),
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'paid', 'rejected', 'cancelled')),
  requested_by    UUID        DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  resolution_note TEXT        CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 200),
  -- Movimiento de staff_ledger con el que se pagó (anticipo/pago registrado por el admin)
  ledger_entry_id UUID        REFERENCES public.staff_ledger(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'pending') = (resolved_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_payout_requests_business_status ON public.payout_requests (business_id, status);
CREATE INDEX IF NOT EXISTS idx_payout_requests_staff_created   ON public.payout_requests (staff_id, created_at DESC);
-- Una sola solicitud pendiente por profesional (también protege de dos envíos simultáneos)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_requests_one_pending
  ON public.payout_requests (staff_id) WHERE status = 'pending';
-- Un movimiento del equipo solo puede cerrar UNA solicitud
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_requests_ledger_entry
  ON public.payout_requests (ledger_entry_id) WHERE ledger_entry_id IS NOT NULL;

-- ── RLS: lectura admin del negocio o profesional dueño; escrituras solo por RPC ──
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'payout_requests' LOOP
    EXECUTE format('DROP POLICY %I ON public.payout_requests', p.policyname);
  END LOOP;
END $$;

CREATE POLICY xin_select ON public.payout_requests FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id')
         AND (public._is_business_admin(business_id) OR public._is_my_staff(staff_id)));
-- Rol interno (funciones SECURITY DEFINER), mismo patrón que el resto de tablas
CREATE POLICY xin_internal_definer ON public.payout_requests FOR ALL TO postgres USING (TRUE) WITH CHECK (TRUE);

-- Sin INSERT / UPDATE / DELETE para usuarios: todo pasa por las funciones de abajo
REVOKE ALL ON public.payout_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payout_requests TO authenticated;
GRANT ALL ON public.payout_requests TO service_role;

-- ── Saldo actual de un profesional (misma regla que staff_ledger_balances), en NUMERIC ──
CREATE OR REPLACE FUNCTION public._staff_balance_numeric(p_staff_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(CASE
           WHEN l.entry_type IN ('commission', 'tip', 'bonus')      THEN  l.amount::NUMERIC
           WHEN l.entry_type IN ('advance', 'payment', 'deduction') THEN -l.amount::NUMERIC
           ELSE 0 END), 0)
    FROM staff_ledger l
   WHERE l.staff_id = p_staff_id
$$;
REVOKE ALL ON FUNCTION public._staff_balance_numeric(UUID) FROM PUBLIC, anon, authenticated;

-- ── request_payout: el profesional pide un pago o un anticipo ────────────────
-- Errores (mensaje = código): forbidden, not_linked, invalid_kind, invalid_amount, note_too_long,
-- exceeds_balance (DETAIL = saldo), pending_exists.
CREATE OR REPLACE FUNCTION public.request_payout(p_kind TEXT, p_amount NUMERIC, p_note TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz     UUID;
  v_staff   UUID;
  v_note    TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_balance NUMERIC;
  v_id      UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  BEGIN
    v_biz := (auth.jwt() -> 'app_metadata' ->> 'business_id')::UUID;
  EXCEPTION WHEN OTHERS THEN v_biz := NULL;
  END;
  IF v_biz IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public._assert_business_access(v_biz);

  -- El profesional vinculado a este usuario (el business_id sale del token, nunca del cliente)
  SELECT s.id INTO v_staff
    FROM staff s
   WHERE s.business_id = v_biz AND s.user_id = auth.uid() AND s.is_active = TRUE
   ORDER BY s.created_at
   LIMIT 1;
  IF v_staff IS NULL THEN RAISE EXCEPTION 'not_linked'; END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('payout', 'advance') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  -- COP entero entre 1 y 50.000.000 (mismo tope que el registro de pagos al equipo)
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> trunc(p_amount) OR p_amount > 50000000 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN RAISE EXCEPTION 'note_too_long'; END IF;

  IF EXISTS (SELECT 1 FROM payout_requests r WHERE r.staff_id = v_staff AND r.status = 'pending') THEN
    RAISE EXCEPTION 'pending_exists';
  END IF;

  -- Un pago no puede pedir más de lo que se le debe; un anticipo es plata que aún no ganó
  IF p_kind = 'payout' THEN
    v_balance := public._staff_balance_numeric(v_staff);
    IF p_amount > v_balance THEN
      RAISE EXCEPTION 'exceeds_balance' USING DETAIL = GREATEST(v_balance, 0)::TEXT;
    END IF;
  END IF;

  BEGIN
    INSERT INTO payout_requests (business_id, staff_id, kind, amount, note, requested_by)
    VALUES (v_biz, v_staff, p_kind, p_amount, v_note, auth.uid())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'pending_exists';
  END;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_payout(TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_payout(TEXT, NUMERIC, TEXT) TO authenticated;

-- ── cancel_payout_request: el profesional cancela SU solicitud pendiente ─────
-- Errores: forbidden, not_found (también si es de otro), not_pending.
CREATE OR REPLACE FUNCTION public.cancel_payout_request(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz UUID;
  r     payout_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  BEGIN
    v_biz := (auth.jwt() -> 'app_metadata' ->> 'business_id')::UUID;
  EXCEPTION WHEN OTHERS THEN v_biz := NULL;
  END;
  IF v_biz IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO r FROM payout_requests WHERE id = p_id AND business_id = v_biz FOR UPDATE;
  IF NOT FOUND OR NOT public._is_my_staff(r.staff_id) THEN RAISE EXCEPTION 'not_found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;

  UPDATE payout_requests
     SET status = 'cancelled', resolved_by = auth.uid(), resolved_at = NOW()
   WHERE id = r.id;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_payout_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_payout_request(UUID) TO authenticated;

-- ── resolve_payout_request: el admin la marca pagada o la rechaza ────────────
-- 'paid': NO mueve plata; el movimiento (anticipo/pago) ya lo registró el flujo de Pagos al equipo y
-- aquí solo se enlaza (p_ledger_entry_id, opcional) tras validar que es del mismo negocio y profesional,
-- del tipo que corresponde (payout → payment, advance → advance), posterior a la solicitud y no
-- usado por otra solicitud.
-- 'rejected': el motivo es obligatorio (3 a 200 caracteres).
-- Errores: forbidden, invalid_status, not_found, not_pending, note_required, note_too_long,
-- invalid_ledger_entry.
CREATE OR REPLACE FUNCTION public.resolve_payout_request(
  p_id              UUID,
  p_status          TEXT,
  p_note            TEXT DEFAULT NULL,
  p_ledger_entry_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz  UUID;
  v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  r      payout_requests%ROWTYPE;
BEGIN
  v_biz := public._my_admin_business();   -- 'forbidden' si no es admin del negocio del token

  IF p_status IS NULL OR p_status NOT IN ('paid', 'rejected') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN RAISE EXCEPTION 'note_too_long'; END IF;
  IF p_status = 'rejected' AND (v_note IS NULL OR char_length(v_note) < 3) THEN
    RAISE EXCEPTION 'note_required';
  END IF;

  SELECT * INTO r FROM payout_requests WHERE id = p_id AND business_id = v_biz FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;

  IF p_status = 'paid' AND p_ledger_entry_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM staff_ledger l
       WHERE l.id = p_ledger_entry_id
         AND l.business_id = v_biz
         AND l.staff_id = r.staff_id
         AND l.entry_type = CASE r.kind WHEN 'payout' THEN 'payment' ELSE 'advance' END
         AND l.created_at >= r.created_at
         AND NOT EXISTS (SELECT 1 FROM payout_requests o WHERE o.ledger_entry_id = l.id)
    ) THEN
      RAISE EXCEPTION 'invalid_ledger_entry';
    END IF;
  END IF;

  UPDATE payout_requests
     SET status          = p_status,
         resolved_by     = auth.uid(),
         resolved_at     = NOW(),
         resolution_note = v_note,
         ledger_entry_id = CASE WHEN p_status = 'paid' THEN p_ledger_entry_id END
   WHERE id = r.id;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_payout_request(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_payout_request(UUID, TEXT, TEXT, UUID) TO authenticated;

-- ── Auditoría (a prueba de fallos: nunca bloquea la operación) ───────────────
-- El actor (quien pidió / resolvió) lo pone _audit desde la sesión; el resumen empieza con el verbo.
CREATE OR REPLACE FUNCTION public._trg_audit_payout_requests()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_staff TEXT; v_what TEXT;
BEGIN
  SELECT full_name INTO v_staff FROM staff WHERE id = NEW.staff_id;
  v_what := CASE NEW.kind WHEN 'advance' THEN 'un anticipo' ELSE 'el pago de lo que le deben' END;

  IF TG_OP = 'INSERT' THEN
    PERFORM public._audit(NEW.business_id, 'money', 'payout_request.created', 'payout_request', NEW.id,
      'pidió ' || v_what || ' de ' || public._m(NEW.amount)
        || COALESCE(' · ' || NULLIF(NEW.note, ''), ''),
      'info', NEW.amount, NULL,
      jsonb_build_object('tipo', NEW.kind, 'monto', NEW.amount, 'nota', NEW.note));
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'paid' THEN
      PERFORM public._audit(NEW.business_id, 'money', 'payout_request.paid', 'payout_request', NEW.id,
        'marcó como pagada la solicitud de ' || CASE NEW.kind WHEN 'advance' THEN 'anticipo' ELSE 'pago' END
          || ' de ' || public._m(NEW.amount) || ' de ' || COALESCE(v_staff, 'un profesional'),
        'info', NEW.amount, jsonb_build_object('estado', OLD.status),
        jsonb_build_object('estado', NEW.status, 'movimiento', NEW.ledger_entry_id));
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public._audit(NEW.business_id, 'money', 'payout_request.rejected', 'payout_request', NEW.id,
        'rechazó la solicitud de ' || CASE NEW.kind WHEN 'advance' THEN 'anticipo' ELSE 'pago' END
          || ' de ' || public._m(NEW.amount) || ' de ' || COALESCE(v_staff, 'un profesional')
          || COALESCE(' · motivo: ' || NULLIF(NEW.resolution_note, ''), ''),
        'info', NEW.amount, jsonb_build_object('estado', OLD.status),
        jsonb_build_object('estado', NEW.status, 'motivo', NEW.resolution_note));
    ELSIF NEW.status = 'cancelled' THEN
      PERFORM public._audit(NEW.business_id, 'money', 'payout_request.cancelled', 'payout_request', NEW.id,
        'canceló su solicitud de ' || CASE NEW.kind WHEN 'advance' THEN 'anticipo' ELSE 'pago' END
          || ' de ' || public._m(NEW.amount),
        'info', NEW.amount, jsonb_build_object('estado', OLD.status),
        jsonb_build_object('estado', NEW.status));
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public._trg_audit_payout_requests() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_payout_requests ON public.payout_requests;
CREATE TRIGGER trg_audit_payout_requests AFTER INSERT OR UPDATE OF status ON public.payout_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_payout_requests();
