// lib/accounting-utils.ts — lógica PURA de Contabilidad (movimientos de plata, meses, CSV para el contador).
// Sin dependencias de servidor: la usan la Server Action y los componentes cliente.
import type { MoneyMovement, MoneyMovementMethod, MoneyMovementSource, ProfitLossResult } from '@xinuco/types'
import { addDaysToDateKey, businessTodayISODate } from '@/lib/agenda-time'

// ── Etiquetas ─────────────────────────────────────────────────────────────────

export const METHOD_LABEL: Record<MoneyMovementMethod, string> = {
  cash:           'Efectivo',
  card:           'Tarjeta',
  transfer:       'Transferencia',
  mercadopago:    'Mercado Pago',
  loyalty_points: 'Puntos',
  mixed:          'Mixto',
  other:          'Otro',
}

export const SOURCE_LABEL: Record<MoneyMovementSource, string> = {
  sale:               'Venta',
  asset_sale:         'Venta de equipo',
  expense:            'Gasto',
  team_advance:       'Anticipo',
  team_payment:       'Pago al equipo',
  inventory_purchase: 'Compra de inventario',
  asset_purchase:     'Compra de equipo',
}

// ── Resumen de movimientos ────────────────────────────────────────────────────

export interface MethodTotals {
  method: MoneyMovementMethod
  in:     number
  out:    number
  net:    number
}

export interface SourceTotal {
  source: MoneyMovementSource
  total:  number
}

export interface MovementsSummary {
  /** Plata que entró (sin lo pagado con puntos: eso no es plata). */
  moneyIn:    number
  moneyOut:   number
  net:        number
  /** Propinas incluidas en lo que entró (son de los profesionales). */
  tips:       number
  /** Valor de lo pagado con puntos de fidelidad (no entró plata). */
  pointsUsed: number
  byMethod:   MethodTotals[]
  bySource:   SourceTotal[]
}

type SummaryRow = Pick<MoneyMovement, 'kind' | 'source' | 'method' | 'amount' | 'tip'>

/**
 * Totales de una lista de movimientos. Lo pagado con puntos NO es plata: no suma a
 * entró/salió, ni a los medios de pago, ni al origen; se informa aparte en `pointsUsed`.
 */
export function summarizeMovements(rows: SummaryRow[]): MovementsSummary {
  let moneyIn = 0
  let moneyOut = 0
  let tips = 0
  let pointsUsed = 0
  const methods = new Map<MoneyMovementMethod, MethodTotals>()
  const sources = new Map<MoneyMovementSource, number>()

  for (const r of rows) {
    const amount = Number(r.amount) || 0
    if (r.method === 'loyalty_points') {
      if (r.kind === 'in') pointsUsed += amount
      continue
    }

    const m = methods.get(r.method) ?? { method: r.method, in: 0, out: 0, net: 0 }
    if (r.kind === 'in') {
      moneyIn += amount
      tips += Number(r.tip) || 0
      m.in += amount
    } else {
      moneyOut += amount
      m.out += amount
    }
    m.net = m.in - m.out
    methods.set(r.method, m)

    sources.set(r.source, (sources.get(r.source) ?? 0) + amount)
  }

  const byMethod = [...methods.values()].sort(
    (a, b) => (b.in + b.out) - (a.in + a.out) || a.method.localeCompare(b.method),
  )
  const bySource = [...sources.entries()]
    .map(([source, total]) => ({ source, total }))
    .sort((a, b) => b.total - a.total || a.source.localeCompare(b.source))

  return { moneyIn, moneyOut, net: moneyIn - moneyOut, tips, pointsUsed, byMethod, bySource }
}

// ── Meses ─────────────────────────────────────────────────────────────────────

const MONTH_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_KEY_RE.test(value)
}

/** Mes actual del negocio (America/Bogota) como 'YYYY-MM'. */
export function currentMonthKey(): string {
  return businessTodayISODate().slice(0, 7)
}

