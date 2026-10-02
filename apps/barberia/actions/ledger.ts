'use server'

// actions/ledger.ts — "Pagos al equipo" (antes Ledger) y "Mi cuenta" de cada profesional.
//
// Seguridad: la RLS de `staff_ledger` deja LEER al administrador del negocio o al profesional
// dueño de la fila (staff.user_id = su usuario) y solo deja INSERTAR al administrador. Aun así,
// TODA escritura exige rol admin|super_admin aquí mismo, y el business_id sale SIEMPRE del
// PERFIL del usuario autenticado (nunca del cliente). Los movimientos no se editan ni se borran:
// se corrigen con un bono (a favor) o un descuento.

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import type { LedgerEntryType, StaffLedgerEntry, TeamPaymentMethod } from '@xinuco/types'
import { addDaysToDateKey, businessTodayISODate } from '@/lib/agenda-time'
import {
  bogotaDateKey,
  bogotaDayRangeUTC,
  isLedgerEntryType,
  isRealDateKey,
  isTeamPaymentMethod,
  settlementSinceLastPayment,
  type LedgerEntryLike,
  type SettlementSummary,
  type TeamReceiptResult,
} from '@/lib/team-payments'
import { maskEmail } from '@/lib/team-utils'
import { loadStaffContacts } from '@/lib/staff-contacts'
import { paymentMethodForAccount } from '@/lib/money-accounts'
import { resolveAccount } from '@/lib/account-resolve'
import { createServiceClient, resolveStaffEmail, sendTeamPaymentReceipt } from '@/lib/email/notifications'

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface TeamStaffRef {
  id:             string
  full_name:      string
  specialty_role: string
  is_active:      boolean
  user_id:        string | null
}

/** Profesional con sus saldos (columnas de la vista staff_ledger_balances). */
export interface TeamPaymentsMember {
  staff:            TeamStaffRef
  total_earned:     number
  total_advances:   number
  total_paid_out:   number
  total_bonus:      number
  total_deductions: number
  current_balance:  number
  last_payment_at:  string | null
  /** WhatsApp / celular del profesional (para abrir su chat con la liquidación). */
  phone:            string | null
  /**
   * Correo enmascarado (c***s@gmail.com) al que llegan sus recibos: el suyo o el del usuario
   * vinculado. null = sin correo. Nunca se envía el correo completo al cliente.
   */
  receipt_email_masked: string | null
}

export interface TeamPaymentsOverview {
  members: TeamPaymentsMember[]
  totals: {
    /** Suma de los saldos positivos: lo que se le debe al equipo. */
    owed:                 number
    /** Suma (en positivo) de los saldos negativos: anticipos por descontar. */
    advances_outstanding: number
  }
  activeShift:  { id: string } | null
  businessName: string
}

export interface AccountFilters {
  type?: LedgerEntryType | 'all'
  /** 'YYYY-MM-DD' (día local de Colombia). */
  from?: string
  to?:   string
  /** Página 1-based: se devuelven los primeros page × 50 movimientos (cumulativo, "Ver más"). */
  page?: number
}

export interface AccountEntry extends StaffLedgerEntry {
  /** Solo comisiones: tipo de la línea de venta. */
  item_type: 'service' | 'product' | null
}

export interface StaffAccount {
  staff:      TeamStaffRef
  balance:    number
  /** Resumen desde el último pago (sobre TODOS los movimientos, sin filtros). */
  settlement: SettlementSummary
  entries:    AccountEntry[]
  /** Total de movimientos que cumplen los filtros. */
  total:      number
  hasMore:    boolean
  page:       number
  /** Período sugerido al liquidar (día siguiente al último pago → hoy). */
  suggestedPeriod: { from: string; to: string }
}

