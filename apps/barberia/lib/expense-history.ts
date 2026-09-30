// lib/expense-history.ts — historial de gastos para calcular los gastos fijos pendientes.
// Solo trae las columnas necesarias y pagina de a 1000 filas (tope de PostgREST).
import type { RecurringExpenseLike } from './expense-utils'

export const EXPENSE_HISTORY_DAYS = 400
export const EXPENSE_HISTORY_COLUMNS =
  'id, category, description, amount, expense_date, is_recurring, payment_method, created_at, auto_registered'

const PAGE_SIZE = 1000

/**
 * Gastos del negocio con `expense_date` en [fromKey, toKeyExclusive) (si se pasa),
 * del más reciente al más antiguo. Sirve con cliente de usuario (RLS) o service role:
 * SIEMPRE filtra por `business_id`.
 */
export async function fetchExpenseHistory(
  supabase: any,
  businessId: string,
  fromKey: string,
  toKeyExclusive?: string,
): Promise<RecurringExpenseLike[]> {
  const rows: RecurringExpenseLike[] = []

  for (let page = 0; ; page++) {
    let query = supabase
      .from('expenses')
      .select(EXPENSE_HISTORY_COLUMNS)
      .eq('business_id', businessId)
      .gte('expense_date', fromKey)
    if (toKeyExclusive) query = query.lt('expense_date', toKeyExclusive)

    const { data, error } = await query
      .order('expense_date', { ascending: false })
      .order('id', { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (error) throw new Error(error.message)
    const batch = (data ?? []) as RecurringExpenseLike[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }

  return rows
}
