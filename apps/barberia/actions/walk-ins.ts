'use server'

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import type { StaffStatusNow } from '@/lib/walk-in-wait'
import {
  canAttend, canReserve, canRelease, canSetStatus, WALK_IN_NOT_YOURS_MESSAGE,
  type WalkInActor, type WalkInOwnership,
} from '@/lib/walk-in-permissions'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type WalkInStatus = 'waiting' | 'in_progress' | 'completed' | 'cancelled'

export interface WalkIn {
  id:             string
  business_id:    string
  customer_name:  string
  customer_phone: string | null
  service_id:     string | null
  staff_id:       string | null
  status:         WalkInStatus
  notes:          string | null
  position:       number
  arrived_at:     string
  served_at:      string | null
  created_at:     string
  appointment_id?: string | null
  customer_id?:    string | null
}

export interface WalkInAppointment {
  id:         string
  status:     string
  start_time: string
  services:   { name: string; price_cop: number; duration_minutes: number } | null
}

export interface WalkInWithRelations extends WalkIn {
  service:      { id: string; name: string; price_cop?: number; duration_minutes?: number } | null
  staff:        { id: string; full_name: string } | null
  appointment?: WalkInAppointment | null
}

interface AddWalkInData {
  customer_name:   string
  customer_phone?: string | null
  service_id?:     string | null
  staff_id?:       string | null
  notes?:          string | null
}

interface ActionResult {
  success?: boolean
  error?:   string
}

export interface WalkInSuggestion {
  staff_id:         string
  full_name:        string
  /** Hora LOCAL del negocio guardada como UTC (formatear con formatApptTime) */
  next_slot:        string
  minutes_from_now: number
}

export type ReserveWalkInResult =
  | { success: true; staffId: string; startTime: string; error?: undefined }
  | { error: string; success?: undefined; staffId?: undefined; startTime?: undefined }

export type StartWalkInResult =
  | { success: true; appointmentId: string; error?: undefined }
  | { error: string; success?: undefined; appointmentId?: undefined }

// ════════════════════════════════════════════════════════════════════════════
// Actor (rol + profesional ligado) y turno — para las reglas de barbero.
// La BD las aplica de verdad (migración 20261002110000); aquí se validan antes
// para dar un mensaje claro. Si no se puede determinar el rol, se trata como
// barbero sin profesional (lo más restrictivo).
// ════════════════════════════════════════════════════════════════════════════

type Supa = Awaited<ReturnType<typeof createClient>>

/** Actor + negocio de su perfil (para filtrar las escrituras directas por business_id). */
type WalkInActorCtx = WalkInActor & { businessId: string | null }

async function getWalkInActor(supabase: Supa, userId: string): Promise<WalkInActorCtx> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', userId)
    .maybeSingle()

  const role = (profile as { role?: string } | null)?.role
  const businessId = (profile as { business_id?: string } | null)?.business_id ?? null
  if (role === 'admin' || role === 'super_admin') return { isAdmin: true, staffId: null, businessId }

  if (!businessId) return { isAdmin: false, staffId: null, businessId: null }

  const { data: staff } = await supabase
    .from('staff')
    .select('id')
    .eq('user_id', userId)
    .eq('business_id', businessId)
    .maybeSingle()

  return { isAdmin: false, staffId: (staff as { id?: string } | null)?.id ?? null, businessId }
}

async function getWalkInOwnership(supabase: Supa, walkInId: string): Promise<WalkInOwnership | null> {
  const { data } = await supabase
    .from('walk_ins')
    .select('staff_id, appointment_id')
    .eq('id', walkInId)
    .maybeSingle()
  return (data as WalkInOwnership | null) ?? null
}

/** Traduce el error de BD de una escritura directa (el guard de walk_ins lanza walk_in_not_yours). */
function directWriteError(message: string | undefined): string {
  return message?.includes('walk_in_not_yours') ? WALK_IN_NOT_YOURS_MESSAGE : (message ?? 'No se pudo guardar el cambio.')
}

