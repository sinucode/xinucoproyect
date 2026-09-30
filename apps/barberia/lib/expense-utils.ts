// lib/expense-utils.ts — utilidades puras del módulo Gastos (categorías, medios de pago,
// rangos de mes y gastos fijos pendientes). Sin dependencias de servidor: las usan tanto
// las Server Actions como el componente cliente.
import type { ExpensePaymentMethod } from '@xinuco/types'
import { addDaysToDateKey, businessTodayISODate } from './agenda-time'

// ── Categorías ────────────────────────────────────────────────────────────────

export const EXPENSE_CATEGORIES = [
  { value: 'rent',        label: 'Arriendo' },
  { value: 'utilities',   label: 'Servicios públicos' },
  { value: 'supplies',    label: 'Insumos' },
  { value: 'salary',      label: 'Nómina fija' },
  { value: 'maintenance', label: 'Mantenimiento' },
  { value: 'marketing',   label: 'Publicidad' },
  { value: 'taxes',       label: 'Impuestos y trámites' },
  { value: 'other',       label: 'Otros' },
] as const

export type ExpenseCategoryValue = (typeof EXPENSE_CATEGORIES)[number]['value']

export const EXPENSE_CATEGORY_VALUES: string[] = EXPENSE_CATEGORIES.map(c => c.value)

/** Etiqueta en español de una categoría; si no se conoce, devuelve el valor tal cual. */
export function categoryLabel(value: string): string {
  return EXPENSE_CATEGORIES.find(c => c.value === value)?.label ?? value
}

/** Clases Tailwind del badge por categoría. */
export const CATEGORY_BADGE_COLORS: Record<string, string> = {
  rent:        'text-blue-400 bg-blue-400/10 border-blue-400/20',
  utilities:   'text-purple-400 bg-purple-400/10 border-purple-400/20',
  supplies:    'text-amber-400 bg-amber-400/10 border-amber-400/20',
  salary:      'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  maintenance: 'text-orange-400 bg-orange-400/10 border-orange-400/20',
  marketing:   'text-pink-400 bg-pink-400/10 border-pink-400/20',
  taxes:       'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
  other:       'text-zinc-400 bg-zinc-400/10 border-zinc-400/20',
}

/** Color sólido (barras de resumen) por categoría. */
export const CATEGORY_BAR_COLORS: Record<string, string> = {
  rent:        '#60a5fa',
  utilities:   '#c084fc',
  supplies:    '#fbbf24',
  salary:      '#34d399',
  maintenance: '#fb923c',
  marketing:   '#f472b6',
  taxes:       '#22d3ee',
  other:       '#a1a1aa',
}

export function categoryBadgeClass(value: string): string {
  return CATEGORY_BADGE_COLORS[value] ?? CATEGORY_BADGE_COLORS.other
}

export function categoryBarColor(value: string): string {
  return CATEGORY_BAR_COLORS[value] ?? CATEGORY_BAR_COLORS.other
}

// ── Medios de pago ────────────────────────────────────────────────────────────

export const PAYMENT_METHODS: { value: ExpensePaymentMethod; label: string }[] = [
  { value: 'cash_register', label: 'Efectivo de la caja' },
  { value: 'transfer',      label: 'Transferencia' },
  { value: 'card',          label: 'Tarjeta' },
  { value: 'other',         label: 'Otro' },
]

export const PAYMENT_METHOD_VALUES: string[] = PAYMENT_METHODS.map(m => m.value)

export function paymentMethodLabel(value: string): string {
  return PAYMENT_METHODS.find(m => m.value === value)?.label ?? value
}

// ── Meses ─────────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const MONTH_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export function isValidMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_KEY_RE.test(value)
}

/** Mes actual del negocio (America/Bogota) como 'YYYY-MM'. */
export function currentMonthKey(): string {
  return businessTodayISODate().slice(0, 7)
}

