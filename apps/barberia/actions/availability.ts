'use server'
// actions/availability.ts — Horario del negocio (businesses.operating_hours).
// Se muestra en la página de reservas; las horas de cada profesional se manejan en Equipo.

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OperatingHours, Json } from '@xinuco/types'
import { validateOperatingHours } from '@/lib/business-hours'

const NOT_ADMIN = 'Solo un administrador puede cambiar el horario del negocio.'
const NOT_SAVED = 'No se pudo guardar: solo un administrador puede cambiar esto.'

type Supabase = Awaited<ReturnType<typeof createClient>>

// La RLS de businesses solo deja actualizar al admin; aquí se repite y el business_id
// sale SIEMPRE del perfil (nunca del cliente).
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

/** Horario guardado del negocio (null si aún no se ha definido). */
export async function getAvailability(): Promise<{ operating_hours: OperatingHours | null } | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase, businessId } = auth

  const { data, error } = await supabase
    .from('businesses')
    .select('operating_hours')
    .eq('id', businessId)
    .single()

  if (error || !data) return { error: 'No se pudo leer el horario del negocio.' }
  return { operating_hours: ((data as { operating_hours?: OperatingHours | null }).operating_hours ?? null) }
}

export async function updateAvailability(
  data: { operating_hours: OperatingHours },
): Promise<{ success?: boolean; error?: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase, businessId } = auth

  const checked = validateOperatingHours(data?.operating_hours)
  if (!checked.ok) return { error: checked.error }

  const { data: updated, error } = await supabase
    .from('businesses')
    .update({ operating_hours: checked.value as unknown as Json })
    .eq('id', businessId)
    .select('id')

  if (error) return { error: error.message }
  if (!updated || updated.length === 0) return { error: NOT_SAVED }

  revalidatePath('/[slug]/dashboard/settings', 'layout')
  revalidatePath('/[slug]/dashboard/staff', 'page')
  revalidatePath('/[slug]/book', 'page')
  revalidatePath('/[slug]', 'page')
  return { success: true }
}