// ════════════════════════════════════════════════════════════════════════════
// closeStaleWalkIns
// Cierra (status 'cancelled') los turnos que siguen en espera de un día anterior
// y libera su hueco apartado (RPC close_stale_walk_ins). Mejor esfuerzo: nunca falla.
// ════════════════════════════════════════════════════════════════════════════

export async function closeStaleWalkIns(businessId: string): Promise<number> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('close_stale_walk_ins', { p_business_id: businessId })
    if (error || typeof data !== 'number') return 0
    return data
  } catch {
    return 0
  }
}

// ════════════════════════════════════════════════════════════════════════════
// getWalkInQueue
// Obtiene la cola activa (waiting + in_progress) ordenada por posición ASC
// Incluye nombre del servicio y del barbero asignado
// ════════════════════════════════════════════════════════════════════════════

export async function getWalkInQueue(businessId: string): Promise<WalkInWithRelations[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('walk_ins')
    .select(`
      *,
      service:service_id ( id, name, price_cop, duration_minutes ),
      staff:staff_id ( id, full_name ),
      appointment:appointment_id ( id, status, start_time, services ( name, price_cop, duration_minutes ) )
    `)
    .eq('business_id', businessId)
    .in('status', ['waiting', 'in_progress'])
    .order('position', { ascending: true })
    .order('arrived_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as unknown as WalkInWithRelations[]
}

// ════════════════════════════════════════════════════════════════════════════
// addWalkIn
// Inserta un nuevo walk-in en la cola.
// La posición se calcula como MAX(position) + 1 entre los activos del negocio.
// ════════════════════════════════════════════════════════════════════════════

export async function addWalkIn(
  businessId: string,
  data: AddWalkInData
): Promise<ActionResult> {
  const supabase = await createClient()

  // Barbero: solo puede pedir turno sin profesional o con él mismo (el guard de BD lo exige igual)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }
  const actor = await getWalkInActor(supabase, user.id)
  if (!actor.isAdmin && data.staff_id && data.staff_id !== actor.staffId) {
    return { error: WALK_IN_NOT_YOURS_MESSAGE }
  }

  // Calcular la siguiente posición en cola
  const { data: maxRow } = await supabase
    .from('walk_ins')
    .select('position')
    .eq('business_id', businessId)
    .in('status', ['waiting', 'in_progress'])
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPosition = ((maxRow?.position as number | null) ?? -1) + 1

  const { error } = await supabase
    .from('walk_ins')
    .insert({
      business_id:    businessId,
      customer_name:  data.customer_name.trim(),
      customer_phone: data.customer_phone?.trim() || null,
      service_id:     data.service_id ?? null,
      staff_id:       data.staff_id   ?? null,
      notes:          data.notes?.trim() ?? null,
      position:       nextPosition,
      status:         'waiting',
    })

  if (error) return { error: directWriteError(error.message) }

  revalidatePath('/[slug]/dashboard/walk-ins', 'page')
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// getStaffStatusNow
// Estado AHORA de cada barbero (libre / en cita / almuerzo / permiso / fuera
// de horario) vía RPC get_staff_status_now. Si falla devuelve [].
// ════════════════════════════════════════════════════════════════════════════

export async function getStaffStatusNow(businessId: string): Promise<StaffStatusNow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_staff_status_now', { p_business_id: businessId })
  if (error || !Array.isArray(data)) return []
  return data as unknown as StaffStatusNow[]
}

// ════════════════════════════════════════════════════════════════════════════
// startWalkIn
// "Atender": crea (atómicamente, vía RPC start_walk_in) el cliente y una cita
// in_progress del barbero desde ahora, y pasa el turno a in_progress.
// ════════════════════════════════════════════════════════════════════════════

const START_WALK_IN_ERRORS: Record<string, string> = {
  walk_in_not_found:   'Este turno ya no está en espera.',
  walk_in_not_waiting: 'Este turno ya no está en espera.',
  walk_in_not_yours:   WALK_IN_NOT_YOURS_MESSAGE,
  staff_not_found:     'Elige un barbero válido.',
  service_required:    'Elige el servicio para atender.',
  station_busy:        'La estación que necesita este servicio está ocupada ahora. Espera a que se libere o elige otro servicio.',
}

export async function startWalkIn(
  walkInId:   string,
  staffId:    string,
  serviceId?: string | null,
): Promise<StartWalkInResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  // Barbero: solo atiende a nombre propio un turno suyo o sin barbero asignado
  const actor = await getWalkInActor(supabase, user.id)
  if (!actor.isAdmin) {
    const entry = await getWalkInOwnership(supabase, walkInId)
    if (!entry) return { error: 'Este turno ya no está en espera.' }
    if (staffId !== actor.staffId || !canAttend(actor, entry)) {
      return { error: WALK_IN_NOT_YOURS_MESSAGE }
    }
  }

  const { data, error } = await supabase.rpc('start_walk_in', {
    p_walk_in_id: walkInId,
    p_staff_id:   staffId,
    p_service_id: serviceId ?? null,
  })

  if (error) {
    const key = Object.keys(START_WALK_IN_ERRORS).find((k) => error.message?.includes(k))
    return { error: key ? START_WALK_IN_ERRORS[key] : 'No se pudo atender el turno. Intenta de nuevo.' }
  }

  const appointmentId = (data as { appointment_id?: string } | null)?.appointment_id
  if (!appointmentId) return { error: 'No se pudo atender el turno. Intenta de nuevo.' }

  revalidatePath('/[slug]/dashboard/walk-ins', 'page')
  revalidatePath('/[slug]/dashboard/appointments', 'page')
  return { success: true, appointmentId }
}

