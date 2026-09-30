-- ============================================================
-- 20260930230000_report_prev_period.sql — Reportes: período anterior comparable
--
-- Antes "Este mes" (1–30 sep) se comparaba con los 30 días previos (2–31 ago)
-- y "Este año" con los 273 días anteriores. Ahora:
--   mes vs mes anterior, trimestre vs trimestre anterior, año vs mismo período
--   del año pasado; un mes en curso contra los mismos días del mes anterior.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_management_report(p_date_from DATE, p_date_to DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bid        UUID;
  v_today      DATE := (NOW() AT TIME ZONE 'America/Bogota')::DATE;
  v_len        INTEGER;
  v_months     INTEGER;
  v_prev_from  DATE;
  v_prev_to    DATE;
  v_start      TIMESTAMPTZ;
  v_end        TIMESTAMPTZ;
  v_pstart     TIMESTAMPTZ;
  v_pend       TIMESTAMPTZ;
  v_cap_to     DATE;
  v_monthly    JSONB := '[]'::JSONB;
  v_m          DATE;
  v_m_to       DATE;
  v_pl         JSONB;
  v_result     JSONB;
BEGIN
  BEGIN
    v_bid := (auth.jwt() -> 'app_metadata' ->> 'business_id')::UUID;
  EXCEPTION WHEN OTHERS THEN v_bid := NULL;
  END;
  IF v_bid IS NULL OR NOT public._is_business_admin(v_bid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from OR p_date_to - p_date_from > 400 THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  -- Período anterior comparable:
  --   · empieza el 1 de enero y abarca más de 3 meses → mismas fechas del año pasado
  --   · empieza el día 1 → los mismos meses inmediatamente anteriores
  --     (si termina el último día del mes, el anterior también cierra en fin de mes;
  --      un mes en curso se compara contra los mismos días del mes anterior)
  --   · otro rango → los mismos días inmediatamente anteriores
  v_len    := p_date_to - p_date_from + 1;
  v_months := (EXTRACT(YEAR FROM p_date_to) * 12 + EXTRACT(MONTH FROM p_date_to))::INTEGER
            - (EXTRACT(YEAR FROM p_date_from) * 12 + EXTRACT(MONTH FROM p_date_from))::INTEGER + 1;
  IF EXTRACT(DAY FROM p_date_from) = 1 AND EXTRACT(MONTH FROM p_date_from) = 1 AND v_months > 3 THEN
    v_prev_from := (p_date_from - INTERVAL '1 year')::DATE;
    v_prev_to   := (p_date_to   - INTERVAL '1 year')::DATE;
  ELSIF EXTRACT(DAY FROM p_date_from) = 1 THEN
    v_prev_from := (p_date_from - make_interval(months => v_months))::DATE;
    IF p_date_to = (date_trunc('month', p_date_to) + INTERVAL '1 month - 1 day')::DATE THEN
      v_prev_to := (date_trunc('month', p_date_to - make_interval(months => v_months)) + INTERVAL '1 month - 1 day')::DATE;
    ELSE
      v_prev_to := (p_date_to - make_interval(months => v_months))::DATE;
    END IF;
  ELSE
    v_prev_to   := p_date_from - 1;
    v_prev_from := p_date_from - v_len;
  END IF;
  v_start     := p_date_from::TIMESTAMP AT TIME ZONE 'America/Bogota';
  v_end       := (p_date_to + 1)::TIMESTAMP AT TIME ZONE 'America/Bogota';
  v_pstart    := v_prev_from::TIMESTAMP AT TIME ZONE 'America/Bogota';
  v_pend      := (v_prev_to + 1)::TIMESTAMP AT TIME ZONE 'America/Bogota';
  v_cap_to    := LEAST(p_date_to, v_today);   -- la capacidad solo cuenta días ya vividos

  -- ── Últimos 12 meses ───────────────────────────────────────────────────────
  v_m := (date_trunc('month', p_date_to) - INTERVAL '11 months')::DATE;
  WHILE v_m <= p_date_to LOOP
    v_m_to := LEAST((v_m + INTERVAL '1 month' - INTERVAL '1 day')::DATE, v_today);
    IF v_m_to >= v_m THEN
      v_pl := public.get_profit_loss(v_bid, v_m, v_m_to);
      v_monthly := v_monthly || jsonb_build_object(
        'month',    to_char(v_m, 'YYYY-MM'),
        'revenue',  (v_pl -> 'revenue' ->> 'total')::INTEGER,
        'net',      (v_pl ->> 'net_profit')::INTEGER,
        'costs',    (v_pl -> 'revenue' ->> 'total')::INTEGER - (v_pl ->> 'net_profit')::INTEGER,
        'sales',    (v_pl -> 'revenue' ->> 'sales_count')::INTEGER
      );
    END IF;
    v_m := (v_m + INTERVAL '1 month')::DATE;
  END LOOP;

  WITH
  paid AS (
    SELECT s.* FROM sales s
     WHERE s.business_id = v_bid AND s.status IN ('paid', 'completed')
  ),
  k_cur AS (
    SELECT COUNT(*)::INTEGER AS sales_count,
           COUNT(DISTINCT customer_id)::INTEGER AS clients,
           (SELECT COUNT(*) FROM sale_items si JOIN paid p2 ON p2.id = si.sale_id
             WHERE si.item_type = 'service' AND p2.created_at >= v_start AND p2.created_at < v_end)::INTEGER AS services
      FROM paid WHERE created_at >= v_start AND created_at < v_end
  ),
  k_prev AS (
    SELECT COUNT(*)::INTEGER AS sales_count,
           COUNT(DISTINCT customer_id)::INTEGER AS clients,
           (SELECT COUNT(*) FROM sale_items si JOIN paid p2 ON p2.id = si.sale_id
             WHERE si.item_type = 'service' AND p2.created_at >= v_pstart AND p2.created_at < v_pend)::INTEGER AS services
      FROM paid WHERE created_at >= v_pstart AND created_at < v_pend
  ),
  -- Citas del período (hora de pared)
  appts AS (
    SELECT a.*, COALESCE(sv.duration_minutes, 30) AS dur, COALESCE(sv.price_cop, 0) AS price,
           (a.start_time AT TIME ZONE 'UTC') AS local_ts
      FROM appointments a
      LEFT JOIN services sv ON sv.id = a.service_id
     WHERE a.business_id = v_bid
       AND (a.start_time AT TIME ZONE 'UTC')::DATE BETWEEN p_date_from AND p_date_to
  ),
  leaks AS (
    SELECT
      (SELECT COUNT(*) FROM appts WHERE status = 'cancelled')::INTEGER                        AS cancelled_count,
      (SELECT COALESCE(SUM(price), 0) FROM appts WHERE status = 'cancelled')::INTEGER         AS cancelled_value,
      (SELECT COUNT(*) FROM appts WHERE status = 'no_show')::INTEGER                          AS no_show_count,
      (SELECT COALESCE(SUM(price), 0) FROM appts WHERE status = 'no_show')::INTEGER           AS no_show_value,
      (SELECT COUNT(*) FROM sales WHERE business_id = v_bid AND status = 'voided'
          AND created_at >= v_start AND created_at < v_end)::INTEGER                          AS voided_count,
      (SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE business_id = v_bid AND status = 'voided'
          AND created_at >= v_start AND created_at < v_end)::INTEGER                          AS voided_value,
      (SELECT COALESCE(SUM(COALESCE(total_cost, ABS(quantity) * COALESCE(unit_cost, 0))), 0) FROM inventory_movements
        WHERE business_id = v_bid AND movement_type = 'waste'
          AND created_at >= v_start AND created_at < v_end)::INTEGER                          AS waste_value,
      (SELECT COALESCE(SUM(GREATEST(public._shift_expected_cash(sh.id) - COALESCE(sh.actual_closing_balance, 0)::INTEGER, 0)), 0)
         FROM cash_register_shifts sh
        WHERE sh.business_id = v_bid AND sh.status = 'closed'
          AND sh.closed_at >= v_start AND sh.closed_at < v_end)::INTEGER                     AS cash_shortfall
  ),
  -- Días vividos del período por día de la semana (0 = domingo)
  days AS (
    SELECT EXTRACT(DOW FROM d)::INTEGER AS dow, COUNT(*)::INTEGER AS n
      FROM generate_series(p_date_from, v_cap_to, INTERVAL '1 day') d
     WHERE v_cap_to >= p_date_from
     GROUP BY 1
  ),
  heat AS (
    SELECT h.dow, h.hour,
           COUNT(a.id)::INTEGER AS appointments,
           COALESCE(SUM(LEAST(a.dur, 60)), 0)::INTEGER AS booked_minutes
      FROM (SELECT d.dow, gs AS hour FROM days d CROSS JOIN generate_series(6, 21) gs) h
      LEFT JOIN appts a
        ON EXTRACT(DOW FROM a.local_ts)::INTEGER = h.dow
       AND EXTRACT(HOUR FROM a.local_ts)::INTEGER = h.hour
       AND a.status NOT IN ('cancelled', 'no_show')
       AND a.local_ts::DATE <= v_cap_to
     GROUP BY h.dow, h.hour
  ),
  cap AS (
    -- Minutos de trabajo disponibles en cada día×hora (profesionales activos × días vividos)
    SELECT sc.day_of_week AS dow, gs AS hour,
           SUM(GREATEST(0, EXTRACT(EPOCH FROM (
                 LEAST(sc.end_time, make_time(gs, 0, 0) + INTERVAL '1 hour')
               - GREATEST(sc.start_time, make_time(gs, 0, 0)))) / 60) * COALESCE(d.n, 0))::INTEGER AS cap_minutes
      FROM staff_schedules sc
      JOIN staff st ON st.id = sc.staff_id AND st.is_active
      JOIN days d ON d.dow = sc.day_of_week
      CROSS JOIN generate_series(6, 21) gs
     WHERE sc.business_id = v_bid
     GROUP BY sc.day_of_week, gs
  ),
  staff_occ AS (
    SELECT st.id, st.full_name,
           COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (sc.end_time - sc.start_time)) / 60 * d.n)
                       FROM staff_schedules sc JOIN days d ON d.dow = sc.day_of_week
                      WHERE sc.staff_id = st.id), 0)::INTEGER AS scheduled_minutes,
           COALESCE((SELECT SUM(a.dur) FROM appts a
                      WHERE a.staff_id = st.id AND a.status NOT IN ('cancelled', 'no_show')
                        AND a.local_ts::DATE <= v_cap_to), 0)::INTEGER AS booked_minutes,
           COALESCE((SELECT ROUND(SUM(CASE WHEN COALESCE(p.subtotal, 0) > 0
                        THEN si.total_price::NUMERIC * GREATEST(p.subtotal - COALESCE(p.discount_amount, 0), 0) / p.subtotal
                        ELSE 0 END))
                       FROM sale_items si JOIN paid p ON p.id = si.sale_id
                      WHERE si.staff_id = st.id AND p.created_at >= v_start AND p.created_at < v_end), 0)::INTEGER AS produced,
           COALESCE((SELECT COUNT(*) FROM sale_items si JOIN paid p ON p.id = si.sale_id
                      WHERE si.staff_id = st.id AND si.item_type = 'service'
                        AND p.created_at >= v_start AND p.created_at < v_end), 0)::INTEGER AS services
      FROM staff st
     WHERE st.business_id = v_bid AND st.is_active
  ),
  lines AS (
    SELECT si.item_type, si.description, si.quantity,
           CASE WHEN COALESCE(p.subtotal, 0) > 0
                THEN si.total_price::NUMERIC * GREATEST(p.subtotal - COALESCE(p.discount_amount, 0), 0) / p.subtotal
                ELSE 0 END AS net
      FROM sale_items si JOIN paid p ON p.id = si.sale_id
     WHERE p.created_at >= v_start AND p.created_at < v_end
  ),
  svc AS (
    SELECT description AS name, COUNT(*)::INTEGER AS count, ROUND(SUM(net))::INTEGER AS revenue
      FROM lines WHERE item_type = 'service' GROUP BY description ORDER BY 3 DESC LIMIT 10
  ),
  prd AS (
    SELECT description AS name, SUM(quantity)::INTEGER AS count, ROUND(SUM(net))::INTEGER AS revenue
      FROM lines WHERE item_type <> 'service' GROUP BY description ORDER BY 3 DESC LIMIT 10
  ),
  -- Clientes: primera compra y compras por mes
  cust_sales AS (
    SELECT customer_id, (created_at AT TIME ZONE 'America/Bogota')::DATE AS d, total_amount - COALESCE(tip_amount, 0) AS spent
      FROM paid WHERE customer_id IS NOT NULL
  ),
  first_sale AS (
    SELECT customer_id, MIN(d) AS first_d, MAX(d) AS last_d, SUM(spent) AS total_spent, COUNT(*) AS visits
      FROM cust_sales GROUP BY customer_id
  ),
  cm AS (
    SELECT to_char(date_trunc('month', cs.d), 'YYYY-MM') AS month,
           COUNT(DISTINCT cs.customer_id) FILTER (WHERE date_trunc('month', fs.first_d) = date_trunc('month', cs.d))::INTEGER AS new_clients,
           COUNT(DISTINCT cs.customer_id) FILTER (WHERE date_trunc('month', fs.first_d) < date_trunc('month', cs.d))::INTEGER AS returning_clients
      FROM cust_sales cs JOIN first_sale fs ON fs.customer_id = cs.customer_id
     WHERE cs.d >= (date_trunc('month', p_date_to) - INTERVAL '5 months')::DATE AND cs.d <= p_date_to
     GROUP BY 1
  ),
  risk AS (
    SELECT fs.customer_id, c.full_name, c.phone, fs.last_d, fs.visits,
           ROUND(fs.total_spent::NUMERIC / GREATEST(1, CEIL((fs.last_d - fs.first_d + 1) / 30.0)))::INTEGER AS monthly_value
      FROM first_sale fs JOIN customers c ON c.id = fs.customer_id
     WHERE fs.last_d BETWEEN v_today - 180 AND v_today - 45
       AND fs.visits >= 2
  )
  SELECT jsonb_build_object(
    'period',      jsonb_build_object('from', p_date_from, 'to', p_date_to, 'prev_from', v_prev_from, 'prev_to', v_prev_to, 'today', v_today),
    'pl',          public.get_profit_loss(v_bid, p_date_from, p_date_to),
    'pl_prev',     public.get_profit_loss(v_bid, v_prev_from, v_prev_to),
    'kpis',        (SELECT to_jsonb(k_cur) FROM k_cur),
    'kpis_prev',   (SELECT to_jsonb(k_prev) FROM k_prev),
    'monthly',     v_monthly,
    'leaks',       (SELECT to_jsonb(leaks) FROM leaks),
    'heatmap',     COALESCE((SELECT jsonb_agg(jsonb_build_object(
                      'dow', h.dow, 'hour', h.hour, 'appointments', h.appointments,
                      'booked_minutes', h.booked_minutes, 'capacity_minutes', COALESCE(c.cap_minutes, 0),
                      'weeks', (SELECT n FROM days WHERE days.dow = h.dow))
                      ORDER BY h.dow, h.hour)
                    FROM heat h LEFT JOIN cap c ON c.dow = h.dow AND c.hour = h.hour
                    WHERE COALESCE(c.cap_minutes, 0) > 0 OR h.appointments > 0), '[]'::JSONB),
    'staff',       COALESCE((SELECT jsonb_agg(to_jsonb(so) ORDER BY so.produced DESC) FROM staff_occ so), '[]'::JSONB),
    'services',    COALESCE((SELECT jsonb_agg(to_jsonb(svc)) FROM svc), '[]'::JSONB),
    'products',    COALESCE((SELECT jsonb_agg(to_jsonb(prd)) FROM prd), '[]'::JSONB),
    'customers_monthly', COALESCE((SELECT jsonb_agg(to_jsonb(cm) ORDER BY cm.month) FROM cm), '[]'::JSONB),
    'at_risk',     jsonb_build_object(
                     'count',         (SELECT COUNT(*) FROM risk),
                     'monthly_value', (SELECT COALESCE(SUM(monthly_value), 0) FROM risk),
                     'top',           COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                         'id', r.customer_id, 'name', r.full_name, 'has_phone', r.phone IS NOT NULL,
                                         'last_visit', r.last_d, 'visits', r.visits, 'monthly_value', r.monthly_value)
                                         ORDER BY r.monthly_value DESC)
                                       FROM (SELECT * FROM risk ORDER BY monthly_value DESC LIMIT 10) r), '[]'::JSONB))
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_management_report(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_management_report(DATE, DATE) TO authenticated;
