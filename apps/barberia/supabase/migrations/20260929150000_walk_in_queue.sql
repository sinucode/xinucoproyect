-- ============================================================
-- 20260929150000_walk_in_queue.sql — Fila de espera conectada a citas y cobro
--
-- "Atender" un turno crea (atómicamente) el cliente y una cita in_progress del
-- barbero desde AHORA; así el turno aparece en la Agenda, bloquea al barbero y
-- se cobra con el mismo checkout (venta, inventario, comisión). Al cerrarse la
-- cita (completada / cancelada / no asistió) el turno se cierra solo (trigger).
--
-- Funciones SECURITY INVOKER: corren con el usuario del negocio → aplica RLS.
-- Convención horaria: start_time de citas = hora LOCAL del negocio como UTC.
-- walk_ins.arrived_at / served_at son instantes reales (NOW()).
-- ============================================================

ALTER TABLE public.walk_ins
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_id    UUID REFERENCES public.customers(id)    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_walk_ins_appointment ON public.walk_ins (appointment_id);

-- ── Atender un turno ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_walk_in(
  p_walk_in_id UUID,
  p_staff_id   UUID,
  p_service_id UUID DEFAULT NULL   -- si el turno no tenía servicio
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  w          RECORD;
  v_service  UUID;
  v_customer UUID;
  v_phone    TEXT;
  v_appt     UUID;
  v_start    TIMESTAMPTZ := date_trunc('minute', (NOW() AT TIME ZONE 'America/Bogota')) AT TIME ZONE 'UTC';
BEGIN
  SELECT * INTO w FROM walk_ins WHERE id = p_walk_in_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'walk_in_not_found'; END IF;
  IF w.status <> 'waiting' THEN RAISE EXCEPTION 'walk_in_not_waiting'; END IF;

  PERFORM 1 FROM staff WHERE id = p_staff_id AND business_id = w.business_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;

  v_service := COALESCE(p_service_id, w.service_id);
  PERFORM 1 FROM services WHERE id = v_service AND business_id = w.business_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_required'; END IF;

  -- Cliente: por teléfono si lo dio; si no, uno propio del turno (phone es obligatorio)
  v_phone := COALESCE(NULLIF(TRIM(w.customer_phone), ''), 'fila-' || LEFT(w.id::TEXT, 8));
  SELECT id INTO v_customer FROM customers
   WHERE business_id = w.business_id AND phone = v_phone LIMIT 1;
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

  RETURN jsonb_build_object('appointment_id', v_appt, 'customer_id', v_customer);
END;
$$;
REVOKE ALL ON FUNCTION public.start_walk_in(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_walk_in(UUID, UUID, UUID) TO authenticated;

-- ── Estado de cada barbero AHORA ─────────────────────────────────────────────
-- status: free | busy (cita en curso/programada ahora) | break | time_off | off (fuera de horario)
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
           ap.status IN ('in_progress', 'ready_to_pay')
           OR (ap.status = 'scheduled'
               AND ap.start_time <= n.tz_as_utc
               AND ap.start_time + make_interval(mins => COALESCE(sv.duration_minutes, 30) + COALESCE(sv.buffer_time_minutes, 0)) > n.tz_as_utc)
         )
         AND ap.start_time >= n.tz_as_utc - INTERVAL '12 hours'
       ORDER BY ap.start_time DESC
       LIMIT 1
    ) a ON TRUE
    WHERE s.business_id = p_business_id AND s.is_active
  ) x
$$;
REVOKE ALL ON FUNCTION public.get_staff_status_now(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_status_now(UUID) TO authenticated;

-- ── Cerrar el turno cuando se cierra su cita ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._sync_walk_in_from_appointment()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('completed', 'cancelled', 'no_show') THEN
    UPDATE walk_ins
       SET status    = CASE WHEN NEW.status = 'completed' THEN 'completed' ELSE 'cancelled' END,
           served_at = CASE WHEN NEW.status = 'completed' THEN NOW() ELSE served_at END
     WHERE appointment_id = NEW.id
       AND status IN ('waiting', 'in_progress');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_walk_in_from_appointment ON public.appointments;
CREATE TRIGGER trg_sync_walk_in_from_appointment
  AFTER UPDATE OF status ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public._sync_walk_in_from_appointment();
