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
