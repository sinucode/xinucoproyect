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
  /**
   * Inicio del hueco apartado en la agenda (hora local del negocio como UTC, ISO).
   * Si viene, ese es el momento de atención de este turno y ocupa a `staff_id`
   * desde ahí hasta ahí + duración.
   */
  reserved_start?: string | null
}

export interface WaitEstimate {
  /** false si ningún barbero está trabajando ahora (todos off/almuerzo/permiso). */
  available: boolean
  /** Minutos hasta que empieza a ser atendido cada turno (por id). */
  minutesById: Record<string, number>
}

/** ¿El turno en espera ya tiene un hueco apartado en la agenda (cita programada)? */
export function isReservedTurn(w: {
  status: string
  appointment?: { status: string; start_time: string } | null
}): boolean {
  return w.status === 'waiting' && w.appointment?.status === 'scheduled' && !!w.appointment.start_time
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
 * Estima cuántos minutos falta para que cada turno en espera empiece.
 *  - Turnos con hueco apartado (`reserved_start`): usan esa hora y ocupan a su
 *    barbero de inicio a inicio + duración.
 *  - Turnos sin apartar: en orden, al barbero que se libere primero (respetando
 *    el staff_id preasignado si está disponible), saltando los huecos apartados.
 */
export function estimateWaits(
  waiting: WaitingTurn[],
  staff: StaffStatusNow[],
  nowMs: number,
): WaitEstimate {
  const durMs = (t: WaitingTurn) =>
    (t.duration_minutes && t.duration_minutes > 0 ? t.duration_minutes : DEFAULT_SERVICE_MINUTES) * 60_000

  const minutesById: Record<string, number> = {}

  // 1) Turnos con hueco apartado: hora fija + ocupación del barbero
  const reserved = new Map<string, { start: number; end: number }[]>()
  for (const turn of waiting) {
    const start = turn.reserved_start ? new Date(turn.reserved_start).getTime() : NaN
    if (!Number.isFinite(start)) continue
    minutesById[turn.id] = Math.max(0, Math.ceil((start - nowMs) / 60_000))
    if (turn.staff_id) {
      const list = reserved.get(turn.staff_id) ?? []
      list.push({ start, end: start + durMs(turn) })
      reserved.set(turn.staff_id, list)
    }
  }

  const freeAt = new Map<string, number>()
  for (const s of staff) {
    if (s.status === 'free') {
      freeAt.set(s.id, nowMs)
    } else if (s.status === 'busy') {
      const until = s.busy_until ? new Date(s.busy_until).getTime() : NaN
      freeAt.set(s.id, Number.isFinite(until) ? Math.max(nowMs, until) : nowMs)
    }
  }

  if (freeAt.size === 0) return { available: false, minutesById }

  // Primer inicio >= t de duración d que no pise un hueco apartado de ese barbero
  const firstFit = (staffId: string, t: number, d: number) => {
    const blocks = (reserved.get(staffId) ?? []).slice().sort((a, b) => a.start - b.start)
    let start = t
    for (const b of blocks) {
      if (start < b.end && start + d > b.start) start = b.end
    }
    return start
  }

  // 2) Turnos sin apartar
  for (const turn of waiting) {
    if (turn.id in minutesById) continue
    const d = durMs(turn)

    let staffId: string | null = null
    let start = Infinity
    if (turn.staff_id && freeAt.has(turn.staff_id)) {
      staffId = turn.staff_id
      start = firstFit(staffId, freeAt.get(staffId) as number, d)
    } else {
      for (const [id, t] of freeAt) {
        const candidate = firstFit(id, t, d)
        if (candidate < start) { start = candidate; staffId = id }
      }
    }
    if (!staffId) continue

    minutesById[turn.id] = Math.max(0, Math.ceil((start - nowMs) / 60_000))
    freeAt.set(staffId, start + d)
  }

  return { available: true, minutesById }
}
