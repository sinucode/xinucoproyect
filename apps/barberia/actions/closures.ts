'use server'
// actions/closures.ts — Días cerrados del negocio (festivos, vacaciones, remodelación).
//
// La escritura pasa SOLO por las RPC set_business_closure / remove_business_closure (la tabla
// business_closures no admite escritura directa). Cada cierre bloquea a todos los profesionales
// activos, así la página de reservas y la agenda ya lo respetan. La BD vuelve a validar el rol
// admin y el negocio sale del JWT; aquí además se exige admin y se valida antes de llamar.

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { businessTodayISODate } from '@/lib/agenda-time'
import { colombiaHolidays } from '@/lib/colombia-holidays'
import { closureErrorMessage, validateClosureInput } from '@/lib/business-closures'

const NOT_ADMIN = 'Solo un administrador puede cambiar los días cerrados.'

export interface ClosureResult {
  success?: boolean
  error?:   string
  /** Id del cierre creado (para poder volver a abrir sin recargar). */
  id?:      string
  /** Citas activas que ya había en esos días. */
  appointments?: number
}

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

  const role = (profile as { role?: string } | null)?.role
  const businessId = (profile as { business_id?: string | null } | null)?.business_id
  if ((role !== 'admin' && role !== 'super_admin') || !businessId) return { error: NOT_ADMIN }

  return { supabase, businessId }
}

function revalidateClosures() {
  revalidatePath('/[slug]/dashboard/settings', 'layout')
  revalidatePath('/[slug]/dashboard/appointments', 'page')
  revalidatePath('/[slug]/book', 'page')
  revalidatePath('/[slug]', 'page')
}

async function createClosure(
  supabase: Supabase,
  input: { date_from: string; date_to: string; reason: string; kind: 'holiday' | 'custom' },
): Promise<ClosureResult> {
  const { data, error } = await (supabase as any).rpc('set_business_closure', {
    p_date_from: input.date_from,
    p_date_to:   input.date_to,
    p_reason:    input.reason,
    p_kind:      input.kind,
  })
  if (error) return { error: closureErrorMessage(error.message) }

  const row = (data ?? {}) as { id?: string; appointments_on_those_days?: number }
  revalidateClosures()
  return { success: true, id: row.id, appointments: Number(row.appointments_on_those_days ?? 0) }
}

// ════════════════════════════════════════════════════════════════════════════
// closeHoliday — "Cerramos" un festivo de Colombia
// El nombre sale de la lista oficial (no del cliente): solo se aceptan fechas que son festivo.
// ════════════════════════════════════════════════════════════════════════════

export async function closeHoliday(date: string): Promise<ClosureResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }

  const today = businessTodayISODate()
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Fecha no válida.' }

  const holiday = colombiaHolidays(Number(date.slice(0, 4))).find(h => h.date === date)
  if (!holiday) return { error: 'Esa fecha no es un festivo de Colombia.' }

  const invalid = validateClosureInput({ date_from: date, date_to: date, reason: holiday.name }, today)
  if (invalid) return { error: invalid }

  return createClosure(auth.supabase, { date_from: date, date_to: date, reason: holiday.name, kind: 'holiday' })
}

// ════════════════════════════════════════════════════════════════════════════
// createCustomClosure — vacaciones, remodelación, etc. (hasta 60 días, sin fechas pasadas)
// ════════════════════════════════════════════════════════════════════════════

export async function createCustomClosure(input: {
  date_from: string
  date_to:   string
  reason:    string
}): Promise<ClosureResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }

  const invalid = validateClosureInput(input, businessTodayISODate())
  if (invalid) return { error: invalid }

  return createClosure(auth.supabase, {
    date_from: input.date_from,
    date_to:   input.date_to,
    reason:    input.reason.trim(),
    kind:      'custom',
  })
}

// ════════════════════════════════════════════════════════════════════════════
// removeClosure — volver a abrir (quita el cierre y sus bloqueos)
// La BD comprueba que el cierre sea del negocio del admin.
// ════════════════════════════════════════════════════════════════════════════

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function removeClosure(closureId: string): Promise<ClosureResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }

  if (typeof closureId !== 'string' || !UUID_RE.test(closureId)) return { error: 'Cierre no válido.' }

  const { error } = await (auth.supabase as any).rpc('remove_business_closure', { p_closure_id: closureId })
  if (error) return { error: closureErrorMessage(error.message) }

  revalidateClosures()
  return { success: true }
}
