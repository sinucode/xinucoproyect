'use server'
// ============================================================
// actions/super-admin.ts — Server Actions for super admin
// All actions require profile.role === 'super_admin'.
// ============================================================

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { PLAN_BUNDLES } from '@xinuco/billing-catalog'
import type { BusinessFeatures } from '@xinuco/types'
import type { PlanName } from '@xinuco/billing-catalog'

export interface ActionResult {
  success: boolean
  error?:  string
}

// ── Auth guard helper ─────────────────────────────────────────────────────────
//
// [SEC] Usa app_metadata.role del JWT — NO la tabla profiles.
// Los super_admin no tienen fila en profiles (no son tenant-specific).
// app_metadata solo es escribible por el service role (servidor) — nunca
// puede ser manipulado por el cliente. Es la fuente de verdad para roles.

async function requireSuperAdmin() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.', supabase: null, user: null }

  if (user.app_metadata?.role !== 'super_admin') {
    return { error: 'Acceso denegado. Se requiere rol super_admin.', supabase: null, user: null }
  }

  return { error: null, supabase, user }
}

// ── getAllBusinesses ───────────────────────────────────────────────────────────

export async function getAllBusinesses() {
  const { error, supabase } = await requireSuperAdmin()
  if (error || !supabase) return { data: null, error: error ?? 'Error desconocido.' }

  const { data, error: dbError } = await supabase
    .from('businesses')
    .select('id, name, slug, is_active, features_enabled, created_at')
    .order('name')

  if (dbError) return { data: null, error: dbError.message }
  return { data, error: null }
}

// ── updateBusinessFeatures ────────────────────────────────────────────────────

/**
 * Merges partial feature overrides into the existing features_enabled JSONB.
 * Does NOT replace the entire object — only touches the provided keys.
 */
export async function updateBusinessFeatures(
  businessId: string,
  features:   Partial<BusinessFeatures>,
): Promise<ActionResult> {
  const { error, supabase } = await requireSuperAdmin()
  if (error || !supabase) return { success: false, error: error ?? 'Error desconocido.' }

  // Fetch current features to merge
  const { data: biz, error: fetchError } = await supabase
    .from('businesses')
    .select('features_enabled')
    .eq('id', businessId)
    .single()

  if (fetchError || !biz) return { success: false, error: fetchError?.message ?? 'Negocio no encontrado.' }

  const current   = (biz.features_enabled ?? {}) as unknown as BusinessFeatures
  const merged    = { ...current, ...features }

  const { error: updateError } = await supabase
    .from('businesses')
    .update({ features_enabled: merged as unknown as Record<string, boolean> })
    .eq('id', businessId)

  if (updateError) return { success: false, error: updateError.message }

  revalidatePath('/super-admin/businesses')
  revalidatePath(`/super-admin/businesses/${businessId}`)
  return { success: true }
}

// ── applyPlan ─────────────────────────────────────────────────────────────────

/**
 * Applies a full plan bundle to a business, replacing all feature flags
 * with the bundle's values.
 */
export async function applyPlan(
  businessId: string,
  plan:        PlanName,
): Promise<ActionResult> {
  const bundle = PLAN_BUNDLES[plan]
  if (!bundle) return { success: false, error: `Plan desconocido: ${plan}` }

  // applyPlan is a "full replace" of the plan keys — reuse updateBusinessFeatures
  // but with all keys from the bundle (it's a complete set)
  return updateBusinessFeatures(businessId, bundle.features as Partial<BusinessFeatures>)
}

// ── Trial Mode Actions ────────────────────────────────────────────────────────

/**
 * setBusinessTrial — Activa el modo trial para un negocio.
 * Mientras el trial esté activo, el FeatureGate tratará TODAS las features
 * como habilitadas, sin modificar features_enabled (los datos nunca se borran).
 *
 * @param businessId - UUID del negocio
 * @param expiresAt  - ISO 8601 timestamp de vencimiento (ej: "2026-06-28T23:59:59Z")
 */
export async function setBusinessTrial(
  businessId: string,
  expiresAt: string,
): Promise<ActionResult> {
  const { error, supabase } = await requireSuperAdmin()
  if (error || !supabase) return { success: false, error: error ?? 'Error desconocido.' }

  const { error: updateError } = await supabase
    .from('businesses')
    .update({ trial_expires_at: expiresAt } as Record<string, unknown>)
    .eq('id', businessId)

  if (updateError) return { success: false, error: updateError.message }

  revalidatePath('/super-admin/businesses')
  revalidatePath(`/super-admin/businesses/${businessId}`)
  return { success: true }
}

/**
 * clearBusinessTrial — Desactiva el trial de un negocio de inmediato.
 * Los datos del negocio NO son afectados — solo se quita el acceso temporal.
 */
export async function clearBusinessTrial(
  businessId: string,
): Promise<ActionResult> {
  const { error, supabase } = await requireSuperAdmin()
  if (error || !supabase) return { success: false, error: error ?? 'Error desconocido.' }

  const { error: updateError } = await supabase
    .from('businesses')
    .update({ trial_expires_at: null } as Record<string, unknown>)
    .eq('id', businessId)

  if (updateError) return { success: false, error: updateError.message }

  revalidatePath('/super-admin/businesses')
  revalidatePath(`/super-admin/businesses/${businessId}`)
  return { success: true }
}

