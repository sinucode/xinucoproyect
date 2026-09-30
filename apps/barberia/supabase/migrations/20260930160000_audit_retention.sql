-- ============================================================
-- 20260930160000_audit_retention.sql — Cuánto tiempo se guarda la auditoría
--
-- - platform_settings: ajustes globales de la vertical, solo el super_admin
--   los lee/cambia. audit_retention_months = 36 (3 años) por defecto.
--   Opciones permitidas: 12, 24, 36, 60, 120 meses (mínimo 1 año: nadie
--   puede acortar el plazo para borrar evidencia).
-- - get_audit_retention_months(): el plazo vigente (lo lee cualquier
--   usuario con sesión para mostrarlo en la pantalla de Auditoría).
-- - purge_audit_logs(): borra lo más viejo que el plazo, por tandas.
--   Solo la ejecuta el sistema (service_role, desde el cron diario).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  updated_by_name TEXT
);

INSERT INTO public.platform_settings (key, value)
VALUES ('audit_retention_months', '36'::JSONB)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'platform_settings' AND NOT ('service_role' = ANY (roles))
  LOOP
    EXECUTE format('DROP POLICY %I ON public.platform_settings', p.policyname);
  END LOOP;
END $$;

CREATE POLICY xin_super_admin_select ON public.platform_settings FOR SELECT TO authenticated
  USING (COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE));
CREATE POLICY xin_super_admin_update ON public.platform_settings FOR UPDATE TO authenticated
  USING      (COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE))
  WITH CHECK (COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE));

REVOKE ALL ON public.platform_settings FROM anon;

-- Validación del plazo de auditoría
CREATE OR REPLACE FUNCTION public._check_platform_settings()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.key = 'audit_retention_months' THEN
    IF jsonb_typeof(NEW.value) <> 'number' OR (NEW.value)::TEXT::INTEGER NOT IN (12, 24, 36, 60, 120) THEN
      RAISE EXCEPTION 'invalid_retention';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_platform_settings ON public.platform_settings;
CREATE TRIGGER trg_check_platform_settings
  BEFORE INSERT OR UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public._check_platform_settings();

-- Plazo vigente (para mostrarlo a los admins de cada barbería)
CREATE OR REPLACE FUNCTION public.get_audit_retention_months()
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT (value)::TEXT::INTEGER FROM platform_settings WHERE key = 'audit_retention_months'), 36)
$$;
REVOKE ALL ON FUNCTION public.get_audit_retention_months() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_audit_retention_months() TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs (created_at);

-- Borrado de lo vencido, por tandas (máx. p_batch filas por llamada)
CREATE OR REPLACE FUNCTION public.purge_audit_logs(p_batch INTEGER DEFAULT 5000)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_months  INTEGER := public.get_audit_retention_months();
  v_cutoff  TIMESTAMPTZ;
  v_deleted INTEGER;
BEGIN
  IF v_months IS NULL OR v_months < 12 THEN v_months := 36; END IF;
  v_cutoff := now() - make_interval(months => v_months);

  DELETE FROM audit_logs
   WHERE id IN (SELECT id FROM audit_logs WHERE created_at < v_cutoff
                 ORDER BY created_at LIMIT GREATEST(LEAST(COALESCE(p_batch, 5000), 50000), 1));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('retention_months', v_months, 'cutoff', v_cutoff, 'deleted', v_deleted);
END;
$$;
REVOKE ALL ON FUNCTION public.purge_audit_logs(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_audit_logs(INTEGER) TO service_role;
