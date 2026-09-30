'use server'
// actions/fixed-assets.ts — RF21 Activos Fijos

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import type {
  FixedAsset,
  DepreciationSchedule,
  AssetPortfolioSummary,
} from '@xinuco/types'

// ── Tipos de resultado ────────────────────────────────────────────────────────

interface ActionResult {
  success?: boolean
  error?:   string
}

export type CreateFixedAssetInput = Omit<
  FixedAsset,
  'id' | 'created_at' | 'business_id' | 'is_active'
>

// ════════════════════════════════════════════════════════════════════════════
// getFixedAssets
// Lista todos los activos activos de un negocio.
// ════════════════════════════════════════════════════════════════════════════

export async function getFixedAssets(
  businessId: string
): Promise<{ data: FixedAsset[] | null; error: string | null }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'No autenticado.' }

  const { data, error } = await supabase
    .from('fixed_assets')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('purchase_date', { ascending: false })

  if (error) return { data: null, error: error.message }
  return { data: (data ?? []) as FixedAsset[], error: null }
}

// ════════════════════════════════════════════════════════════════════════════
// getFixedAsset
// Obtiene un activo individual.
// ════════════════════════════════════════════════════════════════════════════

export async function getFixedAsset(
  businessId: string,
  assetId:    string
): Promise<{ data: FixedAsset | null; error: string | null }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'No autenticado.' }

  const { data, error } = await supabase
    .from('fixed_assets')
    .select('*')
    .eq('business_id', businessId)
    .eq('id', assetId)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as FixedAsset, error: null }
}

// ════════════════════════════════════════════════════════════════════════════
// createFixedAsset
// Inserta un nuevo activo fijo. Audita la acción (best-effort).
// ════════════════════════════════════════════════════════════════════════════

