// ============================================================
// app/api/cron/send-reminders/route.ts — RF18 Recordatorios
// Vercel Cron lo invoca una vez al día (vercel.json: 13:00 UTC = 8:00 a. m.
// Colombia) y envía el recordatorio de TODAS las citas programadas para
// mañana (día del negocio) que aún no lo recibieron.
//
// Seguridad: el header Authorization: Bearer <CRON_SECRET>
// es añadido automáticamente por Vercel cuando CRON_SECRET
// está configurado en las env vars del proyecto.
// ============================================================

import { NextResponse }          from 'next/server'
import { createClient }          from '@supabase/supabase-js'
import { sendBookingReminder }   from '@/lib/email/notifications'
import type { Database }         from '@xinuco/types'
import { businessTodayISODate, addDaysToDateKey } from '@/lib/agenda-time'

// Forzar renderizado dinámico — esta ruta nunca debe ser cacheada por Next.js
export const dynamic = 'force-dynamic'

// ── Tipo del cliente con el esquema de Xinuco ─────────────────────────────────
type XinucoAdmin = ReturnType<typeof createClient<Database>>

// ── GET /api/cron/send-reminders ─────────────────────────────────────────────

export async function GET(request: Request) {
  // ── 1. Verificar el secreto del cron ───────────────────────────────────────
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    )
  }

  // ── 2. Cliente con service role (bypass RLS — necesario para acceso cross-tenant) ──
  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[cron/send-reminders] Missing Supabase env vars')
    return NextResponse.json({ error: 'Configuración incompleta' }, { status: 500 })
  }

  const supabase: any = createClient<any>(supabaseUrl, serviceRoleKey)

  // ── 3. Ventana: el día de MAÑANA del negocio ──────────────────────────────
  // start_time guarda la hora local como UTC (lib/agenda-time.ts), así que
  // "mañana" es [mañanaT00:00Z, pasadoT00:00Z) — no now()+24h en UTC real.
  const tomorrow = addDaysToDateKey(businessTodayISODate(), 1)
  const from     = `${tomorrow}T00:00:00Z`
  const to       = `${addDaysToDateKey(tomorrow, 1)}T00:00:00Z`

  const { data: appointments, error: fetchError } = await supabase
    .from('appointments')
    .select('id, business_id')
    .eq('status', 'scheduled')
    .gte('start_time', from)
    .lt('start_time', to)

  if (fetchError) {
    console.error('[cron/send-reminders] Error al obtener citas:', fetchError.message)
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  const appts    = appointments ?? []
  let sent       = 0
  let skipped    = 0
  let failed     = 0
  const errors:  string[] = []

  // ── 4. Para cada cita, verificar dedup y enviar ───────────────────────────
  for (const appt of appts) {
    // Comprobar si ya se envió recordatorio (índice UNIQUE en notification_log)
    const { data: existing } = await supabase
      .from('notification_log')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('notification_type', 'reminder')
      .eq('channel', 'email')
      .eq('status', 'sent')
      .maybeSingle()

    if (existing) {
      skipped++
      continue
    }

    try {
      await sendBookingReminder({
        supabase,
        businessId:    appt.business_id,
        appointmentId: appt.id,
      })
      sent++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron/send-reminders] Error en cita ${appt.id}:`, msg)
      errors.push(`${appt.id}: ${msg}`)
      failed++
    }
  }

  // ── 5. Respuesta con métricas (visible en Vercel Cron logs) ───────────────
  console.info(
    `[cron/send-reminders] Procesadas=${appts.length} ` +
    `Enviadas=${sent} Omitidas=${skipped} Fallidas=${failed}`,
  )

  return NextResponse.json({
    ok:          true,
    window:      { from, to },
    processed:   appts.length,
    sent,
    skipped,
    failed,
    ...(errors.length > 0 && { errors }),
  })
}
