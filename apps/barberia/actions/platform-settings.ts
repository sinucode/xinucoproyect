'use server'

// actions/platform-settings.ts — Ajustes globales de la plataforma (solo super_admin).
// La BD refuerza lo mismo: RLS de platform_settings solo deja leer/cambiar al super_admin
// y un trigger rechaza plazos fuera de 12/24/36/60/120 meses.

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { isValidRetention } from '@/lib/audit-retention'
import { businessTodayISODate } from '@/lib/agenda-time'

const NOT_SUPER_ADMIN = 'Acceso denegado. Se requieren privilegios de super_admin.'
const SETTING_KEY = 'audit_retention_months'

export interface AuditRetentionSetting {
  months:        number
  updatedAt:     string | null
  updatedByName: string | null
}

// ════════════════════════════════════════════════════════════════════════════
// getAuditRetentionSetting — plazo vigente + quién/cuándo lo cambió
// ════════════════════════════════════════════════════════════════════════════

export async function getAuditRetentionSetting(): Promise<AuditRetentionSetting | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.app_metadata?.role !== 'super_admin') return { error: NOT_SUPER_ADMIN }

  const { data, error } = await (supabase as any)
    .from('platform_settings')
    .select('value, updated_at, updated_by_name')
    .eq('key', SETTING_KEY)
    .maybeSingle()

  if (error || !data) return { error: 'No se pudo leer el plazo de la auditoría.' }

  const months = Number(data.value)
  if (!isValidRetention(months)) return { error: 'No se pudo leer el plazo de la auditoría.' }

  return {
    months,
    updatedAt:     (data.updated_at as string | null) ?? null,
    updatedByName: (data.updated_by_name as string | null) ?? null,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// updateAuditRetention — cambia el plazo (12, 24, 36, 60 o 120 meses)
// ════════════════════════════════════════════════════════════════════════════

export async function updateAuditRetention(
  months: number,
): Promise<
  { success: true; months: number; updatedAt: string; updatedByName: string } | { success: false; error: string }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.app_metadata?.role !== 'super_admin') {
    return { success: false, error: NOT_SUPER_ADMIN }
  }

  if (!isValidRetention(months)) return { success: false, error: 'Plazo no permitido.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle()
  const fullName = (profile as { full_name?: string | null } | null)?.full_name?.trim()
  const updatedByName = fullName || user.email || 'Super admin'

  const { data, error } = await (supabase as any)
    .from('platform_settings')
    .update({ value: months, updated_by: user.id, updated_by_name: updatedByName })
    .eq('key', SETTING_KEY)
    .select('key')

  if (error) {
    return {
      success: false,
      error: String(error.message ?? '').includes('invalid_retention')
        ? 'Plazo no permitido.'
        : 'No se pudo guardar.',
    }
  }
  if (!data || data.length === 0) return { success: false, error: 'No se pudo guardar.' }

  revalidatePath('/adminbarberia/settings')
  return { success: true, months, updatedAt: new Date().toISOString(), updatedByName }
}

// ════════════════════════════════════════════════════════════════════════════
// Borrado manual de auditoría (solo super_admin)
// La BD (RPC count_/purge_audit_logs_before) vuelve a validar el rol y la fecha.
// ════════════════════════════════════════════════════════════════════════════

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidBusinessFilter(businessId: string | null): boolean {
  return businessId === null || (typeof businessId === 'string' && UUID_RE.test(businessId))
}

function purgeErrorMessage(message: unknown): string {
  const text = String(message ?? '')
  if (text.includes('forbidden')) return 'Acceso denegado.'
  if (text.includes('invalid_date')) return 'Fecha no válida.'
  return 'No se pudo completar la operación.'
}

/** Cuántos registros de auditoría anteriores a hoy (Colombia) hay; null = todas las barberías. */
export async function countAuditLogsBefore(
  businessId: string | null,
): Promise<{ count: number } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.app_metadata?.role !== 'super_admin') return { error: NOT_SUPER_ADMIN }

  if (!isValidBusinessFilter(businessId)) return { error: 'Barbería no válida.' }

  const { data, error } = await (supabase as any).rpc('count_audit_logs_before', {
    p_before:      businessTodayISODate(),
    p_business_id: businessId,
  })

  if (error) return { error: purgeErrorMessage(error.message) }
  return { count: Number(data ?? 0) }
}

/** Borra los registros de auditoría anteriores a hoy (Colombia). Exige escribir BORRAR. */
export async function purgeAuditLogsBeforeToday(
  businessId: string | null,
  confirmation: string,
): Promise<{ success: true; deleted: number } | { success: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.app_metadata?.role !== 'super_admin') {
    return { success: false, error: NOT_SUPER_ADMIN }
  }

  if (!isValidBusinessFilter(businessId)) return { success: false, error: 'Barbería no válida.' }
  if (typeof confirmation !== 'string' || confirmation.trim().toUpperCase() !== 'BORRAR') {
    return { success: false, error: 'Escribe BORRAR para confirmar.' }
  }

  const { data, error } = await (supabase as any).rpc('purge_audit_logs_before', {
    p_before:      businessTodayISODate(),
    p_business_id: businessId,
  })

  if (error) return { success: false, error: purgeErrorMessage(error.message) }

  const deleted = Number((data as { deleted?: number } | null)?.deleted ?? 0)

  revalidatePath('/adminbarberia/settings')
  revalidatePath('/[slug]/dashboard/audit', 'page')
  return { success: true, deleted }
}
