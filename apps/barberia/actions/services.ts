'use server'

import { randomUUID } from 'crypto'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Service, ServiceAudience, ServiceAudienceOrAll } from '@xinuco/types'
import { businessTodayISODate } from '@/lib/agenda-time'
import { AUDIENCE_ORDER, normalizeAudiences } from '@/lib/service-audience'
import {
  diffStaffServices,
  resolveServiceStaffIds,
  type StaffServiceRow,
} from '@/lib/service-staff'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ActionResult {
  success?:  boolean
  error?:    string
  data?:     Service | Service[]
  archived?: boolean
  deleted?:  boolean
  message?:  string
}

export interface ServiceInput {
  name:                string
  description?:        string | null
  duration_minutes:    number
  buffer_time_minutes: number
  price_cop:           number
  /** Público del servicio; 'all' = unisex (aparece en todos los públicos). */
  audience:            ServiceAudienceOrAll
  /** 'all' = todos los barberos; o la lista de los que SÍ lo hacen. */
  staff_ids:           string[] | 'all'
  workstation_ids:     string[]
}

export interface ServiceOverviewItem extends Service {
  staff_ids:       string[]
  workstation_ids: string[]
  month_count:     number
  month_revenue:   number
}

export interface ServicesOverview {
  services:     ServiceOverviewItem[]
  staff:        { id: string; full_name: string }[]
  workstations: { id: string; name: string }[]
  /** Públicos que atiende el negocio (siempre al menos uno). */
  audiences:    ServiceAudience[]
}

const NOT_ADMIN = 'Solo un administrador puede modificar servicios.'
const REVALIDATE = '/[slug]/dashboard/services'

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

// ── Validación de servidor ────────────────────────────────────────────────────

function validateInput(input: ServiceInput): string | null {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name.length < 2 || name.length > 80) {
    return 'El nombre debe tener entre 2 y 80 caracteres.'
  }
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (description.length > 300) {
    return 'La descripción no puede superar los 300 caracteres.'
  }
  if (!Number.isInteger(input.duration_minutes) || input.duration_minutes < 5 || input.duration_minutes > 480) {
    return 'La duración debe ser un número entero entre 5 y 480 minutos.'
  }
  if (!Number.isInteger(input.buffer_time_minutes) || input.buffer_time_minutes < 0 || input.buffer_time_minutes > 60) {
    return 'El tiempo de limpieza debe ser un número entero entre 0 y 60 minutos.'
  }
  if (!Number.isInteger(input.price_cop) || input.price_cop <= 0 || input.price_cop > 10_000_000) {
    return 'El precio debe ser un número entero mayor a 0 y hasta $10.000.000.'
  }
  if (input.staff_ids !== 'all' && !Array.isArray(input.staff_ids)) {
    return 'Selección de barberos inválida.'
  }
  if (Array.isArray(input.staff_ids) && input.staff_ids.length === 0) {
    return 'Elige al menos un barbero o selecciona "Todos los barberos".'
  }
  if (input.audience !== 'all' && !(AUDIENCE_ORDER as string[]).includes(input.audience)) {
    return 'Público inválido.'
  }
  if (!Array.isArray(input.workstation_ids)) {
    return 'Selección de estaciones inválida.'
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
    .from('services')
    .select('id, name')
    .eq('business_id', businessId)
  const target = name.trim().toLowerCase()
  return ((data ?? []) as { id: string; name: string }[]).some(
    s => s.id !== excludeId && s.name.trim().toLowerCase() === target,
  )
}

// ── Asignaciones (barberos + estaciones) ──────────────────────────────────────

interface AssignmentPlan {
  error?:      string
  inserts:     StaffServiceRow[]
  deletes:     StaffServiceRow[]
  workstations: string[]
}

