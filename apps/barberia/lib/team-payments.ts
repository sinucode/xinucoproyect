// lib/team-payments.ts — lógica PURA de "Pagos al equipo" (antes Ledger).
// Sin 'use client' ni 'use server': usable desde Server Actions, Server y Client Components.
//
// Saldo de un profesional = comisiones + propinas + bonos − anticipos − pagos − descuentos.
// Los movimientos no se editan ni se borran: se corrigen con un bono (a favor) o un descuento.

import type { LedgerEntryType, TeamPaymentMethod } from '@xinuco/types'
import { addDaysToDateKey } from '@/lib/agenda-time'

// ── Etiquetas y signo por tipo ───────────────────────────────────────────────

export const ENTRY_LABELS: Record<LedgerEntryType, string> = {
  commission: 'Comisión',
  tip:        'Propina',
  bonus:      'Bono / a favor',
  deduction:  'Descuento',
  advance:    'Anticipo',
  payment:    'Pago',
}

/** +1 suma al saldo del profesional; −1 lo resta. */
export const ENTRY_SIGN: Record<LedgerEntryType, 1 | -1> = {
  commission: 1,
  tip:        1,
  bonus:      1,
  deduction:  -1,
  advance:    -1,
  payment:    -1,
}

/** Orden en que se ofrecen los filtros por tipo. */
export const ENTRY_TYPES: LedgerEntryType[] = ['commission', 'tip', 'bonus', 'deduction', 'advance', 'payment']

export const TEAM_PAYMENT_METHODS: TeamPaymentMethod[] = ['cash_register', 'transfer', 'other']

export const TEAM_METHOD_LABELS: Record<TeamPaymentMethod, string> = {
  cash_register: 'Efectivo de la caja',
  transfer:      'Transferencia',
  other:         'Otro',
}

/** Etiqueta corta del medio de pago (columna del historial). */
export const TEAM_METHOD_SHORT: Record<TeamPaymentMethod, string> = {
  cash_register: 'Caja',
  transfer:      'Transferencia',
  other:         'Otro',
}

export function isLedgerEntryType(value: unknown): value is LedgerEntryType {
  return typeof value === 'string' && (ENTRY_TYPES as string[]).includes(value)
}

export function isTeamPaymentMethod(value: unknown): value is TeamPaymentMethod {
  return typeof value === 'string' && (TEAM_PAYMENT_METHODS as string[]).includes(value)
}

// ── Liquidación desde el último pago ─────────────────────────────────────────

/** Lo mínimo que necesita el cálculo de un movimiento (el historial trae más campos). */
export interface LedgerEntryLike {
  id:          string
  entry_type:  LedgerEntryType
  amount:      number
  created_at:  string
  /** Solo en comisiones: tipo de la línea de venta que la originó (viene de sale_item). */
  item_type?:  'service' | 'product' | null
}

export interface SettlementSummary {
  /** created_at del último pago (ISO) o null si nunca se le ha pagado. */
  since:               string | null
  services_commission: number
  products_commission: number
  tips:                number
  bonus:               number
  deductions:          number
  advances:            number
  /** servicios + productos + propinas + bonos − descuentos − anticipos (solo lo posterior al último pago). */
  total_to_pay:        number
  /** Cantidad de movimientos posteriores al último pago. */
  count:               number
  /**
   * Saldo REAL sobre TODOS los movimientos. Puede diferir de total_to_pay si un pago
   * anterior no saldó todo (o se pagó de más): la UI muestra este como "Saldo total".
   */
  balance:             number
}

/** Suma con signo de todos los movimientos = saldo del profesional. */
export function computeBalance(entries: Pick<LedgerEntryLike, 'entry_type' | 'amount'>[]): number {
  let total = 0
  for (const e of entries) total += ENTRY_SIGN[e.entry_type] * (e.amount ?? 0)
  return total
}

