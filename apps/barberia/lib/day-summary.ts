// lib/day-summary.ts — matemática pura del resumen "Tu día" del barbero (Inicio).
//
// Convención: `start_time` = hora local del negocio como UTC (comparar con el "ahora" local
// del negocio en esa misma escala, ver lib/agenda-status.ts). `staff_ledger.created_at`,
// en cambio, es un INSTANTE real: el día del negocio se delimita en America/Bogota (UTC-5,
// Colombia no tiene horario de verano).

export interface SummaryAppt {
  id: string
  status: string
  start_time: string | null
  customer_name: string
  service_name: string
  duration_minutes: number
}

export interface NextAppt {
  appt: SummaryAppt
  /** Minutos que faltan para que empiece (0 = ya toca / está en su hora). */
  minutesUntil: number
}

export interface DaySummary {
  total: number
  /** Atendidas: ya terminadas (completadas o listas para pagar). */
  attended: number
  /** Pendientes: programadas, en curso o con pago pendiente. */
  pending: number
  next: NextAppt | null
}

const ATTENDED = ['completed', 'ready_to_pay']
const PENDING = ['scheduled', 'in_progress', 'payment_pending']

/**
 * Resumen del día a partir de las citas de HOY (sin canceladas ni "no asistió").
 * Próxima cita = la programada más cercana que aún no terminó su espacio (si ya está en su
 * hora y no se ha iniciado, "minutesUntil" es 0 → "ahora").
 */
export function computeDaySummary(appts: SummaryAppt[], nowWallMs: number): DaySummary {
  const valid = appts.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show')
  const attended = valid.filter((a) => ATTENDED.includes(a.status)).length
  const pending = valid.filter((a) => PENDING.includes(a.status)).length

  let next: NextAppt | null = null
  for (const a of valid) {
    if (a.status !== 'scheduled' || !a.start_time) continue
    const start = Date.parse(a.start_time)
    if (Number.isNaN(start)) continue
    if (start + a.duration_minutes * 60_000 <= nowWallMs) continue // ya pasó su espacio: es "atrasada"
    if (!next || start < Date.parse(next.appt.start_time as string)) {
      next = { appt: a, minutesUntil: Math.max(0, Math.ceil((start - nowWallMs) / 60_000)) }
    }
  }

  return { total: valid.length, attended, pending, next }
}

/** 0 → "ahora"; 25 → "en 25 min"; 80 → "en 1 h 20 min"; 120 → "en 2 h". */
export function formatMinutesUntil(min: number): string {
  if (min <= 0) return 'ahora'
  if (min < 60) return `en ${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `en ${h} h` : `en ${h} h ${m} min`
}

/** Instantes reales [inicio, fin) del día 'YYYY-MM-DD' en la zona del negocio (America/Bogota, UTC-5). */
export function businessDayInstants(dateKey: string): { from: string; to: string } {
  const next = new Date(`${dateKey}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return {
    from: `${dateKey}T00:00:00-05:00`,
    to: `${next.toISOString().slice(0, 10)}T00:00:00-05:00`,
  }
}

/** Tipos de movimiento que cuentan como "ganado": comisión y propina. */
export const EARNED_ENTRY_TYPES = ['commission', 'tip'] as const

/** Suma lo ganado (comisión + propina) de un listado de movimientos de la cuenta del profesional. */
export function sumEarned(entries: { entry_type: string; amount: number | null }[]): number {
  let total = 0
  for (const e of entries) {
    if ((EARNED_ENTRY_TYPES as readonly string[]).includes(e.entry_type)) total += Number(e.amount) || 0
  }
  return total
}

export interface QueueRow {
  status: string
  staff_id: string | null
}

/** Fila de espera: cuántos esperan en total y cuántos son del barbero (elegido / apartado para él). */
export function summarizeQueue(rows: QueueRow[], myStaffId: string): { waiting: number; mine: number } {
  const waiting = rows.filter((r) => r.status === 'waiting')
  return { waiting: waiting.length, mine: waiting.filter((r) => r.staff_id === myStaffId).length }
}
