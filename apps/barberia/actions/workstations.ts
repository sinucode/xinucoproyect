'use server'

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import type { ServiceAudience, ServiceAudienceOrAll } from '@xinuco/types'
import { businessTodayISODate } from '@/lib/agenda-time'
import { normalizeAudiences } from '@/lib/service-audience'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ActionResult {
  success?: boolean
  error?:   string
}

export interface WorkstationInput {
  name:        string
  service_ids: string[]
}

export interface WorkstationOverviewItem {
  id:          string
  name:        string
  is_active:   boolean
  created_at:  string
  /** Servicios que NECESITAN esta estación. */
  service_ids: string[]
  /** Citas no canceladas, de hoy en adelante, cuyo servicio usa esta estación. */
  in_use:      number
}

export interface WorkstationsOverview {
  workstations: WorkstationOverviewItem[]
  /** Servicios activos para elegir en el formulario. */
  services:     { id: string; name: string; audience: ServiceAudienceOrAll }[]
  /** Públicos que atiende el negocio (para mostrar la etiqueta solo si hay más de uno). */
  audiences:    ServiceAudience[]
}

const NOT_ADMIN = 'Solo un administrador puede modificar las estaciones.'

// ── Guard de administrador ────────────────────────────────────────────────────
// El business_id SIEMPRE sale del perfil del usuario autenticado, nunca del cliente.

type Supabase = Awaited<ReturnType<typeof createClient>>

async function requireAdmin(): Promise<
  { supabase: Supabase; businessId: string } | { error: string }
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

  return { supabase, businessId }
}

/** Las estaciones se ven en Estaciones, en Servicios y en la reserva pública. */
function revalidateAll() {
  revalidatePath('/[slug]/dashboard/workstations', 'page')
  revalidatePath('/[slug]/dashboard/services', 'page')
  revalidatePath('/[slug]/book', 'page')
}

// ── Validación ────────────────────────────────────────────────────────────────

function validateInput(input: WorkstationInput): string | null {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (name.length < 2 || name.length > 40) {
    return 'El nombre debe tener entre 2 y 40 caracteres.'
  }
  if (!Array.isArray(input.service_ids) || input.service_ids.some(id => typeof id !== 'string')) {
    return 'Selección de servicios inválida.'
  }
  return null
}

/** Pre-chequeo de nombre duplicado (sin distinguir mayúsculas) dentro del negocio. */
async function isDuplicateName(
  supabase: Supabase,
  businessId: string,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('workstations')
    .select('id, name')
    .eq('business_id', businessId)
  const target = name.trim().toLowerCase()
  return ((data ?? []) as { id: string; name: string }[]).some(
    w => w.id !== excludeId && w.name.trim().toLowerCase() === target,
  )
}

const DUPLICATE_MSG = 'Ya existe una estación con ese nombre.'

/** Los servicios elegidos deben pertenecer al negocio. Devuelve los ids únicos. */
async function validateServices(
  supabase: Supabase,
  businessId: string,
  serviceIds: string[],
): Promise<{ ids: string[] } | { error: string }> {
  const ids = Array.from(new Set(serviceIds))
  if (ids.length === 0) return { ids }

  const { data, error } = await supabase
    .from('services')
    .select('id')
    .eq('business_id', businessId)
    .in('id', ids)
  if (error) return { error: error.message }
  if (((data ?? []) as { id: string }[]).length !== ids.length) {
    return { error: 'Alguno de los servicios elegidos no es válido.' }
  }
  return { ids }
}

/**
 * Reemplaza los servicios de una estación: inserta los que faltan primero y
 * borra los sobrantes después. Siempre con business_id.
 */
