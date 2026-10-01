-- ============================================================
-- 20260930240000_business_profile_closures.sql — Configuración del negocio
--
-- 1. Datos del negocio: dirección, ciudad, WhatsApp, teléfono, Instagram,
--    enlace de mapa (públicos) y NIT/cédula + razón social (privados).
-- 2. Días cerrados (festivos que se cierran, vacaciones, remodelación):
--    business_closures es la fuente de verdad; cada cierre crea un bloqueo
--    (staff_time_off) por profesional activo, que el motor de reservas ya
--    respeta en la página pública, la agenda y la fila. Al borrar el cierre
--    se borran sus bloqueos. Un profesional nuevo hereda los cierres futuros.
-- 3. get_public_business devuelve también los datos de contacto, el horario
--    y los próximos cierres (nunca el NIT ni la razón social).
-- 4. Auditoría: cambios en datos del negocio y cierres quedan registrados.
-- Convención: staff_time_off guarda la hora LOCAL como UTC.
-- ============================================================

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS address     TEXT CHECK (address     IS NULL OR char_length(address)     <= 160),
  ADD COLUMN IF NOT EXISTS city        TEXT CHECK (city        IS NULL OR char_length(city)        <= 80),
  ADD COLUMN IF NOT EXISTS whatsapp    TEXT CHECK (whatsapp    IS NULL OR whatsapp ~ '^[0-9]{7,15}$'),
  ADD COLUMN IF NOT EXISTS phone       TEXT CHECK (phone       IS NULL OR phone    ~ '^[0-9]{7,15}$'),
  ADD COLUMN IF NOT EXISTS instagram   TEXT CHECK (instagram   IS NULL OR instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  ADD COLUMN IF NOT EXISTS maps_url    TEXT CHECK (maps_url    IS NULL OR (maps_url ~ '^https://' AND char_length(maps_url) <= 300)),
  ADD COLUMN IF NOT EXISTS tax_id      TEXT CHECK (tax_id      IS NULL OR char_length(tax_id)      <= 30),
  ADD COLUMN IF NOT EXISTS legal_name  TEXT CHECK (legal_name  IS NULL OR char_length(legal_name)  <= 120);

-- ── Cierres ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.business_closures (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  date_from   DATE        NOT NULL,
  date_to     DATE        NOT NULL,
  kind        TEXT        NOT NULL DEFAULT 'custom' CHECK (kind IN ('holiday', 'custom')),
  reason      TEXT        NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 80),
  created_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (date_to >= date_from AND date_to - date_from <= 60)
);
CREATE INDEX IF NOT EXISTS idx_business_closures_range ON public.business_closures (business_id, date_from, date_to);

ALTER TABLE public.staff_time_off
  ADD COLUMN IF NOT EXISTS closure_id UUID REFERENCES public.business_closures(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_staff_time_off_closure ON public.staff_time_off (closure_id) WHERE closure_id IS NOT NULL;

ALTER TABLE public.business_closures ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'business_closures' AND NOT ('service_role' = ANY (roles))
  LOOP
    EXECUTE format('DROP POLICY %I ON public.business_closures', p.policyname);
  END LOOP;
END $$;
CREATE POLICY xin_select ON public.business_closures FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id')
         OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE));
-- Sin escritura directa: set_business_closure / remove_business_closure