export interface TeamMovementInput {
  staffId: string
  type:    'advance' | 'payment' | 'bonus' | 'deduction'
  /** Entero COP entre 1 y 50.000.000. */
  amount:  number
  notes?:  string
  /** Obligatorio en anticipo/pago; se ignora en bono/descuento. */
  payment_method?: TeamPaymentMethod | null
  /**
   * Anticipo/pago: medio de pago del negocio (money_accounts). Con un id, el servidor deriva el método
   * del medio (caja → 'cash_register', otro → 'transfer'); null = "Otro medio" ('other'); sin el campo,
   * se respeta payment_method y la base asigna el medio por defecto (como antes).
   */
  account_id?: string | null
  /** Período liquidado (solo pagos), 'YYYY-MM-DD'. */
  period_from?: string | null
  period_to?:   string | null
  /** Confirma un pago mayor al saldo: la diferencia queda como anticipo. */
  allowOverpay?: boolean
  /** Anticipo/pago: enviar el recibo por correo al profesional (por defecto true). */
  sendReceipt?: boolean
}

export interface TeamMovementResult {
  success?: boolean
  error?:   string
  entry?:   StaffLedgerEntry
  /** El pago supera el saldo: la UI debe pedir confirmación y reenviar con allowOverpay. */
  overpay?: { balance: number }
  /** Anticipo/pago con sendReceipt: resultado del envío del recibo (nunca falla el movimiento). */
  receipt?: TeamReceiptResult
}

// ── Constantes ────────────────────────────────────────────────────────────────

const NOT_ADMIN      = 'Solo un administrador puede gestionar los pagos al equipo.'
const NOT_ALLOWED    = 'No tienes permiso para ver esta cuenta.'
const STAFF_NOT_FOUND = 'Profesional no encontrado.'
const NO_OPEN_SHIFT  = 'No hay caja abierta. Abre la caja o elige otro medio de pago.'
const MAX_AMOUNT     = 50_000_000
const MIN_NOTES      = 3
const MAX_NOTES      = 200
const PAGE_SIZE      = 50
const MAX_PAGES      = 40
const FETCH_SIZE     = 1000
const MAX_FETCH_PAGES = 50

type Supabase = Awaited<ReturnType<typeof createClient>>

// ── Autorización ──────────────────────────────────────────────────────────────

async function getContext(): Promise<
  { supabase: Supabase; userId: string; businessId: string; isAdmin: boolean } | { error: string }
> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NOT_ALLOWED }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', user.id)
    .single()

  const role = (profile as { role?: string } | null)?.role
  const businessId = (profile as { business_id?: string | null } | null)?.business_id
  if (!role || !businessId) return { error: NOT_ALLOWED }

  return { supabase, userId: user.id, businessId, isAdmin: role === 'admin' || role === 'super_admin' }
}

async function requireAdmin(): Promise<
  { supabase: Supabase; userId: string; businessId: string } | { error: string }
> {
  const ctx = await getContext()
  if ('error' in ctx) return { error: NOT_ADMIN }
  if (!ctx.isAdmin) return { error: NOT_ADMIN }
  return ctx
}

// ── Helpers de lectura ────────────────────────────────────────────────────────

const STAFF_COLS = 'id, full_name, specialty_role, is_active, user_id'

function toStaffRef(row: Record<string, unknown>): TeamStaffRef {
  return {
    id:             String(row.id),
    full_name:      String(row.full_name ?? ''),
    specialty_role: String(row.specialty_role ?? ''),
    is_active:      row.is_active !== false,
    user_id:        (row.user_id as string | null | undefined) ?? null,
  }
}

type ItemTypeJoin = { item_type: string | null } | { item_type: string | null }[] | null | undefined

function itemTypeOf(join: ItemTypeJoin): 'service' | 'product' | null {
  const item = Array.isArray(join) ? join[0] : join
  return item?.item_type === 'product' ? 'product' : item?.item_type === 'service' ? 'service' : null
}

