'use server'

// Acciones públicas de citas (sin sesión): el cliente cancela desde el enlace del correo.
// La autorización es el public_token (UUID aleatorio) — nunca se cancela por GET.

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@xinuco/supabase/server'
import { sendCancellationNotice } from '@/lib/email/notifications'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Errores que levanta cancel_appointment_by_token → mensaje para el cliente.
const ERROR_MESSAGES: Record<string, string> = {
  not_found:         'No encontramos esta cita.',
  already_cancelled: 'Esta cita ya fue cancelada.',
  not_cancellable:   'Esta cita ya no se puede cancelar.',
  already_started:   'Esta cita ya pasó o está en curso; no se puede cancelar desde aquí.',
  paid_online:       'Pagaste esta cita en línea. Para cancelarla y gestionar el reembolso, comunícate con el negocio.',
}

function mapError(message: string | undefined): string {
  const key = Object.keys(ERROR_MESSAGES).find((k) => message?.includes(k))
  return key ? ERROR_MESSAGES[key] : 'No pudimos cancelar tu cita. Inténtalo de nuevo.'
}

export async function cancelAppointmentByToken(
  token: string,
  reason?: string | null,
): Promise<{ success: true } | { error: string }> {
  if (typeof token !== 'string' || !UUID_RE.test(token)) {
    return { error: 'Enlace inválido.' }
  }

  // Motivo opcional: se recorta y se limita a 300 caracteres (igual que la BD).
  const cleanReason = (typeof reason === 'string' ? reason.trim().slice(0, 300) : '') || null

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cancel_appointment_by_token', {
    p_token:  token,
    p_reason: cleanReason,
  })
  if (error) return { error: mapError(error.message) }

  const result = data as { appointment_id?: string; business_id?: string } | null
  const appointmentId = result?.appointment_id
  const businessId    = result?.business_id

  // Best-effort: correo de cancelación (la auditoría la escribe el trigger de la BD). Nunca falla la acción.
  if (appointmentId && businessId) {
    try {
      const admin = await createAdminClient()

      try {
        await sendCancellationNotice({ supabase: admin as any, businessId, appointmentId, reason: cleanReason })
      } catch (e) {
        console.error('[cancelAppointmentByToken] email:', e)
      }
    } catch (e) {
      console.error('[cancelAppointmentByToken] admin client:', e)
    }
  }

  revalidatePath('/[slug]/dashboard/appointments', 'page')
  revalidatePath('/[slug]/dashboard', 'page')

  return { success: true }
}
