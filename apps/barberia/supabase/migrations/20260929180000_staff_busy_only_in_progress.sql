-- ============================================================
-- 20260929180000_staff_busy_only_in_progress.sql
-- 'ready_to_pay' = servicio terminado (el cliente está pagando): el barbero ya
-- puede atender al siguiente. Solo 'in_progress' lo mantiene ocupado, y solo
-- cuentan citas de HOY (una cita olvidada de ayer no bloquea a nadie).
-- Afecta: _staff_next_slot (apartar/recomendar) y get_staff_status_now.
-- ============================================================

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
  v_t     := date_trunc('minute', v_t);   -- al minuto actual: libre ya = "disponible ahora"

  LOOP
    v_end := v_t + make_interval(mins => p_duration);
    EXIT WHEN v_end > v_close;

    IF NOT public._staff_blocked(p_staff_id, v_t, v_end)
       AND NOT EXISTS (
         SELECT 1
           FROM appointments a
           LEFT JOIN services sv ON sv.id = a.service_id
          WHERE a.staff_id = p_staff_id
            AND a.status IN ('payment_pending', 'scheduled', 'in_progress')
            AND a.start_time >= (v_day::TIMESTAMP AT TIME ZONE 'UTC')   -- solo citas de hoy
            AND a.start_time < v_end
            -- una cita EN CURSO que se alargó ocupa al menos hasta "ahora"
            -- ('ready_to_pay' = servicio terminado: el barbero ya está libre)
            AND GREATEST(
                  a.start_time + make_interval(mins => COALESCE(sv.duration_minutes, 30) + COALESCE(sv.buffer_time_minutes, 0)),
                  CASE WHEN a.status = 'in_progress' THEN p_from ELSE a.start_time END
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

CREATE OR REPLACE FUNCTION public.get_staff_status_now(p_business_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH now_l AS (
    SELECT (NOW() AT TIME ZONE 'America/Bogota') AS ts
  ), n AS (
    SELECT ts, ts AT TIME ZONE 'UTC' AS tz_as_utc, ts::TIME AS t, EXTRACT(DOW FROM ts)::INT AS dow FROM now_l
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.full_name), '[]'::JSONB)
  FROM (
    SELECT s.id, s.full_name,
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM staff_schedules ss WHERE ss.staff_id = s.id AND ss.day_of_week = n.dow
                          AND ss.start_time <= n.t AND ss.end_time > n.t) THEN 'off'
        WHEN EXISTS (SELECT 1 FROM staff_time_off t WHERE t.staff_id = s.id
                      AND t.starts_at <= n.tz_as_utc AND t.ends_at > n.tz_as_utc) THEN 'time_off'
        WHEN EXISTS (SELECT 1 FROM staff_breaks b WHERE b.staff_id = s.id AND b.day_of_week = n.dow
                      AND b.start_time <= n.t AND b.end_time > n.t) THEN 'break'
        WHEN a.id IS NOT NULL THEN 'busy'
        ELSE 'free'
      END AS status,
      a.busy_until,
      a.customer_name
    FROM staff s
    CROSS JOIN n
    LEFT JOIN LATERAL (
      SELECT ap.id,
             ap.start_time + make_interval(mins => COALESCE(sv.duration_minutes, 30) + COALESCE(sv.buffer_time_minutes, 0)) AS busy_until,
             c.full_name AS customer_name
        FROM appointments ap
        LEFT JOIN services  sv ON sv.id = ap.service_id
        LEFT JOIN customers c  ON c.id  = ap.customer_id
       WHERE ap.staff_id = s.id
         AND (
           ap.status = 'in_progress'
           OR (ap.status = 'scheduled'
               AND ap.start_time <= n.tz_as_utc
               AND ap.start_time + make_interval(mins => COALESCE(sv.duration_minutes, 30) + COALESCE(sv.buffer_time_minutes, 0)) > n.tz_as_utc)
         )
         AND ap.start_time >= date_trunc('day', n.tz_as_utc)   -- solo citas de hoy
       ORDER BY ap.start_time DESC
       LIMIT 1
    ) a ON TRUE
    WHERE s.business_id = p_business_id AND s.is_active
  ) x
$$;
REVOKE ALL ON FUNCTION public.get_staff_status_now(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_status_now(UUID) TO authenticated;
