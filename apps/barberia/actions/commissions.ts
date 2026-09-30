'use server'

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import type { CommissionRule, Staff, Service, ServiceAudienceOrAll } from '@xinuco/types'
import { addDaysToDateKey, businessTodayISODate } from '@/lib/agenda-time'

// Las comisiones se registran SOLAS al cobrar (triggers en la base). Esta acción
// solo administra las reglas, resume lo ganado y permite reaplicar reglas a ventas
// pagadas que quedaron sin comisión.

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ActionResult {
  success?: boolean
  error?:   string
}

export interface CommissionRuleWithRelations extends CommissionRule {
  staff:   Pick<Staff,   'id' | 'full_name'> | null
  service: Pick<Service, 'id' | 'name'>      | null
}

export interface CommissionRuleInput {
  staff_id:           string | null
  service_id:         string | null
  mode:               'percentage' | 'fixed'
  /** % (1–100) o monto fijo COP según `mode`. 0 solo en reglas de solo productos. */
  value:              number
  /** % sobre productos (0–100). Solo aplica a reglas sin servicio específico. */
  product_percentage: number
}

export interface CommissionSummaryRow {
  staff_id:        string
  staff_name:      string
  services_amount: number
  services_count:  number
  products_amount: number
  tips_amount:     number
  total:           number
}

export interface DateRange {
  from: string   // 'YYYY-MM-DD' (fecha local del negocio)
  to:   string   // 'YYYY-MM-DD' (inclusive)
}

export interface CommissionsOverview {
  rules:    CommissionRuleWithRelations[]
  staff:    { id: string; full_name: string }[]
  services: { id: string; name: string; audience: ServiceAudienceOrAll }[]
  summary:  CommissionSummaryRow[]
  range:    DateRange
}

const NOT_ADMIN = 'Solo un administrador puede gestionar comisiones.'
const REVALIDATE_COMMISSIONS = '/[slug]/dashboard/commissions'
const REVALIDATE_LEDGER = '/[slug]/dashboard/ledger'
const MAX_RANGE_DAYS = 366
const MAX_FIXED_AMOUNT = 10_000_000
const PAGE_SIZE = 1000

// ── Guard de administrador ────────────────────────────────────────────────────
// El business_id SIEMPRE sale del perfil del usuario autenticado, nunca del cliente.

type Supabase = Awaited<ReturnType<typeof createClient>>

async function requireAdmin(): Promise<
  { supabase: Supabase; businessId: string } | { error: string }
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

  return { supabase, businessId }
}

// ── Rango de fechas ───────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDateKey(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  )
}

/** Devuelve el rango o el motivo por el que no es válido. */
function parseRange(range: unknown): DateRange | { error: string } {
  const r = range as Partial<DateRange> | null | undefined
  if (!r || !isValidDateKey(r.from) || !isValidDateKey(r.to)) {
    return { error: 'Rango de fechas inválido.' }
  }
  if (r.from > r.to) return { error: 'La fecha inicial no puede ser posterior a la final.' }
  if (daysBetween(r.from, r.to) + 1 > MAX_RANGE_DAYS) {
    return { error: 'El período no puede superar 366 días.' }
  }
  return { from: r.from, to: r.to }
}

/** Mes actual (día 1 → hoy) en la zona del negocio. */
function currentMonthRange(): DateRange {
  const today = businessTodayISODate()
  return { from: `${today.slice(0, 8)}01`, to: today }
}

// ── Validación de reglas ──────────────────────────────────────────────────────

function validateRuleInput(input: CommissionRuleInput): string | null {
  if (input.mode !== 'percentage' && input.mode !== 'fixed') {
    return 'Tipo de comisión inválido.'
  }
  if (!Number.isInteger(input.value) || input.value < 0) {
    return 'El valor de la comisión debe ser un número entero.'
  }
  if (!Number.isInteger(input.product_percentage)
      || input.product_percentage < 0 || input.product_percentage > 100) {
    return 'El porcentaje de productos debe ser un número entero entre 0 y 100.'
  }
  if (input.service_id && input.product_percentage > 0) {
    return 'El % de productos solo aplica a reglas sin servicio específico.'
  }

  if (input.value === 0) {
    // Única excepción: regla de solo productos (sin servicio y con % de productos).
    if (!input.service_id && input.product_percentage > 0) return null
    return 'Define una comisión por servicio o por productos mayor a 0.'
  }
  if (input.mode === 'percentage' && input.value > 100) {
    return 'El porcentaje debe estar entre 1 y 100.'
  }
  if (input.mode === 'fixed' && input.value > MAX_FIXED_AMOUNT) {
    return 'El monto fijo no puede superar $10.000.000.'
  }
  return null
}

