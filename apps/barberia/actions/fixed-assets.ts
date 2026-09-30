'use server'
// actions/fixed-assets.ts — RF21 Activos Fijos
//
// Solo el administrador. El negocio sale SIEMPRE del perfil (nunca del cliente). Crear y dar de baja pasan
// por funciones de la base (register_fixed_asset / dispose_fixed_asset); la auditoría la escriben los
// triggers de la base, por eso aquí no se llama a logAction.

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { businessTodayISODate } from '@/lib/agenda-time'
import {
  MAX_ASSET_PRICE,
  MAX_LIFE_MONTHS,
  MIN_ASSET_DATE,
  mapAssetError,
} from '@/lib/fixed-assets-utils'
import type {
  FixedAsset,
  FixedAssetCategory,
  DepreciationMethod,
  DepreciationSchedule,
  AssetPortfolioSummary,
  AssetPaymentMethod,
  DisposalReason,
} from '@xinuco/types'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ActionResult {
  success?: boolean
  error?:   string
}

export interface RegisterFixedAssetInput {
  name:                string
  category:            FixedAssetCategory
  purchase_date:       string           // 'YYYY-MM-DD'
  purchase_price:      number
  salvage_value:       number
  useful_life_months:  number
  depreciation_method: DepreciationMethod
  payment_method:      AssetPaymentMethod
  serial_number?:      string | null
  location?:           string | null
  description?:        string | null
}

/** Lo que se puede editar de un equipo en uso (nada de pago, caja ni baja). */
export type UpdateFixedAssetInput = Partial<
  Omit<RegisterFixedAssetInput, 'payment_method'>
>

export interface DisposeFixedAssetInput {
  date:           string           // 'YYYY-MM-DD'
  reason:         DisposalReason
  price?:         number | null
  paymentMethod?: AssetPaymentMethod | null
  notes?:         string | null
}

export interface DisposeResult extends ActionResult {
  bookValue?: number
  price?:     number | null
  /** ganancia (+) o pérdida (−) al dar de baja */
  result?:    number
}

const NOT_ADMIN = 'Solo un administrador puede manejar los activos fijos.'

const CATEGORIES: FixedAssetCategory[] = ['furniture', 'equipment', 'technology', 'improvements', 'vehicle', 'other']
const METHODS: DepreciationMethod[] = ['straight_line', 'declining_balance']
const PAYMENTS: AssetPaymentMethod[] = ['cash_register', 'transfer', 'other']
const REASONS: DisposalReason[] = ['sold', 'damaged', 'stolen', 'donated', 'other']

type Supabase = Awaited<ReturnType<typeof createClient>>

// ── Autorización ──────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<
  { supabase: Supabase; businessId: string; userId: string } | { error: string }
> {
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
  if ((role !== 'admin' && role !== 'super_admin') || !businessId) {
    return { error: NOT_ADMIN }
  }

  return { supabase, businessId, userId: user.id }
}

function revalidateAssets() {
  revalidatePath('/[slug]/dashboard/fixed-assets', 'page')
  revalidatePath('/[slug]/dashboard/accounting', 'page')
  // El estado de resultados vive en Gastos y la caja (efectivo esperado) en el dashboard
  revalidatePath('/[slug]/dashboard/expenses', 'page')
  revalidatePath('/[slug]/dashboard', 'layout')
}

// ── Validación ────────────────────────────────────────────────────────────────

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n)
}

function isRealISODate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

interface CleanAssetFields {
  name?:                string
  category?:            FixedAssetCategory
  description?:         string | null
  serial_number?:       string | null
  location?:            string | null
  purchase_date?:       string
  purchase_price?:      number
  salvage_value?:       number
  useful_life_months?:  number
  depreciation_method?: DepreciationMethod
}

