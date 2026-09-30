-- ============================================================
-- 20260930090000_definer_policies.sql — Las funciones internas vuelven a ver sus tablas
--
-- Problema: tras 20260929270000 (políticas "TO authenticated"), el cálculo
-- automático de comisiones dejó de encontrar las reglas: las funciones
-- SECURITY DEFINER corren como el rol dueño (postgres) y, en este proyecto,
-- algunas tablas aplican RLS también a ese rol (FORCE / tablas creadas desde
-- el panel). Las políticas viejas eran "TO public" y lo cubrían sin querer.
--
-- Arreglo: una política explícita para el rol interno `postgres` (nunca lo
-- usa la API: anon/authenticated/service_role son roles distintos) en las
-- tablas que leen/escriben las funciones internas. No abre nada a usuarios.
-- ============================================================

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'commission_rules', 'staff_ledger', 'loyalty_ledgers',
    'expenses', 'expense_categories',
    'staff', 'staff_services', 'staff_schedules', 'staff_breaks', 'staff_time_off',
    'services', 'service_workstations', 'businesses',
    'sales', 'sale_items', 'payments', 'appointments', 'customers', 'cash_register_shifts'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS xin_internal_definer ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY xin_internal_definer ON public.%I FOR ALL TO postgres USING (TRUE) WITH CHECK (TRUE)', t);
  END LOOP;
END $$;
