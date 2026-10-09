-- ============================================================
-- 20261008110000_db_advisors_cleanup.sql — Avisos de los Advisors de Supabase (rendimiento)
--
-- 1. auth_rls_initplan (63 policies): auth.uid() / auth.jwt() sin envolver se evalúan UNA VEZ POR FILA.
--    Se reescriben como (select auth.uid()) / (select auth.jwt()), que Postgres evalúa una vez por consulta.
--    Es semánticamente idéntico (ambas funciones son estables dentro de la sentencia): la RLS no cambia.
--    Se usa ALTER POLICY, que conserva nombre, roles, comando y tipo (permissive) de cada policy.
--    El bloque es atómico: si algo falla, o si queda alguna llamada sin envolver, no se aplica nada.
-- 2. Índices duplicados: se elimina la copia más vieja (mismas columnas, misma unicidad).
-- 3. Llaves foráneas sin índice: índice en las columnas que usan las pantallas y los borrados en cascada
--    (se omiten las columnas de auditoría created_by / closed_by / …, que nunca se filtran).
-- 4. _bogota_today(): search_path fijo.
-- ============================================================

-- ── 1. RLS: evaluar auth.*() una vez por consulta ────────────────────────────
DO $$
DECLARE
  r          RECORD;
  v_qual     TEXT;
  v_check    TEXT;
  v_sql      TEXT;
  v_changed  INTEGER := 0;
  v_left     INTEGER;
  -- (SELECT auth.uid() AS uid) — forma ya envuelta, tal como la devuelve pg_policies
  c_wrapped  CONSTANT TEXT := '\(\s*SELECT\s+auth\.(uid|jwt|role)\(\)\s+AS\s+[a-z_]+\)';
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''), c_wrapped, '', 'gi')
          ~* 'auth\.(uid|jwt|role)\(\)'
  LOOP
    -- Marca las ya envueltas, envuelve las sueltas y restaura las marcadas
    v_qual  := r.qual;
    v_check := r.with_check;
    IF v_qual IS NOT NULL THEN
      v_qual := regexp_replace(v_qual, c_wrapped, '@@WRAP_\1@@', 'gi');
      v_qual := regexp_replace(v_qual, 'auth\.(uid|jwt|role)\(\)', '(select auth.\1())', 'g');
      v_qual := regexp_replace(v_qual, '@@WRAP_(uid|jwt|role)@@', '(select auth.\1())', 'g');
    END IF;
    IF v_check IS NOT NULL THEN
      v_check := regexp_replace(v_check, c_wrapped, '@@WRAP_\1@@', 'gi');
      v_check := regexp_replace(v_check, 'auth\.(uid|jwt|role)\(\)', '(select auth.\1())', 'g');
      v_check := regexp_replace(v_check, '@@WRAP_(uid|jwt|role)@@', '(select auth.\1())', 'g');
    END IF;

    v_sql := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF v_qual  IS NOT NULL THEN v_sql := v_sql || ' USING (' || v_qual || ')'; END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || ' WITH CHECK (' || v_check || ')'; END IF;
    EXECUTE v_sql;
    v_changed := v_changed + 1;
  END LOOP;

  -- Verificación: no debe quedar ninguna llamada sin envolver
  SELECT count(*) INTO v_left
  FROM pg_policies
  WHERE schemaname = 'public'
    AND regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''), c_wrapped, '', 'gi')
        ~* 'auth\.(uid|jwt|role)\(\)';
  IF v_left > 0 THEN
    RAISE EXCEPTION 'Quedaron % policies sin envolver; no se aplicó ningún cambio', v_left;
  END IF;

  RAISE NOTICE 'Policies optimizadas: %', v_changed;
END $$;

-- ── 2. Índices duplicados ────────────────────────────────────────────────────
-- uq_commission_rules_scope (20260929) es idéntico a este (20260523): misma expresión y unicidad.
DROP INDEX IF EXISTS public.uq_commission_rules_business_staff_service;
-- mp_payment_id ya tiene el índice único de su restricción UNIQUE (mp_payments_mp_payment_id_key).
DROP INDEX IF EXISTS public.idx_mp_payments_mp_payment_id;

-- ── 3. Índices para llaves foráneas ──────────────────────────────────────────
DO $$
DECLARE
  r       RECORD;
  v_name  TEXT;
  v_n     INTEGER := 0;
BEGIN
  FOR r IN
    SELECT con.conrelid::regclass AS tbl,
           c.relname              AS tname,
           (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord)
              FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS cols,
           (SELECT string_agg(a.attname, '_' ORDER BY k.ord)
              FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS colnames
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    WHERE con.contype = 'f'
      AND con.connamespace = 'public'::regnamespace
      AND c.relname NOT LIKE '\_%'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = con.conrelid
          AND (SELECT array_agg(k ORDER BY k) FROM unnest((string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(con.conkey)]) k)
            = (SELECT array_agg(k ORDER BY k) FROM unnest(con.conkey) k)
      )
      -- Columnas de auditoría: solo se escriben, no se consultan
      AND NOT EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
          AND a.attname IN ('created_by','closed_by','opened_by','voided_by','resolved_by','requested_by','actor_id')
      )
  LOOP
    v_name := left('idx_' || r.tname || '_' || r.colnames || '_fk', 63);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%s)', v_name, r.tbl, r.cols);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'Índices de llaves foráneas creados: %', v_n;
END $$;

-- ── 4. search_path fijo ──────────────────────────────────────────────────────
ALTER FUNCTION public._bogota_today() SET search_path = public;

-- ── Resultado ────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                         '\(\s*SELECT\s+auth\.(uid|jwt|role)\(\)\s+AS\s+[a-z_]+\)', '', 'gi')
          ~* 'auth\.(uid|jwt|role)\(\)')                                   AS policies_sin_optimizar,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx\_%\_fk') AS indices_fk,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
     AND indexname IN ('uq_commission_rules_business_staff_service','idx_mp_payments_mp_payment_id')) AS duplicados_restantes;
