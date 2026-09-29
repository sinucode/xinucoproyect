-- ============================================================
-- 20260929130000_cancellation_reason.sql — Motivo de cancelación
-- El cliente puede escribir (opcional) por qué cancela desde el enlace del
-- correo. Se guarda en la cita (lo ve el negocio en la Agenda) y va en el
-- correo de cancelación. Máx. 300 caracteres.
-- ============================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT
    CHECK (cancellation_reason IS NULL OR char_length(cancellation_reason) <= 300),
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT
    CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'business'));

-- Nueva firma con p_reason (DEFAULT NULL → llamadas viejas siguen funcionando).
DROP FUNCTION IF EXISTS public.cancel_appointment_by_token(UUID);

CREATE OR REPLACE FUNCTION public.cancel_appointment_by_token(p_token UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r        RECORD;
  v_reason TEXT := NULLIF(LEFT(TRIM(COALESCE(p_reason, '')), 300), '');
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
     SET status = 'cancelled',
         cancellation_reason = v_reason,
         cancelled_by = 'customer',
         updated_at = NOW()
   WHERE id = r.id;

  RETURN jsonb_build_object('appointment_id', r.id, 'business_id', r.business_id, 'reason', v_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_appointment_by_token(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_appointment_by_token(UUID, TEXT) TO anon, authenticated, service_role;
