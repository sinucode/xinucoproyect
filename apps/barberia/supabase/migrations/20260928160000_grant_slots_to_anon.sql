-- ============================================================
-- 20260928160000_grant_slots_to_anon.sql
-- La reserva pública es anónima y "Restrict Function Execution to authenticated
-- Roles" dejó a anon sin EXECUTE en las funciones de horarios → el wizard mostraba
-- "Sin horarios disponibles". Son SECURITY DEFINER y solo devuelven horas libres
-- (sin datos personales), así que es seguro exponerlas a anon.
-- ============================================================
GRANT EXECUTE ON FUNCTION public.get_available_slots_v2(UUID, UUID, UUID, DATE, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION public.get_available_slots(UUID, UUID, DATE, INTEGER)          TO anon;
