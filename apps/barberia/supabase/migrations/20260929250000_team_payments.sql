-- ============================================================
-- 20260929250000_team_payments.sql — "Pagos al equipo" (antes Ledger)
--
-- 1. Nuevos tipos de movimiento: bonus (+, a favor) y deduction (−, descuento),
--    con motivo obligatorio (lo valida la app).
-- 2. De dónde salió la plata en pagos/anticipos: payment_method + shift_id
--    (efectivo de la caja → se resta del efectivo esperado al cerrar caja).
--    created_by y el período liquidado (period_from / period_to).
-- 3. staff_ledger_balances incluye bonos y descuentos.
-- 4. RLS: el admin ve y registra todo lo de su negocio; cada profesional
--    (staff.user_id = su usuario) SOLO VE su propia cuenta y no escribe nada.
--    Las comisiones/propinas las escribe el trigger (SECURITY DEFINER).
-- ============================================================

-- ── 1. Tipos ─────────────────────────────────────────────────────────────────
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.staff_ledger'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%entry_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.staff_ledger DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.staff_ledger
  ADD CONSTRAINT staff_ledger_entry_type_check
  CHECK (entry_type IN ('commission', 'tip', 'advance', 'payment', 'bonus', 'deduction'));

-- ── 2. Columnas ──────────────────────────────────────────────────────────────
ALTER TABLE public.staff_ledger
  ADD COLUMN IF NOT EXISTS payment_method TEXT
    CHECK (payment_method IS NULL OR payment_method IN ('cash_register', 'transfer', 'other')),
  ADD COLUMN IF NOT EXISTS shift_id    UUID REFERENCES public.cash_register_shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS period_from DATE,
  ADD COLUMN IF NOT EXISTS period_to   DATE;

CREATE INDEX IF NOT EXISTS idx_staff_ledger_shift ON public.staff_ledger (shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_ledger_staff_created ON public.staff_ledger (staff_id, created_at DESC);

-- ── 3. Saldos (columnas nuevas al final) ─────────────────────────────────────
CREATE OR REPLACE VIEW public.staff_ledger_balances
  WITH (security_invoker = true)
AS
SELECT
  business_id,
  staff_id,
  COALESCE(SUM(CASE WHEN entry_type IN ('commission', 'tip') THEN amount ELSE 0 END), 0)::INTEGER AS total_earned,
  COALESCE(SUM(CASE WHEN entry_type = 'advance'   THEN amount ELSE 0 END), 0)::INTEGER AS total_advances,
  COALESCE(SUM(CASE WHEN entry_type = 'payment'   THEN amount ELSE 0 END), 0)::INTEGER AS total_paid_out,
  COALESCE(SUM(
    CASE
      WHEN entry_type IN ('commission', 'tip', 'bonus')         THEN  amount
      WHEN entry_type IN ('advance', 'payment', 'deduction')    THEN -amount
      ELSE 0
    END
  ), 0)::INTEGER AS current_balance,
  COALESCE(SUM(CASE WHEN entry_type = 'bonus'     THEN amount ELSE 0 END), 0)::INTEGER AS total_bonus,
  COALESCE(SUM(CASE WHEN entry_type = 'deduction' THEN amount ELSE 0 END), 0)::INTEGER AS total_deductions
FROM public.staff_ledger
GROUP BY business_id, staff_id;

GRANT SELECT ON public.staff_ledger_balances TO authenticated;

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
-- ¿El usuario es admin (o super_admin) de ese negocio?
CREATE OR REPLACE FUNCTION public._is_business_admin(p_business_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE)
      OR EXISTS (SELECT 1 FROM profiles p
                  WHERE p.id = auth.uid()
                    AND p.business_id = p_business_id
                    AND p.role IN ('admin', 'super_admin'))
$$;
REVOKE ALL ON FUNCTION public._is_business_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._is_business_admin(UUID) TO authenticated;

-- ¿Ese profesional es el usuario actual?
CREATE OR REPLACE FUNCTION public._is_my_staff(p_staff_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM staff s WHERE s.id = p_staff_id AND s.user_id = auth.uid() AND auth.uid() IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION public._is_my_staff(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._is_my_staff(UUID) TO authenticated;

-- Quitar TODAS las políticas anteriores de staff_ledger (había una FOR ALL por tenant)
DO $$
DECLARE p TEXT;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'staff_ledger'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.staff_ledger', p);
  END LOOP;
END $$;

ALTER TABLE public.staff_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ledger_select_admin_or_own"
  ON public.staff_ledger FOR SELECT TO authenticated
  USING (
    business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id')
    AND (public._is_business_admin(business_id) OR public._is_my_staff(staff_id))
  );

CREATE POLICY "ledger_insert_admin"
  ON public.staff_ledger FOR INSERT TO authenticated
  WITH CHECK (
    business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id')
    AND public._is_business_admin(business_id)
  );

-- Sin UPDATE / DELETE para usuarios: los movimientos no se editan; se corrigen con ajustes.

CREATE POLICY "ledger_service_role_full"
  ON public.staff_ledger FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);
