-- ============================================================
-- 20260929270000_admin_only_writes.sql — Endurecer escrituras por rol
--
-- Problema: muchas tablas tenían UNA política "FOR ALL" por negocio. Las
-- pantallas validan que sea admin, pero un barbero con sesión podía escribir
-- DIRECTO a la API de Supabase (con su token) y, por ejemplo, ponerse 100% de
-- comisión, borrar gastos o activarse módulos pagos.
--
-- Ahora, en estas tablas:
--   - Leer: cualquier usuario del negocio (la agenda y la reserva lo necesitan).
--     Excepción: expenses solo la lee el admin (información financiera).
--   - Crear / editar / borrar: solo admin del negocio (o super_admin).
-- Las políticas de lectura pública (anon) y de service_role no se tocan.
--
-- businesses: solo el admin actualiza su negocio, y NADIE salvo super_admin /
-- service_role puede activar módulos, cambiar el estado de suscripción,
-- activar/desactivar el negocio o cambiar el slug. (Apagar módulos al cancelar
-- la suscripción sí se permite.)
-- ============================================================

-- Admin del negocio o super_admin
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

-- ── Tablas de configuración y dinero ─────────────────────────────────────────
DO $$
DECLARE
  t   TEXT;
  p   RECORD;
  tables TEXT[] := ARRAY[
    'commission_rules', 'expenses', 'expense_categories',
    'staff', 'staff_services', 'staff_schedules', 'staff_breaks', 'staff_time_off',
    'services', 'service_workstations'
  ];
  tenant TEXT := $q$(business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id')
                   OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE))$q$;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    -- Quitar las políticas de escritura (y las FOR ALL) de usuarios; conservar
    -- las de service_role y las de solo lectura (anon/pública).
    FOR p IN
      SELECT policyname, cmd FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t
         AND NOT ('service_role' = ANY (roles))
         AND (cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
              OR (t = 'expenses' AND cmd = 'SELECT'))
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS xin_select ON public.%I', t);
    IF t = 'expenses' THEN
      EXECUTE format(
        'CREATE POLICY xin_select ON public.%I FOR SELECT TO authenticated USING (public._is_business_admin(business_id))', t);
    ELSE
      EXECUTE format(
        'CREATE POLICY xin_select ON public.%I FOR SELECT TO authenticated USING %s', t, tenant);
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS xin_admin_insert ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY xin_admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public._is_business_admin(business_id))', t);

    EXECUTE format('DROP POLICY IF EXISTS xin_admin_update ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY xin_admin_update ON public.%I FOR UPDATE TO authenticated USING (public._is_business_admin(business_id)) WITH CHECK (public._is_business_admin(business_id))', t);

    EXECUTE format('DROP POLICY IF EXISTS xin_admin_delete ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY xin_admin_delete ON public.%I FOR DELETE TO authenticated USING (public._is_business_admin(business_id))', t);
  END LOOP;
END $$;

-- ── businesses: solo el admin actualiza su negocio ───────────────────────────
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'businesses'
       AND cmd IN ('ALL', 'UPDATE')
       AND NOT ('service_role' = ANY (roles))
       AND COALESCE(qual, '') || COALESCE(with_check, '') NOT ILIKE '%super_admin%'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.businesses', p.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS xin_admin_update_business ON public.businesses;
CREATE POLICY xin_admin_update_business ON public.businesses
  FOR UPDATE TO authenticated
  USING      (public._is_business_admin(id))
  WITH CHECK (public._is_business_admin(id));

-- Campos que solo cambia super_admin / service_role (módulos pagos, estado)
CREATE OR REPLACE FUNCTION public._guard_business_protected_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  k TEXT;
BEGIN
  IF auth.role() = 'service_role'
     OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE)
     OR current_user NOT IN ('authenticated', 'anon') THEN   -- SQL editor, migraciones, service_role
    RETURN NEW;
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active OR NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'forbidden_field';
  END IF;

  -- Módulos: se pueden APAGAR (cancelar plan), nunca encender.
  FOR k IN SELECT jsonb_object_keys(COALESCE(NEW.features_enabled::jsonb, '{}'::jsonb)) LOOP
    IF COALESCE((NEW.features_enabled::jsonb ->> k)::BOOLEAN, FALSE)
       AND NOT COALESCE((OLD.features_enabled::jsonb ->> k)::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION 'forbidden_feature';
    END IF;
  END LOOP;

  -- Suscripción: solo se puede pasar a un estado "sin plan"
  IF (to_jsonb(NEW) ->> 'subscription_status') IS DISTINCT FROM (to_jsonb(OLD) ->> 'subscription_status')
     AND COALESCE(to_jsonb(NEW) ->> 'subscription_status', 'none') NOT IN ('none', 'canceled', 'cancelled') THEN
    RAISE EXCEPTION 'forbidden_field';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._guard_business_protected_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_business_protected_fields ON public.businesses;
CREATE TRIGGER trg_guard_business_protected_fields
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public._guard_business_protected_fields();
