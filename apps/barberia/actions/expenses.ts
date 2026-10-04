'use server'

import { createClient } from '@xinuco/supabase/server'
import { getSessionUser, getMyProfile } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import type { Expense, ExpenseCategoryRow, ExpensePaymentMethod, ProfitLossResult } from '@xinuco/types'
import { addDaysToDateKey, businessTodayISODate } from '@/lib/agenda-time'
import {
  CATEGORY_PALETTE,
  DEFAULT_EXPENSE_CATEGORIES,
  MAX_CATEGORY_NAME,
  MIN_CATEGORY_NAME,
  PAYMENT_METHOD_VALUES,
  isValidCategoryColor,
  isValidMonthKey,
  currentMonthKey,
  monthRange,
  pendingRecurring,
  slugifyCategory,
  type PendingRecurringExpense,
} from '@/lib/expense-utils'
import { EXPENSE_HISTORY_DAYS, fetchExpenseHistory } from '@/lib/expense-history'
import { fetchProfitLoss } from '@/lib/profit-loss'
import { paymentMethodForAccount } from '@/lib/money-accounts'
import { resolveAccount } from '@/lib/account-resolve'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ActionResult {
  success?: boolean
  error?:   string
}

export interface ExpenseInput {
  category:       string
  description:    string
  amount:         number   // INTEGER COP
  expense_date:   string   // 'YYYY-MM-DD' (fecha local del negocio)
  is_recurring:   boolean
  payment_method: ExpensePaymentMethod
  /**
   * Medio de pago del negocio (money_accounts). Con un id, el servidor deriva el payment_method del
   * medio; null = "Otro medio" (fuera de las cuentas, payment_method 'other'); sin el campo, se
   * respeta payment_method y la base asigna el medio por defecto (como antes).
   */
  account_id?:    string | null
}

export interface RecurringExpenseItem {
  category:        string
  description:     string
  amount:          number
  expense_date:    string
  payment_method?: ExpensePaymentMethod
}

export interface ExpensesOverview {
  month:            { key: string; from: string; to: string; label: string }
  expenses:         Expense[]
  pl:               ProfitLossResult | null
  plError?:         string
  pendingRecurring: PendingRecurringExpense[]
  activeShift:      { id: string; opened_at: string } | null
  /** Categorías del negocio (incluye ocultas), ordenadas por sort_order y nombre. */
  categories:       ExpenseCategoryRow[]
}

export interface UpcomingFixedExpense {
  category:    string
  description: string
  amount:      number
  /** Día en que vence / se registra solo 'YYYY-MM-DD' (hoy o mañana). */
  due_date:    string
}

export interface ExpenseCategoryPatch {
  name?:      string
  color?:     string
  is_hidden?: boolean
}

const NOT_ADMIN         = 'Solo un administrador puede gestionar gastos.'
const NO_OPEN_SHIFT     = 'No hay caja abierta. Abre la caja o elige otro medio de pago.'
const CASH_MUST_BE_TODAY = 'Un gasto pagado con efectivo de la caja debe ser de hoy.'
const SHIFT_CLOSED      = 'Este gasto ya se cuadró en un cierre de caja.'
const MAX_AMOUNT        = 100_000_000
const DUPLICATE_CATEGORY = 'Ya existe una categoría con ese nombre.'
const LAST_VISIBLE_CATEGORY = 'Debe quedar al menos una categoría visible.'
const CATEGORY_NOT_FOUND = 'Categoría no encontrada.'
const CATEGORY_IN_USE = 'Tiene gastos registrados: ocúltala en lugar de borrarla.'

type Supabase = Awaited<ReturnType<typeof createClient>>

// ── Autorización ──────────────────────────────────────────────────────────────
// RLS de `expenses` deja pasar a cualquier usuario del negocio: la restricción a
// admin vive aquí, y el business_id sale SIEMPRE del perfil (nunca del cliente).

async function requireAdmin(): Promise<
  { supabase: Supabase; businessId: string; userId: string } | { error: string }
