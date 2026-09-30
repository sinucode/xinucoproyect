'use server'
// actions/accounting.ts — Contabilidad: movimientos de plata y resultados del mes.
// El business_id sale SIEMPRE del perfil del usuario (nunca del navegador) y solo el admin entra.

import { createClient } from '@xinuco/supabase/server'
import type { MoneyMovement, ProfitLossResult } from '@xinuco/types'
import { isMonthKey, currentMonthKey, monthRange, previousMonth } from '@/lib/accounting-utils'
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

export async function getMoneyMovements(
  from: string,
  to: string,
): Promise<{ rows: MoneyMovement[] } | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase } = auth

  if (!isRealDate(from) || !isRealDate(to)) return { error: 'Las fechas no son válidas.' }
  if (to < from) return { error: 'La fecha final no puede ser anterior a la inicial.' }

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
