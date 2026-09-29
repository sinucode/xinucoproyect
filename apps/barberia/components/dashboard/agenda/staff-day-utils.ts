// Utilidades puras para la vista de día del staff.
// Convención: start_time / starts_at / ends_at guardan la hora LOCAL del negocio como UTC,
// por eso todo se calcula relativo a `${dateKey}T00:00:00Z` (sin zona horaria del navegador).

import type { StaffBreak, StaffTimeOff } from '@xinuco/types'

export type BreakRow = Pick<StaffBreak, 'id' | 'day_of_week' | 'start_time' | 'end_time' | 'label'>
export type TimeOffRow = Pick<StaffTimeOff, 'id' | 'starts_at' | 'ends_at' | 'kind' | 'reason'>

export interface TimelineAppt {
  id: string
  start_time: string
  status: string
  customer_name: string
  service_name: string
  /** duración + buffer del servicio, en minutos */
  total_minutes: number
}

export interface MinuteRange {
  startMin: number
  endMin: number
}

export const TIME_OFF_KIND_LABEL: Record<string, string> = {
  permission: 'Permiso',
  vacation: 'Vacaciones',
  sick: 'Incapacidad',
  other: 'Otro',
}

/** 'HH:MM' o 'HH:MM:SS' → minutos desde 00:00. */
export function timeToMin(t: string): number {
  const [h, m] = t.split(':')
  return Number(h) * 60 + Number(m)
}

/** minutos → 'HH:MM' (24 h). */
export function minToHHMM(min: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(min)))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Como 'H:MM' sin cero a la izquierda en la hora (p. ej. "9:00"). */
export function minToLabel(min: number): string {
  return minToHHMM(min).replace(/^0/, '')
}

/** Minutos de un ISO relativos al inicio (00:00 UTC) de `dateKey`. Puede ser <0 o >1440. */
export function isoToDayMin(iso: string, dateKey: string): number {
  return (new Date(iso).getTime() - new Date(`${dateKey}T00:00:00Z`).getTime()) / 60000
}

export function apptRange(a: TimelineAppt, dateKey: string): MinuteRange {
  const startMin = isoToDayMin(a.start_time, dateKey)
  return { startMin, endMin: startMin + a.total_minutes }
}

export function timeOffRange(t: TimeOffRow, dateKey: string): MinuteRange {
  return {
    startMin: Math.max(0, isoToDayMin(t.starts_at, dateKey)),
    endMin: Math.min(1440, isoToDayMin(t.ends_at, dateKey)),
  }
}

export function overlaps(a: MinuteRange, b: MinuteRange): boolean {
  return a.startMin < b.endMin && a.endMin > b.startMin
}

/** Cuántas citas se cruzan con [startMin, endMin). */
export function countOverlapping(ranges: MinuteRange[], startMin: number, endMin: number): number {
  return ranges.filter((r) => overlaps(r, { startMin, endMin })).length
}

/** Minutos libres dentro del horario (sin citas, pausas ni permisos). */
export function freeMinutes(schedule: MinuteRange, busy: MinuteRange[]): number {
  const start = Math.max(0, Math.floor(schedule.startMin))
  const end = Math.min(1440, Math.ceil(schedule.endMin))
  const taken = new Array<boolean>(1440).fill(false)
  for (const r of busy) {
    const s = Math.max(start, Math.floor(r.startMin))
    const e = Math.min(end, Math.ceil(r.endMin))
    for (let i = s; i < e; i++) taken[i] = true
  }
  let free = 0
  for (let i = start; i < end; i++) if (!taken[i]) free++
  return free
}

/** 210 → "3 h 30 min"; 300 → "5 h"; 45 → "45 min". */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

export type RowKind = 'appt' | 'free' | 'outside' | `break:${string}` | `off:${string}`

export interface GridSegment {
  kind: 'free' | 'outside' | 'break' | 'off'
  /** índice de fila (0-based) donde empieza */
  row: number
  span: number
  startMin: number
  endMin: number
  /** id de la pausa/permiso (solo break/off) */
  refId?: string
}