> {
  const supabase = await createClient()

  // Sesión y perfil memoizados por petición (lib/session.ts); la verificación de rol sigue siendo de esta action
  const user = await getSessionUser(supabase)
  if (!user) return { error: NOT_ADMIN }

  const profile = await getMyProfile(supabase)

  const role = (profile as { role?: string } | null)?.role
  const businessId = (profile as { business_id?: string | null } | null)?.business_id
  if ((role !== 'admin' && role !== 'super_admin') || !businessId) {
    return { error: NOT_ADMIN }
  }

  return { supabase, businessId, userId: user.id }
}

// ── Validación ────────────────────────────────────────────────────────────────

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** Valida y normaliza el input. Devuelve el gasto limpio o un mensaje de error. */
function validateInput(
  input: ExpenseInput,
  today: string,
): { value: ExpenseInput } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'Datos de gasto inválidos.' }

  // La categoría se valida contra las del negocio en checkCategory()
  if (typeof input.category !== 'string' || input.category.length === 0) {
    return { error: 'Elige una categoría válida.' }
  }

  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (description.length < 2 || description.length > 120) {
    return { error: 'La descripción debe tener entre 2 y 120 caracteres.' }
  }

  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > MAX_AMOUNT) {
    return { error: 'El monto debe ser un entero entre $1 y $100.000.000.' }
  }

  if (typeof input.expense_date !== 'string' || !isRealDate(input.expense_date)) {
    return { error: 'La fecha no es válida.' }
  }
  // Se tolera 1 día hacia adelante (desfase de zona horaria del cliente)
  if (input.expense_date > addDaysToDateKey(today, 1)) {
    return { error: 'La fecha no puede ser futura.' }
  }

  if (typeof input.payment_method !== 'string' || !PAYMENT_METHOD_VALUES.includes(input.payment_method)) {
    return { error: 'Elige cómo se pagó el gasto.' }
  }

  return {
    value: {
      category:       input.category,
      description,
      amount:         input.amount,
      expense_date:   input.expense_date,
      is_recurring:   input.is_recurring === true,
      payment_method: input.payment_method,
      ...(input.account_id === undefined ? {} : { account_id: input.account_id }),
    },
  }
}

/**
 * Aplica el medio elegido: con un id, valida que sea del negocio (y activo) y deriva de él el método
 * de pago; con null, es "Otro medio". Sin account_id no cambia nada (flujo de siempre).
 * `existing`: el medio y método que ya tenía el gasto que se edita (se conservan si no cambió el medio).
 */
async function applyAccount(
  supabase: Supabase,
  businessId: string,
  value: ExpenseInput,
  existing?: { account_id: string | null; payment_method: ExpensePaymentMethod },
): Promise<{ value: ExpenseInput } | { error: string }> {
  if (value.account_id === undefined) return { value }
  if (value.account_id === null) {
    // Sigue sin medio: se conserva el método guardado (un gasto viejo sin medio no cambia en silencio)
    if (existing && existing.account_id === null) return { value: { ...value, payment_method: existing.payment_method } }
    return { value: { ...value, payment_method: 'other' } }
  }

  const resolved = await resolveAccount(supabase, businessId, value.account_id, existing?.account_id)
  if ('error' in resolved) return resolved
  const { account } = resolved

  let method = paymentMethodForAccount(account, 'expense') as ExpensePaymentMethod
  // Mismo medio que ya tenía (no caja): se conserva el detalle guardado (p. ej. "Tarjeta")
  if (
    existing && existing.account_id === account.id && !account.is_cash_drawer &&
    existing.payment_method !== 'cash_register' && existing.payment_method !== 'other'
  ) {
    method = existing.payment_method
  }
  return { value: { ...value, payment_method: method } }
}

// ── Categorías del negocio ────────────────────────────────────────────────────

