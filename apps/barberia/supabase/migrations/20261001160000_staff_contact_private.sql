-- ============================================================
-- 20261001160000_staff_contact_private.sql — Correo y celular del equipo, solo para el admin
--
-- ORDEN DE EJECUCIÓN: 1) deploy del código  2) ESTA migración.
-- El código nuevo ya no pide `staff.email` / `staff.phone` con el cliente del usuario y tolera
-- que la función get_staff_contacts todavía no exista (el equipo se ve sin correo/celular
-- hasta correr este SQL). Correr esta migración ANTES del deploy rompería, para todos los
-- roles, cualquier lectura de `staff` que pida esas columnas (equipo, pagos al equipo).
--
-- Qué hace: hasta ahora la política RLS de `staff` deja leer la fila completa a cualquier
-- usuario del negocio, así que un barbero podía leer el correo y el celular de sus
-- compañeros llamando a PostgREST directo con su propio token. Aquí se cierra con
-- privilegios por columna:
--
--   · authenticated solo puede LEER id, business_id, profile_id, full_name, specialty_role,
--     is_active, created_at y user_id (los barberos necesitan los nombres de sus compañeros
--     para la agenda, los turnos sin cita y las fichas de Clientes; el aislamiento entre
--     negocios sigue en la RLS, que no se toca).
--   · anon no lee `staff` directo: la reserva pública usa la función DEFINER get_public_staff.
--   · INSERT / UPDATE / DELETE y las políticas RLS NO se tocan: el admin sigue creando y
--     editando correo y celular como siempre (el REVOKE de SELECT no quita permisos de
--     escritura; solo hay que no pedir esas columnas de vuelta con .select()).
--   · get_staff_contacts(negocio): SECURITY DEFINER, solo admin / super_admin de ese negocio.
--     Devuelve id, email y phone de cada profesional. Es lo que usan las pantallas de admin.
--
-- Las funciones SECURITY DEFINER corren como su dueño (postgres), así que los privilegios
-- por columna no les afectan; el service role tampoco. Verificado en las migraciones: ninguna
-- función SECURITY INVOKER ni vista security_invoker lee staff.email / staff.phone.
--
-- Importante: con estos privilegios, `select('*')`, `.select()` sin argumentos (incluido el
-- RETURNING de un insert/update) y `staff(*)` desde otra tabla fallan con "permission denied"
-- para el cliente del usuario. Pide siempre columnas explícitas.
--
-- Revertir: GRANT SELECT ON public.staff TO anon, authenticated;
-- ============================================================

-- ── 1. Lectura por columna ────────────────────────────────────────────────────
REVOKE SELECT ON public.staff FROM anon, authenticated;

GRANT SELECT (id, business_id, profile_id, full_name, specialty_role, is_active, created_at, user_id)
  ON public.staff TO authenticated;

-- ── 2. Contactos del equipo (solo admin) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_staff_contacts(p_business_id UUID)
RETURNS TABLE (id UUID, email TEXT, phone TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  IF NOT public._is_business_admin(p_business_id) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  RETURN QUERY
    SELECT s.id, s.email::TEXT, s.phone::TEXT
      FROM staff s
     WHERE s.business_id = p_business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_staff_contacts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_contacts(UUID) TO authenticated;
