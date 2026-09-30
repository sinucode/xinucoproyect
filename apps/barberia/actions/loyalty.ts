'use server'

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { businessTodayISODate } from '@/lib/agenda-time'
import {
  loyaltyErrorMessage,
  validateLoyaltyConfig,
  type CustomerLoyalty,
  type LoyaltyConfig,
  type LoyaltyMode,
  type LoyaltyMovement,
  type LoyaltySettings,
  type LoyaltySummary,
} from '@/lib/loyalty-utils'

// ════════════════════════════════════════════════════════════════════════════
// Lealtad v2 — Puntos o Sellos
//
// Se gana solo (trigger de BD al pagar la venta) y se canjea en el cobro
// (checkoutAppointment → redeem_loyalty_for_sale). Aquí vive la configuración,
// el panel y los ajustes manuales. Todos los RPC verifican el negocio del
// usuario; el business_id sale SIEMPRE del perfil, nunca del cliente.
// ════════════════════════════════════════════════════════════════════════════

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface LoyaltyOverview {
  settings:  LoyaltySettings
  summary:   LoyaltySummary
  movements: LoyaltyMovement[]
}

export interface CustomerLoyaltyResult {
  customer: { id: string; full_name: string; phone: string }
  loyalty:  CustomerLoyalty | null
}

const NOT_ADMIN  = 'Solo un administrador puede gestionar la lealtad.'
const NOT_MEMBER = 'No autorizado. Inicia sesión de nuevo.'

const CONFIG_COLUMNS =
  'loyalty_mode, loyalty_earn_per_cop, loyalty_point_value_cop, loyalty_min_redeem_points, ' +
  'loyalty_expiry_months, loyalty_stamps_required, loyalty_stamp_max_reward_cop'
const SETTINGS_COLUMNS = `features_enabled, ${CONFIG_COLUMNS}`

type Supabase = Awaited<ReturnType<typeof createClient>>

// ── Autorización ──────────────────────────────────────────────────────────────

async function loadContext(
  onDenied: string,
  adminOnly: boolean,
): Promise<{ supabase: Supabase; businessId: string; userId: string } | { error: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: onDenied }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', user.id)
    .single()

  const role = (profile as { role?: string } | null)?.role
  const businessId = (profile as { business_id?: string | null } | null)?.business_id
  if (!businessId || !role) return { error: onDenied }
  if (adminOnly && role !== 'admin' && role !== 'super_admin') return { error: onDenied }

  return { supabase, businessId, userId: user.id }
}

const requireAdmin  = () => loadContext(NOT_ADMIN, true)
const requireMember = () => loadContext(NOT_MEMBER, false)

// ── Normalización ─────────────────────────────────────────────────────────────

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function toSettings(row: Record<string, unknown> | null): LoyaltySettings {
  const r = row ?? {}
  const features = (r.features_enabled ?? {}) as { loyalty?: boolean }
  return {
    enabled:                      features.loyalty === true,
    loyalty_mode:                 r.loyalty_mode === 'stamps' ? 'stamps' : 'points',
    loyalty_earn_per_cop:         num(r.loyalty_earn_per_cop, 1000),
    loyalty_point_value_cop:      num(r.loyalty_point_value_cop, 50),
    loyalty_min_redeem_points:    num(r.loyalty_min_redeem_points, 0),
    loyalty_expiry_months:        num(r.loyalty_expiry_months, 12),
    loyalty_stamps_required:      num(r.loyalty_stamps_required, 10),
    loyalty_stamp_max_reward_cop: num(r.loyalty_stamp_max_reward_cop, 0),
  }
}

function toCustomerLoyalty(data: unknown): CustomerLoyalty | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  return {
    enabled:              d.enabled === true,
    mode:                 d.mode === 'stamps' ? 'stamps' : 'points',
    balance:              num(d.balance),
    expiring_30d:         num(d.expiring_30d),
    point_value_cop:      num(d.point_value_cop),
    value_cop:            d.value_cop == null ? null : num(d.value_cop),
    min_redeem:           num(d.min_redeem),
    stamps_required:      num(d.stamps_required, 10),
    stamp_max_reward_cop: num(d.stamp_max_reward_cop),
    can_redeem:           d.can_redeem === true,
  }
}

