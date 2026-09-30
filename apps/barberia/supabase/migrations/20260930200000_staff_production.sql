-- ============================================================
-- 20260930200000_staff_production.sql — Contabilidad: por profesional
--
-- get_staff_production(desde, hasta): por cada profesional del negocio
--   - Produjo: servicios y productos vendidos (descuento repartido por línea),
--     cuántos servicios hizo. Ventas anuladas no cuentan. Fecha de la venta.
--   - Ganó: comisiones y propinas (por fecha de la venta, menos las revertidas
--     por anulación), bonos y descuentos manuales (por fecha del registro).
--   - Se le pagó: anticipos y pagos del período.
--   - Saldo pendiente HOY (todo el historial).
-- Solo admin; el negocio sale de la sesión. Fechas de Colombia.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_staff_production(p_date_from DATE, p_date_to DATE)
RETURNS TABLE (
  staff_id          UUID,
  full_name         TEXT,
  is_active         BOOLEAN,
  services_count    INTEGER,
  services_revenue  INTEGER,
  products_revenue  INTEGER,
  commissions       INTEGER,
  tips              INTEGER,
  bonuses           INTEGER,
  deductions        INTEGER,
  advances          INTEGER,
  payments          INTEGER,
  balance_now       INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bid   UUID;
  v_start TIMESTAMPTZ;
  v_end   TIMESTAMPTZ;
BEGIN
  BEGIN
    v_bid := (auth.jwt() -> 'app_metadata' ->> 'business_id')::UUID;
  EXCEPTION WHEN OTHERS THEN v_bid := NULL;
  END;
  IF v_bid IS NULL OR NOT public._is_business_admin(v_bid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from OR p_date_to - p_date_from > 400 THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  v_start := p_date_from::TIMESTAMP AT TIME ZONE 'America/Bogota';
  v_end   := (p_date_to + 1)::TIMESTAMP AT TIME ZONE 'America/Bogota';

  RETURN QUERY
  WITH prod AS (
    SELECT si.staff_id AS sid,
           COUNT(*) FILTER (WHERE si.item_type = 'service')::INTEGER AS svc_cnt,
           COALESCE(ROUND(SUM(CASE WHEN si.item_type = 'service' THEN
             CASE WHEN COALESCE(s.subtotal, 0) > 0
                  THEN si.total_price::NUMERIC * GREATEST(s.subtotal - COALESCE(s.discount_amount, 0), 0) / s.subtotal
                  ELSE 0 END END)), 0)::INTEGER AS svc_rev,
           COALESCE(ROUND(SUM(CASE WHEN si.item_type <> 'service' THEN
             CASE WHEN COALESCE(s.subtotal, 0) > 0
                  THEN si.total_price::NUMERIC * GREATEST(s.subtotal - COALESCE(s.discount_amount, 0), 0) / s.subtotal
                  ELSE 0 END END)), 0)::INTEGER AS prd_rev
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
     WHERE s.business_id = v_bid AND si.staff_id IS NOT NULL
       AND s.status IN ('paid', 'completed')
       AND s.created_at >= v_start AND s.created_at < v_end
     GROUP BY si.staff_id
  ),
  led AS (
    SELECT l.id AS lid, l.staff_id AS sid, l.entry_type, l.amount, l.notes, l.reference_id,
           l.created_at, COALESCE(sa.created_at, l.created_at) AS sale_at
      FROM staff_ledger l
      LEFT JOIN sales sa ON sa.id = l.sale_id
     WHERE l.business_id = v_bid
  ),
  -- Reversiones por anulación: cuentan contra la comisión/propina original (fecha de su venta)
  rev AS (
    SELECT d.sid, o.entry_type AS orig_type, d.amount, o.sale_at
      FROM led d
      JOIN led o ON o.lid = d.reference_id AND o.entry_type IN ('commission', 'tip')
     WHERE d.entry_type = 'deduction' AND COALESCE(d.notes, '') LIKE 'Anulación de venta%'
  ),
  earn AS (
    SELECT l.sid,
           COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'commission' AND l.sale_at >= v_start AND l.sale_at < v_end), 0) AS comm,
           COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'tip'        AND l.sale_at >= v_start AND l.sale_at < v_end), 0) AS tip,
           COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'bonus'      AND l.created_at >= v_start AND l.created_at < v_end), 0) AS bon,
           COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'deduction'  AND COALESCE(l.notes, '') NOT LIKE 'Anulación de venta%'
                                                AND l.created_at >= v_start AND l.created_at < v_end), 0) AS ded,
           COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'advance'    AND l.created_at >= v_start AND l.created_at < v_end), 0) AS adv,
           COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'payment'    AND l.created_at >= v_start AND l.created_at < v_end), 0) AS pay,
           COALESCE(SUM(CASE WHEN l.entry_type IN ('commission', 'tip', 'bonus') THEN l.amount
                             WHEN l.entry_type IN ('advance', 'payment', 'deduction') THEN -l.amount ELSE 0 END), 0) AS bal
      FROM led l
     GROUP BY l.sid
  ),
  revsum AS (
    SELECT r.sid,
           COALESCE(SUM(r.amount) FILTER (WHERE r.orig_type = 'commission'), 0) AS comm_rev,
           COALESCE(SUM(r.amount) FILTER (WHERE r.orig_type = 'tip'), 0)        AS tip_rev
      FROM rev r
     WHERE r.sale_at >= v_start AND r.sale_at < v_end
     GROUP BY r.sid
  )
  SELECT st.id, st.full_name::TEXT, st.is_active,
         COALESCE(p.svc_cnt, 0),
         COALESCE(p.svc_rev, 0),
         COALESCE(p.prd_rev, 0),
         GREATEST(COALESCE(e.comm, 0) - COALESCE(rs.comm_rev, 0), 0)::INTEGER,
         GREATEST(COALESCE(e.tip, 0)  - COALESCE(rs.tip_rev, 0), 0)::INTEGER,
         COALESCE(e.bon, 0)::INTEGER,
         COALESCE(e.ded, 0)::INTEGER,
         COALESCE(e.adv, 0)::INTEGER,
         COALESCE(e.pay, 0)::INTEGER,
         COALESCE(e.bal, 0)::INTEGER
    FROM staff st
    LEFT JOIN prod   p  ON p.sid  = st.id
    LEFT JOIN earn   e  ON e.sid  = st.id
    LEFT JOIN revsum rs ON rs.sid = st.id
   WHERE st.business_id = v_bid
     AND (st.is_active OR p.sid IS NOT NULL OR COALESCE(e.bal, 0) <> 0
          OR COALESCE(e.adv, 0) + COALESCE(e.pay, 0) + COALESCE(e.bon, 0) + COALESCE(e.ded, 0) > 0)
   ORDER BY COALESCE(p.svc_rev, 0) + COALESCE(p.prd_rev, 0) DESC, st.full_name;
END;
$$;
REVOKE ALL ON FUNCTION public.get_staff_production(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_production(DATE, DATE) TO authenticated;
