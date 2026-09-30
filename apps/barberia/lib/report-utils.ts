// lib/report-utils.ts — lógica PURA del tablero gerencial de Reportes (períodos, formato de plata,
// cascada de utilidad, mapa de calor). Sin dependencias de servidor: la usan la Server Action,
// los componentes cliente y los tests.
import type {
  ManagementHeatCell, ManagementMonthly, ManagementStaff, ProfitLossResult,
} from '@xinuco/types'
import { addDaysToDateKey } from '@/lib/agenda-time'
import { previousMonth } from '@/lib/accounting-utils'

// ── Períodos ──────────────────────────────────────────────────────────────────

export const PERIOD_KEYS = ['mes', 'mes-pasado', '3-meses', 'anio'] as const
export type PeriodKey = (typeof PERIOD_KEYS)[number]

export const DEFAULT_PERIOD: PeriodKey = 'mes'

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  'mes':        'Este mes',
  'mes-pasado': 'Mes pasado',
  '3-meses':    'Últimos 3 meses',
  'anio':       'Este año',
}

export function isPeriodKey(value: unknown): value is PeriodKey {
  return typeof value === 'string' && (PERIOD_KEYS as readonly string[]).includes(value)
}

/**
 * Rango de fechas ('YYYY-MM-DD', hora de Bogotá) de un período.
 *  - mes:        del día 1 a hoy
 *  - mes-pasado: del día 1 al último día del mes anterior
 *  - 3-meses:    del día 1 de hace dos meses a hoy (3 meses calendario, el actual incluido)
 *  - anio:       del 1 de enero a hoy
 * `todayISO` se inyecta para poder probarlo (en producción: businessTodayISODate()).
 */
export function periodRange(key: PeriodKey, todayISO: string): { from: string; to: string } {
  const thisMonth = todayISO.slice(0, 7)
  switch (key) {
    case 'mes-pasado': {
      const pm = previousMonth(thisMonth)
      return { from: `${pm}-01`, to: addDaysToDateKey(`${thisMonth}-01`, -1) }
    }
    case '3-meses': {
      const m2 = previousMonth(previousMonth(thisMonth))
      return { from: `${m2}-01`, to: todayISO }
    }
    case 'anio':
      return { from: `${todayISO.slice(0, 4)}-01-01`, to: todayISO }
    case 'mes':
    default:
      return { from: `${thisMonth}-01`, to: todayISO }
  }
}

const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** '2026-09' → 'sep'. */
export function monthShort(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey)
  return m ? (MONTH_SHORT[Number(m[2]) - 1] ?? monthKey) : monthKey
}

/** '2026-09' → "sep '26". */
export function monthShortWithYear(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey)
  return m ? `${MONTH_SHORT[Number(m[2]) - 1] ?? monthKey} '${m[1].slice(2)}` : monthKey
}

function dayMonth(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  return m ? `${Number(m[3])} ${MONTH_SHORT[Number(m[2]) - 1]}` : dateKey
}

/** ('2026-09-01','2026-09-30') → '1 sep – 30 sep 2026'. */
export function periodText(from: string, to: string): string {
  const fy = from.slice(0, 4)
  const ty = to.slice(0, 4)
  return fy === ty ? `${dayMonth(from)} – ${dayMonth(to)} ${ty}` : `${dayMonth(from)} ${fy} – ${dayMonth(to)} ${ty}`
}

/** Días enteros entre dos fechas 'YYYY-MM-DD' (b − a). */
export function daysBetween(a: string, b: string): number {
  const da = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)))
  const db = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)))
  return Math.round((db - da) / 86_400_000)
}

/** 'hace 62 días' (última visita → hoy). */
export function relativeDays(lastISO: string, todayISO: string): string {
  const n = daysBetween(lastISO.slice(0, 10), todayISO.slice(0, 10))
  if (n <= 0) return 'hoy'
  return n === 1 ? 'hace 1 día' : `hace ${n} días`
}

// ── Formato ───────────────────────────────────────────────────────────────────

/** Miles con punto, sin depender del ICU del navegador: 1234567 → '1.234.567'. */
export function formatInt(n: number): string {
  const v = Math.round(Math.abs(n))
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Plata: 1234567 → '$1.234.567'; negativo → '−$1.234' (signo menos real). */
export function formatMoney(n: number): string {
  const v = Math.round(n)
  return `${v < 0 ? '−' : ''}$${formatInt(v)}`
}

/** Con signo explícito: +$1.234 / −$1.234. */
export function formatMoneySigned(n: number): string {
  const v = Math.round(n)
  if (v === 0) return '$0'
  return `${v > 0 ? '+' : '−'}$${formatInt(v)}`
}

function trimDecimal(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/\.0+$/, '').replace('.', ',')
}

