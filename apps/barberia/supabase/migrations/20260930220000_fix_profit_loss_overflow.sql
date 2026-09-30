-- ============================================================
-- 20260930220000_fix_profit_loss_overflow.sql — Estado de resultados: sin desbordes
--
-- Al repartir el descuento de una venta por línea se multiplicaban dos
-- enteros (precio de la línea × subtotal): con ventas de servicio + producto
-- el resultado pasa de 2.147 millones y la función fallaba con
-- "integer out of range" (Contabilidad, Gastos y Reportes). Se hace en NUMERIC.
-- ============================================================

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
  v_depr       INTEGER := 0;
  v_disposals  INTEGER := 0;
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
                THEN si.total_price::NUMERIC * GREATEST(s.subtotal - COALESCE(s.discount_amount, 0), 0) / s.subtotal
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

  -- Costo de productos vendidos: salidas por venta menos devoluciones por anulación
  SELECT GREATEST(COALESCE(ROUND(SUM(-m.quantity * COALESCE(i.unit_cost, 0))), 0), 0)::INTEGER
    INTO v_cogs
    FROM inventory_movements m
    JOIN inventory_items i ON i.id = m.item_id
   WHERE m.business_id = p_business_id
     AND m.movement_type = 'sale'
     AND m.created_at >= v_start AND m.created_at < v_end;

  -- Comisiones reales (por fecha de la venta), menos las revertidas por anulación
  SELECT COALESCE(SUM(CASE WHEN l.entry_type = 'commission' THEN l.amount ELSE -l.amount END), 0)::INTEGER
    INTO v_comm
    FROM staff_ledger l
    JOIN sales s ON s.id = l.sale_id
   WHERE l.business_id = p_business_id
     AND (l.entry_type = 'commission'
          OR (l.entry_type = 'deduction' AND l.notes LIKE 'Anulación de venta%' AND l.reference_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM staff_ledger c WHERE c.id = l.reference_id AND c.entry_type = 'commission')))
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
  -- Desgaste de equipos (depreciación) del período: valor al inicio − valor al final
  SELECT COALESCE(SUM(
           public._asset_value_on(a, p_date_from) - public._asset_value_on(a, p_date_to + 1)
         ), 0)::INTEGER
    INTO v_depr
    FROM fixed_assets a
   WHERE a.business_id = p_business_id
     AND a.purchase_date <= p_date_to
     AND (a.disposed_at IS NULL OR a.disposed_at >= p_date_from)
     AND (a.is_active OR a.disposed_at IS NOT NULL);

  -- Resultado de dar de baja equipos: lo que se recibió − lo que valían
  SELECT COALESCE(SUM(COALESCE(disposal_price, 0) - COALESCE(book_value_at_disposal, 0)), 0)::INTEGER
    INTO v_disposals
    FROM fixed_assets
   WHERE business_id = p_business_id
     AND disposed_at BETWEEN p_date_from AND p_date_to;

  v_net   := v_gross - v_comm - v_expenses - v_depr + v_disposals;   -- utilidad neta

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
    'depreciation',      v_depr,
    'asset_disposals',   v_disposals,
    'net_profit',        v_net,
    'margin_pct',        CASE WHEN v_revenue > 0 THEN ROUND(v_net * 100.0 / v_revenue, 1) ELSE NULL END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_profit_loss(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profit_loss(UUID, DATE, DATE) TO authenticated;
