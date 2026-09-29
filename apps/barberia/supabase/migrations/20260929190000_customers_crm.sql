-- ============================================================
-- 20260929190000_customers_crm.sql — Clientes (CRM)
--
-- 1. customers.updated_at (el código lo usaba y no existía → la página no
--    cargaba) + birthday. Trigger que mantiene updated_at.
-- 2. customer_notes: autor = usuario (created_by + author_name). staff_id
--    exigía un barbero y un admin sin ficha de barbero no podía anotar.
-- 3. list_customers: lista con búsqueda, filtros y orden, con métricas REALES
--    (gasto = ventas pagadas, no precio de lista). SECURITY INVOKER → RLS.
--
-- Convención horaria: appointments.start_time = hora LOCAL como UTC.
-- ============================================================

-- ── 1. customers ─────────────────────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS birthday   DATE;

CREATE OR REPLACE FUNCTION public._set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_updated_at ON public.customers;
CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

-- ── 2. customer_notes: autor ─────────────────────────────────────────────────
ALTER TABLE public.customer_notes
  ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS author_name TEXT CHECK (author_name IS NULL OR char_length(author_name) <= 120);

-- ── 3. list_customers ────────────────────────────────────────────────────────
-- p_filter: all | frequent (3+ visitas en 90 días) | inactive (última visita
--           hace > 30 días) | new (creados este mes) | birthday (cumple este mes)
-- p_sort:   recent (última visita) | spent (gasto) | name | created
CREATE OR REPLACE FUNCTION public.list_customers(
  p_business_id UUID,
  p_query       TEXT    DEFAULT NULL,
  p_filter      TEXT    DEFAULT 'all',
  p_sort        TEXT    DEFAULT 'recent',
  p_limit       INTEGER DEFAULT 30,
  p_offset      INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH now_l AS (
    SELECT (NOW() AT TIME ZONE 'America/Bogota') AS local_ts,
           ((NOW() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'UTC') AS wall_utc
  ),
  base AS (
    SELECT c.*
      FROM customers c
     WHERE c.business_id = p_business_id
       AND (
         COALESCE(TRIM(p_query), '') = ''
         OR c.full_name ILIKE '%' || TRIM(p_query) || '%'
         OR c.phone     ILIKE '%' || TRIM(p_query) || '%'
         OR c.email     ILIKE '%' || TRIM(p_query) || '%'
       )
  ),
  stats AS (
    SELECT b.id,
      (SELECT COUNT(*) FROM appointments a
        WHERE a.customer_id = b.id AND a.status = 'completed')                         AS visits,
      (SELECT COUNT(*) FROM appointments a, now_l n
        WHERE a.customer_id = b.id AND a.status = 'completed'
          AND a.start_time >= n.wall_utc - INTERVAL '90 days')                         AS visits_90d,
      (SELECT MAX(a.start_time) FROM appointments a
        WHERE a.customer_id = b.id AND a.status = 'completed')                         AS last_visit,
      (SELECT MIN(a.start_time) FROM appointments a, now_l n
        WHERE a.customer_id = b.id
          AND a.status IN ('payment_pending', 'scheduled')
          AND a.start_time >= n.wall_utc)                                              AS next_appointment,
      (SELECT COALESCE(SUM(s.total_amount), 0) FROM sales s
        WHERE s.customer_id = b.id AND s.status = 'paid')                              AS total_spent,
      (SELECT COALESCE(array_agg(t.tag ORDER BY t.tag), '{}') FROM customer_tags t
        WHERE t.customer_id = b.id)                                                    AS tags
    FROM base b
  ),
  filtered AS (
    SELECT b.*, s.visits, s.visits_90d, s.last_visit, s.next_appointment, s.total_spent, s.tags
      FROM base b
      JOIN stats s ON s.id = b.id
      CROSS JOIN now_l n
     WHERE CASE COALESCE(p_filter, 'all')
             WHEN 'frequent' THEN s.visits_90d >= 3
             WHEN 'inactive' THEN s.last_visit IS NOT NULL AND s.last_visit < n.wall_utc - INTERVAL '30 days'
                                  AND s.next_appointment IS NULL
             WHEN 'new'      THEN b.created_at >= date_trunc('month', n.local_ts) AT TIME ZONE 'America/Bogota'
             WHEN 'birthday' THEN b.birthday IS NOT NULL
                                  AND EXTRACT(MONTH FROM b.birthday) = EXTRACT(MONTH FROM n.local_ts)
             ELSE TRUE
           END
  )
  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*) FROM filtered),
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.ord)
        FROM (
          SELECT f.id, f.full_name, f.phone, f.email, f.birthday, f.preferred_staff_id, f.created_at,
                 f.visits, f.last_visit, f.next_appointment, f.total_spent, f.tags,
                 ROW_NUMBER() OVER (ORDER BY
                   CASE WHEN p_sort = 'spent'   THEN f.total_spent END DESC NULLS LAST,
                   CASE WHEN p_sort = 'name'    THEN f.full_name   END ASC,
                   CASE WHEN p_sort = 'created' THEN f.created_at  END DESC,
                   f.last_visit DESC NULLS LAST,
                   f.updated_at DESC
                 ) AS ord
            FROM filtered f
           ORDER BY ord
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100)
          OFFSET GREATEST(COALESCE(p_offset, 0), 0)
        ) p
    ), '[]'::JSONB)
  )
$$;
REVOKE ALL ON FUNCTION public.list_customers(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_customers(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
