'use server'

// actions/staff-availability.ts — Almuerzos/pausas (recurrentes) y permisos (puntuales) del staff.
//
// Seguridad: solo admin (o super_admin) del negocio; el staff debe pertenecer al
// business_id del PERFIL (nunca se confía en un business_id del cliente).
// Convención horaria: starts_at/ends_at guardan la hora LOCAL del negocio como UTC
// (`${fecha}T${HH:MM}:00Z`). Ver lib/agenda-time.ts.

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { businessTodayISODate } from '@/lib/agenda-time'

type ActionResult = { success: true } | { error: string }

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_OFF_KINDS = ['permission', 'vacation', 'sick', 'other'] as const
type TimeOffKind = (typeof TIME_OFF_KINDS)[number]

const MAX_LABEL = 60
const MAX_REASON = 200

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** Sesión + perfil admin/super_admin con business_id. */
async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado.' } as const

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
    return { ok: false, error: 'Solo un administrador puede gestionar la disponibilidad del equipo.' } as const
  }
  if (!profile.business_id) return { ok: false, error: 'Tu usuario no tiene un negocio asociado.' } as const

  return { ok: true, supabase, userId: user.id as string, businessId: profile.business_id as string } as const
}

/** Anti-IDOR: el staff debe ser del negocio del perfil. */
async function requireOwnStaff(
  supabase: Awaited<ReturnType<typeof createClient>>,
  staffId: string,
  businessId: string,
): Promise<{ error: string } | null> {
  if (!staffId || typeof staffId !== 'string') return { error: 'Miembro del equipo inválido.' }
  const { data: staff } = await supabase
    .from('staff')
    .select('id')
    .eq('id', staffId)
    .eq('business_id', businessId)
    .maybeSingle()
  if (!staff) return { error: 'Miembro del equipo no encontrado.' }
  return null
}

function validateRange(startTime: string, endTime: string): string | null {
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) return 'Hora inválida (usa HH:MM).'
  if (endTime <= startTime) return 'La hora de fin debe ser posterior a la de inicio.'
  return null
}

// ── Lectura (página Equipo) ──────────────────────────────────────────────────

export interface StaffAvailability {
  breaks: { id: string; day_of_week: number; start_time: string; end_time: string; label: string }[]
  timeOff: { id: string; starts_at: string; ends_at: string; kind: string; reason: string | null }[]
}

/**
 * getStaffAvailability — Pausas recurrentes y permisos vigentes/futuros de un miembro del equipo.
 * Los permisos ya terminados (ends_at antes de hoy 00:00, hora local del negocio) no se listan.
 */
export async function getStaffAvailability(staffId: string): Promise<StaffAvailability | { error: string }> {
  const auth = await requireAdmin()
  if (!auth.ok) return { error: auth.error }
  const { supabase, businessId } = auth

  const ownership = await requireOwnStaff(supabase, staffId, businessId)
  if (ownership) return ownership

  const todayStart = `${businessTodayISODate()}T00:00:00Z`

  const [breaksRes, offRes] = await Promise.all([
    supabase.from('staff_breaks')
      .select('id, day_of_week, start_time, end_time, label')
      .eq('staff_id', staffId)
      .eq('business_id', businessId)
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true }),
    supabase.from('staff_time_off')
      .select('id, starts_at, ends_at, kind, reason')
      .eq('staff_id', staffId)
      .eq('business_id', businessId)
      .gte('ends_at', todayStart)
      .order('starts_at', { ascending: true }),
  ])
  if (breaksRes.error) return { error: breaksRes.error.message }
  if (offRes.error) return { error: offRes.error.message }

  return {
    breaks: (breaksRes.data ?? []) as StaffAvailability['breaks'],
    timeOff: (offRes.data ?? []) as StaffAvailability['timeOff'],
  }
}

// ── Pausas recurrentes ───────────────────────────────────────────────────────

