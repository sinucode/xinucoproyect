-- ============================================================
-- seed_demo_competencia.sql — Datos DEMO para "Barbería Competencia"
-- Requiere 20260928150000_align_appointments_and_public_booking.sql.
-- Todo lleva el prefijo "Demo" para poder borrarlo (bloque LIMPIEZA al final).
--
-- Horas: convención del sistema — hora local de la barbería guardada como UTC
-- ("10:00Z" = 10:00 en la barbería). "Hoy" = fecha actual en America/Bogota.
-- ============================================================

DO $$
DECLARE
  b   UUID := '53c66a4f-13d1-4a1c-8cbc-7207f8abe22e';  -- Barbería Competencia
  d   DATE := (NOW() AT TIME ZONE 'America/Bogota')::DATE;
  s1 UUID; s2 UUID; s3 UUID;                 -- staff
  v1 UUID; v2 UUID; v3 UUID; v4 UUID;        -- services
  c1 UUID; c2 UUID; c3 UUID; c4 UUID; c5 UUID; c6 UUID;
  dow INT;
BEGIN
  IF EXISTS (SELECT 1 FROM staff WHERE business_id = b AND full_name LIKE 'Demo %') THEN
    RAISE EXCEPTION 'Los datos demo ya existen. Corre primero el bloque de LIMPIEZA.';
  END IF;

  -- Servicios
  INSERT INTO services (business_id, name, description, duration_minutes, price_cop, is_active, buffer_time_minutes)
  VALUES (b, 'Demo Corte clásico', 'Corte a tijera y máquina', 30, 25000, TRUE, 0) RETURNING id INTO v1;
  INSERT INTO services (business_id, name, description, duration_minutes, price_cop, is_active, buffer_time_minutes)
  VALUES (b, 'Demo Barba', 'Perfilado y toalla caliente', 20, 15000, TRUE, 0) RETURNING id INTO v2;
  INSERT INTO services (business_id, name, description, duration_minutes, price_cop, is_active, buffer_time_minutes)
  VALUES (b, 'Demo Corte + barba', 'Combo completo', 50, 38000, TRUE, 0) RETURNING id INTO v3;
  INSERT INTO services (business_id, name, description, duration_minutes, price_cop, is_active, buffer_time_minutes)
  VALUES (b, 'Demo Cejas', 'Perfilado de cejas', 15, 10000, TRUE, 0) RETURNING id INTO v4;

  -- Barberos
  INSERT INTO staff (business_id, full_name, specialty_role, is_active) VALUES (b, 'Demo Carlos Ruiz',   'barber', TRUE) RETURNING id INTO s1;
  INSERT INTO staff (business_id, full_name, specialty_role, is_active) VALUES (b, 'Demo Andrés Gómez',  'barber', TRUE) RETURNING id INTO s2;
  INSERT INTO staff (business_id, full_name, specialty_role, is_active) VALUES (b, 'Demo Julián Torres', 'barber', TRUE) RETURNING id INTO s3;

  -- Horario lunes (1) a sábado (6), 09:00–19:00
  FOR dow IN 1..6 LOOP
    INSERT INTO staff_schedules (business_id, staff_id, day_of_week, start_time, end_time) VALUES
      (b, s1, dow, '09:00', '19:00'),
      (b, s2, dow, '09:00', '19:00'),
      (b, s3, dow, '09:00', '19:00');
  END LOOP;

  -- Todos hacen todos los servicios
  INSERT INTO staff_services (business_id, staff_id, service_id)
  SELECT b, st, sv FROM UNNEST(ARRAY[s1, s2, s3]) st, UNNEST(ARRAY[v1, v2, v3, v4]) sv;

  -- Clientes
  INSERT INTO customers (business_id, full_name, phone, email) VALUES (b, 'Demo Juan Pérez',     '3000000001', NULL) RETURNING id INTO c1;
  INSERT INTO customers (business_id, full_name, phone, email) VALUES (b, 'Demo Mateo Rodríguez','3000000002', NULL) RETURNING id INTO c2;
  INSERT INTO customers (business_id, full_name, phone, email) VALUES (b, 'Demo Santiago López', '3000000003', NULL) RETURNING id INTO c3;
  INSERT INTO customers (business_id, full_name, phone, email) VALUES (b, 'Demo Daniel Martínez','3000000004', NULL) RETURNING id INTO c4;
  INSERT INTO customers (business_id, full_name, phone, email) VALUES (b, 'Demo Felipe Castro',  '3000000005', NULL) RETURNING id INTO c5;
  INSERT INTO customers (business_id, full_name, phone, email) VALUES (b, 'Demo Nicolás Vargas', '3000000006', NULL) RETURNING id INTO c6;

  -- Citas (hoy, mañana y pasado mañana) en distintos estados
  INSERT INTO appointments (business_id, customer_id, service_id, staff_id, start_time, status) VALUES
    (b, c1, v1, s1, (d     + TIME '09:00') AT TIME ZONE 'UTC', 'completed'),
    (b, c2, v3, s2, (d     + TIME '10:00') AT TIME ZONE 'UTC', 'in_progress'),
    (b, c3, v2, s3, (d     + TIME '11:00') AT TIME ZONE 'UTC', 'ready_to_pay'),
    (b, c4, v1, s1, (d     + TIME '15:00') AT TIME ZONE 'UTC', 'scheduled'),
    (b, c5, v4, s2, (d     + TIME '16:00') AT TIME ZONE 'UTC', 'cancelled'),
    (b, c6, v3, s3, (d     + TIME '17:00') AT TIME ZONE 'UTC', 'scheduled'),
    (b, c1, v2, s2, (d + 1 + TIME '09:30') AT TIME ZONE 'UTC', 'scheduled'),
    (b, c3, v1, s1, (d + 1 + TIME '11:00') AT TIME ZONE 'UTC', 'scheduled'),
    (b, c4, v3, s3, (d + 1 + TIME '14:00') AT TIME ZONE 'UTC', 'scheduled'),
    (b, c2, v1, s1, (d + 2 + TIME '10:00') AT TIME ZONE 'UTC', 'scheduled'),
    (b, c6, v4, s2, (d + 2 + TIME '12:00') AT TIME ZONE 'UTC', 'payment_pending');
END $$;

-- ============================================================
-- LIMPIEZA — borra SOLO los datos "Demo" de Barbería Competencia.
-- Descomentar y correr cuando ya no se necesiten.
-- ============================================================
-- DO $$
-- DECLARE b UUID := '53c66a4f-13d1-4a1c-8cbc-7207f8abe22e';
-- BEGIN
--   DELETE FROM appointments   WHERE business_id = b AND customer_id IN (SELECT id FROM customers WHERE business_id = b AND full_name LIKE 'Demo %');
--   DELETE FROM customers      WHERE business_id = b AND full_name LIKE 'Demo %';
--   DELETE FROM staff_services WHERE business_id = b AND staff_id IN (SELECT id FROM staff WHERE business_id = b AND full_name LIKE 'Demo %');
--   DELETE FROM staff_schedules WHERE business_id = b AND staff_id IN (SELECT id FROM staff WHERE business_id = b AND full_name LIKE 'Demo %');
--   DELETE FROM staff          WHERE business_id = b AND full_name LIKE 'Demo %';
--   DELETE FROM services       WHERE business_id = b AND name LIKE 'Demo %';
-- END $$;