async function fetchCategories(supabase: Supabase, businessId: string): Promise<ExpenseCategoryRow[]> {
  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('business_id', businessId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as ExpenseCategoryRow[]
}

/**
 * Categorías del negocio. Si aún no tiene ninguna, crea las 8 por defecto (los conflictos
 * únicos se ignoran: dos pestañas abiertas a la vez no se pisan) y devuelve la lista.
 * Si la tabla no está disponible (migración pendiente), devuelve las por defecto en memoria
 * para que la página siga funcionando.
 */
async function ensureExpenseCategories(supabase: Supabase, businessId: string): Promise<ExpenseCategoryRow[]> {
  try {
    const existing = await fetchCategories(supabase, businessId)
    if (existing.length > 0) return existing

    await supabase.from('expense_categories').upsert(
      DEFAULT_EXPENSE_CATEGORIES.map(c => ({
        business_id: businessId,
        slug:        c.slug,
        name:        c.name,
        color:       c.color,
        sort_order:  c.sort_order,
      })),
      { onConflict: 'business_id,slug', ignoreDuplicates: true },
    )
    // En producción se vio una primera carga que devolvió la lista vacía justo después de
    // crear las por defecto: se reintenta una vez antes de rendirse.
    const created = await fetchCategories(supabase, businessId)
    if (created.length > 0) return created
    await new Promise(resolve => setTimeout(resolve, 250))
    return await fetchCategories(supabase, businessId)
  } catch (err) {
    console.error('[expenses] categorías no disponibles, usando las por defecto:', err)
    return DEFAULT_EXPENSE_CATEGORIES.map(c => ({
      id:          `default-${c.slug}`,
      business_id: businessId,
      slug:        c.slug,
      name:        c.name,
      color:       c.color,
      is_hidden:   false,
      sort_order:  c.sort_order,
      created_at:  '',
    }))
  }
}

/** La categoría debe ser del negocio; una oculta solo vale si el gasto ya la tenía. */
function checkCategory(
  categories: ExpenseCategoryRow[],
  slug: string,
  allowHiddenSlug?: string | null,
): string | null {
  const found = categories.find(c => c.slug === slug)
  if (!found) return 'Elige una categoría válida.'
  if (found.is_hidden && slug !== allowHiddenSlug) return 'Esa categoría está oculta. Elige otra.'
  return null
}

function normalizeCategoryName(raw: unknown): string | { error: string } {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
  if (name.length < MIN_CATEGORY_NAME || name.length > MAX_CATEGORY_NAME) {
    return { error: `El nombre debe tener entre ${MIN_CATEGORY_NAME} y ${MAX_CATEGORY_NAME} caracteres.` }
  }
  return name
}

const nameKey = (name: string) => name.trim().toLowerCase()

// ── Caja ──────────────────────────────────────────────────────────────────────

async function getOpenShift(
  supabase: Supabase,
  businessId: string,
): Promise<{ id: string; opened_at: string } | null> {
  const { data } = await supabase
    .from('cash_register_shifts')
    .select('id, opened_at')
    .eq('business_id', businessId)
    .eq('status', 'open')
    .maybeSingle()
  return (data as { id: string; opened_at: string } | null) ?? null
}

/** Reglas del efectivo de la caja: turno abierto + fecha de hoy. Devuelve el shift_id. */
async function resolveShiftId(
  supabase: Supabase,
  businessId: string,
  value: ExpenseInput,
  today: string,
): Promise<{ shiftId: string | null } | { error: string }> {
  if (value.payment_method !== 'cash_register') return { shiftId: null }

  const shift = await getOpenShift(supabase, businessId)
  if (!shift) return { error: NO_OPEN_SHIFT }
  if (value.expense_date !== today) return { error: CASH_MUST_BE_TODAY }
  return { shiftId: shift.id }
}

/** ¿El gasto está vinculado a un turno de caja ya cerrado? */
async function isLinkedToClosedShift(
  supabase: Supabase,
  businessId: string,
  shiftId: string | null,
): Promise<boolean> {
  if (!shiftId) return false
  const { data } = await supabase
    .from('cash_register_shifts')
    .select('id, status')
    .eq('id', shiftId)
    .eq('business_id', businessId)
    .maybeSingle()
  return (data as { status?: string } | null)?.status === 'closed'
}

function revalidateExpenses() {
  revalidatePath('/[slug]/dashboard/expenses', 'page')
  // La caja (turno activo / efectivo esperado) se muestra en el dashboard y sus páginas
  revalidatePath('/[slug]/dashboard', 'layout')
}

// ════════════════════════════════════════════════════════════════════════════
// getExpensesOverview — todo lo que necesita la página de Gastos para un mes
// ════════════════════════════════════════════════════════════════════════════

export async function getExpensesOverview(
  monthKeyInput?: string,
): Promise<ExpensesOverview | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const key = isValidMonthKey(monthKeyInput) ? monthKeyInput : currentMonthKey()
  const range = monthRange(key)
  const today = businessTodayISODate()
  const historyFrom = addDaysToDateKey(range.from, -EXPENSE_HISTORY_DAYS)

  // El historial trae TODOS los gastos (fijos o no) de los ~400 días previos al mes: la plantilla
  // de cada gasto fijo es el más reciente de su grupo, y si ya no es fijo el grupo se detiene.
  const [expensesRes, history, plRes, shift, categories] = await Promise.all([
    supabase.from('expenses').select('*')
      .eq('business_id', businessId)
      .gte('expense_date', range.from).lte('expense_date', range.to)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false }),
    fetchExpenseHistory(supabase, businessId, historyFrom, range.from).catch(() => []),
    fetchProfitLoss(supabase, businessId, range.from, range.to),
    getOpenShift(supabase, businessId),
    ensureExpenseCategories(supabase, businessId),
  ])

  if (expensesRes.error) return { error: expensesRes.error.message }

  const expenses = (expensesRes.data ?? []) as Expense[]

  // P&G: si falla no se cae la página; se muestra el motivo
  const pl: ProfitLossResult | null = 'pl' in plRes ? plRes.pl : null
  const plError: string | undefined = 'error' in plRes ? plRes.error : undefined

  // Los gastos fijos solo se sugieren para el mes en curso
  const pending = key === currentMonthKey()
    ? pendingRecurring(history, expenses, key, today)
    : []

  return {
    month: { key, ...range },
    expenses,
    pl,
    ...(plError ? { plError } : {}),
    pendingRecurring: pending,
    activeShift: shift,
    categories,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// createExpense
// ════════════════════════════════════════════════════════════════════════════

export async function createExpense(input: ExpenseInput): Promise<ActionResult & { expense?: Expense }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId, userId } = auth

  const today = businessTodayISODate()
  const checked = validateInput(input, today)
  if ('error' in checked) return checked
  const categoryError = checkCategory(await ensureExpenseCategories(supabase, businessId), checked.value.category)
  if (categoryError) return { error: categoryError }

  const withAccount = await applyAccount(supabase, businessId, checked.value)
  if ('error' in withAccount) return withAccount
  const { value } = withAccount

  const shift = await resolveShiftId(supabase, businessId, value, today)
  if ('error' in shift) return shift

  const { data: expense, error } = await supabase
    .from('expenses')
    .insert({
      business_id:    businessId,
      category:       value.category,
      description:    value.description,
      amount:         value.amount,
      expense_date:   value.expense_date,
      is_recurring:   value.is_recurring,
      payment_method: value.payment_method,
      ...(value.account_id === undefined ? {} : { account_id: value.account_id }),
      shift_id:       shift.shiftId,
      created_by:     userId,
    })
    .select()
    .single()

  if (error) return { error: error.message }

  revalidateExpenses()
  return { success: true, expense: expense as Expense }
}