/** Calcula (sin escribir) los cambios de staff_services y valida las estaciones. */
async function planAssignments(
  supabase: Supabase,
  businessId: string,
  serviceId: string,
  input: ServiceInput,
): Promise<AssignmentPlan> {
  const empty: AssignmentPlan = { inserts: [], deletes: [], workstations: [] }

  const [staffRes, servicesRes, rowsRes] = await Promise.all([
    supabase.from('staff').select('id, full_name').eq('business_id', businessId).eq('is_active', true),
    supabase.from('services').select('id').eq('business_id', businessId).eq('is_active', true),
    supabase.from('staff_services').select('staff_id, service_id').eq('business_id', businessId),
  ])
  if (staffRes.error)    return { ...empty, error: staffRes.error.message }
  if (servicesRes.error) return { ...empty, error: servicesRes.error.message }
  if (rowsRes.error)     return { ...empty, error: rowsRes.error.message }

  const staff = (staffRes.data ?? []) as { id: string; full_name: string }[]
  const staffIds = staff.map(s => s.id)

  if (Array.isArray(input.staff_ids)) {
    const invalid = input.staff_ids.some(id => !staffIds.includes(id))
    if (invalid) return { ...empty, error: 'Alguno de los barberos elegidos no es válido.' }
  }

  // El servicio objetivo cuenta como activo para materializar (excluido igualmente en el helper).
  const serviceIds = ((servicesRes.data ?? []) as { id: string }[]).map(s => s.id)

  const diff = diffStaffServices({
    currentRows: (rowsRes.data ?? []) as StaffServiceRow[],
    staffIds,
    serviceIds,
    targetServiceId: serviceId,
    target: input.staff_ids,
  })

  if (diff.blocked.length > 0) {
    const names = diff.blocked
      .map(id => staff.find(s => s.id === id)?.full_name ?? 'un barbero')
      .join(', ')
    return {
      ...empty,
      error:
        `No se puede quitar este servicio a ${names}: quedaría sin ningún servicio asignado ` +
        `(un barbero sin asignaciones hace todos los servicios). Asígnale otro servicio primero.`,
    }
  }

  // Estaciones: deben pertenecer al negocio.
  const wsIds = Array.from(new Set(input.workstation_ids))
  if (wsIds.length > 0) {
    const { data: ws, error } = await supabase
      .from('workstations')
      .select('id')
      .eq('business_id', businessId)
      .in('id', wsIds)
    if (error) return { ...empty, error: error.message }
    if (((ws ?? []) as { id: string }[]).length !== wsIds.length) {
      return { ...empty, error: 'Alguna de las estaciones elegidas no es válida.' }
    }
  }

  return { inserts: diff.inserts, deletes: diff.deletes, workstations: wsIds }
}

