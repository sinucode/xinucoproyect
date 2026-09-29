-- ============================================================
-- 20260929120000_public_appointment_cancel.sql — Cancelar cita desde el correo
--
-- Cada cita tiene un public_token (UUID aleatorio, 122 bits) que va en el botón
-- "Cancelar cita" del correo. La página pública solo MUESTRA la cita con el
-- token; cancelar requiere un POST explícito (los escáneres de enlaces de Gmail
-- & co. hacen GET y no deben cancelar nada).
-- Solo se cancela si: status scheduled/payment_pending, la cita no ha empezado
-- (hora local del negocio) y no fue pagada en línea (eso requiere reembolso).
-- Convención horaria: start_time guarda la hora local como UTC.
-- ============================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS public_token UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_public_token ON public.appointments (public_token);

-- Hora actual del negocio en la convención "hora local como UTC".
CREATE OR REPLACE FUNCTION public._business_now()
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (NOW() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'UTC'
$$;
REVOKE ALL ON FUNCTION public._business_now() FROM PUBLIC, anon, authenticated;

-- ── Ver la cita por token (solo datos que el cliente ya conoce) ──────────────
CREATE OR REPLACE FUNCTION public.get_appointment_by_token(p_token UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_paid BOOLEAN;
BEGIN
  SELECT a.id, a.status, a.start_time, b.name AS business_name, b.slug,
         sv.name AS service_name, st.full_name AS staff_name, c.full_name AS customer_name
    INTO r
    FROM appointments a
    JOIN businesses b ON b.id = a.business_id
    LEFT JOIN services  sv ON sv.id = a.service_id
    LEFT JOIN staff     st ON st.id = a.staff_id
    LEFT JOIN customers c  ON c.id  = a.customer_id
   WHERE a.public_token = p_token;

  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT EXISTS (SELECT 1 FROM mp_payments m WHERE m.appointment_id = r.id AND m.mp_status IN ('approved', 'authorized'))
    INTO v_paid;

  RETURN jsonb_build_object(
    'status',        r.status,
    'start_time',    r.start_time,
    'business_name', r.business_name,
    'slug',          r.slug,
    'service_name',  r.service_name,
    'staff_name',    r.staff_name,
    'customer_name', r.customer_name,
    'paid_online',   v_paid,
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', i.name, 'quantity', ap.quantity))
        FROM appointment_products ap JOIN inventory_items i ON i.id = ap.item_id
       WHERE ap.appointment_id = r.id
    ), '[]'::JSONB),
    'can_cancel',    r.status IN ('scheduled', 'payment_pending')
                     AND r.start_time > public._business_now()
                     AND NOT v_paid
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_appointment_by_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_appointment_by_token(UUID) TO anon, authenticated, service_role;

-- ── Cancelar por token ───────────────────────────────────────────────────────
-- Devuelve el id de la cita (para que el servidor envíe el correo y audite).
CREATE OR REPLACE FUNCTION public.cancel_appointment_by_token(p_token UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
BEGIN
  SELECT id, business_id, status, start_time INTO r
    FROM appointments WHERE public_token = p_token
     FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF r.status = 'cancelled' THEN RAISE EXCEPTION 'already_cancelled'; END IF;
  IF r.status NOT IN ('scheduled', 'payment_pending') THEN RAISE EXCEPTION 'not_cancellable'; END IF;
  IF r.start_time <= public._business_now() THEN RAISE EXCEPTION 'already_started'; END IF;
  IF EXISTS (SELECT 1 FROM mp_payments m WHERE m.appointment_id = r.id AND m.mp_status IN ('approved', 'authorized')) THEN
    RAISE EXCEPTION 'paid_online';
  END IF;

  UPDATE appointments
     SET status = 'cancelled', updated_at = NOW()
   WHERE id = r.id;
  -- Los productos apartados se liberan solos (solo cuentan citas abiertas).

  RETURN jsonb_build_object('appointment_id', r.id, 'business_id', r.business_id);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_appointment_by_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_appointment_by_token(UUID) TO anon, authenticated, service_role;
