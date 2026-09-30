-- ============================================================
-- 20260930110000_workstations_capacity.sql — Estaciones compartidas con capacidad real
--
-- Antes: una cita de un servicio con estaciones marcaba TODAS las estaciones de
-- ese servicio como ocupadas (2 sillas de niños → cabía 1 cita) y solo lo
-- revisaba el cálculo de horarios.
-- Ahora: _station_ok = (citas que se cruzan y usan alguna de esas estaciones)
-- < (estaciones activas del servicio). Se valida en:
--   - get_available_slots_v2 (horarios de la reserva)
--   - create_public_booking (confirmación, con candado contra carreras)
--   - start_walk_in (Fila de espera → error 'station_busy')
-- Y las estaciones solo las modifica el admin (RLS).
-- Convención horaria: start_time = hora local guardada como UTC.
-- ============================================================

CREATE OR REPLACE FUNCTION public._station_ok(
  p_business_id UUID,
  p_service_id  UUID,
  p_start       TIMESTAMPTZ,
  p_end         TIMESTAMPTZ,
  p_exclude     UUID DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mine AS (
    SELECT sw.workstation_id
      FROM service_workstations sw
      JOIN workstations w ON w.id = sw.workstation_id AND w.is_active
     WHERE sw.service_id = p_service_id AND sw.business_id = p_business_id
  )
  SELECT CASE
    WHEN (SELECT count(*) FROM mine) = 0 THEN TRUE
    ELSE (
      SELECT count(*)
        FROM appointments a
        JOIN services sv ON sv.id = a.service_id
       WHERE a.business_id = p_business_id
         AND a.status IN ('payment_pending', 'scheduled', 'in_progress', 'ready_to_pay')
         AND (p_exclude IS NULL OR a.id <> p_exclude)
         AND a.start_time < p_end
         AND a.start_time + make_interval(mins => sv.duration_minutes + COALESCE(sv.buffer_time_minutes, 0)) > p_start
         AND EXISTS (SELECT 1 FROM service_workstations sw2
                      WHERE sw2.service_id = a.service_id
                        AND sw2.workstation_id IN (SELECT workstation_id FROM mine))
    ) < (SELECT count(*) FROM mine)
  END
$$;
REVOKE ALL ON FUNCTION public._station_ok(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_available_slots_v2(
  p_business_id      UUID,
  p_staff_id         UUID,     -- NULL = cualquier barbero disponible
  p_service_id       UUID,     -- NULL = sin restricción de workstation; calcula duración desde services
  p_date             DATE,
  p_duration_minutes INTEGER   -- duración+buffer pre-calculada; se usa si p_service_id es NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_interval_minutes   INTEGER := 30;   -- granularidad de slots (default)
  v_duration_minutes   INTEGER;         -- duración real del servicio
  v_buffer_minutes     INTEGER := 0;    -- buffer post-servicio
  v_total_duration     INTEGER;         -- duración + buffer = bloque total reservado
  v_day_of_week        INTEGER;         -- 0=Domingo … 6=Sábado
  v_open_time          TIME;
  v_close_time         TIME;
  v_current_slot       TIME;
  v_slot_end           TIME;
  v_has_workstations   BOOLEAN := FALSE;
  v_free_workstation   BOOLEAN;
  v_slots              JSONB := '[]'::JSONB;
  v_slot_text          TEXT;
BEGIN
  -- ── PASO 1: Leer configuración operativa del negocio ──────────────────────
  SELECT COALESCE(appointment_interval_minutes, 30)
    INTO v_interval_minutes
    FROM public.businesses
   WHERE id = p_business_id;

  -- ── PASO 2: Calcular duración total (servicio + buffer) ───────────────────
  IF p_service_id IS NOT NULL THEN
    SELECT
      COALESCE(duration_minutes, p_duration_minutes),
      COALESCE(buffer_time_minutes, 0)
      INTO v_duration_minutes, v_buffer_minutes
      FROM public.services
     WHERE id = p_service_id;
  ELSE
    -- Fallback: usar la duración pre-calculada pasada como parámetro
    v_duration_minutes := COALESCE(p_duration_minutes, 30);
    v_buffer_minutes   := 0;
  END IF;

  v_total_duration := COALESCE(v_duration_minutes, 30) + v_buffer_minutes;

  -- ── PASO 3: Verificar si el servicio requiere workstations ────────────────
  IF p_service_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.service_workstations sw
        JOIN public.workstations w ON w.id = sw.workstation_id
       WHERE sw.service_id    = p_service_id
         AND sw.business_id   = p_business_id
         AND w.is_active      = TRUE
    ) INTO v_has_workstations;
  END IF;

  -- ── PASO 3b: ¿El barbero elegido hace este servicio? ──────────────────────
  -- (sin filas en staff_services = hace todos; con filas = solo esos)
  IF p_staff_id IS NOT NULL AND p_service_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.staff_services x WHERE x.staff_id = p_staff_id)
     AND NOT EXISTS (SELECT 1 FROM public.staff_services x WHERE x.staff_id = p_staff_id AND x.service_id = p_service_id)
  THEN
    RETURN '[]'::JSONB;
  END IF;

  -- ── PASO 4: Determinar día de la semana y horario del negocio ─────────────
  -- EXTRACT DOW: 0=Domingo … 6=Sábado
  v_day_of_week := EXTRACT(DOW FROM p_date);

  -- Obtener horario del barbero para ese día
  -- Si p_staff_id es NULL, tomamos el horario más amplio disponible en el negocio
  IF p_staff_id IS NOT NULL THEN
    SELECT start_time, end_time
      INTO v_open_time, v_close_time
      FROM public.staff_schedules
     WHERE staff_id    = p_staff_id
       AND business_id = p_business_id
       AND day_of_week = v_day_of_week
     LIMIT 1;
  ELSE
    -- Sin barbero específico: usar el rango más amplio entre todos los barberos activos
    SELECT MIN(start_time), MAX(end_time)
      INTO v_open_time, v_close_time
      FROM public.staff_schedules ss
      JOIN public.staff s ON s.id = ss.staff_id
     WHERE ss.business_id = p_business_id
       AND ss.day_of_week = v_day_of_week
       AND s.is_active    = TRUE;
  END IF;

  -- Si no hay horario configurado para ese día → devolver array vacío
  IF v_open_time IS NULL OR v_close_time IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  -- ── PASO 5: Generar y filtrar slots candidatos ─────────────────────────────
  v_current_slot := v_open_time;

  WHILE v_current_slot + (v_total_duration || ' minutes')::INTERVAL <= v_close_time LOOP

    v_slot_end := v_current_slot + (v_total_duration || ' minutes')::INTERVAL;

    -- ── 5a. Verificar colisión de staff ─────────────────────────────────────
    -- Un slot es inválido si el barbero ya tiene una cita que se solapa
    DECLARE
      v_staff_busy BOOLEAN := FALSE;
    BEGIN
      IF p_staff_id IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1
            FROM public.appointments a
           WHERE a.staff_id    = p_staff_id
             AND a.business_id = p_business_id
             AND DATE(a.start_time) = p_date
             AND a.status NOT IN ('cancelled', 'no_show')
             AND (
               -- La cita existente se solapa con el slot candidato
               (a.start_time::TIME < v_slot_end AND
                (a.start_time + (
                  COALESCE((SELECT duration_minutes + buffer_time_minutes FROM public.services WHERE id = a.service_id), 30) || ' minutes'
                )::INTERVAL)::TIME > v_current_slot)
             )
        ) INTO v_staff_busy;

        -- Almuerzo (recurrente) o permiso del barbero en ese rango
        IF NOT v_staff_busy THEN
          v_staff_busy := public._staff_blocked(
            p_staff_id,
            (p_date + v_current_slot) AT TIME ZONE 'UTC',
            (p_date + v_slot_end)     AT TIME ZONE 'UTC'
          );
        END IF;
      ELSE
        -- "Cualquiera": el slot solo es válido si AL MENOS un barbero activo
        -- trabaja en ese rango, ofrece el servicio y no tiene solapes.
        SELECT NOT EXISTS (
          SELECT 1
            FROM public.staff s
            JOIN public.staff_schedules ss
              ON ss.staff_id = s.id AND ss.day_of_week = v_day_of_week
           WHERE s.business_id = p_business_id
             AND s.is_active   = TRUE
             AND ss.start_time <= v_current_slot
             AND ss.end_time   >= v_slot_end
             AND (
               p_service_id IS NULL
               OR NOT EXISTS (SELECT 1 FROM public.staff_services x WHERE x.staff_id = s.id)
               OR EXISTS (SELECT 1 FROM public.staff_services x WHERE x.staff_id = s.id AND x.service_id = p_service_id)
             )
             AND NOT public._staff_blocked(
               s.id,
               (p_date + v_current_slot) AT TIME ZONE 'UTC',
               (p_date + v_slot_end)     AT TIME ZONE 'UTC'
             )
             AND NOT EXISTS (
               SELECT 1
                 FROM public.appointments a
                WHERE a.staff_id    = s.id
                  AND a.business_id = p_business_id
                  AND DATE(a.start_time) = p_date
                  AND a.status NOT IN ('cancelled', 'no_show')
                  AND a.start_time::TIME < v_slot_end
                  AND (a.start_time + (
                        COALESCE((SELECT duration_minutes + buffer_time_minutes FROM public.services WHERE id = a.service_id), 30) || ' minutes'
                      )::INTERVAL)::TIME > v_current_slot
             )
        ) INTO v_staff_busy;
      END IF;

      -- Si el barbero está ocupado, saltar este slot
      IF v_staff_busy THEN
        v_current_slot := v_current_slot + (v_interval_minutes || ' minutes')::INTERVAL;
        CONTINUE;
      END IF;
    END;

    -- ── 5b. Estaciones compartidas: capacidad real (citas que se cruzan < estaciones) ──
    IF v_has_workstations AND NOT public._station_ok(
         p_business_id, p_service_id,
         (p_date + v_current_slot) AT TIME ZONE 'UTC',
         (p_date + v_slot_end)     AT TIME ZONE 'UTC') THEN
      v_current_slot := v_current_slot + (v_interval_minutes || ' minutes')::INTERVAL;
      CONTINUE;
    END IF;

    -- ── 5c. Slot válido — añadir al resultado ────────────────────────────────
    v_slot_text := TO_CHAR(v_current_slot, 'HH24:MI');
    v_slots := v_slots || jsonb_build_array(v_slot_text);

    v_current_slot := v_current_slot + (v_interval_minutes || ' minutes')::INTERVAL;
  END LOOP;

  RETURN v_slots;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_business_id UUID,
  p_service_id  UUID,
  p_staff_id    UUID,          -- NULL = cualquier barbero disponible
  p_start_time  TIMESTAMPTZ,
  p_full_name   TEXT,
  p_phone       TEXT,
  p_email       TEXT  DEFAULT NULL,
  p_status      TEXT  DEFAULT 'scheduled',
  p_products    JSONB DEFAULT '[]'::JSONB   -- [{ "item_id": uuid, "quantity": int }]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration   INTEGER;
  v_end        TIMESTAMPTZ;
  v_staff      UUID;
  v_customer   UUID;
  v_appt       UUID;
  v_phone      TEXT := NULLIF(TRIM(p_phone), '');
  v_name       TEXT := NULLIF(TRIM(p_full_name), '');
  v_products   JSONB := COALESCE(p_products, '[]'::JSONB);
  v_enabled    BOOLEAN;
  v_max_units  INTEGER;
  v_max_open   INTEGER;
  v_total_qty  INTEGER := 0;
  v_open_count INTEGER;
  r            RECORD;
  v_item       RECORD;