// ════════════════════════════════════════════════════════════════════════════
// updateWalkInStatus
// Actualiza el estado del walk-in.
// Si pasa a 'completed', registra served_at automáticamente.
// ════════════════════════════════════════════════════════════════════════════

export async function updateWalkInStatus(
  walkInId: string,
  status:   WalkInStatus
): Promise<ActionResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }
  const actor = await getWalkInActor(supabase, user.id)

  // Barbero: nunca pasa un turno a 'in_progress' por aquí (eso es "Atender") ni toca el de otro
  if (!actor.isAdmin) {
    const entry = await getWalkInOwnership(supabase, walkInId)
    if (!entry) return { error: 'Este turno ya no está en espera.' }
    if (!canSetStatus(actor, entry, status)) return { error: WALK_IN_NOT_YOURS_MESSAGE }
  }

  const updatePayload: Record<string, unknown> = { status }
  if (status === 'completed') {
    updatePayload.served_at = new Date().toISOString()
  }

  let query = supabase
    .from('walk_ins')
    .update(updatePayload)
    .eq('id', walkInId)
  if (actor.businessId) query = query.eq('business_id', actor.businessId)
  const { error } = await query

  if (error) return { error: directWriteError(error.message) }

  revalidatePath('/[slug]/dashboard/walk-ins', 'page')
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// reserveWalkIn
// Aparta el próximo hueco libre de HOY del barbero (o del mejor, si staffId es
// null) como cita 'scheduled' ligada al turno (RPC reserve_walk_in). Libera
// antes cualquier reserva previa del turno.
// ════════════════════════════════════════════════════════════════════════════

const RESERVE_WALK_IN_ERRORS: Record<string, string> = {
  service_required:    'Elige el servicio para apartar el turno.',
  walk_in_not_found:   'Este turno ya no está en espera.',
  walk_in_not_waiting: 'Este turno ya no está en espera.',
  walk_in_not_yours:   WALK_IN_NOT_YOURS_MESSAGE,
  staff_not_found:     'Elige un barbero válido.',
}