/** Suma (o resta) meses a un 'YYYY-MM'. */
export function shiftMonth(monthKey: string, delta: number): string {
  const m = MONTH_KEY_RE.exec(monthKey)
  if (!m) return monthKey
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

/** Último día (1–31) del mes 'YYYY-MM'. */
function lastDayOfMonth(monthKey: string): number {
  const to = addDaysToDateKey(`${shiftMonth(monthKey, 1)}-01`, -1)
  return Number(to.slice(8, 10))
}

/** Rango de fechas del mes: from/to 'YYYY-MM-DD' y etiqueta 'Septiembre de 2026'. */
export function monthRange(monthKey: string): { from: string; to: string; label: string } {
  const m = MONTH_KEY_RE.exec(monthKey)
  if (!m) throw new Error('Mes inválido.')
  const to = `${monthKey}-${String(lastDayOfMonth(monthKey)).padStart(2, '0')}`
  return {
    from:  `${monthKey}-01`,
    to,
    label: `${MONTH_NAMES[Number(m[2]) - 1]} de ${m[1]}`,
  }
}

// ── Gastos fijos pendientes ───────────────────────────────────────────────────

export interface RecurringExpenseLike {
  id?:            string
  category:       string
  description:    string
  amount:         number
  expense_date:   string
  is_recurring:   boolean
  payment_method?: ExpensePaymentMethod | string | null
  created_at?:    string
}

export interface PendingRecurringExpense {
  category:       string
  description:    string
  amount:         number
  payment_method: ExpensePaymentMethod
  /** Fecha sugerida 'YYYY-MM-DD' dentro del mes consultado. */
  suggested_date: string
}

function recurringKey(category: string, description: string): string {
  return `${category}::${description.trim().toLowerCase()}`
}

/**
 * Gastos fijos que aún no se han registrado en el mes.
 *
 * "Plantilla" = el gasto marcado como fijo más reciente de cada (categoría + descripción
 * normalizada) fechado ANTES del mes. Está pendiente si el mes no tiene ningún gasto con
 * la misma categoría y descripción normalizada. La fecha sugerida es el mismo día del mes
 * de la plantilla, ajustado al último día del mes y, si se pasa `todayKey`, sin superar hoy
 * (el servidor rechaza fechas futuras).
 */
export function pendingRecurring(
  recurringHistory: RecurringExpenseLike[],
  currentMonthExpenses: RecurringExpenseLike[],
  monthKey: string,
  todayKey?: string,
): PendingRecurringExpense[] {
  const { from, to } = monthRange(monthKey)

  // Plantillas: la más reciente por clave
  const templates = new Map<string, RecurringExpenseLike>()
  for (const e of recurringHistory) {
    if (!e.is_recurring || e.expense_date >= from) continue
    const key = recurringKey(e.category, e.description)
    const prev = templates.get(key)
    const newer =
      !prev ||
      e.expense_date > prev.expense_date ||
      (e.expense_date === prev.expense_date && (e.created_at ?? '') > (prev.created_at ?? ''))
    if (newer) templates.set(key, e)
  }

  const registered = new Set(currentMonthExpenses.map(e => recurringKey(e.category, e.description)))
  const maxDay = Number(to.slice(8, 10))

  const pending: PendingRecurringExpense[] = []
  for (const [key, t] of templates) {
    if (registered.has(key)) continue
    const day = Math.min(Number(t.expense_date.slice(8, 10)) || 1, maxDay)
    let suggested = `${monthKey}-${String(day).padStart(2, '0')}`
    if (todayKey && suggested > todayKey) suggested = todayKey >= from ? todayKey : suggested
    if (suggested > to) suggested = to
    pending.push({
      category:       t.category,
      description:    t.description.trim(),
      amount:         t.amount,
      // El efectivo de la caja depende del turno de hoy: nunca se sugiere para gastos fijos.
      payment_method: normalizeRecurringMethod(t.payment_method),
      suggested_date: suggested,
    })
  }

  return pending.sort((a, b) => a.suggested_date.localeCompare(b.suggested_date) || a.description.localeCompare(b.description))
}

function normalizeRecurringMethod(value: unknown): ExpensePaymentMethod {
  return value === 'card' || value === 'other' ? value : 'transfer'
}