/** Mes anterior: '2026-01' → '2025-12'. */
export function previousMonth(yyyyMm: string): string {
  const m = MONTH_KEY_RE.exec(yyyyMm)
  if (!m) return yyyyMm
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) - 1
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** Mes siguiente: '2025-12' → '2026-01'. */
export function nextMonth(yyyyMm: string): string {
  const m = MONTH_KEY_RE.exec(yyyyMm)
  if (!m) return yyyyMm
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + 1
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

/**
 * Rango del mes: del día 1 al último día. Si es el mes actual (hora de Bogotá) termina hoy,
 * porque lo que viene después todavía no pasó.
 */
export function monthRange(yyyyMm: string): { from: string; to: string } {
  if (!isMonthKey(yyyyMm)) throw new Error('Mes inválido.')
  const from = `${yyyyMm}-01`
  const today = businessTodayISODate()
  if (today.slice(0, 7) === yyyyMm) return { from, to: today }
  return { from, to: addDaysToDateKey(`${nextMonth(yyyyMm)}-01`, -1) }
}

/** '2026-09' → 'septiembre 2026'. */
export function monthLabel(yyyyMm: string): string {
  const m = MONTH_KEY_RE.exec(yyyyMm)
  if (!m) return yyyyMm
  return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`
}

/** '2026-09' → 'septiembre' (solo el nombre del mes). */
export function monthName(yyyyMm: string): string {
  const m = MONTH_KEY_RE.exec(yyyyMm)
  return m ? MONTH_NAMES[Number(m[2]) - 1] : yyyyMm
}

/**
 * Cambio porcentual frente al período anterior. Null si no hay base (anterior = 0).
 * Con base negativa usa su valor absoluto: pasar de −100 a −50 es una mejora de +50 %.
 */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

// ── CSV (Excel en Colombia: separador ';') ────────────────────────────────────

export const CSV_BOM = '﻿'

type CsvCell = string | number | null

function csvField(value: CsvCell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.trunc(value)) : ''
  let text = value
  // Evita que Excel interprete un texto como fórmula (p. ej. el nombre de un cliente "=1+1")
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Filas → texto CSV: ';' como separador, CRLF, comillas solo cuando hacen falta y BOM UTF-8. */
export function toCsv(rows: CsvCell[][]): string {
  return CSV_BOM + rows.map(r => r.map(csvField).join(';') + '\r\n').join('')
}

export const MOVEMENTS_CSV_HEADER = [
  'Fecha', 'Hora', 'Tipo', 'Origen', 'Descripción', 'Categoría', 'Medio de pago', 'Monto', 'Propina',
]

export function movementsCsv(rows: MoneyMovement[]): string {
  // Orden cronológico (los que solo tienen fecha van al inicio de su día)
  const sorted = [...rows].sort((a, b) =>
    a.occurred_on.localeCompare(b.occurred_on) || (a.occurred_time ?? '').localeCompare(b.occurred_time ?? ''))
  return toCsv([
    MOVEMENTS_CSV_HEADER,
    ...sorted.map(r => [
      r.occurred_on,
      r.occurred_time,
      r.kind === 'in' ? 'Entrada' : 'Salida',
      SOURCE_LABEL[r.source] ?? r.source,
      r.description,
      r.category,
      METHOD_LABEL[r.method] ?? r.method,
      r.amount,
      r.tip || 0,
    ]),
  ])
}

/** Estado de resultados del mes en dos columnas (Concepto;Valor). `categoryName` traduce slug → nombre. */
export function profitLossCsv(
  pl: ProfitLossResult,
  label: string,
  categoryName: (slug: string) => string,
): string {
  const rows: CsvCell[][] = [
    ['Estado de resultados', label],
    ['Concepto', 'Valor'],
    ['Ingresos por servicios', pl.revenue.services],
    ['Ingresos por productos', pl.revenue.retail],
    ['Descuentos', pl.revenue.discounts],
    ['Ingresos totales', pl.revenue.total],
    ['Costo de productos vendidos', pl.cost_of_goods],
    ['Utilidad bruta', pl.gross_profit],
    ['Comisiones del equipo', pl.commissions],
    ['Gastos', pl.expenses.total],
    ...pl.expenses.by_category.map(c => [`Gastos - ${categoryName(c.category)}`, c.total] as CsvCell[]),
    ['Desgaste de equipos', pl.depreciation ?? 0],
    ['Venta o baja de equipos', pl.asset_disposals ?? 0],
    ['Utilidad neta', pl.net_profit],
    ['Propinas (no son ingreso del negocio)', pl.tips],
  ]
  return toCsv(rows)
}
