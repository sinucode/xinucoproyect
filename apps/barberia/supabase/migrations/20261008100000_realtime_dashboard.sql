-- 20261008100000_realtime_dashboard.sql
-- Actualización en vivo del dashboard (admin y barberos): agrega las tablas que el dashboard escucha
-- a la publicación `supabase_realtime`, para que Supabase Realtime emita sus cambios (postgres_changes).
--   · public.appointments      (citas: reservas públicas, cambios de estado, etc.)
--   · public.walk_ins          (turnos sin cita)
--   · public.payout_requests   (solicitudes de pago / anticipo)
-- La RLS SIGUE filtrando lo que recibe cada usuario: Realtime evalúa las políticas con el JWT del
-- suscriptor, así que un negocio nunca recibe eventos de otro y un barbero solo ve lo que ya podía leer.
-- Idempotente: crea la publicación si no existe y agrega cada tabla solo si aún no está en ella.

DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOREACH t IN ARRAY ARRAY['appointments', 'walk_ins', 'payout_requests'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Verificación (solo lectura): tablas publicadas en supabase_realtime
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY schemaname, tablename;