export async function reserveWalkIn(
  walkInId: string,
  staffId:  string | null,
): Promise<ReserveWalkInResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  // Barbero: aparta para sí mismo un turno libre, o gestiona uno suyo
  const actor = await getWalkInActor(supabase, user.id)
  if (!actor.isAdmin) {
    const entry = await getWalkInOwnership(supabase, walkInId)
    if (!entry) return { error: 'Este turno ya no está en espera.' }
    if (!canReserve(actor, entry, staffId)) return { error: WALK_IN_NOT_YOURS_MESSAGE }
  }

  const { data, error } = await supabase.rpc('reserve_walk_in', {
    p_walk_in_id: walkInId,
    p_staff_id:   staffId,
  })

  if (error) {
    if (error.message?.includes('no_availability_today')) {
      return { error: staffId ? 'Ese barbero no tiene espacio libre hoy.' : 'Ningún barbero tiene espacio libre hoy.' }
    }
    const key = Object.keys(RESERVE_WALK_IN_ERRORS).find((k) => error.message?.includes(k))
    return { error: key ? RESERVE_WALK_IN_ERRORS[key] : 'No se pudo apartar el turno. Intenta de nuevo.' }
  }

  const res = data as { staff_id?: string; start_time?: string } | null
  if (!res?.staff_id || !res?.start_time) return { error: 'No se pudo apartar el turno. Intenta de nuevo.' }

  revalidatePath('/[slug]/dashboard/walk-ins', 'page')
  revalidatePath('/[slug]/dashboard/appointments', 'page')
  return { success: true, staffId: res.staff_id, startTime: res.start_time }
}

/** Barbero: no libera ni saca de la fila el hueco apartado de otro profesional. */
async function assertCanRelease(supabase: Supa, walkInId: string, cancel: boolean): Promise<ActionResult | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  const actor = await getWalkInActor(supabase, user.id)
  if (actor.isAdmin) return null

  const entry = await getWalkInOwnership(supabase, walkInId)
  if (!entry) return { error: 'Este turno ya no está en espera.' }
  return canRelease(actor, entry, cancel) ? null : { error: WALK_IN_NOT_YOURS_MESSAGE }
}

// ════════════════════════════════════════════════════════════════════════════
// releaseWalkIn
// Libera el hueco apartado (cancela la cita programada) y quita el barbero.
// Con cancel=true también cancela el turno (sale de la fila).
// ════════════════════════════════════════════════════════════════════════════

