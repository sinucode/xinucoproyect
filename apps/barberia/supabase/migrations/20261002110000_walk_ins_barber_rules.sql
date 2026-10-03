-- ============================================================
-- 20261002110000_walk_ins_barber_rules.sql — Fila de espera: limpieza y reglas de barbero
--
-- 1) close_stale_walk_ins(p_business_id): los turnos que siguen EN ESPERA (o apartados
--    sin empezar) de un día anterior del negocio se cierran como 'cancelled' (el estado
--    de "no se quedó"; walk_ins no tiene un estado 'left' — su CHECK solo admite
--    waiting / in_progress / completed / cancelled) y liberan su hueco apartado igual
--    que release_walk_in(p_cancel => true). Medianoche = America/Bogota.
--
-- 2) Un barbero/manicurista (profiles.role no admin) solo opera SUS turnos:
--    - start_walk_in:   a nombre propio, y turno suyo o sin barbero reservado/pedido.
--    - reserve_walk_in: SIEMPRE a nombre propio (p_staff_id = un profesional del usuario) y solo un
--                       turno libre o suyo. Un barbero NO puede pasarle el turno a un colega: eso es del admin.
--    - release_walk_in: libera lo suyo o lo libre; el hueco de otro profesional es del admin.
--    El admin (_is_business_admin) conserva todo. Se recrean las últimas definiciones
--    (start: 20260930110000, reserve: 20260929170000, release: 20260929160000) agregando
--    SOLO el guard (error 'walk_in_not_yours').
--
-- 3) Triggers _guard_walk_in_staff_change (INSERT y UPDATE): walk_ins admite INSERT/UPDATE de
--    cualquier miembro del negocio por REST (RLS xin_insert/xin_update), así que sin esto un
--    barbero podría crear turnos para otro, reasignar o cerrar el turno de otro con un
--    PATCH directo. Ver la nota sobre current_user abajo.
--    _sync_walk_in_from_appointment pasa a SECURITY DEFINER para no depender de este guard.
-- ============================================================

