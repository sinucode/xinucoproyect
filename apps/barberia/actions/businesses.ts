'use server'

import { createClient, createAdminClient }      from '@xinuco/supabase/server'
import { revalidatePath }    from 'next/cache'
import { Database }          from '@xinuco/types'
import type { BusinessInsert, BusinessFeatures, BrandConfig, BusinessBranding, Json } from '@xinuco/types'
import { validateBusinessProfile, type BusinessProfileInput } from '@/lib/business-profile'
import { isValidBookingInterval } from '@/lib/booking-settings'

// ── Tipos de resultado compartidos ────────────────────────────────────────────

interface ActionResult {
  success?: boolean
  error?:   string
}

// ── Regex estricta para colores hexadecimales (#RGB, #RRGGBB, #RRGGBBAA) ──────
const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/

export async function getBusinessBySlug(slug: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('businesses')
    .select('id, name, slug, is_active, branding, brand_config, features_enabled, created_at')
    .eq('slug', slug)
    .single()

  if (error) throw error
  return data
}

export async function getBusinesses() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('businesses')
    .select('*')

  if (error) throw error
  return data
}

export async function createBusiness(businessData: BusinessInsert) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('businesses')
    .insert([businessData])
    .select()

  if (error) throw error
  return data
}

/**
 * toggleBusinessFeature — Habilita o deshabilita un módulo (Feature Flag)
 * para un inquilino específico asegurando validación de rol de admin.
 */
export async function toggleBusinessFeature(businessId: string, featureKey: string, value: boolean) {
  const supabase = await createClient()

  // 1. Validar que el usuario sea super_admin en el servidor (Next.js side security)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.app_metadata?.role !== 'super_admin') {
    return { error: 'Autorización denegada. Se requiere rol de super_admin.' }
  }

  // 2. Usar cliente administrativo para bypass del RPC fallido y RLS
  const adminSupabase = await createAdminClient()

  // Obtener estado actual de los módulos
  const { data: biz, error: fetchError } = await adminSupabase
    .from('businesses')
    .select('features_enabled')
    .eq('id', businessId)
    .single()

  if (fetchError || !biz) return { error: 'No se pudo obtener el estado del negocio.' }

  // Patch del JSONB
  const currentFeatures = biz.features_enabled as unknown as BusinessFeatures
  const updatedFeatures: BusinessFeatures = {
    ...currentFeatures,
    [featureKey]: value
  }

  const { error: updateError } = await adminSupabase
    .from('businesses')
    .update({ features_enabled: updatedFeatures as unknown as Json })
    .eq('id', businessId)
  
  if (updateError) return { error: updateError.message }
  
  revalidatePath('/adminbarberia')
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════════
// updateBusinessTheme — Actualiza la configuración visual (brand_config JSONB)
// ════════════════════════════════════════════════════════════════════════════════

export async function updateBusinessTheme(businessId: string, config: BrandConfig) {
  const supabase = await createClient()

  // 1. Validación de sesión (Anti-IDOR)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'No autenticado. Inicia sesión para continuar.' }
  }

  // 2. Validación estricta de formato hexadecimal para todos los colores
  const colorFields = [
    { key: 'primaryColor',   value: config.primaryColor },
    { key: 'secondaryColor', value: config.secondaryColor },
    { key: 'bgColor',        value: config.bgColor },
    { key: 'textColor',      value: config.textColor },
  ] as const

  for (const { key, value } of colorFields) {
    if (!HEX_COLOR_REGEX.test(value)) {
      return { error: `Color inválido en "${key}": "${value}". Usa formato hexadecimal (ej: #C5A059).` }
    }
  }

  // 3. Sanitizar el payload — solo campos permitidos
  const safeConfig: BrandConfig = {
    primaryColor:   config.primaryColor,
    secondaryColor: config.secondaryColor,
    bgColor:        config.bgColor,
    textColor:      config.textColor,
    fontFamily:     config.fontFamily.trim().toLowerCase(),
    ...(config.logoUrl ? { logoUrl: config.logoUrl } : {}),
  }

  // 4. Persistir en Supabase
  const { error: updateError } = await supabase
    .from('businesses')
    .update({ brand_config: safeConfig as unknown as Json })
    .eq('id', businessId)

  if (updateError) {
    return { error: updateError.message }
  }

  // 5. Invalidar caché — la UI del tenant y el dashboard se refrescan
  revalidatePath(`/`)
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════════
// Autorización de la configuración del negocio
// La RLS de businesses solo deja actualizar al admin (un UPDATE de otro rol afecta 0 filas en
// silencio), pero la restricción se repite aquí: el business_id sale SIEMPRE del perfil
// (nunca del cliente) y se detecta el caso de 0 filas.
// ════════════════════════════════════════════════════════════════════════════════

