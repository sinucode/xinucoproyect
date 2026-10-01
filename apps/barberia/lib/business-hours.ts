// lib/business-hours.ts — horario del negocio (businesses.operating_hours).
//
// Forma guardada (JSONB): { monday: { is_open, open_time: 'HH:MM', close_time: 'HH:MM' }, … sunday }.
// Puro: convierte entre ese JSON y las filas/estado del editor semanal de Equipo.

import type { OperatingHours, DayHours } from '@xinuco/types'
import {
  DEFAULT_END_TIME,
  DEFAULT_START_TIME,
  scheduleRowsToState,
  stateToScheduleRows,
  summarizeSchedule,
  validateWeeklySchedule,
  type ScheduleRow,
  type WeeklyScheduleState,
} from '@/lib/team-utils'

/** Clave del JSON por día de la semana (0 = Domingo … 6 = Sábado). */
const DAY_KEYS: Record<number, keyof OperatingHours> = {
  1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday', 0: 'sunday',
}
const DAY_INDEXES = [1, 2, 3, 4, 5, 6, 0]

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d/

export const NO_OPEN_DAY_ERROR = 'Abre al menos un día de la semana.'

/**
 * JSON guardado → filas (solo los días abiertos). null si no hay horario definido
 * (columna vacía o con otra forma). Tolera valores sueltos: ignora los días mal formados.
 */
export function operatingHoursToRows(value: unknown): ScheduleRow[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  if (!DAY_INDEXES.some(i => obj[DAY_KEYS[i]] && typeof obj[DAY_KEYS[i]] === 'object')) return null

  const rows: ScheduleRow[] = []
  for (const index of DAY_INDEXES) {
    const day = obj[DAY_KEYS[index]] as Partial<DayHours> | undefined
    if (!day || day.is_open !== true) continue
    if (typeof day.open_time !== 'string' || typeof day.close_time !== 'string') continue
    if (!HHMM_RE.test(day.open_time) || !HHMM_RE.test(day.close_time)) continue
    rows.push({ day_of_week: index, start_time: day.open_time.slice(0, 5), end_time: day.close_time.slice(0, 5) })
  }
  return rows
}

/** ¿Hay un horario definido con al menos un día abierto? */
export function hasOperatingHours(value: unknown): boolean {
  const rows = operatingHoursToRows(value)
  return !!rows && rows.length > 0
}

/** JSON guardado → estado del editor (los 7 días). Sin horario → lunes a sábado 9:00–19:00. */
export function operatingHoursToState(value: unknown): WeeklyScheduleState {
  const rows = operatingHoursToRows(value)
  if (rows && rows.length > 0) return scheduleRowsToState(rows)
  return scheduleRowsToState(
    [1, 2, 3, 4, 5, 6].map(day_of_week => ({ day_of_week, start_time: DEFAULT_START_TIME, end_time: DEFAULT_END_TIME })),
  )
}

/** Estado del editor → JSON para guardar (los 7 días; los cerrados conservan las horas por defecto). */
export function stateToOperatingHours(state: WeeklyScheduleState): OperatingHours {
  const out = {} as OperatingHours
  for (const index of DAY_INDEXES) {
    const s = state[index]
    out[DAY_KEYS[index]] = s?.isWorking
      ? { is_open: true, open_time: s.start_time, close_time: s.end_time }
      : { is_open: false, open_time: s?.start_time ?? DEFAULT_START_TIME, close_time: s?.end_time ?? DEFAULT_END_TIME }
  }
  return out
}

/** Filas del editor de Equipo a partir del horario del negocio (para "Copiar horario del negocio"). */
export function operatingHoursToStaffRows(value: unknown): ScheduleRow[] | null {
  const rows = operatingHoursToRows(value)
  return rows && rows.length > 0 ? rows : null
}

/**
 * Valida lo que llega del cliente (nunca se confía en él): forma estricta, horas válidas y al
 * menos un día abierto. Devuelve el JSON normalizado o un mensaje en español.
 */
export function validateOperatingHours(
  value: unknown,
): { ok: true; value: OperatingHours } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Horario inválido.' }
  const obj = value as Record<string, unknown>

  const state: WeeklyScheduleState = {}
  for (const index of DAY_INDEXES) {
    const day = obj[DAY_KEYS[index]] as Partial<DayHours> | undefined
    if (!day || typeof day !== 'object' || typeof day.is_open !== 'boolean'
        || typeof day.open_time !== 'string' || typeof day.close_time !== 'string') {
      return { ok: false, error: 'Horario inválido.' }
    }
    state[index] = { isWorking: day.is_open, start_time: day.open_time, end_time: day.close_time }
  }

  const rows = stateToScheduleRows(state)
  if (rows.length === 0) return { ok: false, error: NO_OPEN_DAY_ERROR }
  const error = validateWeeklySchedule(rows)
  if (error) return { ok: false, error }

  return { ok: true, value: stateToOperatingHours(state) }
}

// ── Formato para el cliente final (12 h) ─────────────────────────────────────

/** '09:00' → '9:00 a. m.'; '19:30' → '7:30 p. m.'; '12:00' → '12:00 p. m.'. */
export function formatHour12(t: string): string {
  const [hh, mm = '00'] = t.split(':')
  const h = Number(hh)
  const suffix = h >= 12 ? 'p. m.' : 'a. m.'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${mm.slice(0, 2)} ${suffix}`
}

/** 'Lun–Sáb 9:00 a. m.–7:00 p. m.' (null si no hay horario definido). */
export function summarizeOperatingHours(value: unknown): string | null {
  const rows = operatingHoursToRows(value)
  if (!rows || rows.length === 0) return null
  return summarizeSchedule(rows, formatHour12)
}