CREATE OR REPLACE FUNCTION public._closure_time_off(p_closure public.business_closures, p_staff_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO staff_time_off (business_id, staff_id, starts_at, ends_at, kind, reason, created_by, closure_id)
  VALUES (p_closure.business_id, p_staff_id,
          (p_closure.date_from::TIMESTAMP) AT TIME ZONE 'UTC',
          ((p_closure.date_to + 1)::TIMESTAMP) AT TIME ZONE 'UTC',
          'other', 'Negocio cerrado: ' || p_closure.reason, p_closure.created_by, p_closure.id)
$$;
REVOKE ALL ON FUNCTION public._closure_time_off(public.business_closures, UUID) FROM PUBLIC, anon, authenticated;

-- Cerrar un día o un rango. Devuelve el cierre y cuántas citas activas hay esos días.
CREATE OR REPLACE FUNCTION public.set_business_closure(
  p_date_from DATE,
  p_date_to   DATE,
  p_reason    TEXT,
  p_kind      TEXT DEFAULT 'custom'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bid   UUID;
  c       public.business_closures;
  st      RECORD;
  v_appts INTEGER;
BEGIN
  BEGIN
    v_bid := (auth.jwt() -> 'app_metadata' ->> 'business_id')::UUID;
  EXCEPTION WHEN OTHERS THEN v_bid := NULL;
  END;
  IF v_bid IS NULL OR NOT public._is_business_admin(v_bid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from OR p_date_to - p_date_from > 60 THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;
  IF p_date_from < (NOW() AT TIME ZONE 'America/Bogota')::DATE THEN RAISE EXCEPTION 'past_date'; END IF;
  IF COALESCE(p_kind, '') NOT IN ('holiday', 'custom') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 2 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF EXISTS (SELECT 1 FROM business_closures
              WHERE business_id = v_bid AND date_from <= p_date_to AND date_to >= p_date_from) THEN
    RAISE EXCEPTION 'overlaps';
  END IF;

  INSERT INTO business_closures (business_id, date_from, date_to, kind, reason, created_by)
  VALUES (v_bid, p_date_from, p_date_to, p_kind, LEFT(btrim(p_reason), 80), auth.uid())
  RETURNING * INTO c;

  FOR st IN SELECT id FROM staff WHERE business_id = v_bid AND is_active LOOP
    PERFORM public._closure_time_off(c, st.id);
  END LOOP;

  SELECT COUNT(*) INTO v_appts FROM appointments
   WHERE business_id = v_bid
     AND status IN ('scheduled', 'payment_pending', 'in_progress', 'ready_to_pay')
     AND (start_time AT TIME ZONE 'UTC')::DATE BETWEEN p_date_from AND p_date_to;

  RETURN jsonb_build_object('id', c.id, 'appointments_on_those_days', v_appts);
END;
$$;
REVOKE ALL ON FUNCTION public.set_business_closure(DATE, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_business_closure(DATE, DATE, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_business_closure(p_closure_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.business_closures;
BEGIN
  SELECT * INTO c FROM business_closures WHERE id = p_closure_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public._assert_business_access(c.business_id);
  IF NOT public._is_business_admin(c.business_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM business_closures WHERE id = c.id;   -- borra sus bloqueos en cascada
END;
$$;
REVOKE ALL ON FUNCTION public.remove_business_closure(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_business_closure(UUID) TO authenticated;

-- Un profesional nuevo (o reactivado) hereda los cierres futuros
CREATE OR REPLACE FUNCTION public._trg_staff_inherit_closures()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.business_closures;
BEGIN
  IF NEW.is_active AND (TG_OP = 'INSERT' OR OLD.is_active IS DISTINCT FROM TRUE) THEN
    FOR c IN SELECT * FROM business_closures
              WHERE business_id = NEW.business_id
                AND date_to >= (NOW() AT TIME ZONE 'America/Bogota')::DATE LOOP
      IF NOT EXISTS (SELECT 1 FROM staff_time_off WHERE closure_id = c.id AND staff_id = NEW.id) THEN
        PERFORM public._closure_time_off(c, NEW.id);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._trg_staff_inherit_closures() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_staff_inherit_closures ON public.staff;
CREATE TRIGGER trg_staff_inherit_closures AFTER INSERT OR UPDATE OF is_active ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public._trg_staff_inherit_closures();

-- ── Auditoría de cierres ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_audit_closures()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.business_closures := COALESCE(NEW, OLD);
BEGIN
  PERFORM public._audit(r.business_id, 'settings',
    CASE WHEN TG_OP = 'INSERT' THEN 'closure.created' ELSE 'closure.deleted' END, 'business_closure', r.id,
    CASE WHEN TG_OP = 'INSERT' THEN 'cerró el negocio ' ELSE 'volvió a abrir el negocio ' END
      || CASE WHEN r.date_from = r.date_to THEN 'el ' || to_char(r.date_from, 'DD/MM/YYYY')
              ELSE 'del ' || to_char(r.date_from, 'DD/MM/YYYY') || ' al ' || to_char(r.date_to, 'DD/MM/YYYY') END
      || ' (' || r.reason || ')',
    'info', NULL, NULL, NULL);
  RETURN r;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public._trg_audit_closures() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_closures ON public.business_closures;
CREATE TRIGGER trg_audit_closures AFTER INSERT OR DELETE ON public.business_closures
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_closures();

-- ── Auditoría de configuración: también datos del negocio ────────────────────
CREATE OR REPLACE FUNCTION public._trg_audit_businesses()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o JSONB := to_jsonb(OLD);
  n JSONB := to_jsonb(NEW);
  k TEXT;
  changed TEXT[] := '{}';
  keys TEXT[] := ARRAY['loyalty_mode', 'loyalty_earn_per_cop', 'loyalty_point_value_cop', 'loyalty_min_redeem_points',
                       'loyalty_expiry_months', 'loyalty_stamps_required', 'loyalty_stamp_max_reward_cop',
                       'booking_products_enabled', 'booking_max_product_units', 'booking_max_open_with_products_per_phone',
                       'service_audiences', 'features_enabled', 'appointment_interval_minutes', 'operating_hours',
                       'name', 'is_active', 'address', 'city', 'whatsapp', 'phone', 'instagram', 'maps_url',
                       'tax_id', 'legal_name'];
BEGIN
  FOREACH k IN ARRAY keys LOOP
    IF o -> k IS DISTINCT FROM n -> k THEN changed := changed || k; END IF;
  END LOOP;
  IF array_length(changed, 1) IS NULL THEN RETURN NEW; END IF;
  PERFORM public._audit(NEW.id, 'settings', 'business.settings_changed', 'business', NEW.id,
    'cambió la configuración: ' || array_to_string(ARRAY(
      SELECT CASE
               WHEN c LIKE 'loyalty_%' THEN 'lealtad'
               WHEN c LIKE 'booking_%' OR c = 'appointment_interval_minutes' THEN 'reservas en línea'
               WHEN c = 'service_audiences' THEN 'públicos de servicios'
               WHEN c = 'features_enabled' THEN 'módulos'
               WHEN c = 'operating_hours' THEN 'horario del negocio'
               WHEN c IN ('tax_id', 'legal_name') THEN 'datos para facturación'
               WHEN c IN ('address', 'city', 'whatsapp', 'phone', 'instagram', 'maps_url') THEN 'datos de contacto'
               WHEN c = 'name' THEN 'nombre'
               ELSE 'estado del negocio' END
        FROM unnest(changed) c GROUP BY 1), ', '),
    CASE WHEN 'features_enabled' = ANY (changed) OR 'is_active' = ANY (changed) THEN 'warning' ELSE 'info' END,
    NULL,
    (SELECT jsonb_object_agg(c, o -> c) FROM unnest(changed) c),
    (SELECT jsonb_object_agg(c, n -> c) FROM unnest(changed) c));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Página pública: contacto, horario y próximos cierres ─────────────────────
DROP FUNCTION IF EXISTS public.get_public_business(text, uuid);
CREATE FUNCTION public.get_public_business(p_slug text DEFAULT NULL, p_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid, name text, slug text, is_active boolean,
  branding jsonb, brand_config jsonb,
  online_payments boolean, email_notifications boolean,
  service_audiences text[],
  address text, city text, whatsapp text, phone text, instagram text, maps_url text,
  operating_hours jsonb, upcoming_closures jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.name::text, b.slug::text, b.is_active,
         b.branding::jsonb, b.brand_config::jsonb,
         COALESCE((b.features_enabled->>'mercadopago_booking')::boolean, false),
         COALESCE((b.features_enabled->>'notifications_email')::boolean, false),
         b.service_audiences,
         b.address, b.city, b.whatsapp, b.phone, b.instagram, b.maps_url,
         b.operating_hours::jsonb,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('from', c.date_from, 'to', c.date_to, 'reason', c.reason)
                                    ORDER BY c.date_from)
                     FROM business_closures c
                    WHERE c.business_id = b.id
                      AND c.date_to >= (NOW() AT TIME ZONE 'America/Bogota')::DATE
                      AND c.date_from <= (NOW() AT TIME ZONE 'America/Bogota')::DATE + 60), '[]'::jsonb)
  FROM businesses b
  WHERE (p_slug IS NOT NULL AND b.slug = p_slug)
     OR (p_id   IS NOT NULL AND b.id   = p_id)
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_public_business(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_business(text, uuid) TO anon, authenticated, service_role;
