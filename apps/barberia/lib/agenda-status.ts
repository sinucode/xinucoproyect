// lib/agenda-status.ts — reglas puras de la Agenda: citas atrasadas y "sin cerrar".
//
// CONVENCIÓN DE TIEMPO (ver lib/agenda-time.ts): `start_time` guarda la hora LOCAL del
// negocio "como si fuera UTC". Para comparar con "ahora" hay que usar el AHORA local del
// negocio expresado igual (milisegundos de `${hoy}T${HH:MM}:00Z`), nunca Date.now().

import { apptDateKey, businessNowHHMM, businessTodayISODate } from '@/lib/agenda-time'

/** Estados que aún falta cerrar (la cita no terminó de verdad). */
export const OPEN_APPT_STATUSES = ['scheduled', 'in_progress', 'ready_to_pay'] as const

/** "Ahora" del negocio como milisegundos en la misma escala que `start_time` (hora local como UTC). */
export function businessWallNowMs(): number {
  return Date.parse(`${businessTodayISODate()}T${businessNowHHMM()}:00Z`)
}

interface OverdueInput {
  status: string
  start_time: string | null | undefined
  /** Duración del servicio en minutos (30 si no se conoce). */
  duration_minutes?: number | null
}

/**
 * Cita "atrasada": sigue `scheduled` y su hora (inicio + duración) ya pasó.
 * El barbero debe cerrarla: Iniciar o marcar "No asistió".
 */
export function isApptOverdue(appt: OverdueInput, nowWallMs: number): boolean {
  if (appt.status !== 'scheduled' || !appt.start_time) return false
  const start = Date.parse(appt.start_time)
  if (Number.isNaN(start)) return false
  const minutes = appt.duration_minutes && appt.duration_minutes > 0 ? appt.duration_minutes : 30
  return start + minutes * 60_000 <= nowWallMs
}

/** ¿La cita es de un día anterior a hoy y sigue abierta (programada / en curso / lista para pagar)? */
export function isUnresolvedPast(
  appt: { status: string; start_time: string | null | undefined },
  todayKey: string,
): boolean {
  if (!appt.start_time) return false
  if (!(OPEN_APPT_STATUSES as readonly string[]).includes(appt.status)) return false
  return apptDateKey(appt.start_time) < todayKey
}

/**
 * Separa las citas de días anteriores que siguen abiertas ("Sin cerrar") del resto.
 * Conserva el orden original en ambas listas.
 */
export function splitUnresolvedPast<T extends { status: string; start_time: string | null | undefined }>(
  appts: T[],
  todayKey: string,
): { unresolved: T[]; rest: T[] } {
  const unresolved: T[] = []
  const rest: T[] = []
  for (const a of appts) (isUnresolvedPast(a, todayKey) ? unresolved : rest).push(a)
  return { unresolved, rest }
}

// ── Acciones de una cita según su estado y quién la mira ─────────────────────
// Una sola fuente de verdad para la tarjeta de la lista (InteractiveAgenda) y la
// hoja de detalle de la línea de tiempo (AppointmentDetailSheet).

export type ApptAction = 'start' | 'finish' | 'no_show' | 'cancel' | 'checkout'

/** Acciones que solo cambian el estado (todas menos "Cobrar", que abre la caja). */
export type ApptStatusAction = Exclude<ApptAction, 'checkout'>

/** Estado al que lleva cada acción de cambio de estado. */
export const APPT_ACTION_NEXT_STATUS: Record<ApptStatusAction, 'in_progress' | 'ready_to_pay' | 'no_show' | 'cancelled'> = {
  start: 'in_progress',
  finish: 'ready_to_pay',
  no_show: 'no_show',
  cancel: 'cancelled',
}

/** Etiqueta del estado. Quien no es admin no cobra: la cita lista para pagar "pasa por caja". */
export function apptStatusLabel(status: string, isAdmin: boolean): string {
  switch (status) {
    case 'payment_pending': return 'Pago Pendiente'
    case 'scheduled': return 'Programada'
    case 'in_progress': return 'En curso'
    case 'ready_to_pay': return isAdmin ? 'Lista para Pagar' : 'Lista para pagar · pasa por caja'
    case 'completed': return 'Completada'
    case 'cancelled': return 'Cancelada'
    case 'no_show': return 'No asistió'
    default: return status
  }
}

/** Acciones disponibles (en orden de aparición). "Cobrar" es solo del administrador. */
export function availableApptActions(status: string, isAdmin: boolean): ApptAction[] {
  switch (status) {
    case 'scheduled': return ['start', 'no_show', 'cancel']
    case 'payment_pending': return ['cancel']
    case 'in_progress': return ['finish']
    case 'ready_to_pay': return isAdmin ? ['checkout'] : []
    default: return []
  }
}

/** Texto de confirmación de las acciones destructivas (null = sin confirmación). */
export function apptActionConfirmText(action: ApptAction, customerName: string): string | null {
  if (action === 'no_show') return `¿Marcar que ${customerName} no asistió?`
  if (action === 'cancel') return `¿Cancelar la cita de ${customerName}?`
  return null
}
