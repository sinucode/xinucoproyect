-- ============================================================
-- 20261001130000_handle_new_user_app_metadata.sql — Perfil al crear usuario
--
-- Problema: handle_new_user (creado a mano en Supabase, no estaba en el repo)
-- leía business_id y role de raw_user_meta_data. El panel de super_admin guarda
-- el negocio en app_metadata, así que el perfil quedaba sin negocio y
-- profiles_business_id_check rechazaba la creación ("Database error creating new user").
--
-- Seguridad: raw_user_meta_data lo escribe el propio usuario (signUp con la
-- clave pública), así que no sirve para decidir negocio ni rol: cualquiera podía
-- registrarse como 'admin' de cualquier negocio. Ahora:
--   - el negocio sale SOLO de raw_app_meta_data (lo escribe el servidor con service_role);
--   - el rol inicial es siempre 'barber'; el rol real lo fija el servidor después
--     (createBusinessUser hace upsert del perfil con el rol elegido);
--   - sin negocio válido (p. ej. super_admin) no se crea perfil, y el alta no falla.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_raw      TEXT := NEW.raw_app_meta_data ->> 'business_id';
  v_business UUID;
BEGIN
  IF v_raw IS NULL OR v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NEW;
  END IF;
  v_business := v_raw::UUID;
  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = v_business) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, business_id, full_name, role)
  VALUES (
    NEW.id,
    v_business,
    COALESCE(NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''), split_part(NEW.email, '@', 1)),
    'barber'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- El trigger ya existe en producción; se recrea igual para que el repo lo refleje.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
