-- ============================================================
-- 20260929230000_expenses_pnl.sql — Gastos y estado de resultados real
--
-- 1. expenses: cómo se pagó (payment_method) y, si fue efectivo de la caja,
--    el turno (shift_id) → se resta del efectivo esperado al cerrar caja.
--    updated_at para ediciones.
-- 2. get_profit_loss v2:
--    - Solo admin del propio negocio (antes: cualquier business_id).
--    - Fechas en hora Colombia (antes: UTC → ventas nocturnas en el día siguiente).
--    - Ingresos = servicios + productos (sin propinas: son del profesional),
--      con el descuento repartido proporcionalmente.
--    - Costo de productos vendidos = movimientos 'sale' × unit_cost del inventario.
--    - Comisiones = las REALES registradas en staff_ledger (por fecha de venta).
--    - Utilidad = ingresos − costo de productos − comisiones − gastos.
-- ============================================================

-- ── 1. expenses ──────────────────────────────────────────────────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'transfer'
    CHECK (payment_method IN ('cash_register', 'transfer', 'card', 'other')),
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.cash_register_shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_expenses_shift ON public.expenses (shift_id) WHERE shift_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON public.expenses;
CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

-- ── 2. get_profit_loss v2 (misma firma y forma de respuesta + campos nuevos) ──
CREATE OR REPLACE FUNCTION public.get_profit_loss(
  p_business_id UUID,
  p_date_from   DATE,
  p_date_to     DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start      TIMESTAMPTZ;
  v_end        TIMESTAMPTZ;
  v_services   INTEGER := 0;
  v_retail     INTEGER := 0;
  v_discounts  INTEGER := 0;
  v_revenue    INTEGER := 0;
  v_tips       INTEGER := 0;
  v_cogs       INTEGER := 0;
  v_comm       INTEGER := 0;
  v_expenses   INTEGER := 0;
  v_by_cat     JSONB   := '[]'::JSONB;
  v_gross      INTEGER := 0;
  v_net        INTEGER := 0;
  v_sales_cnt  INTEGER := 0;
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  IF NOT COALESCE(
       (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
    OR EXISTS (SELECT 1 FROM profiles p
                WHERE p.id = auth.uid() AND p.business_id = p_business_id
                  AND p.role IN ('admin', 'super_admin')),
    FALSE
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  -- Días locales de Colombia → instantes reales
  v_start := p_date_from::TIMESTAMP AT TIME ZONE 'America/Bogota';
  v_end   := (p_date_to + 1)::TIMESTAMP AT TIME ZONE 'America/Bogota';

  -- Ingresos por tipo, con el descuento de cada venta repartido por línea
  WITH s AS (
    SELECT id, subtotal, discount_amount, tip_amount
      FROM sales
     WHERE business_id = p_business_id AND status = 'paid'
       AND created_at >= v_start AND created_at < v_end
  ), lines AS (
    SELECT si.item_type,
           si.total_price,
           CASE WHEN COALESCE(s.subtotal, 0) > 0
                THEN si.total_price * GREATEST(s.subtotal - COALESCE(s.discount_amount, 0), 0) / s.subtotal
                ELSE 0 END AS net_price
      FROM sale_items si JOIN s ON s.id = si.sale_id
  )
  SELECT COALESCE(ROUND(SUM(net_price) FILTER (WHERE item_type = 'service')), 0)::INTEGER,
         COALESCE(ROUND(SUM(net_price) FILTER (WHERE item_type <> 'service')), 0)::INTEGER,
         COALESCE(ROUND(SUM(total_price - net_price)), 0)::INTEGER
    INTO v_services, v_retail, v_discounts
    FROM lines;

  SELECT COALESCE(ROUND(SUM(tip_amount)), 0)::INTEGER, COUNT(*)
    INTO v_tips, v_sales_cnt
    FROM sales
   WHERE business_id = p_business_id AND status = 'paid'
     AND created_at >= v_start AND created_at < v_end;

  v_revenue := v_services + v_retail;

  -- Costo de productos vendidos (salidas por venta × costo del producto)
  SELECT COALESCE(ROUND(SUM(ABS(m.quantity) * COALESCE(i.unit_cost, 0))), 0)::INTEGER
    INTO v_cogs
    FROM inventory_movements m
    JOIN inventory_items i ON i.id = m.item_id
   WHERE m.business_id = p_business_id
     AND m.movement_type = 'sale'
     AND m.quantity < 0
     AND m.created_at >= v_start AND m.created_at < v_end;

  -- Comisiones reales (por fecha de la venta)
  SELECT COALESCE(SUM(l.amount), 0)::INTEGER
    INTO v_comm
    FROM staff_ledger l
    JOIN sales s ON s.id = l.sale_id
   WHERE l.business_id = p_business_id
     AND l.entry_type = 'commission'
     AND s.created_at >= v_start AND s.created_at < v_end;

  -- Gastos (expense_date ya es fecha local)
  SELECT COALESCE(SUM(amount), 0)::INTEGER
    INTO v_expenses
    FROM expenses
   WHERE business_id = p_business_id
     AND expense_date BETWEEN p_date_from AND p_date_to;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'total', cat_total)
                            ORDER BY cat_total DESC), '[]'::JSONB)
    INTO v_by_cat
    FROM (
      SELECT category, SUM(amount)::INTEGER AS cat_total
        FROM expenses
       WHERE business_id = p_business_id
         AND expense_date BETWEEN p_date_from AND p_date_to
       GROUP BY category
    ) g;

  v_gross := v_revenue - v_cogs;                       -- utilidad bruta
  v_net   := v_gross - v_comm - v_expenses;            -- utilidad neta

  RETURN jsonb_build_object(
    'revenue', jsonb_build_object(
      'services',  v_services,
      'retail',    v_retail,
      'total',     v_revenue,
      'discounts', v_discounts,
      'sales_count', v_sales_cnt
    ),
    'tips',              v_tips,
    'cost_of_goods',     v_cogs,
    'expenses', jsonb_build_object(
      'total',       v_expenses,
      'by_category', v_by_cat
    ),
    'gross_profit',      v_gross,
    'commissions',       v_comm,
    'net_profit',        v_net,
    'margin_pct',        CASE WHEN v_revenue > 0 THEN ROUND(v_net * 100.0 / v_revenue, 1) ELSE NULL END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_profit_loss(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profit_loss(UUID, DATE, DATE) TO authenticated;
