-- ============================================================
-- 20260930130000_appointments_customers_rls.sql — Citas y clientes por rol
--
-- Antes: una política "FOR ALL" por negocio → cualquier usuario del negocio
-- podía, por la API, borrar clientes, mover citas de otros barberos o marcar
-- una cita como "completada" sin cobrarla.
--
-- Ahora:
--   appointments
--     - Leer: todo el negocio (agenda, fila de espera).
--     - Cambiar: el admin, o el profesional dueño de la cita (staff.user_id).
--       Un no-admin solo cambia el estado/notas: no mueve la hora, el
--       profesional, el servicio ni el cliente.
--     - "Completada" solo la pone el cobro (funciones internas), nunca a mano.
--     - Crear/borrar directo: solo admin (las reservas y la fila usan funciones).
--   customers
--     - Leer/crear/editar: todo el negocio (el CRM lo usan los barberos).
--     - Borrar: solo admin.
-- ============================================================

DO $$
DECLARE
  t TEXT;
  p RECORD;
  tenant TEXT := $q$(business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id')
                   OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE))$q$;
BEGIN
  FOREACH t IN ARRAY ARRAY['appointments', 'customers'] LOOP
    FOR p IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t
         AND NOT ('service_role' = ANY (roles))
         AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS xin_select ON public.%I', t);
    EXECUTE format('CREATE POLICY xin_select ON public.%I FOR SELECT TO authenticated USING %s', t, tenant);
  END LOOP;
END $$;

-- appointments
DROP POLICY IF EXISTS xin_admin_insert ON public.appointments;
CREATE POLICY xin_admin_insert ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (public._is_business_admin(business_id));

DROP POLICY IF EXISTS xin_update_admin_or_own ON public.appointments;
CREATE POLICY xin_update_admin_or_own ON public.appointments FOR UPDATE TO authenticated
  USING (
    business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id')
    AND (public._is_business_admin(business_id) OR public._is_my_staff(staff_id))
  )
  WITH CHECK (
    business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id')
    AND (public._is_business_admin(business_id) OR public._is_my_staff(staff_id))
  );

DROP POLICY IF EXISTS xin_admin_delete ON public.appointments;
CREATE POLICY xin_admin_delete ON public.appointments FOR DELETE TO authenticated
  USING (public._is_business_admin(business_id));

-- customers
DROP POLICY IF EXISTS xin_member_insert ON public.customers;
CREATE POLICY xin_member_insert ON public.customers FOR INSERT TO authenticated
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'));

DROP POLICY IF EXISTS xin_member_update ON public.customers;
CREATE POLICY xin_member_update ON public.customers FOR UPDATE TO authenticated
  USING      (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'))
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'));

DROP POLICY IF EXISTS xin_admin_delete ON public.customers;
CREATE POLICY xin_admin_delete ON public.customers FOR DELETE TO authenticated
  USING (public._is_business_admin(business_id));

-- Reglas de cambio de una cita hechas por usuarios (no por funciones internas)
CREATE OR REPLACE FUNCTION public._guard_appointment_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  -- Funciones internas (cobro, reservas, fila), service_role y SQL editor: sin restricción
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'forbidden_field';
  END IF;

  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'use_checkout';
  END IF;

  IF NOT public._is_business_admin(OLD.business_id) AND (
       NEW.staff_id    IS DISTINCT FROM OLD.staff_id
    OR NEW.start_time  IS DISTINCT FROM OLD.start_time
    OR NEW.service_id  IS DISTINCT FROM OLD.service_id
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
  ) THEN
    RAISE EXCEPTION 'forbidden_field';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_appointment_update ON public.appointments;
CREATE TRIGGER trg_guard_appointment_update
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public._guard_appointment_update();