const NOT_ADMIN = 'Solo un administrador puede cambiar la configuración del negocio.'
const NOT_SAVED = 'No se pudo guardar: solo un administrador puede cambiar esto.'

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

function revalidateBusinessPages() {
  revalidatePath('/[slug]/dashboard', 'layout')
  revalidatePath('/[slug]/book', 'page')
  revalidatePath('/[slug]', 'page')
}

// ════════════════════════════════════════════════════════════════════════════════
// updateBusinessBranding — Actualiza la columna `branding` (JSONB) del tenant
// ════════════════════════════════════════════════════════════════════════════════

export async function updateBusinessBranding(
  branding: Partial<BusinessBranding>,
): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase, businessId } = auth

  // Leer el branding actual para hacer merge (no pisar campos existentes)
  const { data: biz, error: fetchError } = await supabase
    .from('businesses')
    .select('branding')
    .eq('id', businessId)
    .single()

  if (fetchError || !biz) return { error: 'No se pudo obtener la configuración actual.' }

  const current = (biz.branding ?? {}) as unknown as BusinessBranding
  const merged: BusinessBranding = { ...current, ...branding }

  // Persistir el JSONB fusionado
  const { data: updated, error: updateError } = await supabase
    .from('businesses')
    .update({ branding: merged as unknown as Record<string, Json> })
    .eq('id', businessId)
    .select('id')

  if (updateError) return { error: updateError.message }
  if (!updated || updated.length === 0) return { error: NOT_SAVED }

  revalidateBusinessPages()
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════════
// updateBusinessProfile — Datos del negocio (nombre, contacto público y datos privados
// para facturación). La validación vive en lib/business-profile.ts (espejo de los CHECK).
// ════════════════════════════════════════════════════════════════════════════════

export async function updateBusinessProfile(input: BusinessProfileInput): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase, businessId } = auth

  const checked = validateBusinessProfile(input)
  if (!checked.ok) return { error: checked.error }

  const { data: updated, error: updateError } = await supabase
    .from('businesses')
    .update(checked.value)
    .eq('id', businessId)
    .select('id')

  if (updateError) return { error: updateError.message }
  if (!updated || updated.length === 0) return { error: NOT_SAVED }

  revalidatePath('/[slug]/dashboard/settings', 'layout')
  revalidateBusinessPages()
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════════
// updateBookingSettings — Reservas en línea: intervalo entre horarios y límites de
// productos apartados. (Los límites se hacen cumplir en la BD: create_public_booking /
// get_bookable_products.)
// ════════════════════════════════════════════════════════════════════════════════

export interface BookingSettingsInput {
  booking_products_enabled:                 boolean
  booking_max_product_units:                number   // 0–50 (0 desactiva la función)
  booking_max_open_with_products_per_phone: number   // 0–50 (0 = sin límite)
  appointment_interval_minutes:             number   // 15 | 20 | 30 | 60
}

export async function updateBookingSettings(
  settings: BookingSettingsInput,
): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase, businessId } = auth

  // Validar
  if (typeof settings.booking_products_enabled !== 'boolean') {
    return { error: 'Valor inválido para permitir productos.' }
  }
  const limits = [
    ['Máximo de unidades por cita', settings.booking_max_product_units],
    ['Máximo de citas abiertas con productos', settings.booking_max_open_with_products_per_phone],
  ] as const
  for (const [label, value] of limits) {
    if (!Number.isInteger(value) || value < 0 || value > 50) {
      return { error: `${label} debe ser un entero entre 0 y 50.` }
    }
  }
  if (!isValidBookingInterval(settings.appointment_interval_minutes)) {
    return { error: 'El intervalo entre horarios debe ser de 15, 20, 30 o 60 minutos.' }
  }

  // Persistir (RLS tenant: solo su propio negocio)
  const { data: updated, error: updateError } = await supabase
    .from('businesses')
    .update({
      booking_products_enabled:                 settings.booking_products_enabled,
      booking_max_product_units:                settings.booking_max_product_units,
      booking_max_open_with_products_per_phone: settings.booking_max_open_with_products_per_phone,
      appointment_interval_minutes:             settings.appointment_interval_minutes,
    })
    .eq('id', businessId)
    .select('id')

  if (updateError) return { error: updateError.message }
  if (!updated || updated.length === 0) return { error: NOT_SAVED }

  revalidatePath('/[slug]/dashboard/settings/booking', 'page')
  revalidatePath('/[slug]/dashboard/appointments', 'page')
  revalidatePath('/[slug]/book', 'page')
  revalidatePath('/[slug]', 'page')
  return { success: true }
}
