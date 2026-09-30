-- ============================================================
-- 20260929240000_expense_categories.sql — Categorías de gasto por barbería
--                                          + gastos fijos registrados solos
--
-- 1. expense_categories: cada negocio tiene sus categorías (arranca con las
--    8 por defecto, que la app crea la primera vez). Se pueden crear,
--    renombrar y ocultar; no se borran si tienen gastos (historial/reportes).
--    expenses.category guarda el slug de la categoría.
-- 2. expenses.auto_registered: el cron diario registra el gasto fijo el día
--    que le toca (mismo día del mes) y lo marca así.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  slug        TEXT        NOT NULL CHECK (slug ~ '^[a-z0-9_]{2,40}$'),
  name        TEXT        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 40),
  color       TEXT        CHECK (color IS NULL OR char_length(color) <= 20),
  is_hidden   BOOLEAN     NOT NULL DEFAULT FALSE,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, slug)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_categories_name
  ON public.expense_categories (business_id, lower(btrim(name)));

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant manages expense categories" ON public.expense_categories;
CREATE POLICY "tenant manages expense categories"
  ON public.expense_categories FOR ALL
  TO authenticated
  USING      (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'))
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'));

REVOKE ALL ON public.expense_categories FROM anon;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS auto_registered BOOLEAN NOT NULL DEFAULT FALSE;
