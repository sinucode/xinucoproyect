-- ============================================================
-- 20260930140000_inventory_purchases_counts.sql — Inventario: compras con costo,
-- conteo físico, mermas y compras pagadas con la caja
--
-- 1. inventory_movements: costo unitario/total, proveedor, cómo se pagó y turno.
-- 2. record_stock_movement (solo admin):
--      purchase → suma stock, actualiza el COSTO PROMEDIO del producto, y si se
--                 pagó con efectivo de la caja queda ligado al turno abierto.
--      count    → "conté N": registra el ajuste por la diferencia (con motivo).
--      waste    → merma (vencido, dañado, uso interno) con motivo.
--    La compra NO es gasto: el costo se reconoce al vender (costo de lo vendido).
-- 3. Caja: las compras pagadas con efectivo se restan del efectivo esperado.
-- 4. record_inventory_movement: movimientos que no son venta, solo el admin.
-- ============================================================

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS unit_cost      INTEGER CHECK (unit_cost IS NULL OR unit_cost >= 0),
  ADD COLUMN IF NOT EXISTS total_cost     INTEGER CHECK (total_cost IS NULL OR total_cost >= 0),
  ADD COLUMN IF NOT EXISTS supplier       TEXT CHECK (supplier IS NULL OR char_length(supplier) <= 80),
  ADD COLUMN IF NOT EXISTS payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('cash_register', 'transfer', 'other')),
  ADD COLUMN IF NOT EXISTS shift_id       UUID REFERENCES public.cash_register_shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_shift ON public.inventory_movements (shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON public.inventory_movements (item_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_item_id        UUID,
  p_kind           TEXT,              -- 'purchase' | 'count' | 'waste'
  p_quantity       INTEGER,           -- purchase/waste: unidades; count: cantidad contada
  p_unit_cost      INTEGER DEFAULT NULL,
  p_supplier       TEXT    DEFAULT NULL,
  p_payment_method TEXT    DEFAULT NULL,
  p_notes          TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it       RECORD;
  v_delta  INTEGER;
  v_type   TEXT;
  v_cost   INTEGER;
  v_shift  UUID;
  v_notes  TEXT := NULLIF(LEFT(btrim(COALESCE(p_notes, '')), 200), '');
  v_new    INTEGER;
BEGIN
  SELECT id, business_id, name, current_stock, COALESCE(unit_cost, 0) AS unit_cost, is_active
    INTO it FROM inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found'; END IF;
  PERFORM public._assert_business_access(it.business_id);
  IF NOT public._is_business_admin(it.business_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT it.is_active THEN RAISE EXCEPTION 'item_inactive'; END IF;
  IF p_quantity IS NULL OR p_quantity < 0 OR p_quantity > 100000 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;

  IF p_kind = 'purchase' THEN
    IF p_quantity = 0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
    IF p_unit_cost IS NULL OR p_unit_cost < 0 OR p_unit_cost > 10000000 THEN RAISE EXCEPTION 'invalid_cost'; END IF;
    IF COALESCE(p_payment_method, 'transfer') NOT IN ('cash_register', 'transfer', 'other') THEN
      RAISE EXCEPTION 'invalid_payment_method';
    END IF;
    IF p_payment_method = 'cash_register' THEN
      SELECT id INTO v_shift FROM cash_register_shifts
       WHERE business_id = it.business_id AND status = 'open'
       ORDER BY opened_at DESC LIMIT 1;
      IF v_shift IS NULL THEN RAISE EXCEPTION 'shift_not_open'; END IF;
    END IF;
    v_delta := p_quantity;
    v_type  := 'purchase';
    -- Costo promedio ponderado (lo que ya había + lo que llega)
    v_cost  := CASE WHEN it.current_stock + p_quantity > 0
                    THEN ROUND((it.current_stock::NUMERIC * it.unit_cost + p_quantity::NUMERIC * p_unit_cost)
                               / (it.current_stock + p_quantity))::INTEGER
                    ELSE p_unit_cost END;
  ELSIF p_kind = 'count' THEN
    IF v_notes IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
    v_delta := p_quantity - it.current_stock;
    IF v_delta = 0 THEN RAISE EXCEPTION 'no_change'; END IF;
    v_type  := 'adjustment';
  ELSIF p_kind = 'waste' THEN
    IF v_notes IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
    IF p_quantity = 0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
    IF p_quantity > it.current_stock THEN RAISE EXCEPTION 'insufficient_stock'; END IF;
    v_delta := -p_quantity;
    v_type  := 'waste';
  ELSE
    RAISE EXCEPTION 'invalid_kind';
  END IF;

  v_new := it.current_stock + v_delta;

  UPDATE inventory_items
     SET current_stock = v_new,
         unit_cost     = CASE WHEN p_kind = 'purchase' THEN v_cost ELSE unit_cost END,
         updated_at    = NOW()
   WHERE id = it.id;

  INSERT INTO inventory_movements (business_id, item_id, quantity, movement_type, notes, created_by,
                                   unit_cost, total_cost, supplier, payment_method, shift_id)
  VALUES (it.business_id, it.id, v_delta, v_type,
          COALESCE(v_notes, CASE WHEN p_kind = 'purchase' THEN 'Compra' END),
          auth.uid(),
          CASE WHEN p_kind = 'purchase' THEN p_unit_cost ELSE it.unit_cost END,
          CASE WHEN p_kind = 'purchase' THEN p_unit_cost * p_quantity ELSE ABS(v_delta) * it.unit_cost END,
          CASE WHEN p_kind = 'purchase' THEN NULLIF(LEFT(btrim(COALESCE(p_supplier, '')), 80), '') END,
          CASE WHEN p_kind = 'purchase' THEN COALESCE(p_payment_method, 'transfer') END,
          v_shift);

  RETURN jsonb_build_object('item_id', it.id, 'new_stock', v_new, 'delta', v_delta,
                            'unit_cost', CASE WHEN p_kind = 'purchase' THEN v_cost ELSE it.unit_cost END);
END;
$$;
REVOKE ALL ON FUNCTION public.record_stock_movement(UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_movement(UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_shift_cash_summary(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business UUID;
BEGIN
  SELECT business_id INTO v_business FROM cash_register_shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public._assert_business_access(v_business);

  RETURN jsonb_build_object(
    'total_sales',
      (SELECT COALESCE(SUM(total_amount), 0) FROM sales
        WHERE shift_id = p_shift_id AND business_id = v_business AND status <> 'voided'),
    'cash_collected',
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
         JOIN sales s ON s.id = p.sale_id
        WHERE p.shift_id = p_shift_id AND p.business_id = v_business AND p.payment_method = 'cash'
          AND s.status <> 'voided'),
    'cash_expenses',
      (SELECT COALESCE(SUM(amount), 0) FROM expenses
        WHERE shift_id = p_shift_id AND business_id = v_business AND payment_method = 'cash_register'),
    'cash_team_payments',
      (SELECT COALESCE(SUM(amount), 0) FROM staff_ledger
        WHERE shift_id = p_shift_id AND business_id = v_business
          AND payment_method = 'cash_register' AND entry_type IN ('advance', 'payment')),
    'cash_inventory_purchases',
      (SELECT COALESCE(SUM(total_cost), 0) FROM inventory_movements
        WHERE shift_id = p_shift_id AND business_id = v_business
          AND payment_method = 'cash_register' AND movement_type = 'purchase')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_inventory_movement(
  p_business_id  UUID,
  p_item_id      UUID,
  p_quantity     INTEGER,
  p_type         TEXT,
  p_notes        TEXT     DEFAULT NULL,
  p_reference_id UUID     DEFAULT NULL,
  p_user_id      UUID     DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item      RECORD;
  v_new_stock INTEGER;
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  -- Solo las ventas las registra cualquier usuario del negocio (cobro); lo demás, el admin
  IF p_type <> 'sale' AND NOT public._is_business_admin(p_business_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT current_stock, min_stock, name INTO v_item
    FROM public.inventory_items
   WHERE id = p_item_id AND business_id = p_business_id AND is_active = TRUE
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Item not found or does not belong to this business');
  END IF;

  v_new_stock := v_item.current_stock + p_quantity;
  IF v_new_stock < 0 THEN
    RETURN json_build_object('error', 'Insufficient stock', 'current_stock', v_item.current_stock, 'requested', p_quantity);
  END IF;

  INSERT INTO public.inventory_movements (business_id, item_id, quantity, movement_type, reference_id, notes, created_by)
  VALUES (p_business_id, p_item_id, p_quantity, p_type, p_reference_id, p_notes, COALESCE(p_user_id, auth.uid()));

  UPDATE public.inventory_items SET current_stock = v_new_stock, updated_at = NOW()
   WHERE id = p_item_id AND business_id = p_business_id;

  RETURN json_build_object('item_id', p_item_id, 'new_stock', v_new_stock, 'low_stock_warn', v_new_stock <= v_item.min_stock);
END;
$$;
