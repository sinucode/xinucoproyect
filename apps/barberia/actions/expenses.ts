'use server'

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Expense, ExpensePaymentMethod, ProfitLossResult } from '@xinuco/types'
import { addDaysToDateKey, businessTodayISODate } from '@/lib/agenda-time'
import {
  EXPENSE_CATEGORY_VALUES,
  PAYMENT_METHOD_VALUES,
  isValidMonthKey,
  currentMonthKey,
  monthRange,
  pendingRecurring,
  type PendingRecurringExpense,
} from '@/lib/expense-utils'

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
}

const NOT_ADMIN         = 'Solo un administrador puede gestionar gastos.'
const NO_OPEN_SHIFT     = 'No hay caja abierta. Abre la caja o elige otro medio de pago.'
const CASH_MUST_BE_TODAY = 'Un gasto pagado con efectivo de la caja debe ser de hoy.'
const SHIFT_CLOSED      = 'Este gasto ya se cuadró en un cierre de caja.'
const MAX_AMOUNT        = 100_000_000

type Supabase = Awaited<ReturnType<typeof createClient>>

// ── Autorización ──────────────────────────────────────────────────────────────
// RLS de `expenses` deja pasar a cualquier usuario del negocio: la restricción a
// admin vive aquí, y el business_id sale SIEMPRE del perfil (nunca del cliente).

async function requireAdmin(): Promise<
  { supabase: Supabase; businessId: string; userId: string } | { error: string }
> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NOT_ADMIN }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', user.id)
    .single()

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

  if (typeof input.category !== 'string' || !EXPENSE_CATEGORY_VALUES.includes(input.category)) {
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
    },
  }
}

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
  const historyFrom = addDaysToDateKey(range.from, -400)

  const [expensesRes, historyRes, plRes, shift] = await Promise.all([
    supabase.from('expenses').select('*')
      .eq('business_id', businessId)
      .gte('expense_date', range.from).lte('expense_date', range.to)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase.from('expenses').select('*')
      .eq('business_id', businessId)
      .eq('is_recurring', true)
      .lt('expense_date', range.from).gte('expense_date', historyFrom)
      .order('expense_date', { ascending: false }),
    supabase.rpc('get_profit_loss', {
      p_business_id: businessId,
      p_date_from:   range.from,
      p_date_to:     range.to,
    }),
    getOpenShift(supabase, businessId),
  ])

  if (expensesRes.error) return { error: expensesRes.error.message }

  const expenses = (expensesRes.data ?? []) as Expense[]
  const history = (historyRes.data ?? []) as Expense[]

  // P&G: si falla no se cae la página; se muestra el motivo
  let pl: ProfitLossResult | null = null
  let plError: string | undefined
  const plResult = plRes.data as unknown as (ProfitLossResult & { error?: string }) | null
  if (plRes.error) {
    plError = plRes.error.message.includes('forbidden')
      ? 'No tienes permiso para ver el estado de resultados.'
      : 'No se pudo calcular el estado de resultados. Intenta de nuevo.'
  } else if (plResult?.error) {
    plError = 'No se pudo calcular el estado de resultados. Intenta de nuevo.'
  } else {
    pl = plResult
  }

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
  const { value } = checked

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
  const { value } = checked

  const { data: existingRow, error: findError } = await supabase
    .from('expenses')
    .select('*')
    .eq('id', expenseId)
    .eq('business_id', businessId)
    .maybeSingle()
  if (findError) return { error: findError.message }
  const existing = existingRow as Expense | null
  if (!existing) return { error: 'Gasto no encontrado.' }

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
  const rows = []
  for (const item of items) {
    const method = item?.payment_method ?? 'transfer'
    if (method === 'cash_register') {
      return { error: 'Los gastos fijos no se pagan con efectivo de la caja.' }
    }
    const checked = validateInput({ ...item, is_recurring: true, payment_method: method }, today)
    if ('error' in checked) return checked
    const v = checked.value
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