/** Todos los movimientos de UN profesional (paginado en bloques de 1000), del más viejo al más nuevo. */
async function fetchAllEntries(
  supabase: Supabase,
  businessId: string,
  staffId: string,
): Promise<{ entries: LedgerEntryLike[] } | { error: string }> {
  const entries: LedgerEntryLike[] = []
  for (let page = 0; page < MAX_FETCH_PAGES; page++) {
    const { data, error } = await supabase
      .from('staff_ledger')
      .select('id, entry_type, amount, created_at, sale_item:sale_item_id(item_type)')
      .eq('business_id', businessId)
      .eq('staff_id', staffId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(page * FETCH_SIZE, page * FETCH_SIZE + FETCH_SIZE - 1)
    if (error) return { error: error.message }

    const batch = (data ?? []) as {
      id: string; entry_type: LedgerEntryType; amount: number; created_at: string; sale_item: ItemTypeJoin
    }[]
    for (const r of batch) {
      entries.push({
        id: r.id, entry_type: r.entry_type, amount: r.amount, created_at: r.created_at,
        item_type: itemTypeOf(r.sale_item),
      })
    }
    if (batch.length < FETCH_SIZE) break
  }
  return { entries }
}

/**
 * Período sugerido al liquidar: desde el día siguiente al último pago (o desde el primer
 * movimiento si nunca se le ha pagado) hasta hoy. Nunca queda "desde" después de "hasta".
 */
function suggestPeriod(
  since: string | null,
  firstEntryAt: string | null,
  today: string,
): { from: string; to: string } {
  let from = today
  if (since) from = addDaysToDateKey(bogotaDateKey(since), 1)
  else if (firstEntryAt) from = bogotaDateKey(firstEntryAt)
  if (from > today) from = today
  return { from, to: today }
}

/** Correo de recibos por profesional (staff.email o el del usuario vinculado). Best-effort. */
async function resolveReceiptEmails(rows: Record<string, unknown>[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const pending: { id: string; user_id: string }[] = []
  for (const row of rows) {
    const id = String(row.id)
    const own = typeof row.email === 'string' ? row.email.trim() : ''
    if (own) out.set(id, own)
    else if (typeof row.user_id === 'string' && row.user_id) pending.push({ id, user_id: row.user_id })
  }
  if (pending.length === 0) return out

  try {
    const service = createServiceClient()
    if (!service) return out
    const resolved = await Promise.all(
      pending.map(async p => [p.id, await resolveStaffEmail(service, { user_id: p.user_id })] as const),
    )
    for (const [id, email] of resolved) if (email) out.set(id, email)
  } catch {
    // Sin correo del usuario vinculado: la UI muestra "Sin correo"
  }
  return out
}

// ════════════════════════════════════════════════════════════════════════════
// getTeamPaymentsOverview — página "Pagos al equipo" (admin)
// ════════════════════════════════════════════════════════════════════════════

export async function getTeamPaymentsOverview(): Promise<TeamPaymentsOverview | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const [staffRes, balancesRes, businessRes, shiftRes, paymentsRes, contacts] = await Promise.all([
    // email/phone no se leen aquí (privilegios por columna): vienen de get_staff_contacts
    supabase.from('staff')
      .select(STAFF_COLS)
      .eq('business_id', businessId)
      .order('full_name', { ascending: true }),
    supabase.from('staff_ledger_balances')
      .select('*')
      .eq('business_id', businessId),
    supabase.from('businesses')
      .select('name')
      .eq('id', businessId)
      .maybeSingle(),
    supabase.from('cash_register_shifts')
      .select('id')
      .eq('business_id', businessId)
      .eq('status', 'open')
      .maybeSingle(),
    // Último pago de cada profesional (del más reciente al más viejo: el primero de cada uno gana)
    supabase.from('staff_ledger')
      .select('staff_id, created_at')
      .eq('business_id', businessId)
      .eq('entry_type', 'payment')
      .order('created_at', { ascending: false })
      .limit(5000),
    // Si la función falla (p. ej. aún no desplegada) la página sigue, sin correo ni celular
    loadStaffContacts(supabase, businessId),
  ])

  if (staffRes.error)    return { error: staffRes.error.message }
  if (balancesRes.error) return { error: balancesRes.error.message }

  type BalanceRow = {
    staff_id: string; total_earned: number; total_advances: number; total_paid_out: number
    total_bonus?: number; total_deductions?: number; current_balance: number
  }
  const balanceById = new Map<string, BalanceRow>()
  for (const b of (balancesRes.data ?? []) as BalanceRow[]) balanceById.set(b.staff_id, b)

  const lastPaymentById = new Map<string, string>()
  for (const p of ((paymentsRes.data ?? []) as { staff_id: string; created_at: string }[])) {
    if (!lastPaymentById.has(p.staff_id)) lastPaymentById.set(p.staff_id, p.created_at)
  }

  const staffRows = ((staffRes.data ?? []) as Record<string, unknown>[]).map(row => ({
    ...row,
    email: contacts.get(String(row.id))?.email ?? null,
    phone: contacts.get(String(row.id))?.phone ?? null,
  }))

  // Correo de los recibos: el del profesional o, si no tiene, el del usuario vinculado (Auth).
  // Solo se resuelve (con service role) para quienes aparecen en la lista; al cliente va enmascarado.
  const emailById = await resolveReceiptEmails(staffRows)

  const members: TeamPaymentsMember[] = []
  for (const row of staffRows) {
    const staff = toStaffRef(row)
    const b = balanceById.get(staff.id)
    const current = b?.current_balance ?? 0
    // Un profesional inactivo solo aparece si todavía tiene saldo (a favor o por descontar)
    if (!staff.is_active && current === 0) continue
    members.push({
      staff,
      total_earned:     b?.total_earned ?? 0,
      total_advances:   b?.total_advances ?? 0,
      total_paid_out:   b?.total_paid_out ?? 0,
      total_bonus:      b?.total_bonus ?? 0,
      total_deductions: b?.total_deductions ?? 0,
      current_balance:  current,
      last_payment_at:  lastPaymentById.get(staff.id) ?? null,
      phone:            typeof row.phone === 'string' && row.phone.trim() ? row.phone.trim() : null,
      receipt_email_masked: emailById.get(staff.id) ? maskEmail(emailById.get(staff.id)!) : null,
    })
  }

  let owed = 0
  let advances = 0
  for (const m of members) {
    if (m.current_balance > 0) owed += m.current_balance
    else if (m.current_balance < 0) advances += -m.current_balance
  }

  const shift = (shiftRes.data as { id?: string } | null) ?? null

  return {
    members,
    totals: { owed, advances_outstanding: advances },
    activeShift: shift?.id ? { id: shift.id } : null,
    businessName: (businessRes.data as { name?: string } | null)?.name ?? 'tu negocio',
  }
}

// ════════════════════════════════════════════════════════════════════════════
// getStaffAccount — cuenta de UN profesional (admin: cualquiera del negocio;
// profesional: solo la suya)
// ════════════════════════════════════════════════════════════════════════════

/** Normaliza los filtros que llegan del cliente / de la URL: lo inválido se ignora. */
function normalizeFilters(filters?: AccountFilters) {
  const type = filters?.type && filters.type !== 'all' && isLedgerEntryType(filters.type) ? filters.type : null
  const from = isRealDateKey(filters?.from) ? filters!.from! : null
  const to   = isRealDateKey(filters?.to)   ? filters!.to!   : null
  const rawPage = Number(filters?.page)
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? Math.min(rawPage, MAX_PAGES) : 1
  return { type, from, to, page }
}

async function loadAccount(
  supabase: Supabase,
  businessId: string,
  staff: TeamStaffRef,
  filters?: AccountFilters,
): Promise<StaffAccount | { error: string }> {
  const f = normalizeFilters(filters)

  const all = await fetchAllEntries(supabase, businessId, staff.id)
  if ('error' in all) return { error: all.error }

  const settlement = settlementSinceLastPayment(all.entries)

  let query = supabase
    .from('staff_ledger')
    .select('*, sale_item:sale_item_id(item_type)', { count: 'exact' })
    .eq('business_id', businessId)
    .eq('staff_id', staff.id)
  if (f.type) query = query.eq('entry_type', f.type)
  // Las fechas son días locales de Colombia: [D 05:00Z, D+1 05:00Z)
  if (f.from) query = query.gte('created_at', bogotaDayRangeUTC(f.from, f.from).start)
  if (f.to)   query = query.lt('created_at', bogotaDayRangeUTC(f.to, f.to).end)
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, f.page * PAGE_SIZE - 1)
  if (error) return { error: error.message }

  const entries: AccountEntry[] = ((data ?? []) as (StaffLedgerEntry & { sale_item?: ItemTypeJoin })[]).map(row => {
    const { sale_item, ...rest } = row
    return { ...rest, item_type: itemTypeOf(sale_item) }
  })
  const total = count ?? entries.length

  return {
    staff,
    balance: settlement.balance,
    settlement,
    entries,
    total,
    hasMore: total > f.page * PAGE_SIZE,
    page: f.page,
    suggestedPeriod: suggestPeriod(settlement.since, all.entries[0]?.created_at ?? null, businessTodayISODate()),
  }
}