function toSummary(data: unknown, fallbackMode: LoyaltyMode): LoyaltySummary {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return {
    mode:                   d.mode === 'stamps' ? 'stamps' : d.mode === 'points' ? 'points' : fallbackMode,
    customers_with_balance: num(d.customers_with_balance),
    total_balance:          num(d.total_balance),
    customers_ready:        num(d.customers_ready),
    redeemed_total:         num(d.redeemed_total),
    discount_given_cop:     num(d.discount_given_cop),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// getLoyaltySettings — configuración del programa (admin)
// ════════════════════════════════════════════════════════════════════════════

export async function getLoyaltySettings(): Promise<{ settings?: LoyaltySettings; error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return { error: ctx.error }

  const { data, error } = await ctx.supabase
    .from('businesses')
    .select(SETTINGS_COLUMNS)
    .eq('id', ctx.businessId)
    .single()

  if (error || !data) return { error: 'No se pudo cargar la configuración de lealtad.' }
  return { settings: toSettings(data as Record<string, unknown>) }
}

// ════════════════════════════════════════════════════════════════════════════
// updateLoyaltySettings — guarda la configuración (admin)
// Valida igual que los CHECK de la BD; en modo puntos el punto debe valer menos
// de lo que se gasta para ganarlo (si no, se devuelve el 100% o más).
// ════════════════════════════════════════════════════════════════════════════

export async function updateLoyaltySettings(
  input: LoyaltyConfig,
): Promise<{ success?: boolean; error?: string; settings?: LoyaltySettings }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return { error: ctx.error }

  const parsed = validateLoyaltyConfig(input)
  if ('error' in parsed) return { error: parsed.error }

  const { data, error } = await ctx.supabase
    .from('businesses')
    .update(parsed.value)
    .eq('id', ctx.businessId)
    .select(SETTINGS_COLUMNS)
    .single()

  if (error || !data) {
    console.error('[loyalty] updateLoyaltySettings', error)
    return { error: 'No se pudo guardar la configuración de lealtad.' }
  }

  revalidatePath('/[slug]/dashboard/settings', 'page')
  revalidatePath('/[slug]/dashboard/settings/loyalty', 'page')
  revalidatePath('/[slug]/dashboard/loyalty', 'page')
  revalidatePath('/[slug]/dashboard', 'layout')
  return { success: true, settings: toSettings(data as Record<string, unknown>) }
}

// ════════════════════════════════════════════════════════════════════════════
// getLoyaltyOverview — panel de lealtad (admin)
// Configuración + resumen (RPC) + últimos 100 movimientos del modo activo.
// ════════════════════════════════════════════════════════════════════════════

export async function getLoyaltyOverview(): Promise<LoyaltyOverview | { error: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return { error: ctx.error }

  const { data: biz, error: bizError } = await ctx.supabase
    .from('businesses')
    .select(SETTINGS_COLUMNS)
    .eq('id', ctx.businessId)
    .single()

  if (bizError || !biz) return { error: 'No se pudo cargar la configuración de lealtad.' }
  const settings = toSettings(biz as Record<string, unknown>)

  const [summaryRes, movementsRes] = await Promise.all([
    ctx.supabase.rpc('get_loyalty_summary', { p_business_id: ctx.businessId }),
    ctx.supabase
      .from('loyalty_ledgers')
      .select(
        'id, entry_type, points_added, points_redeemed, discount_cop, notes, sale_id, created_at, ' +
        'customer:client_id ( id, full_name, phone )',
      )
      .eq('business_id', ctx.businessId)
      .eq('kind', settings.loyalty_mode)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  if (summaryRes.error) console.error('[loyalty] get_loyalty_summary', summaryRes.error)
  if (movementsRes.error) console.error('[loyalty] movements', movementsRes.error)

  type Row = {
    id: string
    entry_type: string
    points_added: number | null
    points_redeemed: number | null
    discount_cop: number | null
    notes: string | null
    sale_id: string | null
    created_at: string
    customer: LoyaltyMovement['customer'] | LoyaltyMovement['customer'][]
  }

  const movements: LoyaltyMovement[] = ((movementsRes.data ?? []) as unknown as Row[]).map((row) => {
    const added    = num(row.points_added)
    const redeemed = num(row.points_redeemed)
    const type = row.entry_type === 'redeem' ? 'redeem' : row.entry_type === 'adjust' ? 'adjust' : 'earn'
    return {
      id:           row.id,
      customer:     Array.isArray(row.customer) ? (row.customer[0] ?? null) : (row.customer ?? null),
      entry_type:   type,
      units:        added - redeemed,
      discount_cop: row.discount_cop == null ? null : num(row.discount_cop),
      notes:        row.notes,
      sale_id:      row.sale_id,
      created_at:   row.created_at,
    }
  })

  return {
    settings,
    summary: toSummary(summaryRes.data, settings.loyalty_mode),
    movements,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// findCustomerLoyalty — busca clientes por teléfono o nombre (cualquier miembro)
// ════════════════════════════════════════════════════════════════════════════

export async function findCustomerLoyalty(
  query: string,
): Promise<{ results: CustomerLoyaltyResult[]; error?: string }> {
  const ctx = await requireMember()
  if ('error' in ctx) return { results: [], error: ctx.error }

  // Se quitan los caracteres que rompen el filtro .or() / el patrón ilike
  const q = String(query ?? '').replace(/[%_,()*\\"']/g, ' ').replace(/\s+/g, ' ').trim()
  if (q.length < 2) return { results: [] }

  const { data, error } = await ctx.supabase
    .from('customers')
    .select('id, full_name, phone')
    .eq('business_id', ctx.businessId)
    .or(`phone.ilike.%${q}%,full_name.ilike.%${q}%`)
    .order('full_name', { ascending: true })
    .limit(8)

  if (error) {
    console.error('[loyalty] findCustomerLoyalty', error)
    return { results: [], error: 'No se pudo buscar el cliente.' }
  }

  const customers = (data ?? []) as { id: string; full_name: string; phone: string }[]
  const results = await Promise.all(
    customers.map(async (customer): Promise<CustomerLoyaltyResult> => {
      const { data: loyalty, error: rpcError } = await ctx.supabase.rpc('get_customer_loyalty', {
        p_customer_id: customer.id,
      })
      if (rpcError) console.error('[loyalty] get_customer_loyalty', rpcError)
      return { customer, loyalty: rpcError ? null : toCustomerLoyalty(loyalty) }
    }),
  )

  return { results }
}

// ════════════════════════════════════════════════════════════════════════════
// getCustomerLoyalty — saldo de un cliente en el modo activo (cualquier miembro)
// El RPC verifica que el cliente sea del negocio del usuario.
// ════════════════════════════════════════════════════════════════════════════

export async function getCustomerLoyalty(
  customerId: string,
): Promise<{ loyalty?: CustomerLoyalty; error?: string }> {
  const ctx = await requireMember()
  if ('error' in ctx) return { error: ctx.error }
  if (!customerId || typeof customerId !== 'string') return { error: 'Cliente inválido.' }

  const { data, error } = await ctx.supabase.rpc('get_customer_loyalty', { p_customer_id: customerId })
  if (error) {
    return { error: loyaltyErrorMessage(error.message, 'No se pudo cargar la lealtad del cliente.') }
  }

  const loyalty = toCustomerLoyalty(data)
  if (!loyalty) return { error: 'No se pudo cargar la lealtad del cliente.' }
  return { loyalty }
}

// ════════════════════════════════════════════════════════════════════════════
// adjustCustomerLoyalty — ajuste manual de saldo (admin). delta > 0 suma, < 0 resta.
// ════════════════════════════════════════════════════════════════════════════

export async function adjustCustomerLoyalty(
  customerId: string,
  delta: number,
  reason: string,
): Promise<{ success?: boolean; balance?: number; error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return { error: ctx.error }

  if (!customerId || typeof customerId !== 'string') return { error: 'Cliente inválido.' }
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000) {
    return { error: loyaltyErrorMessage('invalid_delta') }
  }
  const cleanReason = String(reason ?? '').trim()
  if (cleanReason.length < 3) return { error: loyaltyErrorMessage('reason_required') }

  const { data, error } = await ctx.supabase.rpc('adjust_customer_loyalty', {
    p_customer_id: customerId,
    p_delta:       delta,
    p_reason:      cleanReason.slice(0, 200),
  })

  if (error) {
    return { error: loyaltyErrorMessage(error.message, 'No se pudo ajustar el saldo.') }
  }

  revalidatePath('/[slug]/dashboard/loyalty', 'page')
  return { success: true, balance: num((data as { balance?: number } | null)?.balance) }
}

// ════════════════════════════════════════════════════════════════════════════
// applyPendingLoyalty — otorga lealtad a ventas pagadas que aún no la tienen (admin)
// Por defecto, el mes en curso (hora de Colombia).
// ════════════════════════════════════════════════════════════════════════════

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function applyPendingLoyalty(
  range?: { from?: string; to?: string },
): Promise<{ success?: boolean; sales?: number; units?: number; error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return { error: ctx.error }

  const today = businessTodayISODate()
  const from = range?.from ?? `${today.slice(0, 7)}-01`
  const to   = range?.to   ?? today
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    return { error: 'El rango de fechas no es válido.' }
  }

  const { data, error } = await ctx.supabase.rpc('apply_pending_loyalty', {
    p_business_id: ctx.businessId,
    p_from:        from,
    p_to:          to,
  })

  if (error) {
    return { error: loyaltyErrorMessage(error.message, 'No se pudo aplicar la lealtad a las ventas anteriores.') }
  }

  const result = (data ?? {}) as { sales?: number; units?: number }
  revalidatePath('/[slug]/dashboard/loyalty', 'page')
  return { success: true, sales: num(result.sales), units: num(result.units) }
}
