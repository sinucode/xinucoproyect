-- ============================================================
-- 20261002100000_staff_quick_booking.sql — Agendar una cita desde adentro (equipo)
--
-- Hasta ahora "Nueva cita" y "Agendar aquí" abrían la reserva PÚBLICA. Esta función
-- deja que el equipo agende desde la Agenda / Inicio sin salir del panel:
--   - Admin: agenda para cualquier profesional activo del negocio.
--   - Barbero / manicurista: solo para sí mismo (_is_my_staff).
--
-- Las reglas de disponibilidad son EXACTAMENTE las de la reserva en línea: se llama a
-- get_available_slots_v2 (horario del profesional, citas que se cruzan, almuerzo /
-- pausas, permisos y cierres, estaciones compartidas) y la hora pedida debe ser uno de
-- los horarios que devuelve. Si no lo es, se clasifica el motivo para dar un error claro.
--
-- Serialización: se bloquea la fila del profesional (FOR UPDATE, igual que
-- create_public_booking) y, si el servicio usa estaciones, el candado de estaciones del
-- negocio, ANTES de revisar disponibilidad. Así dos reservas simultáneas no se pisan.
--
-- Devuelve JSONB: { appointment_id } o { error: '<código>' } para fallos esperados:
--   invalid_start | notes_too_long | in_the_past | staff_not_found | customer_not_found
--   service_not_found | service_not_offered | outside_schedule | slot_taken | slot_unavailable
-- Un usuario sin permiso (otro negocio, o barbero sobre otro profesional) recibe
-- RAISE EXCEPTION 'forbidden' (igual que el resto de funciones internas).
--
-- Convención horaria: start_time = hora LOCAL del negocio guardada como UTC
-- (el 10:00 de la barbería se guarda como ...T10:00:00Z), igual que create_public_booking.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_staff_appointment(
  p_business_id UUID,
  p_staff_id    UUID,
  p_customer_id UUID,
  p_service_id  UUID,
  p_start       TIMESTAMPTZ,          -- hora local como UTC: `${fecha}T${HH:MM}:00Z`
  p_notes       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notes     TEXT := NULLIF(TRIM(p_notes), '');
  v_duration  INTEGER;                 -- duración + buffer del servicio
  v_end       TIMESTAMPTZ;
  v_date      DATE;
  v_hhmm      TEXT;
  v_now_local TIMESTAMPTZ := (NOW() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'UTC';
  v_slots     JSONB;
  v_appt      UUID;
  v_sched     RECORD;
BEGIN
  -- ── Permisos: negocio del usuario + (admin del negocio O el propio profesional) ──
  PERFORM public._assert_business_access(p_business_id);
  IF NOT (public._is_business_admin(p_business_id) OR public._is_my_staff(p_staff_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- ── Datos básicos ──────────────────────────────────────────────────────────────
  IF p_start IS NULL THEN RETURN jsonb_build_object('error', 'invalid_start'); END IF;
  IF v_notes IS NOT NULL AND char_length(v_notes) > 500 THEN
    RETURN jsonb_build_object('error', 'notes_too_long');
  END IF;
  -- No se agenda en el pasado (se compara al minuto, en hora local del negocio)
  IF p_start < date_trunc('minute', v_now_local) THEN
    RETURN jsonb_build_object('error', 'in_the_past');
  END IF;

  v_date := (p_start AT TIME ZONE 'UTC')::DATE;
  v_hhmm := to_char(p_start AT TIME ZONE 'UTC', 'HH24:MI');

  -- ── Profesional del negocio y activo (se bloquea la fila: serializa reservas) ──
  PERFORM 1 FROM staff
   WHERE id = p_staff_id AND business_id = p_business_id AND is_active
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'staff_not_found'); END IF;

  -- ── Cliente del negocio ────────────────────────────────────────────────────────
  PERFORM 1 FROM customers WHERE id = p_customer_id AND business_id = p_business_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'customer_not_found'); END IF;

  -- ── Servicio activo del negocio ────────────────────────────────────────────────
  SELECT COALESCE(duration_minutes, 30) + COALESCE(buffer_time_minutes, 0)
    INTO v_duration
    FROM services
   WHERE id = p_service_id AND business_id = p_business_id AND is_active;
  IF v_duration IS NULL THEN RETURN jsonb_build_object('error', 'service_not_found'); END IF;

  v_end := p_start + make_interval(mins => v_duration);

  -- ── ¿El profesional hace este servicio? (sin filas en staff_services = hace todos) ──
  IF EXISTS (SELECT 1 FROM staff_services x WHERE x.staff_id = p_staff_id)
     AND NOT EXISTS (SELECT 1 FROM staff_services x
                      WHERE x.staff_id = p_staff_id AND x.service_id = p_service_id) THEN
    RETURN jsonb_build_object('error', 'service_not_offered');
  END IF;

  -- ── Estaciones compartidas: candado del negocio antes de mirar la capacidad ────
  IF EXISTS (SELECT 1 FROM service_workstations
              WHERE service_id = p_service_id AND business_id = p_business_id) THEN
    PERFORM pg_advisory_xact_lock(hashtext('stations:' || p_business_id::TEXT));
  END IF;

  -- ── Disponibilidad: la hora pedida debe ser uno de los horarios de la reserva en línea ──
  v_slots := public.get_available_slots_v2(p_business_id, p_staff_id, p_service_id, v_date, NULL);

  IF NOT jsonb_exists(COALESCE(v_slots, '[]'::JSONB), v_hhmm) THEN
    -- Clasificar el motivo para dar un mensaje útil
    SELECT ss.start_time, ss.end_time INTO v_sched
      FROM staff_schedules ss
     WHERE ss.staff_id = p_staff_id AND ss.business_id = p_business_id
       AND ss.day_of_week = EXTRACT(DOW FROM v_date)
     LIMIT 1;

    IF NOT FOUND
       OR (p_start AT TIME ZONE 'UTC')::TIME < v_sched.start_time
       OR (v_end   AT TIME ZONE 'UTC')::TIME > v_sched.end_time
       OR (v_end   AT TIME ZONE 'UTC')::DATE <> v_date THEN
      RETURN jsonb_build_object('error', 'outside_schedule');
    END IF;

    IF EXISTS (
      SELECT 1
        FROM appointments a
        JOIN services sv ON sv.id = a.service_id
       WHERE a.staff_id = p_staff_id
         AND a.status NOT IN ('cancelled', 'no_show')
         AND a.start_time < v_end
         AND a.start_time + make_interval(mins => sv.duration_minutes + COALESCE(sv.buffer_time_minutes, 0)) > p_start
    ) THEN
      RETURN jsonb_build_object('error', 'slot_taken');
    END IF;

    -- Almuerzo / pausa, permiso, cierre, estación ocupada u hora fuera de la cuadrícula
    RETURN jsonb_build_object('error', 'slot_unavailable');
  END IF;

  -- ── Crear la cita (hora local como UTC, igual que create_public_booking) ────────
  BEGIN
    INSERT INTO appointments (business_id, customer_id, service_id, staff_id, start_time, status, notes)
    VALUES (p_business_id, p_customer_id, p_service_id, p_staff_id, p_start, 'scheduled', v_notes)
    RETURNING id INTO v_appt;
  EXCEPTION WHEN unique_violation THEN
    -- uq_appointments_staff_start: doble reserva exacta
    RETURN jsonb_build_object('error', 'slot_taken');
  END;

  RETURN jsonb_build_object('appointment_id', v_appt);
END;
$$;

REVOKE ALL ON FUNCTION public.create_staff_appointment(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_staff_appointment(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TEXT) TO authenticated;

COMMENT ON FUNCTION public.create_staff_appointment IS
  'Agenda una cita desde el panel: admin para cualquier profesional, barbero solo para sí mismo. Valida con get_available_slots_v2 (mismas reglas que la reserva en línea). Devuelve {appointment_id} o {error}.';