// ════════════════════════════════════════════════════════════════════════════
// updateExpense
// ════════════════════════════════════════════════════════════════════════════

export async function updateExpense(
  expenseId: string,
  input: ExpenseInput,
): Promise<ActionResult & { expense?: Expense }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const today = businessTodayISODate()
  const checked = validateInput(input, today)
  if ('error' in checked) return checked

  const { data: existingRow, error: findError } = await supabase
    .from('expenses')
    .select('*')
    .eq('id', expenseId)
    .eq('business_id', businessId)
    .maybeSingle()
  if (findError) return { error: findError.message }
  const existing = existingRow as Expense | null
  if (!existing) return { error: 'Gasto no encontrado.' }

  const withAccount = await applyAccount(supabase, businessId, checked.value, {
    account_id:     existing.account_id ?? null,
    payment_method: existing.payment_method,
  })
  if ('error' in withAccount) return withAccount
  const { value } = withAccount

  const categoryError = checkCategory(
    await ensureExpenseCategories(supabase, businessId),
    value.category,
    existing.category,
  )
  if (categoryError) return { error: categoryError }

  // Gasto ya cuadrado en un cierre de caja: solo se pueden editar descripción / categoría / fijo
  // (monto, medio de pago, fecha y turno quedan intactos).
  let shiftId: string | null
  if (await isLinkedToClosedShift(supabase, businessId, existing.shift_id)) {
    if (
      value.amount !== existing.amount ||
      value.payment_method !== existing.payment_method ||
      value.expense_date !== existing.expense_date
    ) {
      return { error: SHIFT_CLOSED }
    }
    shiftId = existing.shift_id
  } else if (
    existing.shift_id &&
    existing.payment_method === 'cash_register' &&
    value.payment_method === 'cash_register' &&
    value.expense_date === existing.expense_date
  ) {
    // Sigue siendo efectivo del mismo turno (aunque el turno pase de medianoche)
    shiftId = existing.shift_id
  } else {
    const shift = await resolveShiftId(supabase, businessId, value, today)
    if ('error' in shift) return shift
    shiftId = shift.shiftId
  }

  const { data: expense, error } = await supabase
    .from('expenses')
    .update({
      category:       value.category,
      description:    value.description,
      amount:         value.amount,
      expense_date:   value.expense_date,
      is_recurring:   value.is_recurring,
      payment_method: value.payment_method,
      // Sin medio elegido pero con otro método: se suelta el medio para que la base asigne el de siempre
      ...(value.account_id !== undefined
        ? { account_id: value.account_id }
        : value.payment_method !== existing.payment_method ? { account_id: null } : {}),
      shift_id:       shiftId,
    })
    .eq('id', expenseId)
    .eq('business_id', businessId)
    .select()
    .single()

  if (error) return { error: error.message }

  revalidateExpenses()
  return { success: true, expense: expense as Expense }
}

