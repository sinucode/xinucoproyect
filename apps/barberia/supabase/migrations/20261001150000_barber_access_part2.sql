-- ============================================================
-- 20261001150000_barber_access_part2.sql — Acceso del barbero, parte 2 (DESPUÉS del deploy)
--
-- ORDEN DE EJECUCIÓN: 1) 20261001140000_barber_access_part1.sql  2) deploy del código
-- 3) ESTA migración. Correrla antes del deploy rompería la reserva pública (lee `staff`
-- con el cliente anónimo), el expediente de Clientes del barbero y el cobro/turno actual.
--
-- Qué hace: cierra a nivel de base de datos lo que el barbero y la manicurista NO deben
-- ver ni escribir directo (la plata, el inventario, las notificaciones y los datos de
-- pago en línea). Hasta ahora varias tablas tenían una política "tenant" que dejaba leer
-- y escribir a cualquier usuario del negocio, sin importar su rol.
--
--   · "tenant" = business_id igual al business_id del JWT (app_metadata).
--   · "admin"  = tenant Y public._is_business_admin(business_id) (admin o super_admin).
--
-- Robusta a la deriva de producción (las políticas reales difieren de las migraciones):
-- para cada tabla primero BORRA todas las políticas existentes (dinámicamente), asegura
-- RLS activado y crea exactamente el conjunto deseado, siempre con xin_internal_definer
-- (FOR ALL TO postgres) para que las funciones SECURITY DEFINER sigan viendo sus tablas
-- (patrón de 20260930090000_definer_policies.sql). service_role no pasa por RLS.
--
-- Escrituras de usuario que SIGUEN permitidas (verificadas en el código):
--   cash_register_shifts  INSERT/UPDATE admin   (openShift / closeShift)
--   commission_rules      INSERT/UPDATE/DELETE admin   (actions/commissions.ts)
--   inventory_items       INSERT/UPDATE/DELETE admin   (actions/inventory.ts)
--   customer_notes        INSERT tenant con created_by = auth.uid(); UPDATE/DELETE admin
--   customer_tags         INSERT/DELETE tenant   (actions/crm.ts updateCustomerTags)
--   walk_ins              INSERT/UPDATE tenant; DELETE admin   (actions/walk-ins.ts)
-- Todo lo demás (sales, payments, money_accounts, loyalty_ledgers, inventory_movements,
-- sale_items, notification_log, appointment_products, mp_*) se escribe solo por funciones
-- DEFINER o service_role: sin escrituras de usuario.
--
-- Mi cuenta: sale_items lo puede leer el admin o el profesional dueño de la línea
-- (_is_my_staff) para el detalle de su propia cuenta.
-- ============================================================

-- ── Respaldo: copia de las políticas actuales antes de borrarlas ──────────────
-- Tabla sin políticas y con RLS: la API no la ve; solo se consulta desde el SQL Editor.
CREATE TABLE IF NOT EXISTS public._policy_backup_20261001 AS
  SELECT now() AS backed_up_at, p.* FROM pg_policies p WHERE FALSE;
ALTER TABLE public._policy_backup_20261001 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._policy_backup_20261001 FROM anon, authenticated;
INSERT INTO public._policy_backup_20261001
  SELECT now(), p.* FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename IN (
       'sales', 'payments', 'cash_register_shifts', 'money_accounts', 'loyalty_ledgers',
       'inventory_movements', 'sale_items', 'commission_rules', 'inventory_items',
       'notification_log', 'appointment_products', 'customer_notes', 'customer_tags',
       'walk_ins', 'mp_subscriptions', 'mp_payments', 'mp_fee_config', 'staff');

-- ── 0. Reinicio de políticas: RLS activa, nada heredado, solo el rol interno ──
DO $$
DECLARE
  t TEXT;
  r RECORD;
  tables TEXT[] := ARRAY[
    'sales', 'payments', 'cash_register_shifts', 'money_accounts', 'loyalty_ledgers',
    'inventory_movements', 'sale_items', 'commission_rules', 'inventory_items',
    'notification_log', 'appointment_products', 'customer_notes', 'customer_tags',
    'walk_ins', 'mp_subscriptions', 'mp_payments', 'mp_fee_config'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'La tabla public.% no existe: revisa las migraciones antes de continuar', t;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY xin_internal_definer ON public.%I FOR ALL TO postgres USING (TRUE) WITH CHECK (TRUE)', t);
  END LOOP;
END $$;

-- ── 1. Solo lectura admin (+ super_admin): dinero y registros contables ───────
-- sales, payments, money_accounts, loyalty_ledgers, inventory_movements
-- (las escrituras las hacen las funciones DEFINER: cobro, POS, anulación, lealtad, inventario)
CREATE POLICY xin_select ON public.sales FOR SELECT TO authenticated
  USING ((business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id))
         OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE));

CREATE POLICY xin_select ON public.payments FOR SELECT TO authenticated
  USING ((business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id))
         OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE));

CREATE POLICY xin_select ON public.money_accounts FOR SELECT TO authenticated
  USING ((business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id))
         OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE));

CREATE POLICY xin_select ON public.loyalty_ledgers FOR SELECT TO authenticated
  USING ((business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id))
         OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE));

CREATE POLICY xin_select ON public.inventory_movements FOR SELECT TO authenticated
  USING ((business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id))
         OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE));

