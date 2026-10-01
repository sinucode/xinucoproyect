'use server'
// actions/notifications.ts — RF18 historial de notificaciones del negocio.
//
// El disparo manual del cron diario (recordatorios de TODOS los negocios) NO vive aquí: es una
// tarea de plataforma y solo la corre el super_admin (actions/platform-settings.ts → runDailyTasks).

import { createClient } from '@xinuco/supabase/server'

export interface NotificationLogRow {
  id:                string
  appointment_id:    string | null
  notification_type: string
  channel:           string
  recipient_email:   string | null
  status:            string
  error_message:     string | null
  created_at:        string
}

// ════════════════════════════════════════════════════════════════════════════
// getNotificationLog
// Historial de notificaciones del negocio del administrador. El negocio sale SIEMPRE del
// perfil (nunca del cliente) y solo un admin lo ve (trae correos de clientes).
// ════════════════════════════════════════════════════════════════════════════
export async function getNotificationLog(
  limit = 50,
): Promise<{ data: NotificationLogRow[] | null; error: string | null }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'No autorizado.' }

  const { data: profileRaw } = await supabase
    .from('profiles')
    .select('business_id, role')
    .eq('id', user.id)
    .single()

  const profile = profileRaw as { business_id: string | null; role: string } | null
  if (!profile?.business_id || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
    return { data: null, error: 'Acceso denegado.' }
  }

  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 50

  const { data, error } = await supabase
    .from('notification_log')
    .select('id, appointment_id, notification_type, channel, recipient_email, status, error_message, created_at')
    .eq('business_id', profile.business_id)
    .order('created_at', { ascending: false })
    .limit(safeLimit)

  if (error) {
    console.error('[getNotificationLog]', error)
    return { data: null, error: error.message }
  }

  return { data: data as unknown as NotificationLogRow[], error: null }
}