async function replaceServiceLinks(
  supabase: Supabase,
  businessId: string,
  workstationId: string,
  serviceIds: string[],
): Promise<string | null> {
  const { data: current, error: readErr } = await supabase
    .from('service_workstations')
    .select('service_id')
    .eq('business_id', businessId)
    .eq('workstation_id', workstationId)
  if (readErr) return readErr.message

  const have = new Set(((current ?? []) as { service_id: string }[]).map(r => r.service_id))
  const want = new Set(serviceIds)

  const toInsert = serviceIds.filter(id => !have.has(id))
  const toDelete = Array.from(have).filter(id => !want.has(id))

  if (toInsert.length > 0) {
    const { error } = await supabase
      .from('service_workstations')
      .insert(toInsert.map(id => ({
        service_id: id, workstation_id: workstationId, business_id: businessId,
      })))
    if (error) return error.message
  }

  for (const serviceId of toDelete) {
    const { error } = await supabase
      .from('service_workstations')
      .delete()
      .eq('business_id', businessId)
      .eq('workstation_id', workstationId)
      .eq('service_id', serviceId)
    if (error) return error.message
  }

  return null
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

/**
 * getWorkstationsOverview — Datos para la página de Estaciones:
 * estaciones + servicios que las necesitan + citas próximas que las usan.
 */
export async function getWorkstationsOverview(): Promise<WorkstationsOverview | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const [wsRes, swRes, svcRes, bizRes] = await Promise.all([
    supabase.from('workstations').select('id, name, is_active, created_at').eq('business_id', businessId)
      .order('is_active', { ascending: false }).order('name', { ascending: true }),
    supabase.from('service_workstations').select('service_id, workstation_id').eq('business_id', businessId),
    supabase.from('services').select('id, name, audience').eq('business_id', businessId)
      .eq('is_active', true).order('name', { ascending: true }),
    supabase.from('businesses').select('service_audiences').eq('id', businessId).maybeSingle(),
  ])
  const firstError = [wsRes, swRes, svcRes, bizRes].find(r => r.error)
  if (firstError?.error) return { error: firstError.error.message }

  const stations = (wsRes.data ?? []) as { id: string; name: string; is_active: boolean; created_at: string }[]
  const links = (swRes.data ?? []) as { service_id: string; workstation_id: string }[]
  const services = (svcRes.data ?? []) as { id: string; name: string; audience: ServiceAudienceOrAll }[]

  // Servicio → estaciones y estación → servicios
  const servicesByStation = new Map<string, string[]>()
  const stationsByService = new Map<string, string[]>()
  for (const l of links) {
    servicesByStation.set(l.workstation_id, [...(servicesByStation.get(l.workstation_id) ?? []), l.service_id])
    stationsByService.set(l.service_id, [...(stationsByService.get(l.service_id) ?? []), l.workstation_id])
  }

  // Citas próximas (hoy en adelante, no canceladas) por servicio.
  // Convención horaria: start_time = hora local guardada como UTC.
  const inUseByStation = new Map<string, number>()
  const linkedServiceIds = Array.from(stationsByService.keys())
  if (linkedServiceIds.length > 0) {
    const { data: appts, error } = await supabase
      .from('appointments')
      .select('id, service_id')
      .eq('business_id', businessId)
      .neq('status', 'cancelled')
      .gte('start_time', `${businessTodayISODate()}T00:00:00Z`)
      .in('service_id', linkedServiceIds)
    if (error) return { error: error.message }

    for (const a of (appts ?? []) as { id: string; service_id: string }[]) {
      for (const wsId of stationsByService.get(a.service_id) ?? []) {
        inUseByStation.set(wsId, (inUseByStation.get(wsId) ?? 0) + 1)
      }
    }
  }

  return {
    workstations: stations.map(s => ({
      ...s,
      service_ids: servicesByStation.get(s.id) ?? [],
      in_use:      inUseByStation.get(s.id) ?? 0,
    })),
    services,
    audiences: normalizeAudiences((bizRes.data as { service_audiences?: unknown } | null)?.service_audiences),
  }
}

// ── Escrituras ────────────────────────────────────────────────────────────────

export async function createWorkstation(input: WorkstationInput): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const invalid = validateInput(input)
  if (invalid) return { error: invalid }
  const name = input.name.trim()

  if (await isDuplicateName(supabase, businessId, name)) return { error: DUPLICATE_MSG }

  const services = await validateServices(supabase, businessId, input.service_ids)
  if ('error' in services) return services

  const { data, error } = await supabase
    .from('workstations')
    .insert({ business_id: businessId, name, is_active: true })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { error: DUPLICATE_MSG }
    return { error: error.message }
  }

  const id = (data as { id?: string } | null)?.id
  if (!id) return { error: 'No se pudo crear la estación.' }

  const linkError = await replaceServiceLinks(supabase, businessId, id, services.ids)
  if (linkError) {
    revalidateAll()
    return { error: `La estación se creó, pero no se pudieron guardar sus servicios: ${linkError}` }
  }

  revalidateAll()
  return { success: true }
}

export async function updateWorkstation(id: string, input: WorkstationInput): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const invalid = validateInput(input)
  if (invalid) return { error: invalid }
  const name = input.name.trim()

  if (await isDuplicateName(supabase, businessId, name, id)) return { error: DUPLICATE_MSG }

  const services = await validateServices(supabase, businessId, input.service_ids)
  if ('error' in services) return services

  const { error } = await supabase
    .from('workstations')
    .update({ name })
    .eq('id', id)
    .eq('business_id', businessId)

  if (error) {
    if (error.code === '23505') return { error: DUPLICATE_MSG }
    return { error: error.message }
  }

  const linkError = await replaceServiceLinks(supabase, businessId, id, services.ids)
  if (linkError) {
    revalidateAll()
    return { error: `El nombre se guardó, pero no se pudieron guardar los servicios: ${linkError}` }
  }

  revalidateAll()
  return { success: true }
}

/** Activa o desactiva una estación. Inactiva = no cuenta para la capacidad. */
export async function setWorkstationActive(id: string, active: boolean): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const { error } = await supabase
    .from('workstations')
    .update({ is_active: Boolean(active) })
    .eq('id', id)
    .eq('business_id', businessId)
  if (error) return { error: error.message }

  revalidateAll()
  return { success: true }
}

/**
 * deleteWorkstation — Quita la estación de los servicios que la usan y la borra.
 * Las citas no referencian estaciones, así que el historial no cambia.
 */
export async function deleteWorkstation(id: string): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const { error: linksError } = await supabase
    .from('service_workstations')
    .delete()
    .eq('business_id', businessId)
    .eq('workstation_id', id)
  if (linksError) return { error: linksError.message }

  const { error } = await supabase
    .from('workstations')
    .delete()
    .eq('id', id)
    .eq('business_id', businessId)
  if (error) return { error: error.message }

  revalidateAll()
  return { success: true }
}