/** Comprueba que el profesional y el servicio (si hay) sean del negocio. */
async function validateScope(
  supabase: Supabase,
  businessId: string,
  input: CommissionRuleInput,
): Promise<string | null> {
  if (input.staff_id) {
    const { data } = await supabase
      .from('staff')
      .select('id')
      .eq('id', input.staff_id)
      .eq('business_id', businessId)
      .maybeSingle()
    if (!data) return 'Profesional no encontrado.'
  }
  if (input.service_id) {
    const { data } = await supabase
      .from('services')
      .select('id')
      .eq('id', input.service_id)
      .eq('business_id', businessId)
      .maybeSingle()
    if (!data) return 'Servicio no encontrado.'
  }
  return null
}

function ruleColumns(input: CommissionRuleInput) {
  return {
    commission_percentage: input.mode === 'percentage' ? input.value : 0,
    fixed_amount:          input.mode === 'fixed' ? input.value : 0,
    product_percentage:    input.product_percentage,
  }
}

function ruleError(error: { code?: string; message: string }): string {
  if (error.code === '23505') {
    return 'Ya existe una regla para esa combinación de profesional y servicio.'
  }
  return error.message
}

// ════════════════════════════════════════════════════════════════════════════
// getCommissionsOverview
// Reglas + equipo activo + servicios activos + resumen de lo ganado en el período.
// ════════════════════════════════════════════════════════════════════════════

export async function getCommissionsOverview(
  range: DateRange,
): Promise<CommissionsOverview | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const parsed = parseRange(range)
  const safeRange: DateRange = 'error' in parsed ? currentMonthRange() : parsed

  // [from 00:00 Bogotá, día siguiente al "to" 00:00 Bogotá) expresado en UTC (UTC-5 fijo)
  const startISO = `${safeRange.from}T05:00:00Z`
  const endISO   = `${addDaysToDateKey(safeRange.to, 1)}T05:00:00Z`

  const [rulesRes, staffRes, servicesRes] = await Promise.all([
    supabase
      .from('commission_rules')
      .select('*, staff:staff_id ( id, full_name ), service:service_id ( id, name )')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false }),
    supabase
      .from('staff')
      .select('id, full_name, is_active')
      .eq('business_id', businessId)
      .order('full_name'),
    supabase
      .from('services')
      .select('id, name, audience')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name'),
  ])

  if (rulesRes.error)    return { error: rulesRes.error.message }
  if (staffRes.error)    return { error: staffRes.error.message }
  if (servicesRes.error) return { error: servicesRes.error.message }

  // Movimientos automáticos del período (comisiones y propinas), paginados
  type LedgerRow = {
    staff_id:  string
    entry_type: 'commission' | 'tip'
    amount:    number
    sale_item: { item_type: string } | { item_type: string }[] | null
  }
  const entries: LedgerRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('staff_ledger')
      // Por fecha de la VENTA (no del registro): "Aplicar reglas" a un mes pasado
      // debe contar en ese mes.
      .select('staff_id, entry_type, amount, sale_item:sale_item_id(item_type), sale:sale_id!inner(created_at)')
      .eq('business_id', businessId)
      .in('entry_type', ['commission', 'tip'])
      .gte('sale.created_at', startISO)
      .lt('sale.created_at', endISO)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) return { error: error.message }
    const page = (data ?? []) as LedgerRow[]
    entries.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  const allStaff = (staffRes.data ?? []) as { id: string; full_name: string; is_active: boolean }[]
  const nameById = new Map(allStaff.map(s => [s.id, s.full_name]))

  const byStaff = new Map<string, CommissionSummaryRow>()
  for (const e of entries) {
    let row = byStaff.get(e.staff_id)
    if (!row) {
      row = {
        staff_id:        e.staff_id,
        staff_name:      nameById.get(e.staff_id) ?? 'Profesional',
        services_amount: 0,
        services_count:  0,
        products_amount: 0,
        tips_amount:     0,
        total:           0,
      }
      byStaff.set(e.staff_id, row)
    }
    const amount = e.amount ?? 0
    if (e.entry_type === 'tip') {
      row.tips_amount += amount
    } else {
      const item = Array.isArray(e.sale_item) ? e.sale_item[0] : e.sale_item
      if (item?.item_type === 'product') {
        row.products_amount += amount
      } else {
        row.services_amount += amount
        row.services_count  += 1
      }
    }
    row.total += amount
  }

  const summary = Array.from(byStaff.values()).sort(
    (a, b) => b.total - a.total || a.staff_name.localeCompare(b.staff_name, 'es'),
  )

  return {
    rules: (rulesRes.data ?? []) as CommissionRuleWithRelations[],
    staff: allStaff.filter(s => s.is_active).map(s => ({ id: s.id, full_name: s.full_name })),
    services: (servicesRes.data ?? []) as { id: string; name: string; audience: ServiceAudienceOrAll }[],
    summary,
    range: safeRange,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// createCommissionRule / updateCommissionRule / deleteCommissionRule
// ════════════════════════════════════════════════════════════════════════════

export async function createCommissionRule(input: CommissionRuleInput): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const invalid = validateRuleInput(input)
  if (invalid) return { error: invalid }

  const scopeError = await validateScope(supabase, businessId, input)
  if (scopeError) return { error: scopeError }

  const { error } = await supabase
    .from('commission_rules')
    .insert({
      business_id: businessId,
      staff_id:    input.staff_id   || null,
      service_id:  input.service_id || null,
      ...ruleColumns(input),
    })

  if (error) return { error: ruleError(error) }

  revalidatePath(REVALIDATE_COMMISSIONS, 'page')
  return { success: true }
}

