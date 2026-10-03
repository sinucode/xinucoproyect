'use server'

// actions/staff-booking.ts — Reserva interna: el equipo agenda una cita desde la Agenda / Inicio
// sin abrir la reserva pública.
//
// Seguridad: el business_id sale SIEMPRE del perfil de la sesión (nunca del cliente). Un barbero
// o manicurista solo agenda para SÍ MISMO (su ficha de staff.user_id); el admin elige un
// profesional activo del negocio. La RPC `create_staff_appointment` vuelve a validar todo en la BD.

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { businessNowHHMM, businessTodayISODate } from '@/lib/agenda-time'
import {
  MAX_BOOKING_NOTES,
  filterFutureSlots,
  isDateKey,
  isHHMM,
  isUuid,
  mapStaffBookingError,
  sanitizeCustomerSearch,
} from '@/lib/staff-booking'

type Supabase = Awaited<ReturnType<typeof createClient>>

const NOT_AUTHENTICATED = 'No autenticado.'
const NOT_LINKED = 'Tu usuario no está vinculado a un profesional. Pídele al administrador que lo vincule en Equipo.'
const STAFF_REQUIRED = 'Elige el profesional.'

export interface BookingStaff { id: string; full_name: string }
export interface BookingService {
  id: string
  name: string
  duration_minutes: number
  price_cop: number
}
export interface BookingCustomer { id: string; full_name: string; phone: string }

interface Ctx {
  supabase: Supabase
  businessId: string
  isAdmin: boolean
  userId: string
}

async function getContext(): Promise<Ctx | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NOT_AUTHENTICATED }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', user.id)
    .single()

  const p = profile as { role?: string; business_id?: string | null } | null
  if (!p?.business_id) return { error: NOT_AUTHENTICATED }
  return {
    supabase,
    businessId: p.business_id,
    isAdmin: p.role === 'admin' || p.role === 'super_admin',
    userId: user.id,
  }
}

/** Profesional con el que se agenda: el propio (no admin) o el elegido (admin, activo y del negocio). */
async function resolveStaff(ctx: Ctx, requestedStaffId?: string | null): Promise<BookingStaff | { error: string }> {
  const { supabase, businessId, isAdmin, userId } = ctx

  if (!isAdmin) {
    const { data } = await supabase
      .from('staff')
      .select('id, full_name')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    return (data as BookingStaff | null) ?? { error: NOT_LINKED }
  }

  if (!isUuid(requestedStaffId)) return { error: STAFF_REQUIRED }
  const { data } = await supabase
    .from('staff')
    .select('id, full_name')
    .eq('id', requestedStaffId)
    .eq('business_id', businessId)
    .eq('is_active', true)
    .maybeSingle()
  return (data as BookingStaff | null) ?? { error: 'No se encontró al profesional.' }
}

// ════════════════════════════════════════════════════════════════════════════
// getQuickBookingContext — quién puede agendar y para quién
// ════════════════════════════════════════════════════════════════════════════

export async function getQuickBookingContext(): Promise<
  { isAdmin: boolean; staff: BookingStaff[]; selfStaffId: string | null } | { error: string }
> {
  const ctx = await getContext()
  if ('error' in ctx) return ctx

  if (!ctx.isAdmin) {
    const me = await resolveStaff(ctx)
    if ('error' in me) return me
    return { isAdmin: false, staff: [me], selfStaffId: me.id }
  }

  const { data } = await ctx.supabase
    .from('staff')
    .select('id, full_name')
    .eq('business_id', ctx.businessId)
    .eq('is_active', true)
    .order('full_name', { ascending: true })
  return { isAdmin: true, staff: (data ?? []) as BookingStaff[], selfStaffId: null }
}

// ════════════════════════════════════════════════════════════════════════════
// getQuickBookingOptions — servicios que hace el profesional + horarios libres de ese día
// Los horarios salen de get_available_slots_v2 (mismas reglas que la reserva en línea);
// si no se pasa serviceId solo se devuelven los servicios.
// ════════════════════════════════════════════════════════════════════════════