export async function getStaffAccount(
  staffId: string,
  filters?: AccountFilters,
): Promise<StaffAccount | { error: string }> {
  const ctx = await getContext()
  if ('error' in ctx) return ctx
  const { supabase, userId, businessId, isAdmin } = ctx

  if (!staffId || typeof staffId !== 'string') return { error: isAdmin ? STAFF_NOT_FOUND : NOT_ALLOWED }

  // Anti-IDOR: el profesional debe ser del negocio del perfil; un no-admin, además, el suyo.
  let staffQuery = supabase
    .from('staff')
    .select(STAFF_COLS)
    .eq('id', staffId)
    .eq('business_id', businessId)
  if (!isAdmin) staffQuery = staffQuery.eq('user_id', userId)
  const { data: staffRow } = await staffQuery.maybeSingle()

  if (!staffRow) return { error: isAdmin ? STAFF_NOT_FOUND : NOT_ALLOWED }

  return loadAccount(supabase, businessId, toStaffRef(staffRow as Record<string, unknown>), filters)
}

// ════════════════════════════════════════════════════════════════════════════
// getMyAccount — "Mi cuenta" del profesional que inició sesión (solo lectura)
// ════════════════════════════════════════════════════════════════════════════

export async function getMyAccount(
  filters?: AccountFilters,
): Promise<StaffAccount | { notLinked: true } | { error: string }> {
  const ctx = await getContext()
  if ('error' in ctx) return ctx
  const { supabase, userId, businessId } = ctx

  const { data: staffRow } = await supabase
    .from('staff')
    .select(STAFF_COLS)
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .order('is_active', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!staffRow) return { notLinked: true }

  return loadAccount(supabase, businessId, toStaffRef(staffRow as Record<string, unknown>), filters)
}

