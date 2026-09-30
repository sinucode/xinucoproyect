'use server'

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import type { StaffStatusNow } from '@/lib/walk-in-wait'

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

  if (error) return { error: error.message }

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

  const updatePayload: Record<string, unknown> = { status }
  if (status === 'completed') {
    updatePayload.served_at = new Date().toISOString()
  }

  const { error } = await supabase
    .from('walk_ins')
    .update(updatePayload)
    .eq('id', walkInId)

  if (error) return { error: error.message }

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
  staff_not_found:     'Elige un barbero válido.',
}

export async function reserveWalkIn(
  walkInId: string,
  staffId:  string | null,
): Promise<ReserveWalkInResult> {
  const supabase = await createClient()

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

// ════════════════════════════════════════════════════════════════════════════
// releaseWalkIn
// Libera el hueco apartado (cancela la cita programada) y quita el barbero.
// Con cancel=true también cancela el turno (sale de la fila).
// ════════════════════════════════════════════════════════════════════════════

export async function releaseWalkIn(walkInId: string, cancel = false): Promise<ActionResult> {
  const supabase = await createClient()

  const { error } = await supabase.rpc('release_walk_in', {
    p_walk_in_id: walkInId,
    p_cancel:     cancel,
  })

  if (error) {
    if (error.message?.includes('walk_in_not_waiting') || error.message?.includes('walk_in_not_found')) {
      return { error: 'Este turno ya no está en espera.' }
    }
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

  const { error } = await supabase
    .from('walk_ins')
    .update({ service_id: serviceId })
    .eq('id', walkInId)
    .eq('status', 'waiting')

  if (error) return { error: error.message }

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

  const { error: rpcError } = await supabase.rpc('release_walk_in', {
    p_walk_in_id: walkInId,
    p_cancel:     true,
  })

  if (rpcError) {
    // No estaba en espera (p. ej. turno legacy en atención sin cita): cancelar directo
    if (!rpcError.message?.includes('walk_in_not_waiting')) {
      return { error: 'No se pudo quitar el turno. Intenta de nuevo.' }
    }
    const { error } = await supabase
      .from('walk_ins')
      .update({ status: 'cancelled' })
      .eq('id', walkInId)
    if (error) return { error: error.message }
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