BEGIN
  IF p_status NOT IN ('scheduled', 'payment_pending') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  IF v_phone IS NULL OR v_name IS NULL OR p_start_time IS NULL THEN
    RAISE EXCEPTION 'missing_fields';
  END IF;
  IF jsonb_typeof(v_products) <> 'array' THEN
    RAISE EXCEPTION 'invalid_products';
  END IF;

  SELECT booking_products_enabled, booking_max_product_units, booking_max_open_with_products_per_phone
    INTO v_enabled, v_max_units, v_max_open
    FROM businesses WHERE id = p_business_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'business_not_found'; END IF;

  SELECT duration_minutes + COALESCE(buffer_time_minutes, 0)
    INTO v_duration
    FROM services
   WHERE id = p_service_id AND business_id = p_business_id AND is_active;
  IF v_duration IS NULL THEN RAISE EXCEPTION 'service_not_found'; END IF;

  v_end := p_start_time + make_interval(mins => v_duration);

  -- ── Productos: validar reglas del negocio antes de tocar nada ──────────────
  IF jsonb_array_length(v_products) > 0 THEN
    IF NOT v_enabled OR v_max_units = 0 THEN
      RAISE EXCEPTION 'products_disabled';
    END IF;

    SELECT COALESCE(SUM((e->>'quantity')::INTEGER), 0) INTO v_total_qty
      FROM jsonb_array_elements(v_products) e;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_products) e
                WHERE (e->>'quantity')::INTEGER IS NULL OR (e->>'quantity')::INTEGER <= 0) THEN
      RAISE EXCEPTION 'invalid_products';
    END IF;
    IF v_total_qty > v_max_units THEN
      RAISE EXCEPTION 'products_limit_exceeded';
    END IF;

    IF v_max_open > 0 THEN
      SELECT COUNT(DISTINCT a.id) INTO v_open_count
        FROM appointments a
        JOIN customers c ON c.id = a.customer_id
       WHERE a.business_id = p_business_id
         AND c.phone = v_phone
         AND a.status IN ('payment_pending', 'scheduled', 'in_progress', 'ready_to_pay')
         AND a.start_time >= public._business_today_start()
         AND EXISTS (SELECT 1 FROM appointment_products ap WHERE ap.appointment_id = a.id);
      IF v_open_count >= v_max_open THEN
        RAISE EXCEPTION 'products_open_limit';
      END IF;
    END IF;
  END IF;

  -- ── Barbero libre (igual que antes) ────────────────────────────────────────
  SELECT s.id INTO v_staff
    FROM staff s
   WHERE s.business_id = p_business_id
     AND s.is_active
     AND (p_staff_id IS NULL OR s.id = p_staff_id)
     AND (
       NOT EXISTS (SELECT 1 FROM staff_services x WHERE x.staff_id = s.id)
       OR EXISTS (SELECT 1 FROM staff_services x WHERE x.staff_id = s.id AND x.service_id = p_service_id)
     )
     AND EXISTS (
       SELECT 1 FROM staff_schedules ss
        WHERE ss.staff_id    = s.id
          AND ss.day_of_week = EXTRACT(DOW FROM p_start_time AT TIME ZONE 'UTC')
          AND ss.start_time <= (p_start_time AT TIME ZONE 'UTC')::TIME
          AND ss.end_time   >= (v_end        AT TIME ZONE 'UTC')::TIME
     )
     AND NOT EXISTS (
       SELECT 1
         FROM appointments a
         JOIN services sv ON sv.id = a.service_id
        WHERE a.staff_id = s.id
          AND a.status NOT IN ('cancelled', 'no_show')
          AND a.start_time < v_end
          AND a.start_time + make_interval(mins => sv.duration_minutes + COALESCE(sv.buffer_time_minutes, 0)) > p_start_time
     )
     AND NOT public._staff_blocked(s.id, p_start_time, v_end)   -- almuerzo / permiso
   ORDER BY s.created_at
   LIMIT 1
   FOR UPDATE OF s;

  IF v_staff IS NULL THEN RAISE EXCEPTION 'slot_unavailable'; END IF;

  -- ── Estación compartida (lavacabezas, silla de niños…) ─────────────────────
  IF EXISTS (SELECT 1 FROM service_workstations WHERE service_id = p_service_id AND business_id = p_business_id) THEN
    PERFORM pg_advisory_xact_lock(hashtext('stations:' || p_business_id::TEXT));
    IF NOT public._station_ok(p_business_id, p_service_id, p_start_time, v_end) THEN
      RAISE EXCEPTION 'slot_unavailable';
    END IF;
  END IF;

  -- ── Cliente ────────────────────────────────────────────────────────────────
  SELECT id INTO v_customer
    FROM customers
   WHERE business_id = p_business_id AND phone = v_phone
   LIMIT 1;

  IF v_customer IS NULL THEN
    INSERT INTO customers (business_id, full_name, phone, email)
    VALUES (p_business_id, v_name, v_phone, NULLIF(TRIM(p_email), ''))
    RETURNING id INTO v_customer;
  ELSIF NULLIF(TRIM(p_email), '') IS NOT NULL THEN
    UPDATE customers SET email = TRIM(p_email) WHERE id = v_customer AND email IS NULL;
  END IF;

  INSERT INTO appointments (business_id, customer_id, service_id, staff_id, start_time, status)
  VALUES (p_business_id, v_customer, p_service_id, v_staff, p_start_time, p_status)
  RETURNING id INTO v_appt;

  -- ── Apartar productos (bloqueo por ítem, en orden estable) ─────────────────
  FOR r IN
    SELECT (e->>'item_id')::UUID AS item_id, SUM((e->>'quantity')::INTEGER)::INTEGER AS qty
      FROM jsonb_array_elements(v_products) e
     GROUP BY 1
     ORDER BY 1
  LOOP
    SELECT id, current_stock, unit_price INTO v_item
      FROM inventory_items
     WHERE id = r.item_id
       AND business_id = p_business_id
       AND is_active AND bookable_online
       AND COALESCE(unit_price, 0) > 0
     FOR UPDATE;

    IF NOT FOUND OR v_item.current_stock - public._inventory_reserved_qty(r.item_id) < r.qty THEN
      RAISE EXCEPTION 'product_unavailable';   -- revierte toda la reserva
    END IF;

    INSERT INTO appointment_products (business_id, appointment_id, item_id, quantity, unit_price)
    VALUES (p_business_id, v_appt, r.item_id, r.qty, v_item.unit_price);
  END LOOP;

  RETURN jsonb_build_object('appointment_id', v_appt, 'customer_id', v_customer, 'staff_id', v_staff);
END;
$$;

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

-- ── Estaciones: solo el admin las modifica ───────────────────────────────────
DO $$
DECLARE
  t TEXT;
  p RECORD;
  tenant TEXT := $q$(business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id')
                   OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE))$q$;
BEGIN
  FOREACH t IN ARRAY ARRAY['workstations'] LOOP
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
    EXECUTE format('DROP POLICY IF EXISTS xin_admin_insert ON public.%I', t);
    EXECUTE format('CREATE POLICY xin_admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public._is_business_admin(business_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS xin_admin_update ON public.%I', t);
    EXECUTE format('CREATE POLICY xin_admin_update ON public.%I FOR UPDATE TO authenticated USING (public._is_business_admin(business_id)) WITH CHECK (public._is_business_admin(business_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS xin_admin_delete ON public.%I', t);
    EXECUTE format('CREATE POLICY xin_admin_delete ON public.%I FOR DELETE TO authenticated USING (public._is_business_admin(business_id))', t);
  END LOOP;
END $$;
