-- ============================================================
-- 20260928120000_fix_profiles_rls_app_metadata.sql
--
-- [SEC] profiles quedó fuera de 20260525200001_fix_rls_app_metadata.sql.
-- Su única política leía auth.jwt() ->> 'business_id' (nivel superior del
-- JWT), que siempre es NULL: business_id vive en app_metadata. Resultado:
-- ningún usuario podía leer su propio perfil y el dashboard lo mostraba
-- como "barber" / "Equipo".
--
-- Solo lectura: las escrituras en profiles se hacen con el service role
-- (actions/business-users.ts). Una política UPDATE para el propio usuario
-- le permitiría cambiarse el rol.
-- ============================================================

DROP POLICY IF EXISTS "Acceso total por negocio en perfiles" ON public.profiles;

DROP POLICY IF EXISTS "users can read own profile" ON public.profiles;
CREATE POLICY "users can read own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "tenant can read business profiles" ON public.profiles;
CREATE POLICY "tenant can read business profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (business_id::text = (auth.jwt() -> 'app_metadata' ->> 'business_id'));
