-- ============================================================
-- 20260929140000_staff_breaks_time_off.sql — Almuerzos y permisos del staff
--
-- staff_breaks:   pausas RECURRENTES por día de la semana (ej. almuerzo L–S 12–13)
-- staff_time_off: bloqueos PUNTUALES (permiso, vacaciones, incapacidad…)
-- Ambos bloquean la disponibilidad: get_available_slots_v2 (barbero específico
-- y "cualquiera") y create_public_booking (validación en la BD).
-- Convención horaria del sistema: starts_at/ends_at y start_time de citas
-- guardan la hora LOCAL del negocio como UTC.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_breaks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  staff_id    UUID        NOT NULL REFERENCES public.staff(id)      ON DELETE CASCADE,
  day_of_week INTEGER     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time  TIME        NOT NULL,
  end_time    TIME        NOT NULL,
  label       TEXT        NOT NULL DEFAULT 'Almuerzo' CHECK (char_length(label) <= 60),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_staff_breaks_staff_dow ON public.staff_breaks (staff_id, day_of_week);

CREATE TABLE IF NOT EXISTS public.staff_time_off (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  staff_id    UUID        NOT NULL REFERENCES public.staff(id)      ON DELETE CASCADE,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  kind        TEXT        NOT NULL DEFAULT 'permission'
              CHECK (kind IN ('permission', 'vacation', 'sick', 'other')),
  reason      TEXT        CHECK (reason IS NULL OR char_length(reason) <= 200),
  created_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_staff_time_off_staff_range ON public.staff_time_off (staff_id, starts_at, ends_at);

ALTER TABLE public.staff_breaks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_time_off ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant can manage staff_breaks" ON public.staff_breaks;
CREATE POLICY "tenant can manage staff_breaks" ON public.staff_breaks
  FOR ALL TO authenticated
  USING      (business_id::text = (auth.jwt() -> 'app_metadata' ->> 'business_id'))
  WITH CHECK (business_id::text = (auth.jwt() -> 'app_metadata' ->> 'business_id'));

DROP POLICY IF EXISTS "tenant can manage staff_time_off" ON public.staff_time_off;
CREATE POLICY "tenant can manage staff_time_off" ON public.staff_time_off
  FOR ALL TO authenticated
  USING      (business_id::text = (auth.jwt() -> 'app_metadata' ->> 'business_id'))
  WITH CHECK (business_id::text = (auth.jwt() -> 'app_metadata' ->> 'business_id'));

-- ¿El barbero tiene almuerzo o permiso que se cruce con [p_start, p_end)?
CREATE OR REPLACE FUNCTION public._staff_blocked(p_staff_id UUID, p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (
           SELECT 1 FROM staff_breaks b
            WHERE b.staff_id    = p_staff_id
              AND b.day_of_week = EXTRACT(DOW FROM p_start AT TIME ZONE 'UTC')
              AND b.start_time  < (p_end   AT TIME ZONE 'UTC')::TIME
              AND b.end_time    > (p_start AT TIME ZONE 'UTC')::TIME
         )
      OR EXISTS (
           SELECT 1 FROM staff_time_off t
            WHERE t.staff_id  = p_staff_id
              AND t.starts_at < p_end
              AND t.ends_at   > p_start
         )
$$;
REVOKE ALL ON FUNCTION public._staff_blocked(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ── get_available_slots_v2 (idéntica + bloqueos) ─────────────────────────────
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

    -- ── 5b. Verificar disponibilidad de workstation ──────────────────────────
    -- Solo si el servicio requiere workstations asignadas
    IF v_has_workstations THEN
      SELECT EXISTS (
        SELECT 1
          FROM public.service_workstations sw
          JOIN public.workstations wk ON wk.id = sw.workstation_id
         WHERE sw.service_id  = p_service_id
           AND sw.business_id = p_business_id
           AND wk.is_active   = TRUE
           -- La workstation NO tiene citas solapadas en este slot
           AND NOT EXISTS (
             SELECT 1
               FROM public.appointments a2
              WHERE a2.business_id   = p_business_id
                AND a2.status NOT IN ('cancelled', 'no_show')
                AND DATE(a2.start_time) = p_date
                -- Verificar que la workstation está ocupada en ese horario
                -- Usamos la tabla service_workstations para saber qué workstation usa cada cita
                AND EXISTS (
                  SELECT 1
                    FROM public.service_workstations sw2
                   WHERE sw2.workstation_id = sw.workstation_id
                     AND sw2.service_id     = a2.service_id
                )
                AND (
                  a2.start_time::TIME < v_slot_end AND
                  (a2.start_time + (
                    COALESCE((SELECT duration_minutes + buffer_time_minutes FROM public.services WHERE id = a2.service_id), 30) || ' minutes'
                  )::INTERVAL)::TIME > v_current_slot
                )
           )
         LIMIT 1
      ) INTO v_free_workstation;

      -- Si no hay ninguna workstation libre → saltar este slot
      IF NOT v_free_workstation THEN
        v_current_slot := v_current_slot + (v_interval_minutes || ' minutes')::INTERVAL;
        CONTINUE;
      END IF;
    END IF;

    -- ── 5c. Slot válido — añadir al resultado ────────────────────────────────
    v_slot_text := TO_CHAR(v_current_slot, 'HH24:MI');
    v_slots := v_slots || jsonb_build_array(v_slot_text);

    v_current_slot := v_current_slot + (v_interval_minutes || ' minutes')::INTERVAL;
  END LOOP;

  RETURN v_slots;
END;
$$;

-- ── create_public_booking (idéntica + bloqueos) ──────────────────────────────
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
