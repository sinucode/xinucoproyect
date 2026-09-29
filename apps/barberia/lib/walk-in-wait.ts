// lib/walk-in-wait.ts — estimación de espera de la fila (turnos sin cita).
//
// CONVENCIÓN DE TIEMPO: `busy_until` viene de get_staff_status_now y, como todo
// start_time de citas, es la hora LOCAL del negocio guardada "como si fuera UTC".
// Por eso `nowMs` debe estar en la MISMA convención: usa `businessNowAsUtcMs()`.

export type StaffNowStatus = 'free' | 'busy' | 'break' | 'time_off' | 'off'

export interface StaffStatusNow {
  id:            string
  full_name:     string
  status:        StaffNowStatus
  busy_until:    string | null
  customer_name: string | null
}

export interface WaitingTurn {
  id:               string
  staff_id:         string | null
  duration_minutes?: number | null
}

export interface WaitEstimate {
  /** false si ningún barbero está trabajando ahora (todos off/almuerzo/permiso). */
  available: boolean
  /** Minutos hasta que empieza a ser atendido cada turno (por id). */
  minutesById: Record<string, number>
}

export const DEFAULT_SERVICE_MINUTES = 30
const BUSINESS_TZ = 'America/Bogota'

/** Instante actual expresado en la convención "hora local como UTC" (ms). */
export function businessNowAsUtcMs(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
}

/**
 * Asigna los turnos en espera, en orden, al barbero que se libere primero
 * (respetando el staff_id preasignado si ese barbero está disponible) y devuelve
 * cuántos minutos falta para que cada uno empiece.
 */
export function estimateWaits(
  waiting: WaitingTurn[],
  staff: StaffStatusNow[],
  nowMs: number,
): WaitEstimate {
  const freeAt = new Map<string, number>()
  for (const s of staff) {
    if (s.status === 'free') {
      freeAt.set(s.id, nowMs)
    } else if (s.status === 'busy') {
      const until = s.busy_until ? new Date(s.busy_until).getTime() : NaN
      freeAt.set(s.id, Number.isFinite(until) ? Math.max(nowMs, until) : nowMs)
    }
  }

  if (freeAt.size === 0) return { available: false, minutesById: {} }

  const minutesById: Record<string, number> = {}
  for (const turn of waiting) {
    let staffId: string | null = null
    if (turn.staff_id && freeAt.has(turn.staff_id)) {
      staffId = turn.staff_id
    } else {
      let best = Infinity
      for (const [id, t] of freeAt) {
        if (t < best) { best = t; staffId = id }
      }
    }
    if (!staffId) continue

    const start = freeAt.get(staffId) as number
    minutesById[turn.id] = Math.max(0, Math.ceil((start - nowMs) / 60_000))

    const dur = turn.duration_minutes && turn.duration_minutes > 0 ? turn.duration_minutes : DEFAULT_SERVICE_MINUTES
    freeAt.set(staffId, start + dur * 60_000)
  }

  return { available: true, minutesById }
}