// ════════════════════════════════════════════════════════════════════════════
// recordTeamMovement — anticipo, pago (liquidación), bono o descuento (solo admin)
// ════════════════════════════════════════════════════════════════════════════

function formatPlainCOP(amount: number): string {
  return `$${String(Math.abs(Math.round(amount))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

export async function recordTeamMovement(input: TeamMovementInput): Promise<TeamMovementResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, userId, businessId } = auth

  if (!input || typeof input !== 'object') return { error: 'Datos inválidos.' }

  // ── Validación ──────────────────────────────────────────────────────────────
  const type = input.type
  if (type !== 'advance' && type !== 'payment' && type !== 'bonus' && type !== 'deduction') {
    return { error: 'Elige el tipo de movimiento.' }
  }

  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > MAX_AMOUNT) {
    return { error: 'El monto debe ser un entero entre $1 y $50.000.000.' }
  }

  let notes = typeof input.notes === 'string' ? input.notes.trim() : ''
  if (type === 'payment') {
    if (notes.length > MAX_NOTES) return { error: `La nota no puede superar ${MAX_NOTES} caracteres.` }
    if (!notes) notes = 'Liquidación'
  } else if (notes.length < MIN_NOTES || notes.length > MAX_NOTES) {
    return { error: `El motivo debe tener entre ${MIN_NOTES} y ${MAX_NOTES} caracteres.` }
  }

  // El medio de pago solo aplica a plata que sale: anticipos y pagos
  let method: TeamPaymentMethod | null = null
  let accountId: string | null | undefined
  if (type === 'advance' || type === 'payment') {
    if (input.account_id === null) accountId = null
    if (!isTeamPaymentMethod(input.payment_method)) return { error: 'Elige cómo se pagó.' }
    method = input.payment_method
    if (input.account_id === null) {
      method = 'other'
    } else if (input.account_id !== undefined) {
      const resolved = await resolveAccount(supabase, businessId, input.account_id)
      if ('error' in resolved) return resolved
      accountId = resolved.account.id
      method = paymentMethodForAccount(resolved.account, 'outflow') as TeamPaymentMethod
    }
  }

  // El período liquidado solo aplica a pagos
  let periodFrom: string | null = null
  let periodTo: string | null = null
  if (type === 'payment' && (input.period_from || input.period_to)) {
    if (!isRealDateKey(input.period_from) || !isRealDateKey(input.period_to)) {
      return { error: 'Las fechas del período no son válidas.' }
    }
    if (input.period_from > input.period_to) {
      return { error: 'El inicio del período no puede ser posterior a su final.' }
    }
    periodFrom = input.period_from
    periodTo = input.period_to
  }

  // ── El profesional debe ser del negocio del perfil (anti-IDOR) ──────────────
  if (!input.staffId || typeof input.staffId !== 'string') return { error: STAFF_NOT_FOUND }
  const { data: staffRow } = await supabase
    .from('staff')
    .select('id')
    .eq('id', input.staffId)
    .eq('business_id', businessId)
    .maybeSingle()
  if (!staffRow) return { error: STAFF_NOT_FOUND }

  // ── Efectivo de la caja: exige turno abierto ────────────────────────────────
  let shiftId: string | null = null
  if (method === 'cash_register') {
    const { data: shift } = await supabase
      .from('cash_register_shifts')
      .select('id')
      .eq('business_id', businessId)
      .eq('status', 'open')
      .maybeSingle()
    const id = (shift as { id?: string } | null)?.id
    if (!id) return { error: NO_OPEN_SHIFT }
    shiftId = id
  }

  // ── Un pago mayor al saldo pide confirmación explícita ──────────────────────
  if (type === 'payment' && input.allowOverpay !== true) {
    const { data: balanceRow } = await supabase
      .from('staff_ledger_balances')
      .select('current_balance')
      .eq('business_id', businessId)
      .eq('staff_id', input.staffId)
      .maybeSingle()
    const balance = (balanceRow as { current_balance?: number } | null)?.current_balance ?? 0
    if (input.amount > balance) {
      return {
        error: `El pago supera el saldo (${formatPlainCOP(Math.max(balance, 0))}). La diferencia quedará como anticipo.`,
        overpay: { balance },
      }
    }
  }

  // ── Insertar ────────────────────────────────────────────────────────────────
  const { data: created, error } = await supabase
    .from('staff_ledger')
    .insert({
      business_id:    businessId,
      staff_id:       input.staffId,
      entry_type:     type,
      amount:         input.amount,
      notes,
      reference_id:   null,
      payment_method: method,
      ...(accountId === undefined ? {} : { account_id: accountId }),
      shift_id:       shiftId,
      created_by:     userId,
      period_from:    periodFrom,
      period_to:      periodTo,
    })
    .select()
    .single()

  if (error) return { error: error.message }

  revalidatePath('/[slug]/dashboard/ledger', 'page')
  // La caja (efectivo esperado) se muestra en el dashboard y sus páginas
  revalidatePath('/[slug]/dashboard', 'layout')
  revalidatePath('/[slug]/dashboard/commissions', 'page')

  const entry = created as StaffLedgerEntry

  // Recibo por correo al profesional (anticipos y pagos): un fallo nunca falla el movimiento
  if ((type === 'advance' || type === 'payment') && input.sendReceipt !== false) {
    let receipt: TeamReceiptResult
    try {
      receipt = await sendTeamPaymentReceipt({ entryId: entry.id, businessId })
    } catch {
      receipt = { sent: false, reason: 'error' }
    }
    return { success: true, entry, receipt }
  }

  return { success: true, entry }
}
