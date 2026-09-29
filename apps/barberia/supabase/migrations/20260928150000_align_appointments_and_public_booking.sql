-- ============================================================
-- 20260928150000_align_appointments_and_public_booking.sql
--
-- 1. appointments en prod venía de un esquema viejo (barber_id → profiles,
--    time_range obligatorio, sin service_id/start_time). El código, bookings.ts,
--    get_available_slots_v2 y calculate_commission usan staff_id/service_id/
--    start_time (00001_initial_schema.sql nunca aplicó por CREATE IF NOT EXISTS).
--    barber_id y time_range quedan opcionales (legacy).
--
-- 2. staff.user_id (el código enlaza auth.users → staff por user_id; prod tenía
--    profile_id). Se copia desde profile_id.
--
-- 3. create_public_booking: la reserva pública es anónima y RLS solo deja
--    escribir al tenant. En vez de abrir customers/appointments a anon (PII),
--    una RPC SECURITY DEFINER valida negocio/servicio/barbero/horario/solapes,
--    asigna barbero si es "cualquiera" y crea cliente + cita.
--
-- Convención horaria (igual que BookingWizard y get_available_slots_v2):
-- start_time guarda la hora LOCAL del negocio como si fuera UTC ("10:00Z" = 10:00
-- en la barbería). Por eso todo se compara AT TIME ZONE 'UTC'.
-- ============================================================

-- ── 1. appointments ──────────────────────────────────────────────────────────
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS staff_id   UUID REFERENCES public.staff(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES public.services(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes      TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.appointments
  ALTER COLUMN barber_id  DROP NOT NULL,
  ALTER COLUMN time_range DROP NOT NULL,
  ALTER COLUMN status     SET DEFAULT 'scheduled';

-- NOT VALID: la única fila legacy tiene status 'pending'.
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_status_check CHECK (status IN (
    'payment_pending', 'scheduled', 'in_progress', 'ready_to_pay',
    'completed', 'cancelled', 'no_show'
  )) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_appointments_business_start ON public.appointments (business_id, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_staff_start    ON public.appointments (staff_id, start_time);

-- Guarda mínima contra doble reserva exacta; los solapes los valida la RPC.
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_staff_start
  ON public.appointments (staff_id, start_time)
  WHERE staff_id IS NOT NULL AND start_time IS NOT NULL
    AND status NOT IN ('cancelled', 'no_show');

-- ── 2. staff.user_id ─────────────────────────────────────────────────────────
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.staff s
   SET user_id = s.profile_id
 WHERE s.user_id IS NULL
   AND s.profile_id IN (SELECT id FROM auth.users);

-- ── 3. create_public_booking ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_business_id UUID,
  p_service_id  UUID,
  p_staff_id    UUID,          -- NULL = cualquier barbero disponible
  p_start_time  TIMESTAMPTZ,
  p_full_name   TEXT,
  p_phone       TEXT,
  p_email       TEXT DEFAULT NULL,
  p_status      TEXT DEFAULT 'scheduled'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration INTEGER;
  v_end      TIMESTAMPTZ;
  v_staff    UUID;
  v_customer UUID;
  v_appt     UUID;
  v_phone    TEXT := NULLIF(TRIM(p_phone), '');
  v_name     TEXT := NULLIF(TRIM(p_full_name), '');
BEGIN
  IF p_status NOT IN ('scheduled', 'payment_pending') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  IF v_phone IS NULL OR v_name IS NULL OR p_start_time IS NULL THEN
    RAISE EXCEPTION 'missing_fields';
  END IF;

  PERFORM 1 FROM businesses WHERE id = p_business_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'business_not_found'; END IF;

  SELECT duration_minutes + COALESCE(buffer_time_minutes, 0)
    INTO v_duration
    FROM services
   WHERE id = p_service_id AND business_id = p_business_id AND is_active;
  IF v_duration IS NULL THEN RAISE EXCEPTION 'service_not_found'; END IF;

  v_end := p_start_time + make_interval(mins => v_duration);

  -- Barbero: el pedido (o el primero libre) que trabaje ese día/horario,
  -- ofrezca el servicio (si tiene servicios asignados) y no tenga solapes.
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
   ORDER BY s.created_at
   LIMIT 1
   FOR UPDATE OF s;   -- serializa reservas concurrentes del mismo barbero

  IF v_staff IS NULL THEN RAISE EXCEPTION 'slot_unavailable'; END IF;

  SELECT id INTO v_customer
    FROM customers
   WHERE business_id = p_business_id AND phone = v_phone
   LIMIT 1;

  IF v_customer IS NULL THEN
    INSERT INTO customers (business_id, full_name, phone, email)
    VALUES (p_business_id, v_name, v_phone, NULLIF(TRIM(p_email), ''))
    RETURNING id INTO v_customer;
  ELSIF NULLIF(TRIM(p_email), '') IS NOT NULL THEN
    -- Nunca sobrescribir datos existentes desde una reserva anónima; solo completar.
    UPDATE customers SET email = TRIM(p_email) WHERE id = v_customer AND email IS NULL;
  END IF;

  INSERT INTO appointments (business_id, customer_id, service_id, staff_id, start_time, status)
  VALUES (p_business_id, v_customer, p_service_id, v_staff, p_start_time, p_status)
  RETURNING id INTO v_appt;

  RETURN jsonb_build_object('appointment_id', v_appt, 'customer_id', v_customer, 'staff_id', v_staff);
END;
$$;

REVOKE ALL ON FUNCTION public.create_public_booking(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_public_booking(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT)
  TO anon, authenticated, service_role;
