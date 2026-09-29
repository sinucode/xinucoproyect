-- ============================================================
-- 20260929160000_walk_in_reservations.sql — Apartar el turno en la agenda
--
-- Asignar un barbero a un turno de la fila APARTA su próximo hueco libre de hoy
-- (cita 'scheduled'), así la reserva en línea no puede tomarlo. Sin barbero, se
-- recomienda el que quede libre más pronto. Atender reutiliza esa cita
-- (pasa a in_progress desde ahora). Quitar/reasignar libera el hueco.
--
-- Funciones SECURITY DEFINER con verificación explícita de negocio (usan
-- helpers internos sin EXECUTE para authenticated).
-- Convención horaria: start_time = hora LOCAL del negocio guardada como UTC.
-- ============================================================

-- ── Helpers internos ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._assert_business_access(p_business_id UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF NOT COALESCE(
       (auth.jwt() -> 'app_metadata' ->> 'business_id') = p_business_id::TEXT
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin',
    FALSE
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._assert_business_access(UUID) FROM PUBLIC, anon, authenticated;

-- Próximo inicio libre HOY para un barbero, desde p_from, con pasos de 5 min.
CREATE OR REPLACE FUNCTION public._staff_next_slot(p_staff_id UUID, p_duration INTEGER, p_from TIMESTAMPTZ)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_day   DATE := (p_from AT TIME ZONE 'UTC')::DATE;
  v_sched RECORD;
  v_t     TIMESTAMPTZ;
  v_end   TIMESTAMPTZ;
  v_close TIMESTAMPTZ;
BEGIN
  SELECT start_time, end_time INTO v_sched
    FROM staff_schedules
   WHERE staff_id = p_staff_id AND day_of_week = EXTRACT(DOW FROM v_day)
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_close := (v_day + v_sched.end_time) AT TIME ZONE 'UTC';
  v_t     := GREATEST(p_from, (v_day + v_sched.start_time) AT TIME ZONE 'UTC');
  v_t     := to_timestamp(CEIL(EXTRACT(EPOCH FROM v_t) / 300) * 300);   -- redondeo a 5 min

  LOOP
    v_end := v_t + make_interval(mins => p_duration);
    EXIT WHEN v_end > v_close;

    IF NOT public._staff_blocked(p_staff_id, v_t, v_end)
       AND NOT EXISTS (
         SELECT 1
           FROM appointments a
           LEFT JOIN services sv ON sv.id = a.service_id
          WHERE a.staff_id = p_staff_id
            AND a.status IN ('payment_pending', 'scheduled', 'in_progress', 'ready_to_pay')
            AND a.start_time < v_end
            -- una cita en curso que se alargó ocupa al menos hasta "ahora"
            AND GREATEST(
                  a.start_time + make_interval(mins => COALESCE(sv.duration_minutes, 30) + COALESCE(sv.buffer_time_minutes, 0)),
                  CASE WHEN a.status IN ('in_progress', 'ready_to_pay') THEN p_from ELSE a.start_time END
                ) > v_t
       )
    THEN
      RETURN v_t;
    END IF;

    v_t := v_t + INTERVAL '5 minutes';
  END LOOP;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._staff_next_slot(UUID, INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- Libera el hueco apartado de un turno (desvincula y cancela la cita programada).
CREATE OR REPLACE FUNCTION public._release_walk_in_slot(p_walk_in_id UUID)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_appt UUID;
BEGIN
  SELECT appointment_id INTO v_appt FROM walk_ins WHERE id = p_walk_in_id;
  IF v_appt IS NULL THEN RETURN; END IF;

  -- Desvincular ANTES de cancelar: el trigger cerraría el turno.
  UPDATE walk_ins SET appointment_id = NULL WHERE id = p_walk_in_id;
  UPDATE appointments
     SET status = 'cancelled', cancelled_by = 'business',
         cancellation_reason = 'Turno de la fila reasignado o retirado', updated_at = NOW()
   WHERE id = v_appt AND status IN ('scheduled', 'payment_pending');
END;
$$;
REVOKE ALL ON FUNCTION public._release_walk_in_slot(UUID) FROM PUBLIC, anon, authenticated;

-- ── Recomendación de barbero ─────────────────────────────────────────────────
-- [{ staff_id, full_name, next_slot, minutes_from_now }] ordenado por next_slot.
CREATE OR REPLACE FUNCTION public.suggest_walk_in_staff(p_walk_in_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w          RECORD;
  v_duration INTEGER;
  v_now      TIMESTAMPTZ := (NOW() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'UTC';
BEGIN
  SELECT * INTO w FROM walk_ins WHERE id = p_walk_in_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'walk_in_not_found'; END IF;
  PERFORM public._assert_business_access(w.business_id);

  SELECT COALESCE(duration_minutes, 30) + COALESCE(buffer_time_minutes, 0) INTO v_duration
    FROM services WHERE id = w.service_id;
  v_duration := COALESCE(v_duration, 30);

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'staff_id', x.id, 'full_name', x.full_name, 'next_slot', x.slot,
             'minutes_from_now', GREATEST(0, CEIL(EXTRACT(EPOCH FROM (x.slot - v_now)) / 60))::INT
           ) ORDER BY x.slot, x.full_name)
      FROM (
        SELECT s.id, s.full_name, public._staff_next_slot(s.id, v_duration, v_now) AS slot
          FROM staff s
         WHERE s.business_id = w.business_id AND s.is_active
           AND (
             w.service_id IS NULL
             OR NOT EXISTS (SELECT 1 FROM staff_services x WHERE x.staff_id = s.id)
             OR EXISTS (SELECT 1 FROM staff_services x WHERE x.staff_id = s.id AND x.service_id = w.service_id)
           )
      ) x
     WHERE x.slot IS NOT NULL
  ), '[]'::JSONB);
END;
$$;
REVOKE ALL ON FUNCTION public.suggest_walk_in_staff(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_walk_in_staff(UUID) TO authenticated;

-- ── Apartar el turno con un barbero (o el recomendado si p_staff_id es NULL) ──
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
     ORDER BY 2, s.full_name
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
          COALESCE('Fila de espera · turno apartado. ' || NULLIF(TRIM(w.notes), ''), 'Fila de espera · turno apartado'))
  RETURNING id INTO v_appt;

  UPDATE walk_ins
     SET staff_id = v_staff, appointment_id = v_appt, customer_id = v_customer
   WHERE id = w.id;

  RETURN jsonb_build_object('appointment_id', v_appt, 'staff_id', v_staff, 'start_time', v_slot);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_walk_in(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_walk_in(UUID, UUID) TO authenticated;

-- ── Liberar el turno (quitar barbero o sacar de la fila) ─────────────────────
CREATE OR REPLACE FUNCTION public.release_walk_in(p_walk_in_id UUID, p_cancel BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w RECORD;
BEGIN
  SELECT * INTO w FROM walk_ins WHERE id = p_walk_in_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'walk_in_not_found'; END IF;
  PERFORM public._assert_business_access(w.business_id);
  IF w.status <> 'waiting' THEN RAISE EXCEPTION 'walk_in_not_waiting'; END IF;

  PERFORM public._release_walk_in_slot(w.id);
  UPDATE walk_ins
     SET staff_id = NULL,
         status   = CASE WHEN p_cancel THEN 'cancelled' ELSE status END
   WHERE id = w.id;
END;
$$;
REVOKE ALL ON FUNCTION public.release_walk_in(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_walk_in(UUID, BOOLEAN) TO authenticated;

-- ── Atender: reutiliza la cita apartada si es del mismo barbero ──────────────
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
  v_start    TIMESTAMPTZ := date_trunc('minute', (NOW() AT TIME ZONE 'America/Bogota')) AT TIME ZONE 'UTC';
BEGIN
  SELECT * INTO w FROM walk_ins WHERE id = p_walk_in_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'walk_in_not_found'; END IF;
  PERFORM public._assert_business_access(w.business_id);
  IF w.status <> 'waiting' THEN RAISE EXCEPTION 'walk_in_not_waiting'; END IF;

  PERFORM 1 FROM staff WHERE id = p_staff_id AND business_id = w.business_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;

  v_service := COALESCE(p_service_id, w.service_id);
  PERFORM 1 FROM services WHERE id = v_service AND business_id = w.business_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_required'; END IF;

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
