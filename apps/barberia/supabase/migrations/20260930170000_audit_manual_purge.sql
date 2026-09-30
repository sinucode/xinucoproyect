-- ============================================================
-- 20260930170000_audit_manual_purge.sql — Borrado manual de auditoría (super_admin)
--
-- - count_audit_logs_before(fecha, negocio?): cuántos registros hay antes de
--   esa fecha (para el mensaje de advertencia).
-- - purge_audit_logs_before(fecha, negocio?): borra los registros anteriores a
--   las 00:00 (hora Colombia) de esa fecha, de un negocio o de todos.
--   Solo super_admin. La fecha no puede ser futura.
--   Deja constancia en cada negocio afectado: "Soporte Xinuco borró N
--   registros anteriores al DD/MM/AAAA" (esa constancia no se borra aquí).
-- ============================================================

CREATE OR REPLACE FUNCTION public._assert_super_admin()
RETURNS VOID LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF NOT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._assert_super_admin() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._audit_purge_cutoff(p_before DATE)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF p_before IS NULL OR p_before > (now() AT TIME ZONE 'America/Bogota')::DATE THEN
    RAISE EXCEPTION 'invalid_date';
  END IF;
  RETURN p_before::TIMESTAMP AT TIME ZONE 'America/Bogota';
END;
$$;
REVOKE ALL ON FUNCTION public._audit_purge_cutoff(DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.count_audit_logs_before(p_before DATE, p_business_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cutoff TIMESTAMPTZ;
BEGIN
  PERFORM public._assert_super_admin();
  v_cutoff := public._audit_purge_cutoff(p_before);
  RETURN (SELECT COUNT(*) FROM audit_logs
           WHERE created_at < v_cutoff
             AND (p_business_id IS NULL OR business_id = p_business_id));
END;
$$;
REVOKE ALL ON FUNCTION public.count_audit_logs_before(DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_audit_logs_before(DATE, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.purge_audit_logs_before(p_before DATE, p_business_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_total  INTEGER := 0;
  v_n      INTEGER;
  r        RECORD;
BEGIN
  PERFORM public._assert_super_admin();
  v_cutoff := public._audit_purge_cutoff(p_before);

  FOR r IN
    SELECT business_id FROM audit_logs
     WHERE created_at < v_cutoff
       AND (p_business_id IS NULL OR business_id = p_business_id)
     GROUP BY business_id
  LOOP
    DELETE FROM audit_logs WHERE business_id = r.business_id AND created_at < v_cutoff;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    CONTINUE WHEN v_n = 0;
    v_total := v_total + v_n;
    INSERT INTO audit_logs (business_id, actor_id, actor_name, action, entity_type, entity_id,
                            new_value, category, summary, severity, amount)
    VALUES (r.business_id, auth.uid(), 'Soporte Xinuco', 'audit.purged', 'audit_logs', NULL,
            jsonb_build_object('borrados', v_n, 'antes_de', to_char(p_before, 'YYYY-MM-DD')),
            'settings',
            'borró ' || v_n || CASE WHEN v_n = 1 THEN ' registro' ELSE ' registros' END
              || ' de auditoría anteriores al ' || to_char(p_before, 'DD/MM/YYYY'),
            'warning', NULL);
  END LOOP;

  RETURN jsonb_build_object('deleted', v_total, 'before', p_before, 'business_id', p_business_id);
END;
$$;
REVOKE ALL ON FUNCTION public.purge_audit_logs_before(DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_audit_logs_before(DATE, UUID) TO authenticated;
