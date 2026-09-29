-- ============================================================
-- 20260929100100_fix_inventory_reservations_guard.sql
-- [SEC] get_inventory_reservations devuelve nombres/teléfonos de clientes.
--  1. Supabase concede EXECUTE a anon por default privileges: REVOKE FROM PUBLIC
--     no lo quita → se revoca explícitamente a anon.
--  2. El guard era NOT(a OR b): sin sesión ambos son NULL → NOT NULL → no
--     lanzaba. Ahora COALESCE(..., FALSE).
-- ============================================================
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
