-- ============================================================
-- 20260928130000_businesses_missing_columns_and_dead_policies.sql
-- Ya aplicada en producción (SQL Editor, 2026-09-28).
--
-- 1. Columnas de businesses declaradas en 00001_initial_schema.sql y en
--    @xinuco/types que nunca llegaron a producción. Sin trial_expires_at,
--    el select del layout del dashboard fallaba (42703) → business = null →
--    sin nombre del negocio y features bloqueadas. operating_hours /
--    workstations_count rompían Configuración → Disponibilidad.
--
-- 2. Políticas muertas que leían auth.jwt() ->> 'business_id' (nivel superior
--    del JWT, siempre NULL). No otorgaban nada; cada tabla ya tiene su política
--    correcta vía app_metadata. (20260928120000 intentó borrar la de profiles
--    con un nombre equivocado.)
-- ============================================================

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS operating_hours    JSONB,
  ADD COLUMN IF NOT EXISTS workstations_count INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS trial_expires_at   TIMESTAMPTZ;

DROP POLICY IF EXISTS "Aislamiento total por negocio en perfiles" ON public.profiles;
DROP POLICY IF EXISTS "Aislamiento de citas por negocio"          ON public.appointments;
DROP POLICY IF EXISTS "Edicion solo por dueños del negocio"       ON public.businesses;
