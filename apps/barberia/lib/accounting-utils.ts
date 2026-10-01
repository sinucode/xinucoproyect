// lib/accounting-utils.ts — lógica PURA de Contabilidad (movimientos de plata, meses, CSV para el contador).
// Sin dependencias de servidor: la usan la Server Action y los componentes cliente.
import type {
  MoneyMovement, MoneyMovementMethod, MoneyMovementSource, ProfitLossResult, StaffProduction,
} from '@xinuco/types'
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
  owner_contribution: 'Aporte del dueño',
  owner_loan:         'Préstamo del dueño',
  loan_repayment:     'Devolución de préstamo',
  owner_withdrawal:   'Retiro del dueño',
  transfer_in:        'Traslado entrada',
  transfer_out:       'Traslado salida',
  adjustment:         'Ajuste de saldo',
}

/** Etiqueta del medio de pago de un movimiento: el nombre del medio del negocio, o el método de siempre. */
export const OTHER_MEDIUM_LABEL = 'Otro medio'

export function movementMediumLabel(m: Pick<MoneyMovement, 'account' | 'method'>): string {
  if (typeof m.account === 'string' && m.account.trim()) return m.account
  // Dato antiguo (sin la columna): el método de siempre
  if (m.account === undefined) return METHOD_LABEL[m.method] ?? m.method
  return m.method === 'loyalty_points' ? METHOD_LABEL.loyalty_points : OTHER_MEDIUM_LABEL
}

/** Orígenes que no son ventas ni gastos: plata del dueño, traslados entre medios y ajustes. */
const OWNER_IN: MoneyMovementSource[] = ['owner_contribution', 'owner_loan']
const OWNER_OUT: MoneyMovementSource[] = ['loan_repayment', 'owner_withdrawal']

// ── Resumen de movimientos ────────────────────────────────────────────────────

export interface MethodTotals {
  method: MoneyMovementMethod
  in:     number
  out:    number
  net:    number
}

export interface AccountTotals {
  /** Nombre del medio mostrado ("Nequi", "Efectivo", "Otro medio"…). */
  label: string
  in:    number
  out:   number
  net:   number
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
  /** Por medio del negocio (por nombre); el método de siempre si el dato no trae el nombre. */
  byAccount:  AccountTotals[]
  bySource:   SourceTotal[]
  /** Parte de moneyIn/moneyOut que NO es venta ni gasto: aportes/préstamos/retiros del dueño, traslados y ajustes. */
  internal: {
    ownerIn:       number   // aportes y préstamos del dueño
    ownerOut:      number   // devoluciones de préstamo y retiros
    transfers:     number   // traslados entre medios (cada traslado entra y sale por el mismo valor)
    adjustmentsIn:  number
    adjustmentsOut: number
  }
}

type SummaryRow = Pick<MoneyMovement, 'kind' | 'source' | 'method' | 'amount' | 'tip'> & Partial<Pick<MoneyMovement, 'account'>>

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
  const accounts = new Map<string, AccountTotals>()
  const sources = new Map<MoneyMovementSource, number>()
  const internal = { ownerIn: 0, ownerOut: 0, transfers: 0, adjustmentsIn: 0, adjustmentsOut: 0 }

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

    const label = movementMediumLabel(r)
    const a = accounts.get(label) ?? { label, in: 0, out: 0, net: 0 }
    if (r.kind === 'in') a.in += amount
    else a.out += amount
    a.net = a.in - a.out
    accounts.set(label, a)

    if (OWNER_IN.includes(r.source)) internal.ownerIn += amount
    else if (OWNER_OUT.includes(r.source)) internal.ownerOut += amount
    else if (r.source === 'transfer_in') internal.transfers += amount
    else if (r.source === 'adjustment') {
      if (r.kind === 'in') internal.adjustmentsIn += amount
      else internal.adjustmentsOut += amount
    }

    sources.set(r.source, (sources.get(r.source) ?? 0) + amount)
  }

  const byMethod = [...methods.values()].sort(
    (a, b) => (b.in + b.out) - (a.in + a.out) || a.method.localeCompare(b.method),
  )
  const byAccount = [...accounts.values()].sort(
    (a, b) => (b.in + b.out) - (a.in + a.out) || a.label.localeCompare(b.label, 'es'),
  )
  const bySource = [...sources.entries()]
    .map(([source, total]) => ({ source, total }))
    .sort((a, b) => b.total - a.total || a.source.localeCompare(b.source))

  return { moneyIn, moneyOut, net: moneyIn - moneyOut, tips, pointsUsed, byMethod, byAccount, bySource, internal }
}