/** Plata compacta para ejes y etiquetas: 1200000 → '$1,2 M', 850000 → '$850 mil', 420 → '$420'. */
export function formatMoneyCompact(n: number): string {
  const abs = Math.abs(Math.round(n))
  const sign = n < 0 && abs > 0 ? '−' : ''
  if (abs >= 999_500) {
    const v = abs / 1_000_000
    return `${sign}$${trimDecimal(v, v >= 100 ? 0 : 1)} M`
  }
  if (abs >= 1000) {
    const k = abs / 1000
    return `${sign}$${trimDecimal(k, k >= 10 ? 0 : 1)} mil`
  }
  return `${sign}$${abs}`
}

/** 12.4 → '12 %'. Con `decimals` = 1 → '12,4 %'. */
export function formatPct(n: number, decimals = 0): string {
  const v = decimals > 0 ? trimDecimal(Math.abs(n), decimals) : String(Math.round(Math.abs(n)))
  return `${n < 0 && Number(v) !== 0 ? '−' : ''}${v} %`
}

export function pluralize(n: number, one: string, many: string): string {
  return `${formatInt(n)} ${n === 1 ? one : many}`
}

// ── Utilidad mes a mes ────────────────────────────────────────────────────────

/**
 * Quita los primeros meses sin ventas (solo reflejan desgaste de equipos): empieza en el primer
 * mes con ingresos > 0. Si ninguno tiene ingresos, devuelve todos.
 */
export function trimMonthly(monthly: ManagementMonthly[]): ManagementMonthly[] {
  const first = monthly.findIndex(m => m.revenue > 0)
  return first <= 0 ? monthly : monthly.slice(first)
}

// ── Cascada "De cada $100 que entran…" ───────────────────────────────────────

export type WaterfallKind = 'start' | 'cost' | 'gain' | 'result'

export interface WaterfallStep {
  key:     string
  label:   string
  /** Con signo: costos negativos, ingresos/ganancias positivos. */
  value:   number
  kind:    WaterfallKind
  /** Posición acumulada antes y después del paso (para dibujar la barra flotante). */
  from:    number
  to:      number
  /** Cuánto de cada $100 de ingresos representa (con signo). Null si no hay ingresos. */
  per100:  number | null
}

export const MAX_WATERFALL_CATEGORIES = 5

/**
 * Pasos de la cascada: Ingresos → − costo de productos → − comisiones → − cada categoría de gasto
 * (las 5 mayores + "Otros gastos") → − desgaste → ± venta o baja de equipos → = Utilidad.
 * Los pasos en cero se omiten (salvo Ingresos y el resultado).
 */
export function buildWaterfall(
  pl: ProfitLossResult,
  categoryLabel: (slug: string) => string,
): WaterfallStep[] {
  const revenue = pl.revenue.total
  const steps: WaterfallStep[] = []
  let running = 0

  const per100 = (value: number): number | null => (revenue > 0 ? (value / revenue) * 100 : null)

  steps.push({ key: 'revenue', label: 'Ingresos', value: revenue, kind: 'start', from: 0, to: revenue, per100: per100(revenue) })
  running = revenue

  const addCost = (key: string, label: string, amount: number) => {
    if (!amount) return
    const value = -amount
    steps.push({ key, label, value, kind: 'cost', from: running, to: running + value, per100: per100(value) })
    running += value
  }

  addCost('cogs', 'Costo de productos', pl.cost_of_goods)
  addCost('commissions', 'Comisiones del equipo', pl.commissions)

  const cats = [...(pl.expenses.by_category ?? [])].filter(c => c.total > 0).sort((a, b) => b.total - a.total)
  const top = cats.slice(0, MAX_WATERFALL_CATEGORIES)
  const rest = cats.slice(MAX_WATERFALL_CATEGORIES).reduce((s, c) => s + c.total, 0)
  for (const c of top) addCost(`cat:${c.category}`, categoryLabel(c.category), c.total)
  addCost('other-expenses', 'Otros gastos menores', rest)

  addCost('depreciation', 'Desgaste de equipos', pl.depreciation ?? 0)

  const disposals = pl.asset_disposals ?? 0
  if (disposals) {
    steps.push({
      key: 'disposals',
      label: disposals > 0 ? 'Ganancia por venta de equipos' : 'Pérdida por venta o baja de equipos',
      value: disposals,
      kind: disposals > 0 ? 'gain' : 'cost',
      from: running,
      to: running + disposals,
      per100: per100(disposals),
    })
    running += disposals
  }

  steps.push({
    key: 'result',
    label: pl.net_profit < 0 ? 'Pérdida' : 'Utilidad',
    value: pl.net_profit,
    kind: 'result',
    from: 0,
    to: pl.net_profit,
    per100: per100(pl.net_profit),
  })
  return steps
}

/** "$15 de cada $100" (el signo lo pone quien lo muestre). */
export function per100Text(per100: number | null): string {
  if (per100 === null) return '—'
  const v = Math.round(Math.abs(per100))
  return `$${v} de cada $100`
}

// ── Mapa de calor ─────────────────────────────────────────────────────────────

export const DOW_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const
export const DOW_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'] as const
export const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const