export async function createStaffBreaks(input: {
  staffId: string
  days: number[]
  startTime: string
  endTime: string
  label?: string
}): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return { error: auth.error }
  const { supabase, businessId } = auth

  const rangeError = validateRange(input.startTime, input.endTime)
  if (rangeError) return { error: rangeError }

  const days = Array.isArray(input.days) ? Array.from(new Set(input.days)) : []
  if (days.length === 0) return { error: 'Selecciona al menos un día.' }
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return { error: 'Día de la semana inválido.' }

  const label = (input.label ?? '').trim() || 'Almuerzo'
  if (label.length > MAX_LABEL) return { error: `La etiqueta no puede superar ${MAX_LABEL} caracteres.` }

  const ownership = await requireOwnStaff(supabase, input.staffId, businessId)
  if (ownership) return ownership

  const rows = days.map((day) => ({
    business_id: businessId,
    staff_id: input.staffId,
    day_of_week: day,
    start_time: `${input.startTime}:00`,
    end_time: `${input.endTime}:00`,
    label,
  }))

  const { error } = await supabase.from('staff_breaks').insert(rows)
  if (error) return { error: error.message }

  revalidatePath('/[slug]/dashboard/appointments', 'page')
  revalidatePath('/[slug]/dashboard/staff', 'page')
  return { success: true }
}

export async function deleteStaffBreak(breakId: string): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return { error: auth.error }
  if (!breakId || typeof breakId !== 'string') return { error: 'Pausa inválida.' }

  const { error } = await auth.supabase
    .from('staff_breaks')
    .delete()
    .eq('id', breakId)
    .eq('business_id', auth.businessId)
  if (error) return { error: error.message }

  revalidatePath('/[slug]/dashboard/appointments', 'page')
  revalidatePath('/[slug]/dashboard/staff', 'page')
  return { success: true }
}

// ── Permisos / bloqueos puntuales ────────────────────────────────────────────

export async function createStaffTimeOff(input: {
  staffId: string
  date: string        // 'YYYY-MM-DD'
  startTime: string   // 'HH:MM'
  endTime: string     // 'HH:MM'
  kind: string
  reason?: string
}): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return { error: auth.error }
  const { supabase, userId, businessId } = auth

  if (!isValidDate(input.date)) return { error: 'Fecha inválida.' }
  const rangeError = validateRange(input.startTime, input.endTime)
  if (rangeError) return { error: rangeError }
  if (!TIME_OFF_KINDS.includes(input.kind as TimeOffKind)) return { error: 'Tipo de bloqueo inválido.' }

  const reason = (input.reason ?? '').trim()
  if (reason.length > MAX_REASON) return { error: `El motivo no puede superar ${MAX_REASON} caracteres.` }

  const ownership = await requireOwnStaff(supabase, input.staffId, businessId)
  if (ownership) return ownership

  const { error } = await supabase.from('staff_time_off').insert({
    business_id: businessId,
    staff_id: input.staffId,
    starts_at: `${input.date}T${input.startTime}:00Z`,
    ends_at: `${input.date}T${input.endTime}:00Z`,
    kind: input.kind,
    reason: reason || null,
    created_by: userId,
  })
  if (error) return { error: error.message }

  revalidatePath('/[slug]/dashboard/appointments', 'page')
  revalidatePath('/[slug]/dashboard/staff', 'page')
  return { success: true }
}

export async function deleteStaffTimeOff(timeOffId: string): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return { error: auth.error }
  if (!timeOffId || typeof timeOffId !== 'string') return { error: 'Permiso inválido.' }

  const { error } = await auth.supabase
    .from('staff_time_off')
    .delete()
    .eq('id', timeOffId)
    .eq('business_id', auth.businessId)
  if (error) return { error: error.message }

  revalidatePath('/[slug]/dashboard/appointments', 'page')
  revalidatePath('/[slug]/dashboard/staff', 'page')
  return { success: true }
}