/**
 * Nota bajo "Entró" / "Salió" cuando una parte no es venta ni gasto (plata del dueño, traslados, ajustes).
 * Null si no hay nada de eso.
 */
export function internalMoneyNote(summary: Pick<MovementsSummary, 'internal'>, side: 'in' | 'out'): string | null {
  const i = summary.internal
  const parts: string[] = []
  const money = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`
  if (side === 'in') {
    if (i.ownerIn > 0) parts.push(`aportes y préstamos del dueño ${money(i.ownerIn)}`)
    if (i.transfers > 0) parts.push(`traslados ${money(i.transfers)}`)
    if (i.adjustmentsIn > 0) parts.push(`ajustes de saldo ${money(i.adjustmentsIn)}`)
  } else {
    if (i.ownerOut > 0) parts.push(`retiros y devoluciones al dueño ${money(i.ownerOut)}`)
    if (i.transfers > 0) parts.push(`traslados ${money(i.transfers)}`)
    if (i.adjustmentsOut > 0) parts.push(`ajustes de saldo ${money(i.adjustmentsOut)}`)
  }
  if (parts.length === 0) return null
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
  return `${side === 'in' ? 'Entró' : 'Salió'} incluye ${joined}.`
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

const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** '2026-01' → 'ene 2026' (encabezados de columna). */
export function monthShortLabel(yyyyMm: string): string {
  const m = MONTH_KEY_RE.exec(yyyyMm)
  return m ? `${MONTH_SHORT[Number(m[2]) - 1]} ${m[1]}` : yyyyMm
}

/** Máximo de meses por descarga (get_money_movements y get_staff_production aceptan hasta 400 días). */
export const ACCOUNTANT_MAX_MONTHS = 13
/** Hasta cuántos meses atrás se puede pedir (incluye el mes actual). */
export const ACCOUNTANT_HISTORY_MONTHS = 36

/** Meses entre dos meses, ambos incluidos: ('2026-01','2026-03') → ['2026-01','2026-02','2026-03']. Vacío si 'to' < 'from'. */
export function monthsBetween(fromMonth: string, toMonth: string): string[] {
  if (!isMonthKey(fromMonth) || !isMonthKey(toMonth) || toMonth < fromMonth) return []
  const out: string[] = []
  let cur = fromMonth
  while (cur <= toMonth && out.length < 1200) {
    out.push(cur)
    cur = nextMonth(cur)
  }
  return out
}

/** Fechas de un rango de meses: del día 1 del primero al último día del último (o hoy si es el mes actual). */
export function rangeDates(fromMonth: string, toMonth: string): { from: string; to: string } {
  if (!isMonthKey(fromMonth) || !isMonthKey(toMonth)) throw new Error('Mes inválido.')
  return { from: `${fromMonth}-01`, to: monthRange(toMonth).to }
}

/** Texto del rango: 'septiembre 2026' o 'enero 2026 a septiembre 2026'. */
export function monthRangeLabel(fromMonth: string, toMonth: string): string {
  return fromMonth === toMonth ? monthLabel(fromMonth) : `${monthLabel(fromMonth)} a ${monthLabel(toMonth)}`
}

/** Sufijo de nombre de archivo: '2026-09' o '2026-01_a_2026-09'. */
export function rangeFileSuffix(fromMonth: string, toMonth: string): string {
  return fromMonth === toMonth ? fromMonth : `${fromMonth}_a_${toMonth}`
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
  'Fecha', 'Hora', 'Tipo', 'Origen', 'Descripción', 'Categoría', 'Medio de pago', 'Medio', 'Monto', 'Propina',
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
      r.account ?? '',
      r.amount,
      r.tip || 0,
    ]),
  ])
}

/**
 * Estado de resultados por mes: una columna por mes y una última con el total del período.
 * Las categorías de gasto son la unión de las de todos los meses (0 donde no hubo).
 * `categoryName` traduce slug → nombre.
 */
export function profitLossMultiCsv(
  monthly: { month: string; pl: ProfitLossResult }[],
  total: ProfitLossResult,
  rangeLabel: string,
  categoryName: (slug: string) => string,
): string {
  const cols = [...monthly.map(m => m.pl), total]
  const line = (label: string, pick: (pl: ProfitLossResult) => number): CsvCell[] => [label, ...cols.map(pick)]

  // Unión de categorías: primero las del total (ya vienen ordenadas), luego las que solo aparezcan en algún mes
  const slugs: string[] = []
  for (const pl of [total, ...monthly.map(m => m.pl)]) {
    for (const c of pl.expenses.by_category) if (!slugs.includes(c.category)) slugs.push(c.category)
  }
  const catTotal = (pl: ProfitLossResult, slug: string) =>
    pl.expenses.by_category.find(c => c.category === slug)?.total ?? 0

  const rows: CsvCell[][] = [
    ['Estado de resultados', rangeLabel],
    ['Concepto', ...monthly.map(m => monthShortLabel(m.month)), 'Total'],
    line('Ingresos por servicios', pl => pl.revenue.services),
    line('Ingresos por productos', pl => pl.revenue.retail),
    line('Descuentos', pl => pl.revenue.discounts),
    line('Ingresos totales', pl => pl.revenue.total),
    line('Costo de productos vendidos', pl => pl.cost_of_goods),
    line('Utilidad bruta', pl => pl.gross_profit),
    line('Comisiones del equipo', pl => pl.commissions),
    line('Gastos', pl => pl.expenses.total),
    ...slugs.map(slug => line(`Gastos - ${categoryName(slug)}`, pl => catTotal(pl, slug))),
    line('Desgaste de equipos', pl => pl.depreciation ?? 0),
    line('Venta o baja de equipos', pl => pl.asset_disposals ?? 0),
    line('Utilidad neta', pl => pl.net_profit),
    line('Propinas (no son ingreso del negocio)', pl => pl.tips),
  ]
  return toCsv(rows)
}

// ── Por profesional ───────────────────────────────────────────────────────────

export interface StaffTotals {
  /** Lo que vendió: servicios + productos (sin propinas). */
  produced: number
  /** Lo que ganó: comisiones + propinas + bonos − descuentos. */
  earned:   number
  /** Lo que se le pagó: anticipos + pagos. */
  paid:     number
  /** Lo que le quedó al negocio: produjo − comisiones − bonos + descuentos. */
  kept:     number
}

type StaffRow = Pick<
  StaffProduction,
  'services_revenue' | 'products_revenue' | 'commissions' | 'tips' | 'bonuses' | 'deductions' | 'advances' | 'payments'
>

export function staffTotals(r: StaffRow): StaffTotals {
  const n = (v: number) => Number(v) || 0
  const produced = n(r.services_revenue) + n(r.products_revenue)
  return {
    produced,
    earned: n(r.commissions) + n(r.tips) + n(r.bonuses) - n(r.deductions),
    paid:   n(r.advances) + n(r.payments),
    kept:   produced - n(r.commissions) - n(r.bonuses) + n(r.deductions),
  }
}

export interface StaffSummary extends StaffTotals {
  /** Saldo pendiente hoy de todo el equipo (suma de los saldos; los negativos restan). */
  pending: number
  count:   number
}

/** Totales de todo el equipo. */
export function summarizeStaff(rows: (StaffRow & Pick<StaffProduction, 'balance_now'>)[]): StaffSummary {
  const sum: StaffSummary = { produced: 0, earned: 0, paid: 0, kept: 0, pending: 0, count: rows.length }
  for (const r of rows) {
    const t = staffTotals(r)
    sum.produced += t.produced
    sum.earned += t.earned
    sum.paid += t.paid
    sum.kept += t.kept
    sum.pending += Number(r.balance_now) || 0
  }
  return sum
}

/** Más produjo primero; a igual producción, por nombre. */
export function sortStaffByProduction<T extends StaffRow & Pick<StaffProduction, 'full_name'>>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => staffTotals(b).produced - staffTotals(a).produced || a.full_name.localeCompare(b.full_name, 'es'),
  )
}

export const STAFF_CSV_HEADER = [
  'Profesional', 'Servicios hechos', 'Produjo en servicios', 'Produjo en productos', 'Produjo total',
  'Comisiones', 'Propinas', 'Bonos', 'Descuentos', 'Ganó total',
  'Anticipos', 'Pagos', 'Pagado total', 'Le quedó al negocio', 'Saldo pendiente hoy',
]

export function staffCsv(rows: StaffProduction[]): string {
  return toCsv([
    STAFF_CSV_HEADER,
    ...sortStaffByProduction(rows).map(r => {
      const t = staffTotals(r)
      return [
        r.full_name, r.services_count, r.services_revenue, r.products_revenue, t.produced,
        r.commissions, r.tips, r.bonuses, r.deductions, t.earned,
        r.advances, r.payments, t.paid, t.kept, r.balance_now,
      ]
    }),
  ])
}
