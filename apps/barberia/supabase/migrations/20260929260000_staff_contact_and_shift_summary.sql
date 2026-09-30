-- ============================================================
-- 20260929260000_staff_contact_and_shift_summary.sql
--
-- 1. staff.email / staff.phone (opcionales): a dónde llega el recibo de
--    anticipos y pagos, y el WhatsApp directo. Si no hay email se usa el del
--    usuario vinculado (staff.user_id).
-- 2. Un usuario solo puede estar vinculado a UN profesional por negocio.
-- 3. get_shift_cash_summary: totales del turno de caja calculados en el
--    servidor (la RLS de staff_ledger ya no deja a un no-admin sumar los pagos
--    de otros → el efectivo esperado sería incorrecto).
-- ============================================================

-- ── 1. Contacto del profesional ──────────────────────────────────────────────
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS email TEXT
    CHECK (email IS NULL OR (char_length(email) <= 254 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  ADD COLUMN IF NOT EXISTS phone TEXT
    CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ]{7,20}$');

-- ── 2. Un usuario ↔ un profesional ───────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_business_user
  ON public.staff (business_id, user_id)
  WHERE user_id IS NOT NULL;

-- ── 3. Resumen del turno de caja ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_shift_cash_summary(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business UUID;
BEGIN
  SELECT business_id INTO v_business FROM cash_register_shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public._assert_business_access(v_business);

  RETURN jsonb_build_object(
    'total_sales',
      (SELECT COALESCE(SUM(total_amount), 0) FROM sales
        WHERE shift_id = p_shift_id AND business_id = v_business),
    'cash_collected',
      (SELECT COALESCE(SUM(amount), 0) FROM payments
        WHERE shift_id = p_shift_id AND business_id = v_business AND payment_method = 'cash'),
    'cash_expenses',
      (SELECT COALESCE(SUM(amount), 0) FROM expenses
        WHERE shift_id = p_shift_id AND business_id = v_business AND payment_method = 'cash_register'),
    'cash_team_payments',
      (SELECT COALESCE(SUM(amount), 0) FROM staff_ledger
        WHERE shift_id = p_shift_id AND business_id = v_business
          AND payment_method = 'cash_register' AND entry_type IN ('advance', 'payment'))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_shift_cash_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shift_cash_summary(UUID) TO authenticated;
