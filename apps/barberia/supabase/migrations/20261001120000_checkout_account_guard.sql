-- ============================================================
-- 20261001120000_checkout_account_guard.sql — Cobro de citas: medio sin efectos colaterales
--
-- Si checkout_appointment devolvía un error (sin sale_id), la versión anterior
-- buscaba "la última venta de la cita" y le cambiaba el medio a un cobro
-- anterior. Ahora: si hay error se devuelve tal cual, y el medio solo se aplica
-- a la venta recién creada.
-- ============================================================

CREATE OR REPLACE FUNCTION public.checkout_appointment_secure(
  p_appointment_id  UUID,
  p_business_id     UUID,
  p_shift_id        UUID,
  p_payment_method  TEXT,
  p_tip_amount      NUMERIC DEFAULT 0,
  p_discount_amount NUMERIC DEFAULT 0,
  p_items           JSONB   DEFAULT '[]'::JSONB,
  p_account_id      UUID    DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_res    JSONB;
  v_sale   UUID;
  v_drawer BOOLEAN;
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  PERFORM 1 FROM appointments WHERE id = p_appointment_id AND business_id = p_business_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  PERFORM 1 FROM cash_register_shifts WHERE id = p_shift_id AND business_id = p_business_id AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'shift_not_open'; END IF;

  IF p_account_id IS NOT NULL THEN
    v_drawer := public._check_account(p_business_id, p_account_id);
    IF v_drawer <> (p_payment_method = 'cash') THEN RAISE EXCEPTION 'account_method_mismatch'; END IF;
  END IF;

  v_res := public.checkout_appointment(p_appointment_id, p_business_id, p_shift_id, p_payment_method,
                                       p_tip_amount, p_discount_amount, p_items);

  IF p_account_id IS NOT NULL THEN
    IF v_res ? 'error' THEN RETURN v_res; END IF;
    v_sale := NULLIF(v_res ->> 'sale_id', '')::UUID;
    IF v_sale IS NULL THEN RAISE EXCEPTION 'sale_not_created'; END IF;
    UPDATE payments SET account_id = p_account_id
     WHERE sale_id = v_sale AND business_id = p_business_id AND payment_method <> 'loyalty_points';
  END IF;
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.checkout_appointment_secure(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkout_appointment_secure(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, JSONB, UUID) TO authenticated;