export async function createFixedAsset(
  businessId:   string,
  input:        CreateFixedAssetInput,
  businessSlug?: string
): Promise<ActionResult & { id?: string }> {
  if (!input.name?.trim()) {
    return { error: 'El nombre del activo es requerido.' }
  }
  if (!input.purchase_date) {
    return { error: 'La fecha de compra es requerida.' }
  }
  if (!Number.isInteger(input.purchase_price) || input.purchase_price <= 0) {
    return { error: 'El precio de compra debe ser un entero COP mayor a 0.' }
  }
  if (!Number.isInteger(input.salvage_value) || input.salvage_value < 0) {
    return { error: 'El valor residual debe ser un entero COP mayor o igual a 0.' }
  }
  if (!Number.isInteger(input.useful_life_months) || input.useful_life_months <= 0) {
    return { error: 'La vida útil debe ser un entero mayor a 0.' }
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  const { data, error } = await supabase
    .from('fixed_assets')
    .insert({
      business_id:         businessId,
      name:                input.name.trim(),
      category:            input.category,
      description:         input.description   ?? null,
      serial_number:       input.serial_number ?? null,
      location:            input.location      ?? null,
      purchase_date:       input.purchase_date,
      purchase_price:      input.purchase_price,
      salvage_value:       input.salvage_value,
      depreciation_method: input.depreciation_method,
      useful_life_months:  input.useful_life_months,
      is_active:           true,
      created_by:          input.created_by ?? user.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  // Audit log — best effort, never blocks main operation
  try {
    await logAction({
      businessId,
      action:     'fixed_asset.created',
      entityType: 'fixed_asset',
      entityId:   data.id,
      newValue:   { name: input.name, purchase_price: input.purchase_price, category: input.category },
    })
  } catch {
    // intentionally silent
  }

  if (businessSlug) {
    revalidatePath(`/${businessSlug}/dashboard/fixed-assets`)
  } else {
    revalidatePath('/[slug]/dashboard/fixed-assets', 'page')
  }

  return { success: true, id: data.id }
}

// ════════════════════════════════════════════════════════════════════════════
// updateFixedAsset
// Actualiza campos de un activo existente. Audita la acción (best-effort).
// ════════════════════════════════════════════════════════════════════════════

export async function updateFixedAsset(
  businessId:   string,
  assetId:      string,
  input:        Partial<CreateFixedAssetInput>,
  businessSlug?: string
): Promise<ActionResult> {
  if (input.purchase_price !== undefined) {
    if (!Number.isInteger(input.purchase_price) || input.purchase_price <= 0) {
      return { error: 'El precio de compra debe ser un entero COP mayor a 0.' }
    }
  }
  if (input.salvage_value !== undefined) {
    if (!Number.isInteger(input.salvage_value) || input.salvage_value < 0) {
      return { error: 'El valor residual debe ser un entero COP mayor o igual a 0.' }
    }
  }
  if (input.useful_life_months !== undefined) {
    if (!Number.isInteger(input.useful_life_months) || input.useful_life_months <= 0) {
      return { error: 'La vida útil debe ser un entero mayor a 0.' }
    }
  }
  if (input.name !== undefined && !input.name.trim()) {
    return { error: 'El nombre del activo no puede estar vacío.' }
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  // Build payload with only provided fields
  const payload: Record<string, unknown> = {}
  if (input.name                !== undefined) payload.name                = input.name.trim()
  if (input.category            !== undefined) payload.category            = input.category
  if (input.description         !== undefined) payload.description         = input.description
  if (input.serial_number       !== undefined) payload.serial_number       = input.serial_number
  if (input.location            !== undefined) payload.location            = input.location
  if (input.purchase_date       !== undefined) payload.purchase_date       = input.purchase_date
  if (input.purchase_price      !== undefined) payload.purchase_price      = input.purchase_price
  if (input.salvage_value       !== undefined) payload.salvage_value       = input.salvage_value
  if (input.depreciation_method !== undefined) payload.depreciation_method = input.depreciation_method
  if (input.useful_life_months  !== undefined) payload.useful_life_months  = input.useful_life_months

  const { error } = await supabase
    .from('fixed_assets')
    .update(payload)
    .eq('id', assetId)
    .eq('business_id', businessId)

  if (error) return { error: error.message }

  // Audit log — best effort
  try {
    await logAction({
      businessId,
      action:     'fixed_asset.updated',
      entityType: 'fixed_asset',
      entityId:   assetId,
      newValue:   payload as any,
    })
  } catch {
    // intentionally silent
  }

  if (businessSlug) {
    revalidatePath(`/${businessSlug}/dashboard/fixed-assets`)
  } else {
    revalidatePath('/[slug]/dashboard/fixed-assets', 'page')
  }

  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// deactivateFixedAsset
// Soft-delete: marca is_active = false. Audita la acción (best-effort).
// NUNCA hace hard DELETE sobre datos de negocio.
// ════════════════════════════════════════════════════════════════════════════

export async function deactivateFixedAsset(
  businessId:   string,
  assetId:      string,
  businessSlug?: string
): Promise<ActionResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  const { error } = await supabase
    .from('fixed_assets')
    .update({ is_active: false })
    .eq('id', assetId)
    .eq('business_id', businessId)

  if (error) return { error: error.message }

  // Audit log — best effort
  try {
    await logAction({
      businessId,
      action:     'fixed_asset.deactivated',
      entityType: 'fixed_asset',
      entityId:   assetId,
    })
  } catch {
    // intentionally silent
  }

  if (businessSlug) {
    revalidatePath(`/${businessSlug}/dashboard/fixed-assets`)
  } else {
    revalidatePath('/[slug]/dashboard/fixed-assets', 'page')
  }

  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// getDepreciationSchedule
// Llama el RPC get_depreciation_schedule y retorna el cronograma tipado.
// ════════════════════════════════════════════════════════════════════════════

export async function getDepreciationSchedule(
  businessId: string,
  assetId:    string
): Promise<{ data: DepreciationSchedule | null; error: string | null }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'No autenticado.' }

  const { data, error } = await supabase.rpc('get_depreciation_schedule', {
    p_business_id: businessId,
    p_asset_id:    assetId,
  })

  if (error) return { data: null, error: error.message }
  if (!data)  return { data: null, error: null }

  const result = data as unknown as DepreciationSchedule & { error?: string }
  if (result.error) return { data: null, error: result.error }

  return { data: result as DepreciationSchedule, error: null }
}

// ════════════════════════════════════════════════════════════════════════════
// getAssetPortfolioSummary
// Llama el RPC get_total_asset_value y retorna el resumen tipado.
// ════════════════════════════════════════════════════════════════════════════

export async function getAssetPortfolioSummary(
  businessId: string
): Promise<{ data: AssetPortfolioSummary | null; error: string | null }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'No autenticado.' }

  const { data, error } = await supabase.rpc('get_total_asset_value', {
    p_business_id: businessId,
  })

  if (error) return { data: null, error: error.message }
  if (!data)  return { data: null, error: null }

  return { data: data as unknown as AssetPortfolioSummary, error: null }
}
