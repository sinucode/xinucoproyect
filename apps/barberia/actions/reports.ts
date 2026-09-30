'use server'
// actions/reports.ts — Reportes gerenciales: una sola llamada al RPC get_management_report.
// El business_id sale SIEMPRE del perfil del usuario (nunca del navegador) y solo el admin entra.

import { createClient } from '@xinuco/supabase/server'
import type { ManagementReport } from '@xinuco/types'
import { businessTodayISODate } from '@/lib/agenda-time'
import { DEFAULT_PERIOD, isPeriodKey, periodRange, type PeriodKey } from '@/lib/report-utils'

const NOT_ADMIN = 'Solo un administrador puede ver los reportes.'
const LOAD_FAILED = 'No se pudo cargar el reporte. Intenta de nuevo.'

type Supabase = Awaited<ReturnType<typeof createClient>>

export interface ManagementReportResult {
  report:  ManagementReport
  periodo: PeriodKey
  from:    string
  to:      string
}

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

/** Reporte gerencial del período ('mes' | 'mes-pasado' | '3-meses' | 'anio'), en fechas de Bogotá. */
export async function getManagementReport(
  periodo?: string,
): Promise<ManagementReportResult | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth

  const key: PeriodKey = isPeriodKey(periodo) ? periodo : DEFAULT_PERIOD
  const { from, to } = periodRange(key, businessTodayISODate())

  // El negocio sale del JWT dentro del RPC; aquí solo se pasan las fechas.
  const { data, error } = await auth.supabase.rpc('get_management_report', {
    p_date_from: from,
    p_date_to:   to,
  })

  if (error) {
    if (error.message.includes('forbidden')) return { error: NOT_ADMIN }
    if (error.message.includes('invalid_range')) {
      return { error: 'El rango de fechas no es válido (máximo 400 días).' }
    }
    console.error('[getManagementReport]', error)
    return { error: LOAD_FAILED }
  }

  if (!data || typeof data !== 'object') return { error: LOAD_FAILED }

  return { report: data as unknown as ManagementReport, periodo: key, from, to }
}
