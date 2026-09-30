'use server'
// actions/accounting.ts — Contabilidad: movimientos de plata y resultados del mes.
// El business_id sale SIEMPRE del perfil del usuario (nunca del navegador) y solo el admin entra.

import { createClient } from '@xinuco/supabase/server'
import type { MoneyMovement, ProfitLossResult, StaffProduction } from '@xinuco/types'
import {
  isMonthKey, currentMonthKey, monthRange, previousMonth, monthsBetween, rangeDates,
  ACCOUNTANT_MAX_MONTHS, ACCOUNTANT_HISTORY_MONTHS,
} from '@/lib/accounting-utils'
import { fetchProfitLoss } from '@/lib/profit-loss'

const NOT_ADMIN = 'Solo un administrador puede ver la contabilidad.'
const LOAD_FAILED = 'No se pudo cargar la información. Intenta de nuevo.'

type Supabase = Awaited<ReturnType<typeof createClient>>

export interface MonthResults {
  current:  ProfitLossResult
  previous: ProfitLossResult
  from:     string
  to:       string
  prevFrom: string
  prevTo:   string
}

export interface AccountantPackage {
  movements: MoneyMovement[]
  monthly:   { month: string; pl: ProfitLossResult }[]
  total:     ProfitLossResult
  staff:     StaffProduction[]
  from:      string
  to:        string
}

// ── Autorización ──────────────────────────────────────────────────────────────

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

function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

// ════════════════════════════════════════════════════════════════════════════
// getMoneyMovements — todo lo que entró y salió de verdad entre dos fechas
// ════════════════════════════════════════════════════════════════════════════

async function getMoneyMovementsWith(
  supabase: Supabase,
  from: string,
  to: string,
): Promise<{ rows: MoneyMovement[] } | { error: string }> {
  // El negocio sale del JWT dentro del RPC; aquí solo se pasan las fechas.
  const { data, error } = await supabase.rpc('get_money_movements', {
    p_date_from: from,
    p_date_to:   to,
  })

  if (error) {
    if (error.message.includes('forbidden')) return { error: NOT_ADMIN }
    if (error.message.includes('invalid_range')) {
      return { error: 'El rango de fechas no es válido (máximo 400 días).' }
    }
    console.error('[getMoneyMovements]', error)
    return { error: LOAD_FAILED }
  }

  return { rows: (data ?? []) as unknown as MoneyMovement[] }
}

export async function getMoneyMovements(
  from: string,
  to: string,
): Promise<{ rows: MoneyMovement[] } | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth

  if (!isRealDate(from) || !isRealDate(to)) return { error: 'Las fechas no son válidas.' }
  if (to < from) return { error: 'La fecha final no puede ser anterior a la inicial.' }

  return getMoneyMovementsWith(auth.supabase, from, to)
}

// ════════════════════════════════════════════════════════════════════════════
// getMonthResults — estado de resultados del mes y del mes anterior completo
// ════════════════════════════════════════════════════════════════════════════

export async function getMonthResults(yyyyMm: string): Promise<MonthResults | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  if (!isMonthKey(yyyyMm)) return { error: 'El mes no es válido.' }
  const now = currentMonthKey()
  const key = yyyyMm > now ? now : yyyyMm

  const { from, to } = monthRange(key)
  const prevFull = monthRange(previousMonth(key))
  const prevFrom = prevFull.from
  // Mes en curso: se compara contra los mismos días del mes anterior (1 al día de hoy)
  let prevTo = prevFull.to
  if (key === now) {
    const day = Math.min(Number(to.slice(8, 10)), Number(prevFull.to.slice(8, 10)))
    prevTo = `${prevFrom.slice(0, 8)}${String(day).padStart(2, '0')}`
  }

  const [cur, prev] = await Promise.all([
    fetchProfitLoss(supabase, businessId, from, to),
    fetchProfitLoss(supabase, businessId, prevFrom, prevTo),
  ])

  if ('error' in cur) return cur
  if ('error' in prev) return prev

  return { current: cur.pl, previous: prev.pl, from, to, prevFrom, prevTo }
}

// ════════════════════════════════════════════════════════════════════════════
// getStaffProduction — qué produjo, ganó y se le pagó a cada profesional
// ════════════════════════════════════════════════════════════════════════════

async function fetchStaffProduction(
  supabase: Supabase,
  from: string,
  to: string,
): Promise<{ rows: StaffProduction[] } | { error: string }> {
  // El negocio sale del JWT dentro del RPC; aquí solo se pasan las fechas.
  const { data, error } = await supabase.rpc('get_staff_production', {
    p_date_from: from,
    p_date_to:   to,
  })

  if (error) {
    if (error.message.includes('forbidden')) return { error: NOT_ADMIN }
    if (error.message.includes('invalid_range')) {
      return { error: 'El rango de fechas no es válido (máximo 400 días).' }
    }
    console.error('[getStaffProduction]', error)
    return { error: LOAD_FAILED }
  }

  return { rows: (data ?? []) as unknown as StaffProduction[] }
}

export async function getStaffProduction(
  from: string,
  to: string,
): Promise<{ rows: StaffProduction[] } | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth

  if (!isRealDate(from) || !isRealDate(to)) return { error: 'Las fechas no son válidas.' }
  if (to < from) return { error: 'La fecha final no puede ser anterior a la inicial.' }

  return fetchStaffProduction(auth.supabase, from, to)
}

// ════════════════════════════════════════════════════════════════════════════
// getAccountantPackage — todo lo que el contador necesita para un rango de meses
// ════════════════════════════════════════════════════════════════════════════

export async function getAccountantPackage(
  fromMonth: string,
  toMonth: string,
): Promise<AccountantPackage | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  if (!isMonthKey(fromMonth) || !isMonthKey(toMonth)) return { error: 'Los meses no son válidos.' }
  if (toMonth < fromMonth) return { error: 'El mes final no puede ser anterior al inicial.' }

  const now = currentMonthKey()
  if (toMonth > now) return { error: 'No se puede pedir un mes que todavía no ha llegado.' }

  const months = monthsBetween(fromMonth, toMonth)
  if (months.length > ACCOUNTANT_MAX_MONTHS) {
    return { error: `Elige máximo ${ACCOUNTANT_MAX_MONTHS} meses por descarga.` }
  }
  const oldest = monthsBetween(fromMonth, now).length
  if (oldest > ACCOUNTANT_HISTORY_MONTHS) {
    return { error: `Solo se pueden descargar los últimos ${ACCOUNTANT_HISTORY_MONTHS} meses.` }
  }

  const { from, to } = rangeDates(fromMonth, toMonth)

  const [movements, staff, total, ...perMonth] = await Promise.all([
    getMoneyMovementsWith(supabase, from, to),
    fetchStaffProduction(supabase, from, to),
    fetchProfitLoss(supabase, businessId, from, to),
    ...months.map(m => {
      const r = monthRange(m)
      return fetchProfitLoss(supabase, businessId, r.from, r.to)
    }),
  ])

  if ('error' in movements) return movements
  if ('error' in staff) return staff
  if ('error' in total) return total

  const monthly: AccountantPackage['monthly'] = []
  for (let i = 0; i < months.length; i++) {
    const res = perMonth[i]
    if ('error' in res) return res
    monthly.push({ month: months[i], pl: res.pl })
  }

  return { movements: movements.rows, monthly, total: total.pl, staff: staff.rows, from, to }
}