/** Aplica el plan. Inserta primero y borra después para no dejar barberos en cero filas. */
async function applyAssignments(
  supabase: Supabase,
  businessId: string,
  serviceId: string,
  plan: AssignmentPlan,
): Promise<string | null> {
  if (plan.inserts.length > 0) {
    const { error } = await supabase
      .from('staff_services')
      .insert(plan.inserts.map(r => ({ ...r, business_id: businessId })))
    if (error) return error.message
  }

  for (const row of plan.deletes) {
    const { error } = await supabase
      .from('staff_services')
      .delete()
      .eq('business_id', businessId)
      .eq('service_id', row.service_id)
      .eq('staff_id', row.staff_id)
    if (error) return error.message
  }

  // Estaciones: reemplazar las filas del servicio.
  const { error: delWsErr } = await supabase
    .from('service_workstations')
    .delete()
    .eq('business_id', businessId)
    .eq('service_id', serviceId)
  if (delWsErr) return delWsErr.message

  if (plan.workstations.length > 0) {
    const { error } = await supabase
      .from('service_workstations')
      .insert(plan.workstations.map(id => ({
        service_id: serviceId, workstation_id: id, business_id: businessId,
      })))
    if (error) return error.message
  }

  return null
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

/**
 * getServices — Obtiene los servicios de un negocio específico.
 * Usa el cliente autenticado → RLS filtra por business_id automáticamente.
 */
export async function getServices(businessId: string): Promise<Service[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as Service[]
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Rango [inicio, fin) del mes actual del negocio, como ISO UTC (hora local guardada como UTC). */
function currentMonthRange(): { from: string; to: string } {
  const today = businessTodayISODate() // YYYY-MM-DD
  const [y, m] = today.split('-').map(Number)
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    from: `${y}-${pad(m)}-01T00:00:00Z`,
    to:   `${ny}-${pad(nm)}-01T00:00:00Z`,
  }
}

/**
 * getServicesOverview — Datos completos para la página de Servicios:
 * servicios + barberos que lo hacen + estaciones + métricas del mes.
 */
export async function getServicesOverview(): Promise<ServicesOverview | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const [servicesRes, staffRes, wsRes, ssRes, swRes, bizRes] = await Promise.all([
    supabase.from('services').select('*').eq('business_id', businessId)
      .order('is_active', { ascending: false }).order('name', { ascending: true }),
    supabase.from('staff').select('id, full_name').eq('business_id', businessId)
      .eq('is_active', true).order('full_name', { ascending: true }),
    supabase.from('workstations').select('id, name').eq('business_id', businessId)
      .eq('is_active', true).order('name', { ascending: true }),
    supabase.from('staff_services').select('staff_id, service_id').eq('business_id', businessId),
    supabase.from('service_workstations').select('service_id, workstation_id').eq('business_id', businessId),
    supabase.from('businesses').select('service_audiences').eq('id', businessId).maybeSingle(),
  ])
  const firstError = [servicesRes, staffRes, wsRes, ssRes, swRes, bizRes].find(r => r.error)
  if (firstError?.error) return { error: firstError.error.message }

  const services = (servicesRes.data ?? []) as Service[]
  const staff = (staffRes.data ?? []) as { id: string; full_name: string }[]
  const workstations = (wsRes.data ?? []) as { id: string; name: string }[]
  const staffServiceRows = (ssRes.data ?? []) as StaffServiceRow[]
  const serviceWsRows = (swRes.data ?? []) as { service_id: string; workstation_id: string }[]
  const staffIds = staff.map(s => s.id)

  // ── Métricas del mes: citas completadas + ingresos de ventas pagadas ───────
  const stats = new Map<string, { count: number; revenue: number }>()
  const { from, to } = currentMonthRange()

  const { data: appts } = await supabase
    .from('appointments')
    .select('id, service_id')
    .eq('business_id', businessId)
    .eq('status', 'completed')
    .gte('start_time', from)
    .lt('start_time', to)

  const apptService = new Map<string, string>()
  for (const a of (appts ?? []) as { id: string; service_id: string }[]) {
    apptService.set(a.id, a.service_id)
    const s = stats.get(a.service_id) ?? { count: 0, revenue: 0 }
    s.count += 1
    stats.set(a.service_id, s)
  }

  if (apptService.size > 0) {
    const saleToService = new Map<string, string>()
    for (const ids of chunk(Array.from(apptService.keys()), 100)) {
      const { data: sales } = await supabase
        .from('sales')
        .select('id, appointment_id')
        .eq('business_id', businessId)
        .eq('status', 'paid')
        .in('appointment_id', ids)
      for (const sale of (sales ?? []) as { id: string; appointment_id: string }[]) {
        const svc = apptService.get(sale.appointment_id)
        if (svc) saleToService.set(sale.id, svc)
      }
    }

    for (const ids of chunk(Array.from(saleToService.keys()), 100)) {
      const { data: items } = await supabase
        .from('sale_items')
        .select('sale_id, total_price')
        .eq('business_id', businessId)
        .eq('item_type', 'service')
        .in('sale_id', ids)
      for (const it of (items ?? []) as { sale_id: string; total_price: number | null }[]) {
        const svc = saleToService.get(it.sale_id)
        if (!svc) continue
        const s = stats.get(svc) ?? { count: 0, revenue: 0 }
        s.revenue += Number(it.total_price ?? 0)
        stats.set(svc, s)
      }
    }
  }

  const items: ServiceOverviewItem[] = services.map(svc => ({
    ...svc,
    staff_ids:       resolveServiceStaffIds(svc.id, staffIds, staffServiceRows),
    workstation_ids: serviceWsRows.filter(r => r.service_id === svc.id).map(r => r.workstation_id),
    month_count:     stats.get(svc.id)?.count ?? 0,
    month_revenue:   stats.get(svc.id)?.revenue ?? 0,
  }))

  const audiences = normalizeAudiences(
    (bizRes.data as { service_audiences?: unknown } | null)?.service_audiences,
  )

  return { services: items, staff, workstations, audiences }
}

// ── Escrituras ────────────────────────────────────────────────────────────────

/**
 * createService — Crea un servicio y sus asignaciones de barberos/estaciones.
 * businessId y rol salen del perfil autenticado (nunca del cliente).
 */
export async function createService(input: ServiceInput): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const invalid = validateInput(input)
  if (invalid) return { error: invalid }

  const name = input.name.trim()
  if (await isDuplicateName(supabase, businessId, name)) {
    return { error: 'Ya existe un servicio con ese nombre.' }
  }

  const id = randomUUID()
  const plan = await planAssignments(supabase, businessId, id, input)
  if (plan.error) return { error: plan.error }

  const { data: result, error } = await supabase
    .from('services')
    .insert({
      id,
      business_id:         businessId,
      name,
      description:         input.description?.trim() || null,
      duration_minutes:    input.duration_minutes,
      buffer_time_minutes: input.buffer_time_minutes,
      price_cop:           input.price_cop,
      audience:            input.audience,
      is_active:           true,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'Ya existe un servicio con ese nombre.' }
    return { error: error.message }
  }

  const assignError = await applyAssignments(supabase, businessId, id, plan)
  if (assignError) {
    revalidatePath(REVALIDATE, 'page')
    return { error: `El servicio se creó, pero no se pudieron guardar las asignaciones: ${assignError}` }
  }

  revalidatePath(REVALIDATE, 'page')
  return { success: true, data: result as Service }
}