export async function releaseWalkIn(walkInId: string, cancel = false): Promise<ActionResult> {
  const supabase = await createClient()

  const denied = await assertCanRelease(supabase, walkInId, cancel)
  if (denied) return denied

  const { error } = await supabase.rpc('release_walk_in', {
    p_walk_in_id: walkInId,
    p_cancel:     cancel,
  })

  if (error) {
    if (error.message?.includes('walk_in_not_waiting') || error.message?.includes('walk_in_not_found')) {
      return { error: 'Este turno ya no está en espera.' }
    }
    if (error.message?.includes('walk_in_not_yours')) return { error: WALK_IN_NOT_YOURS_MESSAGE }
    return { error: 'No se pudo liberar el turno. Intenta de nuevo.' }
  }

  revalidatePath('/[slug]/dashboard/walk-ins', 'page')
  revalidatePath('/[slug]/dashboard/appointments', 'page')
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// suggestWalkInStaff / getWalkInSuggestions
// Barberos con espacio libre hoy, el que quede libre primero va de primero.
// Si falla devuelve [].
// ════════════════════════════════════════════════════════════════════════════

export async function suggestWalkInStaff(walkInId: string): Promise<WalkInSuggestion[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('suggest_walk_in_staff', { p_walk_in_id: walkInId })
  if (error || !Array.isArray(data)) return []
  return data as unknown as WalkInSuggestion[]
}

/** Sugerencias de varios turnos a la vez (máx. 10) → { walkInId: sugerencias } */
export async function getWalkInSuggestions(
  walkInIds: string[],
): Promise<Record<string, WalkInSuggestion[]>> {
  const ids = walkInIds.slice(0, 10)
  const lists = await Promise.all(ids.map((id) => suggestWalkInStaff(id)))
  return Object.fromEntries(ids.map((id, i) => [id, lists[i]]))
}

// ════════════════════════════════════════════════════════════════════════════
// setWalkInService
// Define el servicio de un turno EN ESPERA (necesario para apartar el hueco).
// ════════════════════════════════════════════════════════════════════════════

export async function setWalkInService(
  walkInId:  string,
  serviceId: string | null,
): Promise<ActionResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }
  const actor = await getWalkInActor(supabase, user.id)

  // Barbero: solo el servicio de un turno libre o suyo (misma regla que "Atender")
  if (!actor.isAdmin) {
    const entry = await getWalkInOwnership(supabase, walkInId)
    if (!entry) return { error: 'Este turno ya no está en espera.' }
    if (!canAttend(actor, entry)) return { error: WALK_IN_NOT_YOURS_MESSAGE }
  }

  let query = supabase
    .from('walk_ins')
    .update({ service_id: serviceId })
    .eq('id', walkInId)
  if (actor.businessId) query = query.eq('business_id', actor.businessId)
  const { error } = await query.eq('status', 'waiting')

  if (error) return { error: directWriteError(error.message) }

  revalidatePath('/[slug]/dashboard/walk-ins', 'page')
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// removeFromQueue
// Saca un turno de la fila (soft delete — status 'cancelled').
// Un turno EN ESPERA pasa por release_walk_in(p_cancel=true) para liberar el
// hueco apartado; otros estados (legacy sin cita) solo cambian de status.
// ════════════════════════════════════════════════════════════════════════════

export async function removeFromQueue(walkInId: string): Promise<ActionResult> {
  const supabase = await createClient()

  const denied = await assertCanRelease(supabase, walkInId, true)
  if (denied) return denied

  const { error: rpcError } = await supabase.rpc('release_walk_in', {
    p_walk_in_id: walkInId,
    p_cancel:     true,
  })

  if (rpcError) {
    // No estaba en espera (p. ej. turno legacy en atención sin cita): cancelar directo
    if (rpcError.message?.includes('walk_in_not_yours')) return { error: WALK_IN_NOT_YOURS_MESSAGE }
    if (!rpcError.message?.includes('walk_in_not_waiting')) {
      return { error: 'No se pudo quitar el turno. Intenta de nuevo.' }
    }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No autenticado.' }
    const actor = await getWalkInActor(supabase, user.id)
    if (!actor.isAdmin) {
      // Barbero: solo cancela directo un turno suyo o sin asignar (el guard de BD lo exige igual)
      const entry = await getWalkInOwnership(supabase, walkInId)
      if (!entry) return { error: 'Este turno ya no está en espera.' }
      if (!canSetStatus(actor, entry, 'cancelled')) return { error: WALK_IN_NOT_YOURS_MESSAGE }
    }
    let query = supabase
      .from('walk_ins')
      .update({ status: 'cancelled' })
      .eq('id', walkInId)
    if (actor.businessId) query = query.eq('business_id', actor.businessId)
    const { error } = await query
    if (error) return { error: directWriteError(error.message) }
  }

  revalidatePath('/[slug]/dashboard/walk-ins', 'page')
  revalidatePath('/[slug]/dashboard/appointments', 'page')
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// getWalkInHistory
// Últimos walk-ins completados o cancelados del negocio (por defecto, 50).
// ════════════════════════════════════════════════════════════════════════════

export async function getWalkInHistory(
  businessId: string,
  limit = 50
): Promise<WalkInWithRelations[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('walk_ins')
    .select(`
      *,
      service:service_id ( id, name ),
      staff:staff_id ( id, full_name )
    `)
    .eq('business_id', businessId)
    .in('status', ['completed', 'cancelled'])
    .order('arrived_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as unknown as WalkInWithRelations[]
}