/** Orden cronológico estable: created_at, y en empate el id. */
function byCreatedThenId(a: LedgerEntryLike, b: LedgerEntryLike): number {
  const ta = Date.parse(a.created_at)
  const tb = Date.parse(b.created_at)
  if (ta !== tb) return ta - tb
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Resumen "desde el último pago" de UN profesional. Los movimientos llegan en cualquier orden.
 * Cuenta solo lo posterior (estrictamente) al último movimiento de tipo 'payment'.
 */
export function settlementSinceLastPayment(entries: LedgerEntryLike[]): SettlementSummary {
  const sorted = [...entries].sort(byCreatedThenId)

  let lastPaymentIdx = -1
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].entry_type === 'payment') { lastPaymentIdx = i; break }
  }

  const since = lastPaymentIdx >= 0 ? sorted[lastPaymentIdx].created_at : null
  const after = sorted.slice(lastPaymentIdx + 1)

  const out: SettlementSummary = {
    since,
    services_commission: 0,
    products_commission: 0,
    tips:                0,
    bonus:               0,
    deductions:          0,
    advances:            0,
    total_to_pay:        0,
    count:               after.length,
    balance:             computeBalance(sorted),
  }

  for (const e of after) {
    const amount = e.amount ?? 0
    switch (e.entry_type) {
      case 'commission':
        if (e.item_type === 'product') out.products_commission += amount
        else out.services_commission += amount
        break
      case 'tip':       out.tips       += amount; break
      case 'bonus':     out.bonus      += amount; break
      case 'deduction': out.deductions += amount; break
      case 'advance':   out.advances   += amount; break
      default: break // 'payment' no puede aparecer después del último pago
    }
  }

  out.total_to_pay =
    out.services_commission + out.products_commission + out.tips + out.bonus
    - out.deductions - out.advances

  return out
}

// ── Fechas (hora de Colombia) ────────────────────────────────────────────────

const BUSINESS_TZ = 'America/Bogota'

/** Día 'YYYY-MM-DD' en Colombia de un instante real (timestamptz). */
export function bogotaDateKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

/**
 * Rango UTC [desde, hasta) de los días locales de Colombia from..to (inclusive).
 * Colombia es UTC−5 fijo (sin horario de verano): el día D empieza en `D T05:00Z`.
 */
export function bogotaDayRangeUTC(from: string, to: string): { start: string; end: string } {
  return {
    start: `${from}T05:00:00Z`,
    end:   `${addDaysToDateKey(to, 1)}T05:00:00Z`,
  }
}

/** ¿'YYYY-MM-DD' es una fecha real del calendario? */
export function isRealDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** '29 sept' a partir de 'YYYY-MM-DD' (sin corrimientos de zona horaria). */
export function shortDateLabel(dateKey: string): string {
  const label = new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('es-CO', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  })
  return label.replace(/[,.]/g, '').replace(/\bde\b\s*/g, '').replace(/\s+/g, ' ').trim()
}

/** '29 sept, 3:45 p. m.' — un instante real mostrado en hora de Colombia. */
export function formatLedgerDateTime(iso: string): string {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('es-CO', { timeZone: BUSINESS_TZ, day: 'numeric', month: 'short' }).format(d)
  const time = new Intl.DateTimeFormat('es-CO', {
    timeZone: BUSINESS_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
  return `${date.replace(/[,.]/g, '').replace(/\bde\b\s*/g, '').replace(/\s+/g, ' ').trim()}, ${time}`
}

// ── Texto para WhatsApp ──────────────────────────────────────────────────────

/** '$32.500' — determinista (no depende de la agrupación del locale). */
export function formatMoneyPlain(amount: number): string {
  const n = Math.abs(Math.round(amount))
  return `$${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

export interface SettlementTextLine {
  label:  string
  /** Con signo: negativo = resta (descuentos, anticipos). Las líneas en cero se omiten. */
  amount: number
}

export interface SettlementTextInput {
  businessName: string
  staffName:    string
  fromLabel?:   string | null
  toLabel?:     string | null
  lines:        SettlementTextLine[]
  total:        number
  method?:      TeamPaymentMethod | null
}

const METHOD_IN_TEXT: Record<TeamPaymentMethod, string> = {
  cash_register: 'Efectivo',
  transfer:      'Transferencia',
  other:         'Otro medio',
}

export function buildWhatsAppSettlementText(input: SettlementTextInput): string {
  const firstName = input.staffName.trim().split(/\s+/)[0] || input.staffName
  const period = input.fromLabel && input.toLabel
    ? ` (${input.fromLabel} – ${input.toLabel})`
    : input.toLabel ? ` (hasta ${input.toLabel})` : ''

  const out: string[] = [
    `Hola ${firstName} 👋`,
    `Tu liquidación en ${input.businessName}${period}:`,
  ]

  for (const line of input.lines) {
    if (!line.amount) continue
    const sign = line.amount < 0 ? '−' : ''
    out.push(`• ${line.label}: ${sign}${formatMoneyPlain(line.amount)}`)
  }

  const method = input.method ? ` (${METHOD_IN_TEXT[input.method]})` : ''
  out.push(`Total pagado: ${formatMoneyPlain(input.total)}${method}`)
  out.push('¡Gracias por tu trabajo!')
  return out.join('\n')
}

/**
 * Enlace de WhatsApp con el texto ya escrito. Del profesional no se guarda el teléfono:
 * la UI siempre pasa null y el administrador elige el contacto en WhatsApp.
 */
export function waLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? '').replace(/\D/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}