// ════════════════════════════════════════════════════════════════════════════
// deleteExpense — borrado físico (registro operativo). Si ya se cuadró en un cierre
// de caja se rechaza: alteraría un arqueo cerrado.
// ════════════════════════════════════════════════════════════════════════════

export async function deleteExpense(expenseId: string): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const { data: existingRow, error: findError } = await supabase
    .from('expenses')
    .select('id, shift_id')
    .eq('id', expenseId)
    .eq('business_id', businessId)
    .maybeSingle()
  if (findError) return { error: findError.message }
  const existing = existingRow as { id: string; shift_id: string | null } | null
  if (!existing) return { error: 'Gasto no encontrado.' }

  if (await isLinkedToClosedShift(supabase, businessId, existing.shift_id)) {
    return { error: SHIFT_CLOSED }
  }

  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', expenseId)
    .eq('business_id', businessId)

  if (error) return { error: error.message }

  revalidateExpenses()
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// registerRecurring — registra de una vez los gastos fijos pendientes del mes
// ════════════════════════════════════════════════════════════════════════════

export async function registerRecurring(
  items: RecurringExpenseItem[],
): Promise<ActionResult & { count?: number }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId, userId } = auth

  if (!Array.isArray(items) || items.length === 0) {
    return { error: 'No hay gastos fijos para registrar.' }
  }
  if (items.length > 50) return { error: 'Son demasiados gastos para registrar de una vez.' }

  const today = businessTodayISODate()
  // Un gasto fijo se registra con SU día de vencimiento (aunque sea más adelante en
  // este mes), así conserva el día del mes para los meses siguientes.
  const monthEnd = monthRange(today.slice(0, 7)).to
  const maxRef   = addDaysToDateKey(monthEnd, -1)   // validateInput permite hasta ref + 1 día
  const categories = await ensureExpenseCategories(supabase, businessId)
  const rows = []
  for (const item of items) {
    const method = item?.payment_method ?? 'transfer'
    if (method === 'cash_register') {
      return { error: 'Los gastos fijos no se pagan con efectivo de la caja.' }
    }
    const checked = validateInput({ ...item, is_recurring: true, payment_method: method }, maxRef > today ? maxRef : today)
    if ('error' in checked) return checked
    const v = checked.value
    // Un gasto fijo puede venir de una categoría que luego se ocultó: se acepta
    const categoryError = checkCategory(categories, v.category, v.category)
    if (categoryError) return { error: categoryError }
    rows.push({
      business_id:    businessId,
      category:       v.category,
      description:    v.description,
      amount:         v.amount,
      expense_date:   v.expense_date,
      is_recurring:   true,
      payment_method: v.payment_method,
      shift_id:       null,
      created_by:     userId,
    })
  }

  const { error } = await supabase.from('expenses').insert(rows)
  if (error) return { error: error.message }

  revalidateExpenses()
  return { success: true, count: rows.length }
}

