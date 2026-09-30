// lib/expense-utils.ts — utilidades puras del módulo Gastos (categorías, medios de pago,
// rangos de mes y gastos fijos pendientes). Sin dependencias de servidor: las usan tanto
// las Server Actions como el componente cliente.
import type { ExpensePaymentMethod } from '@xinuco/types'
import { addDaysToDateKey, businessTodayISODate } from './agenda-time'

// ── Categorías ────────────────────────────────────────────────────────────────
// Cada negocio tiene sus categorías (tabla expense_categories); `expenses.category`
// guarda el slug. Las 8 por defecto se crean la primera vez que el negocio entra a Gastos.

/** Paleta de colores de categoría. `key` es lo que se guarda en expense_categories.color. */
export const CATEGORY_PALETTE = [
  { key: 'blue',    label: 'Azul',     badge: 'text-blue-400 bg-blue-400/10 border-blue-400/20',         bar: '#60a5fa' },
  { key: 'purple',  label: 'Morado',   badge: 'text-purple-400 bg-purple-400/10 border-purple-400/20',   bar: '#c084fc' },
  { key: 'amber',   label: 'Ámbar',    badge: 'text-amber-400 bg-amber-400/10 border-amber-400/20',      bar: '#fbbf24' },
  { key: 'emerald', label: 'Verde',    badge: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20', bar: '#34d399' },
  { key: 'orange',  label: 'Naranja',  badge: 'text-orange-400 bg-orange-400/10 border-orange-400/20',   bar: '#fb923c' },
  { key: 'pink',    label: 'Rosado',   badge: 'text-pink-400 bg-pink-400/10 border-pink-400/20',         bar: '#f472b6' },
  { key: 'cyan',    label: 'Turquesa', badge: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',         bar: '#22d3ee' },
  { key: 'red',     label: 'Rojo',     badge: 'text-red-400 bg-red-400/10 border-red-400/20',            bar: '#f87171' },
  { key: 'lime',    label: 'Lima',     badge: 'text-lime-400 bg-lime-400/10 border-lime-400/20',         bar: '#a3e635' },
  { key: 'zinc',    label: 'Gris',     badge: 'text-zinc-400 bg-zinc-400/10 border-zinc-400/20',         bar: '#a1a1aa' },
] as const

export type CategoryColorKey = (typeof CATEGORY_PALETTE)[number]['key']

export const CATEGORY_COLOR_KEYS: string[] = CATEGORY_PALETTE.map(c => c.key)

export function isValidCategoryColor(value: unknown): value is CategoryColorKey {
  return typeof value === 'string' && CATEGORY_COLOR_KEYS.includes(value)
}

/** Categorías que se crean por defecto en cada negocio (las 8 de siempre). */
export const DEFAULT_EXPENSE_CATEGORIES: {
  slug: string; name: string; color: CategoryColorKey; sort_order: number
}[] = [
  { slug: 'rent',        name: 'Arriendo',             color: 'blue',    sort_order: 1 },
  { slug: 'utilities',   name: 'Servicios públicos',   color: 'purple',  sort_order: 2 },
  { slug: 'supplies',    name: 'Insumos',              color: 'amber',   sort_order: 3 },
  { slug: 'salary',      name: 'Nómina fija',          color: 'emerald', sort_order: 4 },
  { slug: 'maintenance', name: 'Mantenimiento',        color: 'orange',  sort_order: 5 },
  { slug: 'marketing',   name: 'Publicidad',           color: 'pink',    sort_order: 6 },
  { slug: 'taxes',       name: 'Impuestos y trámites', color: 'cyan',    sort_order: 7 },
  { slug: 'other',       name: 'Otros',                color: 'zinc',    sort_order: 8 },
]

/** Lo mínimo que necesitan los helpers de una categoría del negocio. */
export interface ExpenseCategoryLike {
  slug:       string
  name:       string
  color?:     string | null
  is_hidden?: boolean
}

export const MIN_CATEGORY_NAME = 2
export const MAX_CATEGORY_NAME = 40

/**
 * Slug de una categoría nueva: ASCII en minúsculas, sin tildes, no alfanumérico → '_',
 * máximo 30 caracteres y prefijo 'c_' (para no chocar nunca con los slugs por defecto).
 * Si ya existe, se le agrega _2, _3…
 */
export function slugifyCategory(name: string, existingSlugs: Iterable<string> = []): string {
  const base = String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
    .replace(/_+$/g, '')
  const root = `c_${base || 'categoria'}`

  const taken = new Set(existingSlugs)
  if (!taken.has(root)) return root
  let n = 2
  while (taken.has(`${root}_${n}`)) n++
  return `${root}_${n}`
}

function defaultCategory(slug: string) {
  return DEFAULT_EXPENSE_CATEGORIES.find(c => c.slug === slug)
}

function findCategory(slug: string, categories?: ExpenseCategoryLike[] | null): ExpenseCategoryLike | undefined {
  return categories?.find(c => c.slug === slug)
}

/** Nombre de una categoría: la del negocio; si no está, la por defecto; si no, el slug tal cual. */
export function categoryName(slug: string, categories?: ExpenseCategoryLike[] | null): string {
  return findCategory(slug, categories)?.name ?? defaultCategory(slug)?.name ?? slug
}

function paletteEntry(slug: string, categories?: ExpenseCategoryLike[] | null) {
  const key = findCategory(slug, categories)?.color ?? defaultCategory(slug)?.color ?? 'zinc'
  return CATEGORY_PALETTE.find(c => c.key === key) ?? CATEGORY_PALETTE[CATEGORY_PALETTE.length - 1]
}

/** Clases Tailwind del badge de una categoría. */
export function categoryBadgeClass(slug: string, categories?: ExpenseCategoryLike[] | null): string {
  return paletteEntry(slug, categories).badge
}

/** Color sólido (barras de resumen, puntos) de una categoría. */
export function categoryBarColor(slug: string, categories?: ExpenseCategoryLike[] | null): string {
  return paletteEntry(slug, categories).bar
}

/** Categorías visibles (sin las ocultas), respetando el orden recibido. */
export function visibleCategories<T extends ExpenseCategoryLike>(categories: T[]): T[] {
  return categories.filter(c => !c.is_hidden)
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
  auto_registered?: boolean | null
}

export interface PendingRecurringExpense {
  category:       string
  description:    string
  amount:         number
  payment_method: ExpensePaymentMethod
  /** Día en que le toca al gasto en el mes consultado 'YYYY-MM-DD' (día de la plantilla, ajustado al fin de mes). */
  due_date:       string
  /** Fecha para registrarlo a mano: la de vencimiento, sin pasar de hoy (el servidor rechaza fechas futuras). */
  suggested_date: string
}

/** Grupo de un gasto fijo: categoría + descripción normalizada. */
export function recurringKey(category: string, description: string): string {
  return `${category}::${description.trim().toLowerCase()}`
}

/**
 * Gastos fijos que aún no se han registrado en el mes.
 *
 * Un "gasto fijo" es un grupo (categoría + descripción normalizada). Su plantilla es el gasto
 * MÁS RECIENTE del grupo (sea fijo o no) fechado ANTES del mes; el grupo está activo solo si
 * ese gasto más reciente está marcado como fijo (así, quitar la marca "Gasto fijo" al último
 * detiene la repetición). Está pendiente si el mes no tiene ningún gasto del mismo grupo.
 *
 * El vencimiento es el día del mes de la plantilla, ajustado al último día del mes. La fecha
 * sugerida para registrarlo a mano es el vencimiento sin pasar de `todayKey` (si se entrega).
 *
 * `history` puede traer gastos de cualquier fecha: los del mes o posteriores se ignoran.
 */
export function pendingRecurring(
  history: RecurringExpenseLike[],
  currentMonthExpenses: RecurringExpenseLike[],
  monthKey: string,
  todayKey?: string,
): PendingRecurringExpense[] {
  const { from, to } = monthRange(monthKey)

  // Plantillas: el gasto más reciente de cada grupo (fijo o no)
  const templates = new Map<string, RecurringExpenseLike>()
  const groups = new Map<string, RecurringExpenseLike[]>()
  for (const e of history) {
    if (e.expense_date >= from) continue
    const key = recurringKey(e.category, e.description)
    const list = groups.get(key) ?? []
    list.push(e)
    groups.set(key, list)
    const prev = templates.get(key)
    if (!prev || isNewer(e, prev)) templates.set(key, e)
  }

  const registered = new Set(currentMonthExpenses.map(e => recurringKey(e.category, e.description)))
  const maxDay = Number(to.slice(8, 10))

  const pending: PendingRecurringExpense[] = []
  for (const [key, t] of templates) {
    if (!t.is_recurring) continue      // el último del grupo ya no es fijo → se detuvo
    if (registered.has(key)) continue
    const day = Math.min(anchorDay(groups.get(key) ?? [t]), maxDay)
    const due = `${monthKey}-${String(day).padStart(2, '0')}`
    let suggested = due
    if (todayKey && suggested > todayKey) suggested = todayKey >= from ? todayKey : suggested
    pending.push({
      category:       t.category,
      description:    t.description.trim(),
      amount:         t.amount,
      // El efectivo de la caja depende del turno de hoy: nunca se sugiere para gastos fijos.
      payment_method: normalizeRecurringMethod(t.payment_method),
      due_date:       due,
      suggested_date: suggested,
    })
  }

  return pending.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.description.localeCompare(b.description))
}

function isNewer(a: RecurringExpenseLike, b: RecurringExpenseLike): boolean {
  return a.expense_date > b.expense_date ||
    (a.expense_date === b.expense_date && (a.created_at ?? '') > (b.created_at ?? ''))
}

/**
 * Día del mes en que vence el gasto fijo. Un registro AUTOMÁTICO en el último día de
 * un mes corto (ej. 28 feb para un fijo del 31) no cambia el día: se busca hacia atrás
 * el último registro que no sea ese ajuste. Si el admin cambia la fecha a mano, ese
 * nuevo día manda desde el mes siguiente.
 */
export function anchorDay(group: RecurringExpenseLike[]): number {
  const sorted = [...group].sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0))
  const isClampedAuto = (e: RecurringExpenseLike) => {
    if (!e.auto_registered) return false
    const [y, m, d] = e.expense_date.split('-').map(Number)
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return d === last && last < 31
  }
  const anchor = sorted.find(e => !isClampedAuto(e)) ?? sorted[0]
  return Number(anchor?.expense_date.slice(8, 10)) || 1
}

function normalizeRecurringMethod(value: unknown): ExpensePaymentMethod {
  return value === 'card' || value === 'other' ? value : 'transfer'
}