-- ── 2. Turnos de caja: lectura y escritura admin (openShift / closeShift) ────
CREATE POLICY xin_select ON public.cash_register_shifts FOR SELECT TO authenticated
  USING ((business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id))
         OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE));

CREATE POLICY xin_admin_insert ON public.cash_register_shifts FOR INSERT TO authenticated
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));

CREATE POLICY xin_admin_update ON public.cash_register_shifts FOR UPDATE TO authenticated
  USING      (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id))
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));

-- ── 3. Líneas de venta: admin, o el profesional dueño de la línea (Mi cuenta) ─
CREATE POLICY xin_select ON public.sale_items FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id')
         AND (public._is_business_admin(business_id) OR public._is_my_staff(staff_id)));

-- ── 4. Comisiones e inventario: lectura y escritura admin ────────────────────
CREATE POLICY xin_select ON public.commission_rules FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));
CREATE POLICY xin_admin_insert ON public.commission_rules FOR INSERT TO authenticated
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));
CREATE POLICY xin_admin_update ON public.commission_rules FOR UPDATE TO authenticated
  USING      (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id))
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));
CREATE POLICY xin_admin_delete ON public.commission_rules FOR DELETE TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));

CREATE POLICY xin_select ON public.inventory_items FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));
CREATE POLICY xin_admin_insert ON public.inventory_items FOR INSERT TO authenticated
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));
CREATE POLICY xin_admin_update ON public.inventory_items FOR UPDATE TO authenticated
  USING      (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id))
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));
CREATE POLICY xin_admin_delete ON public.inventory_items FOR DELETE TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));

-- ── 5. Notificaciones: lectura admin; los inserts los hace service_role ──────
CREATE POLICY xin_select ON public.notification_log FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));

-- ── 6. Citas y clientes: lectura tenant (el barbero las usa) ─────────────────
-- appointment_products: sin escrituras de usuario (las crean las funciones de reserva).
CREATE POLICY xin_select ON public.appointment_products FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'));

-- customer_notes: cualquiera del negocio lee y anota (como autor); corregir/borrar es del admin.
CREATE POLICY xin_select ON public.customer_notes FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'));
CREATE POLICY xin_insert ON public.customer_notes FOR INSERT TO authenticated
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND created_by = auth.uid());
CREATE POLICY xin_admin_update ON public.customer_notes FOR UPDATE TO authenticated
  USING      (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id))
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));
CREATE POLICY xin_admin_delete ON public.customer_notes FOR DELETE TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));

-- customer_tags: leer, agregar y quitar (updateCustomerTags = DELETE + INSERT); sin UPDATE.
CREATE POLICY xin_select ON public.customer_tags FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'));
CREATE POLICY xin_insert ON public.customer_tags FOR INSERT TO authenticated
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'));
CREATE POLICY xin_delete ON public.customer_tags FOR DELETE TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'));

-- walk_ins: la fila de espera la opera todo el equipo (alta, estado, cancelar); borrar es del admin.
CREATE POLICY xin_select ON public.walk_ins FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'));
CREATE POLICY xin_insert ON public.walk_ins FOR INSERT TO authenticated
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'));
CREATE POLICY xin_update ON public.walk_ins FOR UPDATE TO authenticated
  USING      (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'))
  WITH CHECK (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'));
CREATE POLICY xin_admin_delete ON public.walk_ins FOR DELETE TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id));

-- ── 7. Mercado Pago: lectura admin (+ super_admin); escribe solo service_role ─
CREATE POLICY xin_select ON public.mp_subscriptions FOR SELECT TO authenticated
  USING ((business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id))
         OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE));

CREATE POLICY xin_select ON public.mp_payments FOR SELECT TO authenticated
  USING ((business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND public._is_business_admin(business_id))
         OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', FALSE));

-- Tarifas: la global (business_id NULL) y la propia del negocio; sin escrituras de usuario.
CREATE POLICY xin_select ON public.mp_fee_config FOR SELECT TO authenticated
  USING (business_id IS NULL
         OR business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id'));

-- ── 8. staff: se quita la lectura pública (la reserva usa get_public_staff) ──
-- Las demás políticas de staff NO se tocan.
-- Se borra por contenido y no por nombre (en producción los nombres difieren): toda política
-- de staff abierta a anon/public que no esté limitada al negocio del JWT.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'staff'
       AND (roles @> ARRAY['anon']::NAME[] OR roles @> ARRAY['public']::NAME[])
       AND COALESCE(qual, '') NOT ILIKE '%jwt%'
       AND COALESCE(qual, '') NOT ILIKE '%auth.uid%'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.staff', r.policyname);
  END LOOP;
END $$;

-- ── Verificación (solo lectura): políticas resultantes ───────────────────────
SELECT tablename, policyname, cmd, roles, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN (
     'sales', 'payments', 'cash_register_shifts', 'money_accounts', 'loyalty_ledgers',
     'inventory_movements', 'sale_items', 'commission_rules', 'inventory_items',
     'notification_log', 'appointment_products', 'customer_notes', 'customer_tags',
     'walk_ins', 'mp_subscriptions', 'mp_payments', 'mp_fee_config', 'staff'
   )
 ORDER BY tablename, cmd, policyname;
