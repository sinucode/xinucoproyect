-- ============================================================
-- 20260929100000_booking_products.sql — Productos apartados al reservar
--
-- El cliente puede apartar productos al reservar en línea. Se APARTAN (no se
-- descuentan): current_stock solo baja al cobrar. Disponible para apartar =
-- current_stock − apartado en citas abiertas. Todo el control vive en la BD:
--   · límite de unidades por cita y de citas abiertas con productos por teléfono
--     (configurables por el negocio; 0 = sin productos / sin límite)
--   · FOR UPDATE sobre los ítems → dos reservas simultáneas de la última unidad
--     se serializan y la segunda recibe 'product_unavailable'
--   · lo apartado se libera solo al cancelar / no_show / cobrar, o cuando pasa
--     el día de la cita sin cobrarse
--
-- Convención horaria del sistema: start_time guarda la hora local como UTC.
-- ============================================================

-- ── 1. Configuración por negocio ─────────────────────────────────────────────
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS booking_products_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS booking_max_product_units INTEGER NOT NULL DEFAULT 2
    CHECK (booking_max_product_units BETWEEN 0 AND 50),
  ADD COLUMN IF NOT EXISTS booking_max_open_with_products_per_phone INTEGER NOT NULL DEFAULT 1
    CHECK (booking_max_open_with_products_per_phone BETWEEN 0 AND 50);