/** Orden de filas: lunes a sábado; el domingo solo si hay capacidad ese día. */
const ROW_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** '3 p. m.', '12 p. m.', '8 a. m.' (0..23). */
export function formatHour(h: number): string {
  const hh = ((h % 24) + 24) % 24
  return `${hh % 12 === 0 ? 12 : hh % 12} ${hh < 12 ? 'a. m.' : 'p. m.'}`
}

/** Etiqueta corta de eje: '8a', '12p'. */
export function formatHourShort(h: number): string {
  const hh = ((h % 24) + 24) % 24
  return `${hh % 12 === 0 ? 12 : hh % 12}${hh < 12 ? 'a' : 'p'}`
}

/** Rango 'de 2 a 5 p. m.' o 'de 11 a. m. a 2 p. m.' (la hora final es exclusiva: última hora + 1). */
export function formatHourRange(startHour: number, endHourExclusive: number): string {
  const sameHalf = (startHour % 24 < 12) === (endHourExclusive % 24 < 12)
  if (sameHalf) {
    const s = startHour % 12 === 0 ? 12 : startHour % 12
    return `de ${s} a ${formatHour(endHourExclusive)}`
  }
  return `de ${formatHour(startHour)} a ${formatHour(endHourExclusive)}`
}

/** Ocupación 0..1 de una celda; null si ese día y hora no tienen horario de trabajo. */
export function cellOccupancy(c: Pick<ManagementHeatCell, 'booked_minutes' | 'capacity_minutes'>): number | null {
  if (!c.capacity_minutes || c.capacity_minutes <= 0) return null
  return Math.max(0, Math.min(1, c.booked_minutes / c.capacity_minutes))
}

export interface HeatmapGrid {
  rows:  { dow: number; label: string }[]
  hours: number[]
  get:   (dow: number, hour: number) => ManagementHeatCell | undefined
}

export function buildHeatmapGrid(cells: ManagementHeatCell[]): HeatmapGrid {
  const map = new Map<string, ManagementHeatCell>()
  for (const c of cells) map.set(`${c.dow}:${c.hour}`, c)

  const withCap = cells.filter(c => (c.capacity_minutes ?? 0) > 0)
  const hours: number[] = []
  if (withCap.length) {
    const min = Math.min(...withCap.map(c => c.hour))
    const max = Math.max(...withCap.map(c => c.hour))
    for (let h = min; h <= max; h++) hours.push(h)
  }
  const sundayHasCap = withCap.some(c => c.dow === 0)
  const rows = ROW_ORDER
    .filter(d => d !== 0 || sundayHasCap)
    .map(d => ({ dow: d, label: DOW_SHORT[d] }))

  return { rows, hours, get: (dow, hour) => map.get(`${dow}:${hour}`) }
}

/** Textos de la celda: 'martes 3 p. m.: 35 % ocupado · 12 citas en 4 semanas'. */
export function heatCellText(c: ManagementHeatCell): string {
  const occ = cellOccupancy(c)
  const weeks = c.weeks ?? 0
  const citas = `${formatInt(c.appointments)} ${c.appointments === 1 ? 'cita' : 'citas'}`
  const span = weeks > 0 ? ` en ${weeks} ${weeks === 1 ? 'semana' : 'semanas'}` : ''
  const head = `${DOW_NAMES[c.dow]} ${formatHour(c.hour)}`
  return occ === null
    ? `${head}: sin horario de trabajo · ${citas}${span}`
    : `${head}: ${Math.round(occ * 100)} % ocupado · ${citas}${span}`
}

// Rampa de UN solo tono (azul): poca ocupación oscuro → mucha ocupación claro.
const RAMP: [number, [number, number, number]][] = [
  [0,    [0x18, 0x4f, 0x95]],
  [0.45, [0x39, 0x87, 0xe5]],
  [0.75, [0x86, 0xb6, 0xef]],
  [1,    [0xcd, 0xe2, 0xfb]],
]

/** Color de la rampa para t en 0..1. */
export function rampColor(t: number): string {
  const x = Math.max(0, Math.min(1, t))
  for (let i = 1; i < RAMP.length; i++) {
    const [t1, c1] = RAMP[i]
    const [t0, c0] = RAMP[i - 1]
    if (x <= t1) {
      const k = t1 === t0 ? 0 : (x - t0) / (t1 - t0)
      const ch = (j: number) => Math.round(c0[j] + (c1[j] - c0[j]) * k)
      return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`
    }
  }
  const last = RAMP[RAMP.length - 1][1]
  return `rgb(${last[0]}, ${last[1]}, ${last[2]})`
}

// ── Profesionales ─────────────────────────────────────────────────────────────

/** Ocupación 0..100 de un profesional (citas ÷ horas de trabajo); null si no tiene horario. */
export function staffOccupancyPct(s: Pick<ManagementStaff, 'booked_minutes' | 'scheduled_minutes'>): number | null {
  if (!s.scheduled_minutes || s.scheduled_minutes <= 0) return null
  return Math.max(0, Math.min(100, (s.booked_minutes / s.scheduled_minutes) * 100))
}