export async function getQuickBookingOptions(
  date: string,
  staffId?: string | null,
  serviceId?: string | null,
): Promise<{ services: BookingService[]; slots: string[] } | { error: string }> {
  if (!isDateKey(date)) return { error: 'La fecha no es válida.' }
  const todayKey = businessTodayISODate()
  if (date < todayKey) return { error: 'No se puede agendar en una fecha pasada.' }

  const ctx = await getContext()
  if ('error' in ctx) return ctx
  const staff = await resolveStaff(ctx, staffId)
  if ('error' in staff) return staff

  const { supabase, businessId } = ctx

  const [servicesRes, offeredRes] = await Promise.all([
    supabase
      .from('services')
      .select('id, name, duration_minutes, price_cop')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name', { ascending: true }),
    supabase
      .from('staff_services')
      .select('service_id')
      .eq('staff_id', staff.id),
  ])
  if (servicesRes.error) return { error: 'No se pudieron cargar los servicios.' }

  // Sin filas en staff_services = hace todos los servicios; con filas = solo esos
  const offered = ((offeredRes.data ?? []) as { service_id: string }[]).map((r) => r.service_id)
  const services = ((servicesRes.data ?? []) as BookingService[])
    .filter((s) => offered.length === 0 || offered.includes(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      duration_minutes: Number(s.duration_minutes) || 30,
      price_cop: Number(s.price_cop) || 0,
    }))

  if (!serviceId) return { services, slots: [] }
  if (!services.some((s) => s.id === serviceId)) return { services, slots: [] }

  const { data, error } = await supabase.rpc('get_available_slots_v2', {
    p_business_id:      businessId,
    p_staff_id:         staff.id,
    p_service_id:       serviceId,
    p_date:             date,
    p_duration_minutes: 30,
  } as Parameters<typeof supabase.rpc>[1])
  if (error) return { error: 'No se pudieron calcular los horarios libres.' }

  const raw = Array.isArray(data) ? (data as unknown[]) : []
  const slots = raw
    .map((s) => (typeof s === 'string' ? s.substring(0, 5) : ''))
    .filter(isHHMM)
  return { services, slots: filterFutureSlots(slots, date, todayKey, businessNowHHMM()) }
}

// ════════════════════════════════════════════════════════════════════════════
// searchQuickBookingCustomers — buscar cliente por nombre o celular (máx. 8)
// ════════════════════════════════════════════════════════════════════════════

export async function searchQuickBookingCustomers(
  query: string,
): Promise<{ customers: BookingCustomer[] } | { error: string }> {
  const q = sanitizeCustomerSearch(query)
  if (q.length < 2) return { customers: [] }

  const ctx = await getContext()
  if ('error' in ctx) return ctx

  const { data, error } = await ctx.supabase
    .from('customers')
    .select('id, full_name, phone')
    .eq('business_id', ctx.businessId)
    .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`)
    .order('full_name', { ascending: true })
    .limit(8)
  if (error) return { error: 'No se pudo buscar clientes.' }
  return { customers: (data ?? []) as BookingCustomer[] }
}

// ════════════════════════════════════════════════════════════════════════════
// createStaffAppointment — agenda la cita (RPC create_staff_appointment)
// ════════════════════════════════════════════════════════════════════════════

export interface CreateStaffAppointmentInput {
  /** Solo el admin lo elige; el barbero siempre agenda para sí mismo. */
  staffId?: string | null
  customerId: string
  serviceId: string
  /** 'YYYY-MM-DD' (día del negocio) */
  date: string
  /** 'HH:MM' (hora local del negocio) */
  time: string
  notes?: string | null
}

export async function createStaffAppointment(
  input: CreateStaffAppointmentInput,
): Promise<{ success: true; appointmentId: string } | { error: string }> {
  if (!isUuid(input?.customerId)) return { error: 'Elige el cliente.' }
  if (!isUuid(input?.serviceId)) return { error: 'Elige el servicio.' }
  if (!isDateKey(input?.date) || !isHHMM(input?.time)) return { error: mapStaffBookingError('invalid_start') }
  const notes = (input.notes ?? '').trim()
  if (notes.length > MAX_BOOKING_NOTES) return { error: mapStaffBookingError('notes_too_long') }

  const ctx = await getContext()
  if ('error' in ctx) return ctx
  const staff = await resolveStaff(ctx, input.staffId)
  if ('error' in staff) return staff

  const { data, error } = await ctx.supabase.rpc('create_staff_appointment', {
    p_business_id: ctx.businessId,
    p_staff_id:    staff.id,
    p_customer_id: input.customerId,
    p_service_id:  input.serviceId,
    // Hora local del negocio guardada como UTC (igual que BookingWizard)
    p_start:       `${input.date}T${input.time}:00Z`,
    p_notes:       notes || null,
  } as Parameters<Supabase['rpc']>[1])

  if (error) return { error: mapStaffBookingError(error.message) }

  const result = data as { appointment_id?: string; error?: string } | null
  if (!result || result.error) return { error: mapStaffBookingError(result?.error) }
  if (!result.appointment_id) return { error: mapStaffBookingError(null) }

  revalidatePath('/[slug]/dashboard/appointments', 'page')
  revalidatePath('/[slug]/dashboard', 'page')
  return { success: true, appointmentId: result.appointment_id }
}