/** updateService — Actualiza datos y asignaciones de un servicio del negocio. */
export async function updateService(serviceId: string, input: ServiceInput): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const invalid = validateInput(input)
  if (invalid) return { error: invalid }

  const { data: existing } = await supabase
    .from('services')
    .select('id')
    .eq('id', serviceId)
    .eq('business_id', businessId)
    .maybeSingle()
  if (!existing) return { error: 'Servicio no encontrado.' }

  const name = input.name.trim()
  if (await isDuplicateName(supabase, businessId, name, serviceId)) {
    return { error: 'Ya existe un servicio con ese nombre.' }
  }

  const plan = await planAssignments(supabase, businessId, serviceId, input)
  if (plan.error) return { error: plan.error }

  const { error } = await supabase
    .from('services')
    .update({
      name,
      description:         input.description?.trim() || null,
      duration_minutes:    input.duration_minutes,
      buffer_time_minutes: input.buffer_time_minutes,
      price_cop:           input.price_cop,
      audience:            input.audience,
    })
    .eq('id', serviceId)
    .eq('business_id', businessId)

  if (error) {
    if (error.code === '23505') return { error: 'Ya existe un servicio con ese nombre.' }
    return { error: error.message }
  }

  const assignError = await applyAssignments(supabase, businessId, serviceId, plan)
  if (assignError) {
    revalidatePath(REVALIDATE, 'page')
    return { error: `Los datos se guardaron, pero no se pudieron guardar las asignaciones: ${assignError}` }
  }

  revalidatePath(REVALIDATE, 'page')
  return { success: true }
}

/**
 * setServiceAudiences — Define los públicos que atiende el negocio.
 * Desactivar un público oculta sus servicios (reservas y walk-ins), no los borra.
 */
export async function setServiceAudiences(audiences: string[]): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  if (!Array.isArray(audiences) || audiences.some(a => !(AUDIENCE_ORDER as string[]).includes(a))) {
    return { error: 'Público inválido.' }
  }
  if (audiences.length === 0) return { error: 'Debes atender al menos un público.' }

  const ordered = normalizeAudiences(audiences)

  const { error } = await supabase
    .from('businesses')
    .update({ service_audiences: ordered })
    .eq('id', businessId)
  if (error) return { error: error.message }

  revalidatePath(REVALIDATE, 'page')
  revalidatePath('/[slug]/book', 'page')
  revalidatePath('/[slug]', 'page')
  revalidatePath('/[slug]/dashboard/walk-ins', 'page')
  return { success: true }
}

/** setServiceActive — Activa o desactiva un servicio del negocio. */
export async function setServiceActive(serviceId: string, active: boolean): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const { error } = await supabase
    .from('services')
    .update({ is_active: active })
    .eq('id', serviceId)
    .eq('business_id', businessId)

  if (error) return { error: error.message }

  revalidatePath(REVALIDATE, 'page')
  return { success: true }
}

const ARCHIVED_MESSAGE =
  'El servicio tiene historial, así que se archivó (quedó inactivo) en lugar de borrarse.'

/**
 * deleteService — Borra el servicio si no tiene historial; si tiene citas
 * (appointments.service_id es ON DELETE RESTRICT) lo archiva (is_active=false).
 */
export async function deleteService(serviceId: string): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const { data: existing } = await supabase
    .from('services')
    .select('id')
    .eq('id', serviceId)
    .eq('business_id', businessId)
    .maybeSingle()
  if (!existing) return { error: 'Servicio no encontrado.' }

  const archive = async (): Promise<ActionResult> => {
    const { error } = await supabase
      .from('services')
      .update({ is_active: false })
      .eq('id', serviceId)
      .eq('business_id', businessId)
    if (error) return { error: error.message }
    revalidatePath(REVALIDATE, 'page')
    return { success: true, archived: true, message: ARCHIVED_MESSAGE }
  }

  const { data: appts, error: apptErr } = await supabase
    .from('appointments')
    .select('id')
    .eq('business_id', businessId)
    .eq('service_id', serviceId)
    .limit(1)
  if (apptErr) return { error: apptErr.message }
  if (((appts ?? []) as unknown[]).length > 0) return archive()

  const { error: ssErr } = await supabase
    .from('staff_services').delete().eq('business_id', businessId).eq('service_id', serviceId)
  if (ssErr) return { error: ssErr.message }

  const { error: swErr } = await supabase
    .from('service_workstations').delete().eq('business_id', businessId).eq('service_id', serviceId)
  if (swErr) return { error: swErr.message }

  const { error } = await supabase
    .from('services')
    .delete()
    .eq('id', serviceId)
    .eq('business_id', businessId)

  if (error) {
    // Otra tabla (p. ej. fila de espera) referencia el servicio → archivar.
    if (error.code === '23503') return archive()
    return { error: error.message }
  }

  revalidatePath(REVALIDATE, 'page')
  return { success: true, deleted: true }
}
