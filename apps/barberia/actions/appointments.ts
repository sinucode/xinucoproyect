'use server'

import { createClient } from '@xinuco/supabase/server'
import { addMinutes, format, parseISO, isBefore, isAfter, getDay } from 'date-fns'
import { revalidatePath } from 'next/cache'
import type { AppointmentStatus, Json } from '@xinuco/types'
import { logAction } from './audit'
import { sendCancellationNotice } from '@/lib/email/notifications'

// ════════════════════════════════════════════════════════════════════════════════
// MOTOR DE DISPONIBILIDAD — motor client-side de respaldo
//
// El BookingWizard usa getAvailableSlotsAction (actions/staff.ts) → RPC
// get_available_slots_v2. Esta función usa start_time (igual que bookings.ts).
// FIX post-auditoría: reemplaza el filtro por time_range (TSTZRANGE) que
// bookings.ts nunca popula, lo que generaba slots falsos-libres.
// ════════════════════════════════════════════════════════════════════════════════

export async function getAvailableSlots(
  businessId: string,
  serviceId: string,
  date: string,
  staffId?: string | null,
) {
  const supabase = await createClient()

  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('duration_minutes')
    .eq('id', serviceId)
    .single()

  if (serviceError || !service) throw new Error('Servicio no encontrado.')

  const duration = service.duration_minutes

  const startOfDay = `${date}T00:00:00+00:00`
  const endOfDay   = `${date}T23:59:59+00:00`

  let apptQuery = supabase
    .from('appointments')
    .select('staff_id, start_time')
    .eq('business_id', businessId)
    .not('status', 'in', '("cancelled","no_show")')
    .gte('start_time', startOfDay)
    .lte('start_time', endOfDay)

  if (staffId && staffId !== 'any') apptQuery = apptQuery.eq('staff_id', staffId)

  const { data: appointments } = await apptQuery

  const targetDate = parseISO(date)
  const dayOfWeek  = getDay(targetDate)

  let scheduleQuery = supabase
    .from('staff_schedules')
    .select('staff_id, start_time, end_time')
    .eq('business_id', businessId)
    .eq('day_of_week', dayOfWeek)

  if (staffId && staffId !== 'any') scheduleQuery = scheduleQuery.eq('staff_id', staffId)

  const { data: schedules } = await scheduleQuery

  if (!schedules || schedules.length === 0) return { slots: [] }

  const bookedIntervals = (appointments ?? [])
    .filter((app) => app.start_time != null)
    .map((app) => ({
      staff_id: app.staff_id,
      start:    new Date(app.start_time as string),
      end:      addMinutes(new Date(app.start_time as string), duration),
    }))

  const availableSlots = new Set<string>()

  for (const schedule of schedules) {
    const shiftStart    = parseISO(`${date}T${schedule.start_time}`)
    const shiftEnd      = parseISO(`${date}T${schedule.end_time}`)
    const staffBookings = bookedIntervals.filter((b) => b.staff_id === schedule.staff_id)
    let   currentSlot   = shiftStart

    while (isBefore(currentSlot, shiftEnd)) {
      const slotEnd = addMinutes(currentSlot, duration)
      if (isAfter(slotEnd, shiftEnd)) break

      const busy = staffBookings.some(
        (b) => currentSlot < b.end && slotEnd > b.start,
      )
      if (!busy) availableSlots.add(format(currentSlot, 'HH:mm'))
      currentSlot = addMinutes(currentSlot, 30)
    }
  }

  return { slots: Array.from(availableSlots).sort() }
}

/**
 * updateAppointmentStatus — Actualiza el estado de una cita.
 * [SEC H-3] Guarda de autenticación explícita antes de cualquier query.
 */
export async function updateAppointmentStatus(appointmentId: string, status: AppointmentStatus) {
  const supabase = await createClient()

  // ── [SEC H-3] Verificar sesión activa explícitamente ─────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  // Obtener el estado anterior y el business_id antes de actualizar
  const { data: existing } = await supabase
    .from('appointments')
    .select('status, business_id, staff_id')
    .eq('id', appointmentId)
    .single()

  const { error } = await supabase
    .from('appointments')
    .update({
      status,
      updated_at: new Date().toISOString(),
      // Cancelada desde la Agenda → la cancela el negocio (el cliente usa el enlace del correo).
      ...(status === 'cancelled' ? { cancelled_by: 'business' as const } : {}),
    })
    .eq('id', appointmentId)

  if (error) {
    console.error('Error updating appointment status:', error)
    return { error: error.message }
  }

  // ── Audit log (nunca bloquea la operación principal) ─────────────────────────
  if (existing?.business_id) {
    try {
      // Reutilizar el user obtenido al inicio — no llamar auth.getUser() de nuevo
      const { data: profile } = user
        ? await supabase.from('profiles').select('full_name').eq('id', user.id).single()
        : { data: null }

      await logAction({
        businessId:  existing.business_id,
        actorId:     user?.id ?? null,
        actorName:   profile?.full_name ?? null,
        action:      'appointment.status_changed',
        entityType:  'appointment',
        entityId:    appointmentId,
        oldValue:    { status: existing.status } as unknown as Json,
        newValue:    { status } as unknown as Json,
      })
    } catch {
      // Silenciar — el log nunca rompe la operación principal
    }
  }

  // ── Notificación de cancelación por correo (best-effort — nunca bloquea) ────
  if (status === 'cancelled' && existing?.business_id) {
    try {
      await sendCancellationNotice({
        supabase,
        businessId:    existing.business_id,
        appointmentId,
      })
    } catch { /* silenciar */ }
  }

  revalidatePath('/[slug]/dashboard', 'page')
  return { success: true }
}