export async function updateCommissionRule(
  id: string,
  input: CommissionRuleInput,
): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const invalid = validateRuleInput(input)
  if (invalid) return { error: invalid }

  const scopeError = await validateScope(supabase, businessId, input)
  if (scopeError) return { error: scopeError }

  const { data, error } = await supabase
    .from('commission_rules')
    .update({
      staff_id:   input.staff_id   || null,
      service_id: input.service_id || null,
      ...ruleColumns(input),
    })
    .eq('id', id)
    .eq('business_id', businessId)
    .select('id')

  if (error) return { error: ruleError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'Regla no encontrada.' }

  revalidatePath(REVALIDATE_COMMISSIONS, 'page')
  return { success: true }
}

export async function deleteCommissionRule(id: string): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const { data, error } = await supabase
    .from('commission_rules')
    .delete()
    .eq('id', id)
    .eq('business_id', businessId)
    .select('id')

  if (error) return { error: error.message }
  if (!Array.isArray(data) || data.length === 0) return { error: 'Regla no encontrada.' }

  revalidatePath(REVALIDATE_COMMISSIONS, 'page')
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// applyPendingCommissions
// Aplica las reglas vigentes a las ventas pagadas del período que aún no tienen
// comisión. Lo ya registrado no cambia (el RPC es idempotente).
// ════════════════════════════════════════════════════════════════════════════

export async function applyPendingCommissions(
  range: DateRange,
): Promise<{ success: true; sales: number; entries: number } | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const parsed = parseRange(range)
  if ('error' in parsed) return parsed

  const { data, error } = await supabase.rpc('apply_pending_commissions', {
    p_business_id: businessId,
    p_from:        parsed.from,
    p_to:          parsed.to,
  })

  if (error) {
    return { error: error.message === 'forbidden' ? NOT_ADMIN : error.message }
  }

  const result = (data ?? {}) as { sales?: number; entries?: number }

  revalidatePath(REVALIDATE_COMMISSIONS, 'page')
  revalidatePath(REVALIDATE_LEDGER, 'page')
  return { success: true, sales: result.sales ?? 0, entries: result.entries ?? 0 }
}
