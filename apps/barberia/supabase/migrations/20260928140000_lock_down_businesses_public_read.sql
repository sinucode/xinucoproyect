-- ============================================================
-- 20260928140000_lock_down_businesses_public_read.sql
-- Ya aplicada en producción (SQL Editor, 2026-09-28), en dos pasos.
--
-- [SEC] businesses era legible por anon ("Allow public read access": USING true):
-- cualquiera podía listar todos los negocios con features_enabled, trial, etc.
-- Ahora las páginas públicas (/[slug], /book, login, correos) usan la RPC
-- get_public_business: UN negocio por slug o id y solo campos públicos.
-- La tabla queda para su propio tenant y el super_admin.
-- ============================================================

-- Paso 1 (aditivo) ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_business(p_slug text DEFAULT NULL, p_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid, name text, slug text, is_active boolean,
  branding jsonb, brand_config jsonb,
  online_payments boolean, email_notifications boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.name::text, b.slug::text, b.is_active,
         b.branding::jsonb, b.brand_config::jsonb,
         COALESCE((b.features_enabled->>'mercadopago_booking')::boolean, false),
         COALESCE((b.features_enabled->>'notifications_email')::boolean, false)
  FROM businesses b
  WHERE (p_slug IS NOT NULL AND b.slug = p_slug)
     OR (p_id   IS NOT NULL AND b.id   = p_id)
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_public_business(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_business(text, uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "tenant can read own business" ON public.businesses;
CREATE POLICY "tenant can read own business" ON public.businesses
  FOR SELECT TO authenticated
  USING (id::text = (auth.jwt() -> 'app_metadata' ->> 'business_id'));

DROP POLICY IF EXISTS "super admin can read businesses" ON public.businesses;
CREATE POLICY "super admin can read businesses" ON public.businesses
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin');

-- Paso 2 (después de desplegar el código que usa la RPC) ─────────────────────
DROP POLICY IF EXISTS "Allow public read access to businesses" ON public.businesses;
DROP POLICY IF EXISTS "Lectura publica de negocios"            ON public.businesses;