export interface GridAppt {
  appt: TimelineAppt
  row: number
  span: number
  startMin: number
  endMin: number
}

export interface TimelineLayout {
  rangeStart: number
  rowCount: number
  interval: number
  segments: GridSegment[]
  appts: GridAppt[]
}

const MAX_ROWS = 288

/**
 * Calcula las filas de la línea de tiempo: rango = horario del día ampliado para
 * incluir citas que queden fuera; cada fila = `interval` minutos.
 * Precedencia por fila: cita > permiso > pausa > fuera de horario > libre.
 */
export function buildTimelineLayout(input: {
  schedule: MinuteRange
  interval: number
  breaks: { id: string; startMin: number; endMin: number }[]
  timeOff: { id: string; startMin: number; endMin: number }[]
  appts: TimelineAppt[]
  dateKey: string
}): TimelineLayout {
  const { schedule, breaks, timeOff, dateKey } = input
  const interval = Math.max(5, Math.floor(input.interval) || 30)

  const apptRanges = input.appts.map((a) => ({ appt: a, ...apptRange(a, dateKey) }))

  let rangeStart = schedule.startMin
  let rangeEnd = schedule.endMin
  for (const a of apptRanges) {
    rangeStart = Math.min(rangeStart, Math.floor(a.startMin / interval) * interval)
    rangeEnd = Math.max(rangeEnd, Math.ceil(a.endMin / interval) * interval)
  }
  rangeStart = Math.max(0, rangeStart)
  rangeEnd = Math.min(1440, rangeEnd)

  const rowCount = Math.max(0, Math.min(MAX_ROWS, Math.ceil((rangeEnd - rangeStart) / interval)))

  // Clasificar cada fila
  const kinds: { kind: RowKind; refId?: string }[] = []
  for (let i = 0; i < rowCount; i++) {
    const row: MinuteRange = { startMin: rangeStart + i * interval, endMin: rangeStart + (i + 1) * interval }
    if (apptRanges.some((a) => overlaps(a, row))) {
      kinds.push({ kind: 'appt' })
      continue
    }
    const off = timeOff.find((t) => overlaps(t, row))
    if (off) {
      kinds.push({ kind: `off:${off.id}`, refId: off.id })
      continue
    }
    const brk = breaks.find((b) => overlaps(b, row))
    if (brk) {
      kinds.push({ kind: `break:${brk.id}`, refId: brk.id })
      continue
    }
    kinds.push({ kind: row.startMin < schedule.startMin || row.endMin > schedule.endMin ? 'outside' : 'free' })
  }

  // Agrupar filas consecutivas iguales (pausas/permisos/fuera de horario); libres una a una
  const segments: GridSegment[] = []
  let i = 0
  while (i < rowCount) {
    const k = kinds[i]
    if (k.kind === 'appt') {
      i++
      continue
    }
    const base: 'free' | 'outside' | 'break' | 'off' = k.kind.startsWith('break:')
      ? 'break'
      : k.kind.startsWith('off:')
        ? 'off'
        : (k.kind as 'free' | 'outside')
    let j = i + 1
    if (base !== 'free') {
      while (j < rowCount && kinds[j].kind === k.kind) j++
    }
    segments.push({
      kind: base,
      row: i,
      span: j - i,
      startMin: rangeStart + i * interval,
      endMin: rangeStart + j * interval,
      refId: k.refId,
    })
    i = j
  }

  const appts: GridAppt[] = apptRanges.map((a) => {
    const first = Math.max(0, Math.floor((a.startMin - rangeStart) / interval))
    const last = Math.min(rowCount - 1, Math.ceil((a.endMin - rangeStart) / interval) - 1)
    return {
      appt: a.appt,
      row: first,
      span: Math.max(1, last - first + 1),
      startMin: a.startMin,
      endMin: a.endMin,
    }
  })

  return { rangeStart, rowCount, interval, segments, appts }
}