-- ── 1. Cerrar turnos de días anteriores ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_stale_walk_ins(p_business_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- Medianoche de HOY en el negocio, como instante real (arrived_at es un instante real)
  v_cutoff TIMESTAMPTZ := date_trunc('day', (NOW() AT TIME ZONE 'America/Bogota')) AT TIME ZONE 'America/Bogota';
  r        RECORD;
  v_n      INTEGER := 0;
BEGIN
  PERFORM public._assert_business_access(p_business_id);

  FOR r IN
    SELECT id FROM walk_ins
     WHERE business_id = p_business_id
       AND status = 'waiting'
       AND arrived_at < v_cutoff
     ORDER BY arrived_at
       FOR UPDATE
  LOOP
    PERFORM public._release_walk_in_slot(r.id);   -- cancela la cita 'scheduled' apartada
    UPDATE walk_ins
       SET staff_id = NULL,
           status   = 'cancelled',
           notes    = CASE WHEN NULLIF(TRIM(notes), '') IS NULL
                           THEN 'Cerrado automaticamente: no se atendio el dia que llego'
                           ELSE notes || ' - Cerrado automaticamente: no se atendio el dia que llego' END
     WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.close_stale_walk_ins(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_stale_walk_ins(UUID) TO authenticated;

-- ── 2. RPCs con la regla de barbero (cuerpo anterior + guard) ────────────────

CREATE OR REPLACE FUNCTION public.start_walk_in(
  p_walk_in_id UUID,
  p_staff_id   UUID,
  p_service_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w          RECORD;
  a          RECORD;
  v_service  UUID;
  v_customer UUID;
  v_phone    TEXT;
  v_appt     UUID;
  v_dur      INTEGER;
  v_start    TIMESTAMPTZ := date_trunc('minute', (NOW() AT TIME ZONE 'America/Bogota')) AT TIME ZONE 'UTC';
BEGIN
  SELECT * INTO w FROM walk_ins WHERE id = p_walk_in_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'walk_in_not_found'; END IF;
  PERFORM public._assert_business_access(w.business_id);
  IF w.status <> 'waiting' THEN RAISE EXCEPTION 'walk_in_not_waiting'; END IF;

  -- Barbero/manicurista: solo atiende a nombre propio, y solo turnos suyos (reservados
  -- o pedidos con él) o que nadie reservó ni pidió. El admin atiende cualquiera.
  IF NOT public._is_business_admin(w.business_id) THEN
    IF NOT public._is_my_staff(p_staff_id)
       OR (w.staff_id IS NOT NULL AND NOT public._is_my_staff(w.staff_id)) THEN
      RAISE EXCEPTION 'walk_in_not_yours';
    END IF;
  END IF;

  PERFORM 1 FROM staff WHERE id = p_staff_id AND business_id = w.business_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;

  v_service := COALESCE(p_service_id, w.service_id);
  PERFORM 1 FROM services WHERE id = v_service AND business_id = w.business_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_required'; END IF;

  -- Estación compartida libre desde ahora (el hueco apartado de este turno no cuenta)
  SELECT duration_minutes + COALESCE(buffer_time_minutes, 0) INTO v_dur FROM services WHERE id = v_service;
  IF EXISTS (SELECT 1 FROM service_workstations WHERE service_id = v_service AND business_id = w.business_id) THEN
    PERFORM pg_advisory_xact_lock(hashtext('stations:' || w.business_id::TEXT));
    IF NOT public._station_ok(w.business_id, v_service, v_start, v_start + make_interval(mins => COALESCE(v_dur, 30)), w.appointment_id) THEN
      RAISE EXCEPTION 'station_busy';
    END IF;
  END IF;

  -- ¿Tiene un hueco apartado con este mismo barbero? → reutilizarlo
  IF w.appointment_id IS NOT NULL THEN
    SELECT id, staff_id, status INTO a FROM appointments WHERE id = w.appointment_id;
    IF FOUND AND a.staff_id = p_staff_id AND a.status IN ('scheduled', 'payment_pending') THEN
      UPDATE appointments
         SET status = 'in_progress', start_time = v_start, service_id = v_service, updated_at = NOW()
       WHERE id = a.id;
      UPDATE walk_ins SET status = 'in_progress', staff_id = p_staff_id, service_id = v_service WHERE id = w.id;
      RETURN jsonb_build_object('appointment_id', a.id, 'customer_id', w.customer_id, 'reused', TRUE);
    END IF;
    -- Otro barbero: liberar el hueco anterior
    PERFORM public._release_walk_in_slot(w.id);
  END IF;

  v_phone := COALESCE(NULLIF(TRIM(w.customer_phone), ''), 'fila-' || LEFT(w.id::TEXT, 8));
  SELECT id INTO v_customer FROM customers WHERE business_id = w.business_id AND phone = v_phone LIMIT 1;
  IF v_customer IS NULL THEN
    INSERT INTO customers (business_id, full_name, phone)
    VALUES (w.business_id, w.customer_name, v_phone)
    RETURNING id INTO v_customer;
  END IF;

  INSERT INTO appointments (business_id, customer_id, service_id, staff_id, start_time, status, notes)
  VALUES (w.business_id, v_customer, v_service, p_staff_id, v_start, 'in_progress',
          COALESCE('Fila de espera. ' || NULLIF(TRIM(w.notes), ''), 'Fila de espera'))
  RETURNING id INTO v_appt;

  UPDATE walk_ins
     SET status = 'in_progress', staff_id = p_staff_id, service_id = v_service,
         appointment_id = v_appt, customer_id = v_customer
   WHERE id = w.id;

  RETURN jsonb_build_object('appointment_id', v_appt, 'customer_id', v_customer, 'reused', FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.start_walk_in(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_walk_in(UUID, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reserve_walk_in(p_walk_in_id UUID, p_staff_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w          RECORD;
  v_duration INTEGER;
  v_now      TIMESTAMPTZ := (NOW() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'UTC';
  v_staff    UUID := p_staff_id;
  v_slot     TIMESTAMPTZ;
  v_customer UUID;
  v_phone    TEXT;
  v_appt     UUID;
BEGIN
  SELECT * INTO w FROM walk_ins WHERE id = p_walk_in_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'walk_in_not_found'; END IF;
  PERFORM public._assert_business_access(w.business_id);
  IF w.status <> 'waiting' THEN RAISE EXCEPTION 'walk_in_not_waiting'; END IF;

  -- Barbero/manicurista: solo aparta A NOMBRE PROPIO (el profesional destino es uno suyo; sin
  -- destino no hay "el mejor": eso decide el admin) y solo un turno libre o ya suyo. No puede
  -- pasarle el turno a un colega ni quitárselo: un turno de otro profesional es del admin.
  IF NOT public._is_business_admin(w.business_id) THEN
    IF p_staff_id IS NULL
       OR NOT public._is_my_staff(p_staff_id)
       OR (w.staff_id IS NOT NULL AND NOT public._is_my_staff(w.staff_id)) THEN
      RAISE EXCEPTION 'walk_in_not_yours';
    END IF;
  END IF;

  SELECT COALESCE(duration_minutes, 30) + COALESCE(buffer_time_minutes, 0) INTO v_duration
    FROM services WHERE id = w.service_id AND business_id = w.business_id AND is_active;
  IF v_duration IS NULL THEN RAISE EXCEPTION 'service_required'; END IF;

  -- Liberar lo que tuviera apartado antes de buscar (así su propio hueco cuenta como libre)
  PERFORM public._release_walk_in_slot(w.id);

  IF v_staff IS NULL THEN
    SELECT s.id, public._staff_next_slot(s.id, v_duration, v_now) AS slot
      INTO v_staff, v_slot
      FROM staff s
     WHERE s.business_id = w.business_id AND s.is_active
       AND (NOT EXISTS (SELECT 1 FROM staff_services x WHERE x.staff_id = s.id)
            OR EXISTS (SELECT 1 FROM staff_services x WHERE x.staff_id = s.id AND x.service_id = w.service_id))
       AND public._staff_next_slot(s.id, v_duration, v_now) IS NOT NULL
     ORDER BY 2,
              (SELECT COUNT(*) FROM appointments ap
                WHERE ap.staff_id = s.id AND ap.status NOT IN ('cancelled', 'no_show')
                  AND ap.start_time >= date_trunc('day', v_now)
                  AND ap.start_time <  date_trunc('day', v_now) + INTERVAL '1 day'),
              s.full_name
     LIMIT 1;
    IF v_staff IS NULL THEN RAISE EXCEPTION 'no_availability_today'; END IF;
  ELSE
    PERFORM 1 FROM staff WHERE id = v_staff AND business_id = w.business_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;
    v_slot := public._staff_next_slot(v_staff, v_duration, v_now);
    IF v_slot IS NULL THEN RAISE EXCEPTION 'no_availability_today'; END IF;
  END IF;

  -- Serializa con reservas en línea concurrentes del mismo barbero
  PERFORM 1 FROM staff WHERE id = v_staff FOR UPDATE;

  v_phone := COALESCE(NULLIF(TRIM(w.customer_phone), ''), 'fila-' || LEFT(w.id::TEXT, 8));
  SELECT id INTO v_customer FROM customers WHERE business_id = w.business_id AND phone = v_phone LIMIT 1;
  IF v_customer IS NULL THEN
    INSERT INTO customers (business_id, full_name, phone)
    VALUES (w.business_id, w.customer_name, v_phone)
    RETURNING id INTO v_customer;
  END IF;

  INSERT INTO appointments (business_id, customer_id, service_id, staff_id, start_time, status, notes)
  VALUES (w.business_id, v_customer, w.service_id, v_staff, v_slot, 'scheduled',
          COALESCE('Fila de espera - turno apartado. ' || NULLIF(TRIM(w.notes), ''), 'Fila de espera - turno apartado'))
  RETURNING id INTO v_appt;

  UPDATE walk_ins
     SET staff_id = v_staff, appointment_id = v_appt, customer_id = v_customer
   WHERE id = w.id;

  RETURN jsonb_build_object('appointment_id', v_appt, 'staff_id', v_staff, 'start_time', v_slot);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_walk_in(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_walk_in(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_walk_in(p_walk_in_id UUID, p_cancel BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w RECORD;
BEGIN
  SELECT * INTO w FROM walk_ins WHERE id = p_walk_in_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'walk_in_not_found'; END IF;
  PERFORM public._assert_business_access(w.business_id);
  IF w.status <> 'waiting' THEN RAISE EXCEPTION 'walk_in_not_waiting'; END IF;

  -- Barbero/manicurista: libera lo suyo o lo que nadie tiene; el hueco apartado de otro
  -- profesional solo lo libera el admin. Sacar de la fila un turno sin hueco apartado
  -- (cliente que se fue) sí lo puede hacer cualquiera del equipo.
  IF NOT public._is_business_admin(w.business_id) THEN
    IF NOT ( w.staff_id IS NULL
          OR public._is_my_staff(w.staff_id)
          OR (p_cancel AND w.appointment_id IS NULL) ) THEN
      RAISE EXCEPTION 'walk_in_not_yours';
    END IF;
  END IF;

  PERFORM public._release_walk_in_slot(w.id);
  UPDATE walk_ins
     SET staff_id = NULL,
         status   = CASE WHEN p_cancel THEN 'cancelled' ELSE status END
   WHERE id = w.id;
END;
$$;
REVOKE ALL ON FUNCTION public.release_walk_in(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_walk_in(UUID, BOOLEAN) TO authenticated;

-- ── 3. Guard en walk_ins para escrituras directas (REST) ─────────────────────
-- SECURITY INVOKER a propósito: current_user es el rol que ejecuta el INSERT/UPDATE.
--   · Por REST (PostgREST) es 'authenticated' → se aplica la regla.
--   · Dentro de un RPC SECURITY DEFINER (start/reserve/release/close_stale) es el
--     dueño de la función ('postgres') → NO se aplica aquí; esos RPC ya validan
--     la misma regla arriba. service_role y el SQL editor tampoco son 'authenticated'.
--   · _sync_walk_in_from_appointment (cierra el turno cuando se cierra su cita): antes era INVOKER
--     y corría como el usuario que actualiza la cita. Un barbero solo actualiza SUS citas y la cita
--     de un turno es del mismo profesional que el turno, así que pasaba; pero si el admin movió la
--     cita a otro barbero el turno conserva el profesional anterior y este guard habría bloqueado
--     el cierre de la cita. Se recrea SECURITY DEFINER: solo toca los turnos ligados a la cita que
--     el usuario ya pudo cambiar (RLS de appointments), no recibe parámetros del cliente y queda
--     fuera de este guard (current_user = dueño).
-- Regla (solo no-admin):
--   INSERT: staff_id NULL o propio, status 'waiting', sin appointment_id (si no, release_walk_in
--           podría cancelar la cita de otro).
--   UPDATE: · staff_id solo puede pasar de propio a NULL, o de NULL/propio a propio; nunca a otro.
--           · cualquier cambio de status exige que el turno NO tenga a OTRO profesional asignado
--             (cubre completar, cancelar o revertir el turno en atención de un colega).
--           · appointment_id no se toca por REST (solo lo manejan los RPC).
CREATE OR REPLACE FUNCTION public._guard_walk_in_staff_change()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF public._is_business_admin(NEW.business_id) THEN RETURN NEW; END IF;
    IF NEW.status IS DISTINCT FROM 'waiting'
       OR NEW.appointment_id IS NOT NULL
       OR (NEW.staff_id IS NOT NULL AND NOT public._is_my_staff(NEW.staff_id)) THEN
      RAISE EXCEPTION 'walk_in_not_yours';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF public._is_business_admin(OLD.business_id) THEN RETURN NEW; END IF;

  IF NEW.staff_id IS DISTINCT FROM OLD.staff_id THEN
    IF NEW.staff_id IS NULL THEN
      -- liberar: solo lo propio
      IF NOT public._is_my_staff(OLD.staff_id) THEN RAISE EXCEPTION 'walk_in_not_yours'; END IF;
    ELSE
      -- tomar para sí un turno libre (o ya propio); jamás asignarlo a otro profesional
      IF NOT public._is_my_staff(NEW.staff_id)
         OR (OLD.staff_id IS NOT NULL AND NOT public._is_my_staff(OLD.staff_id)) THEN
        RAISE EXCEPTION 'walk_in_not_yours';
      END IF;
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND OLD.staff_id IS NOT NULL AND NOT public._is_my_staff(OLD.staff_id) THEN
    RAISE EXCEPTION 'walk_in_not_yours';
  END IF;

  IF NEW.appointment_id IS DISTINCT FROM OLD.appointment_id THEN
    RAISE EXCEPTION 'walk_in_not_yours';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._guard_walk_in_staff_change() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_guard_walk_in_staff_change ON public.walk_ins;
CREATE TRIGGER trg_guard_walk_in_staff_change
  BEFORE UPDATE OF staff_id, status, appointment_id ON public.walk_ins
  FOR EACH ROW
  WHEN (NEW.staff_id IS DISTINCT FROM OLD.staff_id
        OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id)
  EXECUTE FUNCTION public._guard_walk_in_staff_change();

-- (un INSERT trigger no puede usar OLD en su WHEN: va aparte, misma función)
DROP TRIGGER IF EXISTS trg_guard_walk_in_insert ON public.walk_ins;
CREATE TRIGGER trg_guard_walk_in_insert
  BEFORE INSERT ON public.walk_ins
  FOR EACH ROW
  EXECUTE FUNCTION public._guard_walk_in_staff_change();

-- ── 4. Cierre del turno al cerrarse su cita: SECURITY DEFINER (ver nota arriba) ──
CREATE OR REPLACE FUNCTION public._sync_walk_in_from_appointment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('completed', 'cancelled', 'no_show') THEN
    UPDATE walk_ins
       SET status    = CASE WHEN NEW.status = 'completed' THEN 'completed' ELSE 'cancelled' END,
           served_at = CASE WHEN NEW.status = 'completed' THEN NOW() ELSE served_at END
     WHERE appointment_id = NEW.id
       AND business_id    = NEW.business_id
       AND status IN ('waiting', 'in_progress');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._sync_walk_in_from_appointment() FROM PUBLIC, anon, authenticated;
