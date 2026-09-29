-- ============================================================
-- 20260929210000_service_audiences.sql — Servicios por público
--
-- Cada servicio es para un público: men (caballeros) | women (damas) |
-- kids (niños) | all (unisex, aparece en todos). Precio y duración van en
-- cada servicio → "Corte caballero" y "Corte dama" son servicios distintos,
-- así horarios, cobro, comisiones y reportes no cambian.
--
-- El negocio activa qué públicos atiende (businesses.service_audiences).
-- Por defecto solo caballeros → las barberías actuales no ven nada nuevo.
-- Un público desactivado oculta sus servicios de la reserva, no los borra.
-- ============================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'men'
    CHECK (audience IN ('men', 'women', 'kids', 'all'));

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS service_audiences TEXT[] NOT NULL DEFAULT ARRAY['men']::TEXT[]
    CHECK (
      cardinality(service_audiences) >= 1
      AND service_audiences <@ ARRAY['men', 'women', 'kids']::TEXT[]
    );

-- get_public_business: + service_audiences (cambia el tipo de retorno → DROP).
DROP FUNCTION IF EXISTS public.get_public_business(text, uuid);

CREATE FUNCTION public.get_public_business(p_slug text DEFAULT NULL, p_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid, name text, slug text, is_active boolean,
  branding jsonb, brand_config jsonb,
  online_payments boolean, email_notifications boolean,
  service_audiences text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.name::text, b.slug::text, b.is_active,
         b.branding::jsonb, b.brand_config::jsonb,
         COALESCE((b.features_enabled->>'mercadopago_booking')::boolean, false),
         COALESCE((b.features_enabled->>'notifications_email')::boolean, false),
         b.service_audiences
  FROM businesses b
  WHERE (p_slug IS NOT NULL AND b.slug = p_slug)
     OR (p_id   IS NOT NULL AND b.id   = p_id)
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_public_business(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_business(text, uuid) TO anon, authenticated, service_role;
