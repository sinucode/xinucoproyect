-- ============================================================
-- 20260929200000_service_staff_public.sql
-- 1. get_available_slots_v2: un barbero que NO hace el servicio no ofrece
--    horarios (antes mostraba horarios y create_public_booking los rechazaba).
-- 2. get_public_service_staff: mapa servicio → barberos que lo hacen, para que
--    la reserva pública solo muestre barberos válidos (anon; datos no sensibles).
-- Resto de get_available_slots_v2 idéntico a 20260929140000.
-- ============================================================

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

CREATE OR REPLACE FUNCTION public.get_public_service_staff(p_business_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_object_agg(sv.id, COALESCE(x.staff_ids, '[]'::JSONB)), '{}'::JSONB)
    FROM services sv
    JOIN businesses b ON b.id = sv.business_id AND b.is_active
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(s.id ORDER BY s.full_name) AS staff_ids
        FROM staff s
       WHERE s.business_id = sv.business_id AND s.is_active
         AND (
           NOT EXISTS (SELECT 1 FROM staff_services y WHERE y.staff_id = s.id)
           OR EXISTS (SELECT 1 FROM staff_services y WHERE y.staff_id = s.id AND y.service_id = sv.id)
         )
    ) x ON TRUE
   WHERE sv.business_id = p_business_id AND sv.is_active
$$;
REVOKE ALL ON FUNCTION public.get_public_service_staff(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_service_staff(UUID) TO anon, authenticated, service_role;