-- ── 2. Producto ofrecible en la reserva en línea ─────────────────────────────
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS bookable_online BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 3. Productos apartados por cita ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.appointment_products (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID        NOT NULL REFERENCES public.businesses(id)       ON DELETE CASCADE,
  appointment_id UUID        NOT NULL REFERENCES public.appointments(id)     ON DELETE CASCADE,
  item_id        UUID        NOT NULL REFERENCES public.inventory_items(id)  ON DELETE CASCADE,
  quantity       INTEGER     NOT NULL CHECK (quantity > 0),
  unit_price     INTEGER     NOT NULL CHECK (unit_price >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (appointment_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_appointment_products_item ON public.appointment_products (item_id);

ALTER TABLE public.appointment_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant can manage appointment_products" ON public.appointment_products;
CREATE POLICY "tenant can manage appointment_products" ON public.appointment_products
  FOR ALL TO authenticated
  USING      (business_id::text = (auth.jwt() -> 'app_metadata' ->> 'business_id'))
  WITH CHECK (business_id::text = (auth.jwt() -> 'app_metadata' ->> 'business_id'));

-- ── 4. Helpers internos (sin EXECUTE para anon/authenticated) ────────────────
-- Inicio del día actual del negocio en la convención "hora local como UTC".
CREATE OR REPLACE FUNCTION public._business_today_start()
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT ((NOW() AT TIME ZONE 'America/Bogota')::DATE)::TIMESTAMP AT TIME ZONE 'UTC'
$$;

-- Unidades apartadas de un ítem en citas abiertas (hoy o futuras), opcionalmente
-- excluyendo una cita (la que se está cobrando).
CREATE OR REPLACE FUNCTION public._inventory_reserved_qty(p_item_id UUID, p_exclude_appointment UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(SUM(ap.quantity), 0)::INTEGER
    FROM appointment_products ap
    JOIN appointments a ON a.id = ap.appointment_id
   WHERE ap.item_id = p_item_id
     AND a.status IN ('payment_pending', 'scheduled', 'in_progress', 'ready_to_pay')
     AND a.start_time >= public._business_today_start()
     AND (p_exclude_appointment IS NULL OR a.id <> p_exclude_appointment)
$$;

REVOKE ALL ON FUNCTION public._business_today_start() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._inventory_reserved_qty(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── 5. Público: productos que se pueden apartar ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_bookable_products(p_business_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_enabled BOOLEAN;
  v_max     INTEGER;
BEGIN
  SELECT booking_products_enabled, booking_max_product_units
    INTO v_enabled, v_max
    FROM businesses WHERE id = p_business_id AND is_active;

  IF NOT COALESCE(v_enabled, FALSE) OR COALESCE(v_max, 0) = 0 THEN
    RETURN jsonb_build_object('enabled', FALSE, 'max_units', 0, 'items', '[]'::JSONB);
  END IF;

  RETURN jsonb_build_object(
    'enabled',   TRUE,
    'max_units', v_max,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', i.id, 'name', i.name, 'description', i.description,
               'unit_price', i.unit_price,
               'available', LEAST(i.current_stock - public._inventory_reserved_qty(i.id), v_max)
             ) ORDER BY i.name)
        FROM inventory_items i
       WHERE i.business_id = p_business_id
         AND i.is_active AND i.bookable_online
         AND COALESCE(i.unit_price, 0) > 0
         AND i.current_stock - public._inventory_reserved_qty(i.id) > 0
    ), '[]'::JSONB)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_bookable_products(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_bookable_products(UUID) TO anon, authenticated, service_role;

-- ── 6. Tenant: apartados por ítem (para Inventario y el cobro) ───────────────
CREATE OR REPLACE FUNCTION public.get_inventory_reservations(p_business_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- COALESCE: sin sesión los claims son NULL y NOT(NULL) no dispararía el RAISE.
  IF NOT COALESCE(
       (auth.jwt() -> 'app_metadata' ->> 'business_id') = p_business_id::TEXT
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin',
    FALSE
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'item_id',        ap.item_id,
             'appointment_id', a.id,
             'quantity',       ap.quantity,
             'start_time',     a.start_time,
             'customer_name',  c.full_name,
             'customer_phone', c.phone
           ) ORDER BY a.start_time)
      FROM appointment_products ap
      JOIN appointments a ON a.id = ap.appointment_id
      LEFT JOIN customers c ON c.id = a.customer_id
     WHERE ap.business_id = p_business_id
       AND a.status IN ('payment_pending', 'scheduled', 'in_progress', 'ready_to_pay')
       AND a.start_time >= public._business_today_start()
  ), '[]'::JSONB);
END;
$$;
REVOKE ALL ON FUNCTION public.get_inventory_reservations(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_reservations(UUID) TO authenticated, service_role;

-- ── 7. create_public_booking con productos ───────────────────────────────────
-- Nueva firma (+ p_products). La vieja se elimina; p_products tiene DEFAULT, así
-- que las llamadas sin productos siguen funcionando.
DROP FUNCTION IF EXISTS public.create_public_booking(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_business_id UUID,
  p_service_id  UUID,
  p_staff_id    UUID,          -- NULL = cualquier barbero disponible
  p_start_time  TIMESTAMPTZ,
  p_full_name   TEXT,
  p_phone       TEXT,
  p_email       TEXT  DEFAULT NULL,
  p_status      TEXT  DEFAULT 'scheduled',
  p_products    JSONB DEFAULT '[]'::JSONB   -- [{ "item_id": uuid, "quantity": int }]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration   INTEGER;
  v_end        TIMESTAMPTZ;
  v_staff      UUID;
  v_customer   UUID;
  v_appt       UUID;
  v_phone      TEXT := NULLIF(TRIM(p_phone), '');
  v_name       TEXT := NULLIF(TRIM(p_full_name), '');
  v_products   JSONB := COALESCE(p_products, '[]'::JSONB);
  v_enabled    BOOLEAN;
  v_max_units  INTEGER;
  v_max_open   INTEGER;
  v_total_qty  INTEGER := 0;
  v_open_count INTEGER;
  r            RECORD;
  v_item       RECORD;
BEGIN
  IF p_status NOT IN ('scheduled', 'payment_pending') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  IF v_phone IS NULL OR v_name IS NULL OR p_start_time IS NULL THEN
    RAISE EXCEPTION 'missing_fields';
  END IF;
  IF jsonb_typeof(v_products) <> 'array' THEN
    RAISE EXCEPTION 'invalid_products';
  END IF;

  SELECT booking_products_enabled, booking_max_product_units, booking_max_open_with_products_per_phone
    INTO v_enabled, v_max_units, v_max_open
    FROM businesses WHERE id = p_business_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'business_not_found'; END IF;

  SELECT duration_minutes + COALESCE(buffer_time_minutes, 0)
    INTO v_duration
    FROM services
   WHERE id = p_service_id AND business_id = p_business_id AND is_active;
  IF v_duration IS NULL THEN RAISE EXCEPTION 'service_not_found'; END IF;

  v_end := p_start_time + make_interval(mins => v_duration);

  -- ── Productos: validar reglas del negocio antes de tocar nada ──────────────
  IF jsonb_array_length(v_products) > 0 THEN
    IF NOT v_enabled OR v_max_units = 0 THEN
      RAISE EXCEPTION 'products_disabled';
    END IF;

    SELECT COALESCE(SUM((e->>'quantity')::INTEGER), 0) INTO v_total_qty
      FROM jsonb_array_elements(v_products) e;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_products) e
                WHERE (e->>'quantity')::INTEGER IS NULL OR (e->>'quantity')::INTEGER <= 0) THEN
      RAISE EXCEPTION 'invalid_products';
    END IF;
    IF v_total_qty > v_max_units THEN
      RAISE EXCEPTION 'products_limit_exceeded';
    END IF;

    IF v_max_open > 0 THEN
      SELECT COUNT(DISTINCT a.id) INTO v_open_count
        FROM appointments a
        JOIN customers c ON c.id = a.customer_id
       WHERE a.business_id = p_business_id
         AND c.phone = v_phone
         AND a.status IN ('payment_pending', 'scheduled', 'in_progress', 'ready_to_pay')
         AND a.start_time >= public._business_today_start()
         AND EXISTS (SELECT 1 FROM appointment_products ap WHERE ap.appointment_id = a.id);
      IF v_open_count >= v_max_open THEN
        RAISE EXCEPTION 'products_open_limit';
      END IF;
    END IF;
  END IF;

  -- ── Barbero libre (igual que antes) ────────────────────────────────────────
  SELECT s.id INTO v_staff
    FROM staff s
   WHERE s.business_id = p_business_id
     AND s.is_active
     AND (p_staff_id IS NULL OR s.id = p_staff_id)
     AND (
       NOT EXISTS (SELECT 1 FROM staff_services x WHERE x.staff_id = s.id)
       OR EXISTS (SELECT 1 FROM staff_services x WHERE x.staff_id = s.id AND x.service_id = p_service_id)
     )
     AND EXISTS (
       SELECT 1 FROM staff_schedules ss
        WHERE ss.staff_id    = s.id
          AND ss.day_of_week = EXTRACT(DOW FROM p_start_time AT TIME ZONE 'UTC')
          AND ss.start_time <= (p_start_time AT TIME ZONE 'UTC')::TIME
          AND ss.end_time   >= (v_end        AT TIME ZONE 'UTC')::TIME
     )
     AND NOT EXISTS (
       SELECT 1
         FROM appointments a
         JOIN services sv ON sv.id = a.service_id
        WHERE a.staff_id = s.id
          AND a.status NOT IN ('cancelled', 'no_show')
          AND a.start_time < v_end
          AND a.start_time + make_interval(mins => sv.duration_minutes + COALESCE(sv.buffer_time_minutes, 0)) > p_start_time
     )
   ORDER BY s.created_at
   LIMIT 1
   FOR UPDATE OF s;

  IF v_staff IS NULL THEN RAISE EXCEPTION 'slot_unavailable'; END IF;

  -- ── Cliente ────────────────────────────────────────────────────────────────
  SELECT id INTO v_customer
    FROM customers
   WHERE business_id = p_business_id AND phone = v_phone
   LIMIT 1;

  IF v_customer IS NULL THEN
    INSERT INTO customers (business_id, full_name, phone, email)
    VALUES (p_business_id, v_name, v_phone, NULLIF(TRIM(p_email), ''))
    RETURNING id INTO v_customer;
  ELSIF NULLIF(TRIM(p_email), '') IS NOT NULL THEN
    UPDATE customers SET email = TRIM(p_email) WHERE id = v_customer AND email IS NULL;
  END IF;

  INSERT INTO appointments (business_id, customer_id, service_id, staff_id, start_time, status)
  VALUES (p_business_id, v_customer, p_service_id, v_staff, p_start_time, p_status)
  RETURNING id INTO v_appt;

  -- ── Apartar productos (bloqueo por ítem, en orden estable) ─────────────────
  FOR r IN
    SELECT (e->>'item_id')::UUID AS item_id, SUM((e->>'quantity')::INTEGER)::INTEGER AS qty
      FROM jsonb_array_elements(v_products) e
     GROUP BY 1
     ORDER BY 1
  LOOP
    SELECT id, current_stock, unit_price INTO v_item
      FROM inventory_items
     WHERE id = r.item_id
       AND business_id = p_business_id
       AND is_active AND bookable_online
       AND COALESCE(unit_price, 0) > 0
     FOR UPDATE;

    IF NOT FOUND OR v_item.current_stock - public._inventory_reserved_qty(r.item_id) < r.qty THEN
      RAISE EXCEPTION 'product_unavailable';   -- revierte toda la reserva
    END IF;

    INSERT INTO appointment_products (business_id, appointment_id, item_id, quantity, unit_price)
    VALUES (p_business_id, v_appt, r.item_id, r.qty, v_item.unit_price);
  END LOOP;

  RETURN jsonb_build_object('appointment_id', v_appt, 'customer_id', v_customer, 'staff_id', v_staff);
END;
$$;

REVOKE ALL ON FUNCTION public.create_public_booking(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_public_booking(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO anon, authenticated, service_role;

-- ── 8. Demo: productos ofrecibles en línea (Barbería Competencia) ────────────
UPDATE public.inventory_items
   SET bookable_online = TRUE
 WHERE business_id = '53c66a4f-13d1-4a1c-8cbc-7207f8abe22e'
   AND name IN ('Demo Cera modeladora', 'Demo Gel fijador', 'Demo Aceite para barba');