/** Valida los campos presentes (al crear se exigen los obligatorios; al editar, solo lo enviado). */
function validateAssetFields(
  input: UpdateFixedAssetInput,
  requireAll: boolean,
  current?: Pick<FixedAsset, 'purchase_price' | 'salvage_value'>,
): { fields: CleanAssetFields } | { error: string } {
  const out: CleanAssetFields = {}

  if (input.name !== undefined || requireAll) {
    const name = (input.name ?? '').trim()
    if (name.length < 1) return { error: mapAssetError('name_required') }
    if (name.length > 150) return { error: 'El nombre no puede superar los 150 caracteres.' }
    out.name = name
  }
  if (input.category !== undefined || requireAll) {
    if (!input.category || !CATEGORIES.includes(input.category)) return { error: mapAssetError('invalid_category') }
    out.category = input.category
  }
  if (input.description !== undefined) {
    const description = (input.description ?? '').trim()
    if (description.length > 500) return { error: 'La descripción no puede superar los 500 caracteres.' }
    out.description = description || null
  }
  if (input.serial_number !== undefined) {
    const serial = (input.serial_number ?? '').trim()
    if (serial.length > 100) return { error: 'El serial no puede superar los 100 caracteres.' }
    out.serial_number = serial || null
  }
  if (input.location !== undefined) {
    const location = (input.location ?? '').trim()
    if (location.length > 100) return { error: 'La ubicación no puede superar los 100 caracteres.' }
    out.location = location || null
  }
  if (input.purchase_date !== undefined || requireAll) {
    const date = input.purchase_date
    if (!isRealISODate(date) || date > businessTodayISODate() || date < MIN_ASSET_DATE) {
      return { error: mapAssetError('invalid_date') }
    }
    out.purchase_date = date
  }
  if (input.purchase_price !== undefined || requireAll) {
    if (!isInt(input.purchase_price) || input.purchase_price <= 0 || input.purchase_price > MAX_ASSET_PRICE) {
      return { error: mapAssetError('invalid_price') }
    }
    out.purchase_price = input.purchase_price
  }
  if (input.salvage_value !== undefined || requireAll) {
    if (!isInt(input.salvage_value) || input.salvage_value < 0) return { error: mapAssetError('invalid_salvage') }
    out.salvage_value = input.salvage_value
  }
  if (input.useful_life_months !== undefined || requireAll) {
    if (!isInt(input.useful_life_months) || input.useful_life_months < 1 || input.useful_life_months > MAX_LIFE_MONTHS) {
      return { error: mapAssetError('invalid_life') }
    }
    out.useful_life_months = input.useful_life_months
  }
  if (input.depreciation_method !== undefined || requireAll) {
    if (!input.depreciation_method || !METHODS.includes(input.depreciation_method)) {
      return { error: mapAssetError('invalid_method') }
    }
    out.depreciation_method = input.depreciation_method
  }

  // El valor residual siempre debe ser menor que el precio (con lo nuevo o, si falta, con lo guardado)
  const price = out.purchase_price ?? current?.purchase_price
  const salvage = out.salvage_value ?? current?.salvage_value
  if (price !== undefined && salvage !== undefined && salvage >= price) {
    return { error: mapAssetError('invalid_salvage') }
  }

  return { fields: out }
}

// ════════════════════════════════════════════════════════════════════════════
// getFixedAssets
// 'active' = equipos en uso · 'disposed' = dados de baja (o desactivados antes de existir la baja).
// ════════════════════════════════════════════════════════════════════════════

export async function getFixedAssets(
  opts: { status: 'active' | 'disposed' } = { status: 'active' },
): Promise<{ data: FixedAsset[] | null; error: string | null }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { data: null, error: auth.error }
  const { supabase, businessId } = auth

  let query = supabase
    .from('fixed_assets')
    .select('*')
    .eq('business_id', businessId)

  if (opts.status === 'disposed') {
    query = query
      .or('disposed_at.not.is.null,is_active.eq.false')
      .order('disposed_at', { ascending: false, nullsFirst: false })
      .order('purchase_date', { ascending: false })
  } else {
    query = query
      .eq('is_active', true)
      .is('disposed_at', null)
      .order('purchase_date', { ascending: false })
  }

  const { data, error } = await query
  if (error) return { data: null, error: 'No se pudieron cargar los equipos. Intenta de nuevo.' }
  return { data: (data ?? []) as FixedAsset[], error: null }
}

// ════════════════════════════════════════════════════════════════════════════
// getAssetPortfolioSummary
// Totales de los equipos en uso (RPC get_total_asset_value, solo admin).
// ════════════════════════════════════════════════════════════════════════════

export async function getAssetPortfolioSummary(): Promise<{ data: AssetPortfolioSummary | null; error: string | null }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { data: null, error: auth.error }
  const { supabase, businessId } = auth

  const { data, error } = await supabase.rpc('get_total_asset_value', { p_business_id: businessId })

  if (error) return { data: null, error: mapAssetError(error.message) }
  return { data: data as unknown as AssetPortfolioSummary, error: null }
}

// ════════════════════════════════════════════════════════════════════════════
// getDepreciationSchedule
// Ficha de un equipo: valor hoy, meses transcurridos y restantes (RPC get_depreciation_schedule).
// ════════════════════════════════════════════════════════════════════════════

export async function getDepreciationSchedule(
  assetId: string,
): Promise<{ data: DepreciationSchedule | null; error: string | null }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { data: null, error: auth.error }
  const { supabase, businessId } = auth

  const { data, error } = await supabase.rpc('get_depreciation_schedule', {
    p_business_id: businessId,
    p_asset_id:    assetId,
  })

  if (error) return { data: null, error: mapAssetError(error.message) }

  const result = data as unknown as (DepreciationSchedule & { error?: string }) | null
  if (!result) return { data: null, error: mapAssetError('not_found') }
  if (result.error) return { data: null, error: mapAssetError(result.error) }
  return { data: result, error: null }
}

