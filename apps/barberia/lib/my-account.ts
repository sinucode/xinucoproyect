// lib/my-account.ts — lógica PURA de "Mi cuenta" del profesional: resúmenes por período, último pago,
// rangos rápidos del historial y agrupación por día. Todo en HORA DE COLOMBIA (los created_at son
// instantes reales; el día local se saca con bogotaDateKey). Sin 'use client' ni 'use server'.

import type { LedgerEntryType } from '@xinuco/types'
import { addDaysToDateKey } from '@/lib/agenda-time'
import {
  ENTRY_SIGN,
  bogotaDateKey,
  formatMoneyPlain,
  isRealDateKey,
  shortDateLabel,
} from '@/lib/team-payments'

/** Lo mínimo de un movimiento para los resúmenes (lo que trae fetchAllEntries). */
export interface AccountEntryLike {
  entry_type: LedgerEntryType
  amount:     number
  created_at: string
}

// ── Períodos (días locales 'YYYY-MM-DD') ─────────────────────────────────────

/** Lunes de la semana de `dateKey` (la semana laboral en Colombia empieza el lunes). */
export function weekStartKey(dateKey: string): string {
  const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay() // 0 = domingo
  const sinceMonday = (dow + 6) % 7
  return addDaysToDateKey(dateKey, -sinceMonday)
}

/** Primer día del mes de `dateKey`. */
export function monthStartKey(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`
}

/** Primer y último día del mes anterior al de `dateKey`. */
export function previousMonthRange(dateKey: string): { from: string; to: string } {
  const thisMonthStart = monthStartKey(dateKey)
  const to = addDaysToDateKey(thisMonthStart, -1)
  return { from: monthStartKey(to), to }
}

export type QuickRangeId = 'today' | 'week' | 'month' | 'lastMonth'

export const QUICK_RANGE_LABELS: Record<QuickRangeId, string> = {
  today:     'Hoy',
  week:      'Semana',
  month:     'Mes',
  lastMonth: 'Mes pasado',
}

export const QUICK_RANGE_IDS: QuickRangeId[] = ['today', 'week', 'month', 'lastMonth']

/** Rango desde/hasta de cada chip del historial, a partir de "hoy" (día local). */
export function quickRange(id: QuickRangeId, todayKey: string): { from: string; to: string } {
  switch (id) {
    case 'today':     return { from: todayKey, to: todayKey }
    case 'week':      return { from: weekStartKey(todayKey), to: todayKey }
    case 'month':     return { from: monthStartKey(todayKey), to: todayKey }
    case 'lastMonth': return previousMonthRange(todayKey)
  }
}

/** ¿Qué chip coincide EXACTAMENTE con el desde/hasta actuales? null si ninguno. */
export function activeQuickRange(from: string, to: string, todayKey: string): QuickRangeId | null {
  if (!from || !to) return null
  for (const id of QUICK_RANGE_IDS) {
    const r = quickRange(id, todayKey)
    if (r.from === from && r.to === to) return id
  }
  return null
}

// ── Ganancias por período ────────────────────────────────────────────────────

export interface PeriodEarnings {
  today: number
  week:  number
  month: number
}

/**
 * Lo ganado en cada período: comisiones (de servicios y de productos) + propinas. Los bonos,
 * descuentos, anticipos y pagos NO cuentan: es lo que produjo, no lo que se movió de su cuenta.
 * Semana = lunes a hoy; mes = día 1 a hoy (días locales de Colombia).
 */
export function periodEarnings(entries: AccountEntryLike[], todayKey: string): PeriodEarnings {
  const weekStart = weekStartKey(todayKey)
  const monthStart = monthStartKey(todayKey)
  const out: PeriodEarnings = { today: 0, week: 0, month: 0 }
  for (const e of entries) {
    if (e.entry_type !== 'commission' && e.entry_type !== 'tip') continue
    const key = bogotaDateKey(e.created_at)
    if (key > todayKey) continue
    const amount = e.amount ?? 0
    if (key === todayKey) out.today += amount
    if (key >= weekStart) out.week += amount
    if (key >= monthStart) out.month += amount
  }
  return out
}

// ── Último pago ──────────────────────────────────────────────────────────────

export interface LastPayout {
  /** Instante real del pago (ISO). */
  at:     string
  /** Día local 'YYYY-MM-DD'. */
  dateKey: string
  amount: number
}

/** El pago (entry_type 'payment') más reciente, o null si nunca se le ha pagado. */
export function lastPayout(entries: AccountEntryLike[]): LastPayout | null {
  let best: AccountEntryLike | null = null
  for (const e of entries) {
    if (e.entry_type !== 'payment') continue
    if (!best || Date.parse(e.created_at) > Date.parse(best.created_at)) best = e
  }
  return best ? { at: best.created_at, dateKey: bogotaDateKey(best.created_at), amount: best.amount } : null
}

/** 'Último pago: 15 sept · $850.000' o 'Aún no te han pagado'. */
export function lastPayoutLabel(p: LastPayout | null): string {
  if (!p) return 'Aún no te han pagado'
  return `Último pago: ${shortDateLabel(p.dateKey)} · ${formatMoneyPlain(p.amount)}`
}

// ── Historial por día ────────────────────────────────────────────────────────

export interface DayFilters {
  type?: LedgerEntryType | null
  from?: string | null
  to?:   string | null
}

/**
 * Total neto (con signo) de cada día local con los MISMOS filtros del historial, sobre TODOS los
 * movimientos: así el total del día sale completo aunque "Ver más" solo haya cargado una parte.
 */
export function dayTotals(entries: AccountEntryLike[], filters: DayFilters = {}): Record<string, number> {
  const from = isRealDateKey(filters.from) ? filters.from : null
  const to = isRealDateKey(filters.to) ? filters.to : null
  const out: Record<string, number> = {}
  for (const e of entries) {
    if (filters.type && e.entry_type !== filters.type) continue
    const key = bogotaDateKey(e.created_at)
    if (from && key < from) continue
    if (to && key > to) continue
    out[key] = (out[key] ?? 0) + ENTRY_SIGN[e.entry_type] * (e.amount ?? 0)
  }
  return out
}

export interface DayGroup<T> {
  /** Día local 'YYYY-MM-DD'. */
  dateKey: string
  items:   T[]
}

/** Agrupa movimientos (ya ordenados del más reciente al más viejo) por día local, conservando el orden. */
export function groupEntriesByDay<T extends { created_at: string }>(entries: T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  for (const item of entries) {
    const key = bogotaDateKey(item.created_at)
    const last = groups[groups.length - 1]
    if (last && last.dateKey === key) last.items.push(item)
    else groups.push({ dateKey: key, items: [item] })
  }
  return groups
}

/** 'Jueves 1 oct' (con 'Hoy, ' delante si es hoy). */
export function dayHeaderLabel(dateKey: string, todayKey?: string): string {
  const weekday = new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'UTC' })
  const cap = weekday.charAt(0).toUpperCase() + weekday.slice(1)
  const base = `${cap} ${shortDateLabel(dateKey)}`
  return todayKey && dateKey === todayKey ? `Hoy, ${base.charAt(0).toLowerCase()}${base.slice(1)}` : base
}

/** '+$25.800' / '−$10.000' / '$0' (determinista, sin depender del locale). */
export function signedMoney(value: number): string {
  if (value === 0) return '$0'
  return `${value < 0 ? '−' : '+'}${formatMoneyPlain(value)}`
}
