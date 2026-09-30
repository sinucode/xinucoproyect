'use server'

// actions/audit.ts — Lectura de la Auditoría (solo administrador).
// Los registros los escriben triggers de la BD; aquí NO se escribe nada.
// El business_id sale SIEMPRE del perfil del administrador (nunca del cliente).

import { createClient } from '@xinuco/supabase/server'
import type { AuditLog } from '@xinuco/types'
import {
  bogotaDayRange,
  isAuditCategory,
  parseActorFilter,
  summarizeAlerts,
  type AuditActorOption,
  type AuditAlertItem,
  type AuditAlertRow,
  type AuditFilters,
} from '@/lib/audit-utils'
import { DEFAULT_AUDIT_RETENTION_MONTHS } from '@/lib/audit-retention'

const NOT_ADMIN = 'Solo un administrador puede ver la auditoría.'
const PAGE_SIZE = 50
const TS_RE   = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALERT_DAYS = 7
const ALERT_ROW_LIMIT = 1000

type Supabase = Awaited<ReturnType<typeof createClient>>

async function requireAdmin(): Promise<{ supabase: Supabase; businessId: string } | { error: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NOT_ADMIN }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', user.id)
    .single()

  const p = profile as { role?: string; business_id?: string | null } | null
  if (!p || p.role !== 'admin' || !p.business_id) return { error: NOT_ADMIN }

  return { supabase, businessId: p.business_id }
}

// ════════════════════════════════════════════════════════════════════════════
// getAuditLogs — una página (50) de registros, del más nuevo al más viejo
// ════════════════════════════════════════════════════════════════════════════

export async function getAuditLogs(
  filters: AuditFilters = {},
): Promise<{ logs: AuditLog[]; hasMore: boolean } | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase, businessId } = auth

  let query = supabase
    .from('audit_logs')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE + 1)

  if (isAuditCategory(filters.category)) query = query.eq('category', filters.category)
  if (filters.onlyWarnings === true) query = query.eq('severity', 'warning')

  const actor = parseActorFilter(filters.actor)
  if (actor) {
    query = 'id' in actor
      ? query.eq('actor_id', actor.id)
      : query.is('actor_id', null).eq('actor_name', actor.name)
  }

  const { fromIso, toIso } = bogotaDayRange(filters.from, filters.to)
  if (fromIso) query = query.gte('created_at', fromIso)
  if (toIso) query = query.lt('created_at', toIso)

  // Cursor compuesto: los triggers de una misma operación comparten created_at
  const b = filters.before
  if (b && typeof b.createdAt === 'string' && TS_RE.test(b.createdAt) && typeof b.id === 'string' && UUID_RE.test(b.id)) {
    const ts = b.createdAt // tal cual viene de la BD: conserva los microsegundos
    query = query.or(`created_at.lt."${ts}",and(created_at.eq."${ts}",id.lt.${b.id})`)
  }

  const { data, error } = await query
  if (error) {
    console.error('[audit.getAuditLogs]', error.message)
    return { error: 'No se pudo cargar el registro. Intenta de nuevo.' }
  }

  const rows = (data ?? []) as AuditLog[]
  return { logs: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE }
}

// ════════════════════════════════════════════════════════════════════════════
// getAuditActors — opciones del filtro "Quién"
// ════════════════════════════════════════════════════════════════════════════

export async function getAuditActors(): Promise<AuditActorOption[] | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase, businessId } = auth

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('business_id', businessId)
    .order('full_name', { ascending: true })

  if (error) {
    console.error('[audit.getAuditActors]', error.message)
    return { error: 'No se pudo cargar la lista de personas.' }
  }

  const people: AuditActorOption[] = ((data ?? []) as { id: string; full_name: string | null }[])
    .filter(p => p.full_name && p.full_name.trim() !== '')
    .map(p => ({ value: `id:${p.id}`, label: p.full_name!.trim() }))

  return [
    ...people,
    { value: 'name:Sistema', label: 'Sistema' },
    { value: 'name:Cliente (en línea)', label: 'Cliente (en línea)' },
    { value: 'name:Soporte Xinuco', label: 'Soporte Xinuco' },
  ]
}

// ════════════════════════════════════════════════════════════════════════════
// getAuditAlerts — resumen de lo delicado en los últimos 7 días
// ════════════════════════════════════════════════════════════════════════════

export async function getAuditAlerts(): Promise<AuditAlertItem[] | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase, businessId } = auth

  const since = new Date(Date.now() - ALERT_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('audit_logs')
    .select('action, amount, severity')
    .eq('business_id', businessId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(ALERT_ROW_LIMIT)

  if (error) {
    console.error('[audit.getAuditAlerts]', error.message)
    return { error: 'No se pudo calcular el resumen de la semana.' }
  }

  return summarizeAlerts((data ?? []) as AuditAlertRow[])
}

// ════════════════════════════════════════════════════════════════════════════
// getAuditRetentionMonths — cuánto tiempo se conserva la auditoría (36 si falla)
// ════════════════════════════════════════════════════════════════════════════

export async function getAuditRetentionMonths(): Promise<number> {
  const auth = await requireAdmin()
  if ('error' in auth) return DEFAULT_AUDIT_RETENTION_MONTHS

  const { data, error } = await (auth.supabase as any).rpc('get_audit_retention_months')
  const months = Number(data)
  if (error || !Number.isInteger(months) || months <= 0) return DEFAULT_AUDIT_RETENTION_MONTHS
  return months
}
