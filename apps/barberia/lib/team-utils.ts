// lib/team-utils.ts — utilidades puras del módulo "Equipo" (profesionales, horarios, estado).
//
// Sin dependencias de servidor ni de React: se usan tanto en Server Actions como en la UI.

// ── Cargos ───────────────────────────────────────────────────────────────────

export const SPECIALTY_OPTIONS = ['Barbero', 'Estilista', 'Manicurista', 'Colorista'] as const

const SPECIALTY_ALIASES: Record<string, string> = {
  barber:      'Barbero',
  barbero:     'Barbero',
  stylist:     'Estilista',
  estilista:   'Estilista',
  manicurist:  'Manicurista',
  manicurista: 'Manicurista',
  colorist:    'Colorista',
  colorista:   'Colorista',
}

/** Etiqueta amigable del cargo. Vacío → 'Profesional'; desconocido → el texto tal cual (recortado). */
export function specialtyLabel(raw: string | null | undefined): string {
  const value = (raw ?? '').trim()
  if (!value) return 'Profesional'
  return SPECIALTY_ALIASES[value.toLowerCase()] ?? value
}

// ── Estado actual ────────────────────────────────────────────────────────────

export const STAFF_STATUS_LABELS = {
  free:     'Libre',
  busy:     'Atendiendo',
  break:    'En descanso',
  time_off: 'De permiso',
  off:      'Fuera de horario',
} as const

// ── Horarios ─────────────────────────────────────────────────────────────────

export interface ScheduleRow {
  day_of_week: number
  start_time:  string
  end_time:    string
}

/** 0 = Domingo … 6 = Sábado. */
const DAY_SHORT: Record<number, string> = { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb' }
const DAY_NAME: Record<number, string>  = {
  0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado',
}
/** Semana empezando en lunes. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

/** 'HH:MM' o 'HH:MM:SS' → '9:00' / '19:30' (24 h, sin cero a la izquierda). */
export function formatHour(t: string): string {
  const [h, m] = t.split(':')
  return `${Number(h)}:${(m ?? '00').slice(0, 2)}`
}

/**
 * Resume el horario semanal: 'Lun–Sáb 9:00–19:00 · Dom 10:00–14:00'.
 * Días consecutivos (lunes primero) con las mismas horas se agrupan.
 * Si un día tiene varias filas usa la entrada más temprana y la salida más tardía.
 */
export function summarizeSchedule(rows: ScheduleRow[]): string {
  if (!rows || rows.length === 0) return 'Sin horario'

  const byDay = new Map<number, { start: string; end: string }>()
  for (const r of rows) {
    const start = r.start_time.slice(0, 5)
    const end = r.end_time.slice(0, 5)
    const cur = byDay.get(r.day_of_week)
    if (!cur) byDay.set(r.day_of_week, { start, end })
    else byDay.set(r.day_of_week, {
      start: start < cur.start ? start : cur.start,
      end:   end > cur.end ? end : cur.end,
    })
  }

  const groups: { days: number[]; start: string; end: string }[] = []
  for (const dow of WEEK_ORDER) {
    const hours = byDay.get(dow)
    if (!hours) continue
    const last = groups[groups.length - 1]
    const prevDow = last ? last.days[last.days.length - 1] : null
    const isConsecutive =
      prevDow !== null && WEEK_ORDER.indexOf(dow) === WEEK_ORDER.indexOf(prevDow) + 1
    if (last && isConsecutive && last.start === hours.start && last.end === hours.end) {
      last.days.push(dow)
    } else {
      groups.push({ days: [dow], start: hours.start, end: hours.end })
    }
  }

  if (groups.length === 0) return 'Sin horario'

  return groups
    .map(g => {
      const days = g.days.length === 1
        ? DAY_SHORT[g.days[0]]
        : `${DAY_SHORT[g.days[0]]}–${DAY_SHORT[g.days[g.days.length - 1]]}`
      return `${days} ${formatHour(g.start)}–${formatHour(g.end)}`
    })
    .join(' · ')
}

/**
 * Valida el horario semanal. Devuelve un mensaje en español o null si es válido.
 * Se usa en el cliente (antes de enviar) y en el servidor (nunca se confía en el cliente).
 */
export function validateWeeklySchedule(rows: ScheduleRow[]): string | null {
  if (!Array.isArray(rows)) return 'Horario inválido.'

  const seen = new Set<number>()
  for (const r of rows) {
    if (!r || !Number.isInteger(r.day_of_week) || r.day_of_week < 0 || r.day_of_week > 6) {
      return 'Día de la semana inválido.'
    }
    const name = DAY_NAME[r.day_of_week]
    if (seen.has(r.day_of_week)) return `${name}: el día está repetido.`
    seen.add(r.day_of_week)

    if (typeof r.start_time !== 'string' || typeof r.end_time !== 'string'
        || !TIME_RE.test(r.start_time) || !TIME_RE.test(r.end_time)) {
      return `${name}: la hora no es válida.`
    }
    if (r.end_time.slice(0, 5) <= r.start_time.slice(0, 5)) {
      return `${name}: la hora de salida debe ser posterior a la de entrada.`
    }
  }
  return null
}

// ── Editor de horario semanal (estado ↔ filas) ───────────────────────────────

/** Días en orden de semana (lunes primero). `letter` se usa en los chips del "Horario rápido". */
export const WEEK_DAYS = [
  { index: 1, name: 'Lunes',     short: 'Lun', letter: 'L' },
  { index: 2, name: 'Martes',    short: 'Mar', letter: 'M' },
  { index: 3, name: 'Miércoles', short: 'Mié', letter: 'X' },
  { index: 4, name: 'Jueves',    short: 'Jue', letter: 'J' },
  { index: 5, name: 'Viernes',   short: 'Vie', letter: 'V' },
  { index: 6, name: 'Sábado',    short: 'Sáb', letter: 'S' },
  { index: 0, name: 'Domingo',   short: 'Dom', letter: 'D' },
] as const

export const DEFAULT_START_TIME = '09:00'
export const DEFAULT_END_TIME = '19:00'
/** Lunes a sábado. */
export const DEFAULT_WORK_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6]