// ════════════════════════════════════════════════════════════════════════════
// registerFixedAsset
// Crea el equipo con la función de la base (valida, toma el negocio del token y, si se pagó con
// efectivo de la caja, lo amarra al turno abierto para el cuadre).
// ════════════════════════════════════════════════════════════════════════════

export async function registerFixedAsset(
  input: RegisterFixedAssetInput,
): Promise<ActionResult & { id?: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase } = auth

  const checked = validateAssetFields(input, true)
  if ('error' in checked) return { error: checked.error }
  const f = checked.fields

  if (!PAYMENTS.includes(input.payment_method)) return { error: mapAssetError('invalid_payment_method') }

  const { data, error } = await supabase.rpc('register_fixed_asset', {
    p_name:               f.name!,
    p_category:           f.category!,
    p_purchase_date:      f.purchase_date!,
    p_purchase_price:     f.purchase_price!,
    p_salvage_value:      f.salvage_value!,
    p_useful_life_months: f.useful_life_months!,
    p_method:             f.depreciation_method!,
    p_payment_method:     input.payment_method,
    p_serial_number:      f.serial_number ?? undefined,
    p_location:           f.location ?? undefined,
    p_description:        f.description ?? undefined,
  })

  if (error) return { error: mapAssetError(error.message) }

  revalidateAssets()
  return { success: true, id: data as unknown as string }
}

// ════════════════════════════════════════════════════════════════════════════
// updateFixedAsset
// Solo datos descriptivos y de valor. El pago, la caja y la baja no se cambian (la base lo impide).
// ════════════════════════════════════════════════════════════════════════════

export async function updateFixedAsset(
  assetId: string,
  input:   UpdateFixedAssetInput,
): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase, businessId } = auth

  if (!assetId) return { error: mapAssetError('not_found') }

  const { data: current, error: currentError } = await supabase
    .from('fixed_assets')
    .select('purchase_price, salvage_value, disposed_at, is_active')
    .eq('id', assetId)
    .eq('business_id', businessId)
    .maybeSingle()

  if (currentError) return { error: mapAssetError(currentError.message) }
  if (!current) return { error: mapAssetError('not_found') }
  const row = current as Pick<FixedAsset, 'purchase_price' | 'salvage_value' | 'disposed_at' | 'is_active'>
  if (row.disposed_at || !row.is_active) return { error: mapAssetError('asset_disposed') }

  const checked = validateAssetFields(input, false, row)
  if ('error' in checked) return { error: checked.error }
  if (Object.keys(checked.fields).length === 0) return { success: true }

  const { data, error } = await supabase
    .from('fixed_assets')
    .update(checked.fields)
    .eq('id', assetId)
    .eq('business_id', businessId)
    .select('id')

  if (error) return { error: mapAssetError(error.message) }
  if (!data || data.length === 0) return { error: mapAssetError('not_found') }

  revalidateAssets()
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// disposeFixedAsset
// Da de baja con motivo. Guarda lo que valía ese día y, si se vendió, el precio y cómo se recibió.
// ════════════════════════════════════════════════════════════════════════════

export async function disposeFixedAsset(
  assetId: string,
  input:   DisposeFixedAssetInput,
): Promise<DisposeResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase } = auth

  if (!assetId) return { error: mapAssetError('not_found') }
  if (!REASONS.includes(input.reason)) return { error: mapAssetError('invalid_reason') }
  if (!isRealISODate(input.date) || input.date > businessTodayISODate()) {
    return { error: mapAssetError('invalid_date') }
  }

  const notes = (input.notes ?? '').trim()
  if (notes.length > 300) return { error: 'La nota no puede superar los 300 caracteres.' }
  if ((input.reason === 'damaged' || input.reason === 'stolen' || input.reason === 'other') && !notes) {
    return { error: mapAssetError('reason_required') }
  }

  let price: number | null = null
  let paymentMethod: AssetPaymentMethod | null = null
  if (input.reason === 'sold') {
    if (!isInt(input.price) || input.price < 0 || input.price > MAX_ASSET_PRICE) {
      return { error: mapAssetError('invalid_price') }
    }
    if (!input.paymentMethod || !PAYMENTS.includes(input.paymentMethod)) {
      return { error: mapAssetError('invalid_payment_method') }
    }
    price = input.price
    paymentMethod = input.paymentMethod
  }

  const { data, error } = await supabase.rpc('dispose_fixed_asset', {
    p_asset_id:       assetId,
    p_date:           input.date,
    p_reason:         input.reason,
    p_price:          price ?? undefined,
    p_payment_method: paymentMethod ?? undefined,
    p_notes:          notes || undefined,
  })

  if (error) return { error: mapAssetError(error.message) }

  revalidateAssets()

  const res = (data ?? {}) as { book_value?: number; price?: number | null; result?: number }
  return { success: true, bookValue: res.book_value, price: res.price ?? null, result: res.result }
}
