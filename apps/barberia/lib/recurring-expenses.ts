// lib/recurring-expenses.ts — gastos fijos mensuales: registro automático + aviso el día antes.
//
// Lo ejecuta el cron diario (app/api/cron/send-reminders) con un cliente service-role
// (cross-tenant, sin RLS): por eso CADA consulta filtra por business_id explícitamente.
//
// Un "gasto fijo" es un grupo (categoría + descripción normalizada); su plantilla es el gasto
// más reciente del grupo y solo sigue activo si está marcado como fijo (ver pendingRecurring).
import { addDaysToDateKey } from './agenda-time'
import {
  categoryName,
  pendingRecurring,
  recurringKey,
  monthRange,
  type ExpenseCategoryLike,
  type PendingRecurringExpense,
  type RecurringExpenseLike,
} from './expense-utils'
import { EXPENSE_HISTORY_DAYS, fetchExpenseHistory } from './expense-history'
import { loadAdminEmails, sendRecurringExpenseReminder } from './email/notifications'

/** Días hacia atrás que se recuperan si el cron dejó de correr algún día. */
export const CATCH_UP_DAYS = 3

export interface RegisteredRecurring {
  business_id:  string
  category:     string
  description:  string
  amount:       number
  expense_date: string
}

export interface ReminderSummary {
  business_id: string
  due_date:    string
  items:       { description: string; category: string; amount: number }[]
  /** Administradores con correo a quienes se avisa. */
  recipients:  number
  /** Correos enviados (0 en dryRun o si Resend no está configurado). */
  sent:        number
}

export interface RecurringRunSummary {
  today:      string
  dryRun:     boolean
  businesses: number
  registered: RegisteredRecurring[]
  reminders:  ReminderSummary[]
  errors:     string[]
}

const monthOf = (dateKey: string) => dateKey.slice(0, 7)

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** Negocios con al menos un gasto fijo en los últimos ~400 días. */
async function findBusinessIdsWithRecurring(supabase: any, sinceKey: string): Promise<string[]> {
  const PAGE = 1000
  const ids = new Set<string>()
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('expenses')
      .select('business_id')
      .eq('is_recurring', true)
      .gte('expense_date', sinceKey)
      .order('id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { business_id: string }[]
    for (const r of rows) ids.add(r.business_id)
    if (rows.length < PAGE) break
  }
  return [...ids]
}

interface BusinessRow {
  id:                string
  name:              string
  slug:              string
  is_active?:        boolean | null
  features_enabled?: { expenses_pgl?: boolean } | null
}

async function loadBusinesses(supabase: any, ids: string[]): Promise<BusinessRow[]> {
  const rows: BusinessRow[] = []
  for (const part of chunk(ids, 100)) {
    const { data, error } = await supabase
      .from('businesses')
      .select('id, name, slug, is_active, features_enabled')
      .in('id', part)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as BusinessRow[]))
  }
  // Solo negocios activos con el módulo Gastos habilitado (sin él, /expenses redirige)
  return rows.filter(b => b.is_active !== false && b.features_enabled?.expenses_pgl === true)
}

/** ¿El mes ya tiene un gasto del mismo grupo? (relectura justo antes de insertar → idempotente) */
async function groupAlreadyRegistered(
  supabase: any,
  businessId: string,
  item: PendingRecurringExpense,
): Promise<boolean> {
  const { from, to } = monthRange(monthOf(item.due_date))
  const { data, error } = await supabase
    .from('expenses')
    .select('id, description')
    .eq('business_id', businessId)
    .eq('category', item.category)
    .gte('expense_date', from)
    .lte('expense_date', to)
  if (error) throw new Error(error.message)
  const key = recurringKey(item.category, item.description)
  return ((data ?? []) as { description: string }[]).some(r => recurringKey(item.category, r.description) === key)
}

async function loadCategories(supabase: any, businessId: string): Promise<ExpenseCategoryLike[]> {
  try {
    const { data } = await supabase
      .from('expense_categories')
      .select('slug, name, color, is_hidden')
      .eq('business_id', businessId)
    return (data ?? []) as ExpenseCategoryLike[]
  } catch {
    return []
  }
}