// ════════════════════════════════════════════════════════════════════════════
// getUpcomingFixedExpenses — gastos fijos que vencen hoy o mañana y siguen sin registrar
// (aviso del dashboard del administrador). Nunca lanza: si algo falla, [].
// ════════════════════════════════════════════════════════════════════════════

export async function getUpcomingFixedExpenses(): Promise<UpcomingFixedExpense[]> {
  const auth = await requireAdmin()
  if ('error' in auth) return []
  const { supabase, businessId } = auth

  try {
    // El módulo Gastos es una función activable: sin ella el enlace del aviso no llevaría a nada
    const { data: biz } = await supabase
      .from('businesses')
      .select('features_enabled')
      .eq('id', businessId)
      .maybeSingle()
    const features = (biz as { features_enabled?: { expenses_pgl?: boolean } } | null)?.features_enabled
    if (!features?.expenses_pgl) return []

    const today = businessTodayISODate()
    const tomorrow = addDaysToDateKey(today, 1)
    const history = await fetchExpenseHistory(supabase, businessId, addDaysToDateKey(today, -EXPENSE_HISTORY_DAYS))

    // Mañana puede ser del mes siguiente
    const months = [...new Set([today.slice(0, 7), tomorrow.slice(0, 7)])]
    return months
      .flatMap(month => pendingRecurring(
        history,
        history.filter(e => e.expense_date.slice(0, 7) === month),
        month,
        today,
      ))
      .filter(item => item.due_date === today || item.due_date === tomorrow)
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.description.localeCompare(b.description))
      .map(item => ({
        category:    item.category,
        description: item.description,
        amount:      item.amount,
        due_date:    item.due_date,
      }))
  } catch {
    return []
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Categorías de gasto (solo admin; el negocio sale siempre del perfil)
// ════════════════════════════════════════════════════════════════════════════

export async function createExpenseCategory(
  name: string,
  color?: string,
): Promise<ActionResult & { category?: ExpenseCategoryRow }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const clean = normalizeCategoryName(name)
  if (typeof clean !== 'string') return clean
  if (color !== undefined && color !== null && !isValidCategoryColor(color)) {
    return { error: 'Elige un color válido.' }
  }

  const categories = await ensureExpenseCategories(supabase, businessId)
  if (categories.some(c => nameKey(c.name) === nameKey(clean))) return { error: DUPLICATE_CATEGORY }

  const { data, error } = await supabase
    .from('expense_categories')
    .insert({
      business_id: businessId,
      slug:        slugifyCategory(clean, categories.map(c => c.slug)),
      name:        clean,
      // Sin color elegido: se reparte de la paleta según cuántas categorías hay
      color:       color ?? CATEGORY_PALETTE[categories.length % CATEGORY_PALETTE.length].key,
      sort_order:  Math.max(0, ...categories.map(c => c.sort_order)) + 1,
    })
    .select()
    .single()

  if (error) return { error: error.code === '23505' ? DUPLICATE_CATEGORY : error.message }

  revalidateExpenses()
  return { success: true, category: data as ExpenseCategoryRow }
}