export interface DayScheduleState {
  isWorking:  boolean
  start_time: string // 'HH:MM'
  end_time:   string // 'HH:MM'
}

/** Clave = day_of_week (0 = Domingo … 6 = Sábado). Siempre trae los 7 días. */
export type WeeklyScheduleState = Record<number, DayScheduleState>

/**
 * Filas guardadas → estado de los 7 días. Si un día tiene varias filas usa la entrada más
 * temprana y la salida más tardía; los días sin filas quedan en "Descansa".
 */
export function scheduleRowsToState(rows: ScheduleRow[] | null | undefined): WeeklyScheduleState {
  const state: WeeklyScheduleState = {}
  for (const day of WEEK_DAYS) {
    const dayRows = (rows ?? []).filter(r => r.day_of_week === day.index)
    if (dayRows.length > 0) {
      const starts = dayRows.map(r => r.start_time.slice(0, 5)).sort()
      const ends = dayRows.map(r => r.end_time.slice(0, 5)).sort()
      state[day.index] = { isWorking: true, start_time: starts[0], end_time: ends[ends.length - 1] }
    } else {
      state[day.index] = { isWorking: false, start_time: DEFAULT_START_TIME, end_time: DEFAULT_END_TIME }
    }
  }
  return state
}

/** Estado → filas para guardar: solo los días que trabaja, lunes primero. */
export function stateToScheduleRows(state: WeeklyScheduleState): ScheduleRow[] {
  return WEEK_DAYS
    .map(d => ({ day: d.index, s: state[d.index] }))
    .filter(x => x.s?.isWorking)
    .map(x => ({ day_of_week: x.day, start_time: x.s.start_time, end_time: x.s.end_time }))
}

/**
 * "Horario rápido": los días elegidos pasan a trabajar con esas horas y los demás a "Descansa"
 * (conservan las horas que tenían, por si se reactivan). No muta el estado recibido.
 */
export function applyQuickSchedule(
  state: WeeklyScheduleState,
  days: readonly number[],
  start: string,
  end: string,
): WeeklyScheduleState {
  const selected = new Set(days)
  const next: WeeklyScheduleState = {}
  for (const day of WEEK_DAYS) {
    const cur = state[day.index] ?? { isWorking: false, start_time: DEFAULT_START_TIME, end_time: DEFAULT_END_TIME }
    next[day.index] = selected.has(day.index)
      ? { isWorking: true, start_time: start, end_time: end }
      : { ...cur, isWorking: false }
  }
  return next
}

/**
 * El horario más común entre los miembros activos que tienen horario (compara el resumen
 * `summarizeSchedule`; en empate gana el primero). null si nadie tiene horario.
 */
export function mostCommonSchedule(
  members: { is_active: boolean; schedules: ScheduleRow[] }[],
): ScheduleRow[] | null {
  const groups = new Map<string, { count: number; rows: ScheduleRow[] }>()
  for (const m of members) {
    if (!m.is_active || !m.schedules || m.schedules.length === 0) continue
    const key = summarizeSchedule(m.schedules)
    const g = groups.get(key)
    if (g) g.count += 1
    else groups.set(key, { count: 1, rows: m.schedules })
  }
  let best: { count: number; rows: ScheduleRow[] } | null = null
  for (const g of groups.values()) {
    if (!best || g.count > best.count) best = g
  }
  return best ? best.rows : null
}