/**
 * Registra los gastos fijos que vencen hoy (o en los últimos CATCH_UP_DAYS días si el cron
 * no corrió) y avisa por correo a los administradores de los que vencen mañana.
 * `dryRun`: calcula y devuelve el resumen sin insertar gastos ni enviar correos.
 */
export async function runRecurringExpenses(
  supabase: any,
  { todayKey, dryRun = false }: { todayKey: string; dryRun?: boolean },
): Promise<RecurringRunSummary> {
  const summary: RecurringRunSummary = {
    today: todayKey, dryRun, businesses: 0, registered: [], reminders: [], errors: [],
  }

  const since = addDaysToDateKey(todayKey, -EXPENSE_HISTORY_DAYS)
  const tomorrow = addDaysToDateKey(todayKey, 1)
  const windowFrom = addDaysToDateKey(todayKey, -CATCH_UP_DAYS)

  const businessIds = await findBusinessIdsWithRecurring(supabase, since)
  if (businessIds.length === 0) return summary
  const businesses = await loadBusinesses(supabase, businessIds)
  summary.businesses = businesses.length

  // Meses que toca revisar por el registro (la ventana puede cruzar de mes)
  const catchUpMonths = [...new Set(
    Array.from({ length: CATCH_UP_DAYS + 1 }, (_, i) => monthOf(addDaysToDateKey(windowFrom, i))),
  )]

  for (const biz of businesses) {
    try {
      const all: RecurringExpenseLike[] = await fetchExpenseHistory(supabase, biz.id, since)
      const pendingFor = (month: string) =>
        pendingRecurring(all, all.filter(e => monthOf(e.expense_date) === month), month, todayKey)

      // ── 1. Registrar los que vencen hoy (o quedaron sin registrar en la ventana) ──
      const due = catchUpMonths
        .flatMap(pendingFor)
        .filter(item => item.due_date >= windowFrom && item.due_date <= todayKey)
        .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.description.localeCompare(b.description))

      for (const item of due) {
        if (!dryRun && await groupAlreadyRegistered(supabase, biz.id, item)) continue

        if (!dryRun) {
          const { error } = await supabase.from('expenses').insert({
            business_id:     biz.id,
            category:        item.category,
            description:     item.description,
            amount:          item.amount,
            expense_date:    item.due_date,
            is_recurring:    true,
            payment_method:  item.payment_method,   // el efectivo de la caja ya viene como 'transfer'
            shift_id:        null,
            auto_registered: true,
            created_by:      null,
          })
          if (error) {
            summary.errors.push(`${biz.id}: no se pudo registrar "${item.description}": ${error.message}`)
            continue
          }
        }

        summary.registered.push({
          business_id:  biz.id,
          category:     item.category,
          description:  item.description,
          amount:       item.amount,
          expense_date: item.due_date,
        })
        // Cuenta como registrado para el cálculo de los avisos de mañana
        all.push({
          category: item.category, description: item.description, amount: item.amount,
          expense_date: item.due_date, is_recurring: true, payment_method: item.payment_method,
          created_at: new Date().toISOString(),
        })
      }

      // ── 2. Avisar los que vencen mañana (mañana puede ser del mes siguiente) ──
      const dueTomorrow = pendingFor(monthOf(tomorrow)).filter(item => item.due_date === tomorrow)
      if (dueTomorrow.length === 0) continue

      const categories = await loadCategories(supabase, biz.id)
      const items = dueTomorrow.map(item => ({
        description: item.description,
        category:    item.category,
        amount:      item.amount,
      }))

      let recipients: number
      let sent = 0
      if (dryRun) {
        recipients = (await loadAdminEmails(supabase, biz.id)).length
      } else {
        const result = await sendRecurringExpenseReminder({
          supabase,
          businessId: biz.id,
          dueDate:    tomorrow,
          items:      items.map(i => ({ ...i, categoryName: categoryName(i.category, categories) })),
        })
        recipients = result.recipients
        sent = result.sent
      }
      summary.reminders.push({ business_id: biz.id, due_date: tomorrow, items, recipients, sent })
    } catch (err) {
      summary.errors.push(`${biz.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return summary
}