export async function updateExpenseCategory(
  id: string,
  patch: ExpenseCategoryPatch,
): Promise<ActionResult & { category?: ExpenseCategoryRow }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  if (!patch || typeof patch !== 'object') return { error: 'Datos de categoría inválidos.' }

  const categories = await ensureExpenseCategories(supabase, businessId)
  const target = categories.find(c => c.id === id)
  if (!target) return { error: CATEGORY_NOT_FOUND }

  const update: { name?: string; color?: string; is_hidden?: boolean } = {}

  if (patch.name !== undefined) {
    const clean = normalizeCategoryName(patch.name)
    if (typeof clean !== 'string') return clean
    if (categories.some(c => c.id !== id && nameKey(c.name) === nameKey(clean))) {
      return { error: DUPLICATE_CATEGORY }
    }
    update.name = clean
  }

  if (patch.color !== undefined) {
    if (!isValidCategoryColor(patch.color)) return { error: 'Elige un color válido.' }
    update.color = patch.color
  }

  if (patch.is_hidden !== undefined) {
    if (typeof patch.is_hidden !== 'boolean') return { error: 'Datos de categoría inválidos.' }
    if (patch.is_hidden && !target.is_hidden && !categories.some(c => c.id !== id && !c.is_hidden)) {
      return { error: LAST_VISIBLE_CATEGORY }
    }
    update.is_hidden = patch.is_hidden
  }

  if (Object.keys(update).length === 0) return { success: true, category: target }

  const { data, error } = await supabase
    .from('expense_categories')
    .update(update)
    .eq('id', id)
    .eq('business_id', businessId)
    .select()
    .single()

  if (error) return { error: error.code === '23505' ? DUPLICATE_CATEGORY : error.message }

  revalidateExpenses()
  return { success: true, category: data as ExpenseCategoryRow }
}

export async function deleteExpenseCategory(id: string): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const categories = await ensureExpenseCategories(supabase, businessId)
  const target = categories.find(c => c.id === id)
  if (!target) return { error: CATEGORY_NOT_FOUND }

  const { count, error: countError } = await supabase
    .from('expenses')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('category', target.slug)
  if (countError) return { error: countError.message }
  if ((count ?? 0) > 0) return { error: CATEGORY_IN_USE }

  if (!target.is_hidden && !categories.some(c => c.id !== id && !c.is_hidden)) {
    return { error: LAST_VISIBLE_CATEGORY }
  }

  const { error } = await supabase
    .from('expense_categories')
    .delete()
    .eq('id', id)
    .eq('business_id', businessId)
  if (error) return { error: error.message }

  revalidateExpenses()
  return { success: true }
}

/** Cuántos gastos (de cualquier fecha) tiene cada categoría, por slug. */
export async function getExpenseCategoryUsage(): Promise<{ usage: Record<string, number> } | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const usage: Record<string, number> = {}
  const PAGE = 1000
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('expenses')
      .select('category')
      .eq('business_id', businessId)
      .order('id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) return { error: error.message }
    const rows = (data ?? []) as { category: string }[]
    for (const r of rows) usage[r.category] = (usage[r.category] ?? 0) + 1
    if (rows.length < PAGE) break
  }
  return { usage }
}
