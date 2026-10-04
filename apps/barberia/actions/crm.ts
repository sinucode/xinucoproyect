'use server'

import { createClient } from '@xinuco/supabase/server'
import { getSessionUser, getMyProfile } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import type { Customer, Staff } from '@xinuco/types'
import {
  CUSTOMERS_PAGE_SIZE,
  businessNowWallISO,
  parseCustomerFilter,
  parseCustomerSort,
  parseSalesSummary,
  validateCustomerInput,
  type CustomerInput,
} from '@/lib/crm-utils'

// ── Tipos de resultado ────────────────────────────────────────────────────────

interface ActionResult {
  success?: boolean
  error?:   string
}

/** Fila de la lista (RPC list_customers). */
export interface CustomerListItem {
  id:                 string
  full_name:          string
  phone:              string
  email:              string | null
  birthday:           string | null   // 'YYYY-MM-DD'
  preferred_staff_id: string | null
  created_at:         string          // instante real
  visits:             number          // citas completadas
  last_visit:         string | null   // start_time (hora local como UTC)
  next_appointment:   string | null   // start_time (hora local como UTC)
  total_spent:        number | null   // COP, ventas pagadas. null = el rol no ve montos (barbero)
  tags:               string[]
}

export interface CustomerListResult {
  items: CustomerListItem[]
  total: number
  page:  number
  error?: string
}

export interface ListCustomersParams {
  query?:  string
  filter?: string
  sort?:   string
  page?:   number
}

export type CustomerRecord = Customer & { birthday: string | null }

// Visita con detalles para el historial
export interface CustomerVisit {
  id:           string
  start_time:   string            // hora local como UTC
  status:       string
  service_name: string
  staff_name:   string | null
  amount_paid:  number | null     // venta pagada de esta cita (sales.appointment_id); null si no hay o el rol no ve montos
}

// Próxima cita abierta
export interface CustomerUpcomingAppointment {
  id:           string
  start_time:   string
  status:       string
  service_name: string
  staff_name:   string | null
  products:     { name: string; quantity: number }[]
}

// Producto comprado (sale_items type product)
export interface CustomerPurchasedProduct {
  description: string
  quantity:    number
  total_price: number | null      // null = el rol no ve montos
  created_at:  string             // instante real
}

// Fila de customer_notes
export interface CustomerNote {
  id:             string
  business_id:    string
  customer_id:    string
  staff_id:       string | null   // ficha de barbero del autor (null si es admin sin ficha)
  appointment_id: string | null
  content:        string
  created_at:     string          // instante real
}

// Nota enriquecida con autor
export interface CustomerNoteWithAuthor extends CustomerNote {
  created_by:  string | null
  author_name: string | null
  staff_name:  string | null
}

// Expediente completo del cliente
export interface CustomerExpediente {
  customer:           CustomerRecord
  total_visits:       number      // citas completadas
  // Montos: null cuando el usuario no es admin (el barbero ve visitas e historial, nunca plata)
  total_spent:        number | null   // COP — ventas pagadas
  paid_sales:         number | null
  avg_ticket:         number | null   // COP
  last_visit:         string | null
  tags:               string[]
  notes:              CustomerNoteWithAuthor[]
  visits:             CustomerVisit[]
  upcoming:           CustomerUpcomingAppointment[]
  purchased_products: CustomerPurchasedProduct[]
  staff_list:         Pick<Staff, 'id' | 'full_name'>[]  // para el selector de barbero preferido
}

// ── Helpers internos ──────────────────────────────────────────────────────────

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

interface TenantContext {
  userId:     string
  businessId: string
  fullName:   string | null
  /** Rol del perfil ('admin' | 'super_admin' | 'barber' | 'manicurist'…); null si no se pudo leer. */
  role:       string | null
}

/** businessId SIEMPRE desde el perfil de la sesión (nunca del cliente). */
async function getTenantContext(supabase: SupabaseClient): Promise<TenantContext | null> {
  // Sesión y perfil memoizados por petición (lib/session.ts); la verificación de rol sigue siendo de esta action
  const user = await getSessionUser(supabase)
  if (!user) return null

  const profile = await getMyProfile(supabase)

  const p = profile as { business_id?: string | null; full_name?: string | null; role?: string | null } | null
  if (!p?.business_id) return null
  return { userId: user.id, businessId: p.business_id, fullName: p.full_name ?? null, role: p.role ?? null }
}

async function customerBelongsToBusiness(
  supabase:   SupabaseClient,
  businessId: string,
  customerId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('customers')
    .select('id')
    .eq('business_id', businessId)
    .eq('id', customerId)
    .maybeSingle()
  return !!data
}

const DUPLICATE_PHONE_ERROR = 'Ya existe un cliente con ese teléfono.'
const NOT_AUTHENTICATED     = 'No autenticado.'
const CUSTOMER_NOT_FOUND    = 'Cliente no encontrado.'
const ADMIN_ONLY_PREFERRED  = 'Solo un administrador puede cambiar el barbero preferido.'

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ════════════════════════════════════════════════════════════════════════════
// listCustomers
// Lista paginada (30) vía RPC list_customers: búsqueda, filtro y orden con
// métricas REALES (gasto = ventas pagadas). SECURITY DEFINER con chequeo de negocio;
// el gasto (total_spent) llega NULL si el usuario no es admin.
// ════════════════════════════════════════════════════════════════════════════

export async function listCustomers(params: ListCustomersParams = {}): Promise<CustomerListResult> {
  const supabase = await createClient()
  const ctx = await getTenantContext(supabase)

  const filter = parseCustomerFilter(params.filter)
  const sort   = parseCustomerSort(params.sort)
  const rawPage = Math.floor(Number(params.page))
  const page   = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 0
  const query  = (params.query ?? '').trim().slice(0, 100)

  if (!ctx) return { items: [], total: 0, page, error: NOT_AUTHENTICATED }

  const { data, error } = await supabase.rpc('list_customers', {
    p_business_id: ctx.businessId,
    p_query:       query || null,
    p_filter:      filter,
    p_sort:        sort,
    p_limit:       CUSTOMERS_PAGE_SIZE,
    p_offset:      page * CUSTOMERS_PAGE_SIZE,
  })

  if (error) return { items: [], total: 0, page, error: error.message }

  const payload = (data ?? {}) as { total?: unknown; items?: Record<string, unknown>[] }
  const items: CustomerListItem[] = (payload.items ?? []).map((r) => ({
    id:                 r.id as string,
    full_name:          r.full_name as string,
    phone:              (r.phone as string) ?? '',
    email:              (r.email as string | null) ?? null,
    birthday:           (r.birthday as string | null) ?? null,
    preferred_staff_id: (r.preferred_staff_id as string | null) ?? null,
    created_at:         r.created_at as string,
    visits:             num(r.visits),
    last_visit:         (r.last_visit as string | null) ?? null,
    next_appointment:   (r.next_appointment as string | null) ?? null,
    total_spent:        r.total_spent === null || r.total_spent === undefined ? null : num(r.total_spent),
    tags:               Array.isArray(r.tags) ? (r.tags as string[]) : [],
  }))

  return { items, total: num(payload.total), page }
}

// ════════════════════════════════════════════════════════════════════════════
// getCustomerExpediente
// Perfil completo: datos, historial (últimas 30 por start_time), próximas citas
// con productos apartados, notas, etiquetas, staff activo y dinero REAL
// (sales pagadas + productos comprados). El dinero y los productos vienen del RPC
// get_customer_sales_summary (DEFINER): montos solo para el admin, NULL para el resto.
// ════════════════════════════════════════════════════════════════════════════

export async function getCustomerExpediente(customerId: string): Promise<CustomerExpediente | null> {
  const supabase = await createClient()
  const ctx = await getTenantContext(supabase)
  if (!ctx) return null
  const { businessId } = ctx

  const nowWall = businessNowWallISO()

  const [
    customerResult,
    appointmentsResult,
    upcomingResult,
    completedResult,
    salesSummaryResult,
    notesResult,
    tagsResult,
    staffResult,
  ] = await Promise.all([
    supabase
      .from('customers')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', customerId)
      .maybeSingle(),

    // Historial: por start_time desc
    supabase
      .from('appointments')
      .select('id, start_time, status, services ( name ), staff:staff_id ( full_name )')
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .order('start_time', { ascending: false })
      .limit(30),

    // Próximas citas abiertas (start_time >= ahora del negocio); los productos apartados
    // vienen del RPC de resumen (inventory_items es solo admin)
    supabase
      .from('appointments')
      .select(`
        id, start_time, status,
        services ( name ),
        staff:staff_id ( full_name )
      `)
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .in('status', ['scheduled', 'payment_pending'])
      .gte('start_time', nowWall)
      .order('start_time', { ascending: true })
      .limit(10),

    // Visitas completadas: conteo real + última
    supabase
      .from('appointments')
      .select('start_time', { count: 'exact' })
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .eq('status', 'completed')
      .order('start_time', { ascending: false })
      .limit(1),

    // Dinero real + productos comprados + productos apartados (RPC: valida el negocio y
    // devuelve los montos solo al admin)
    supabase.rpc('get_customer_sales_summary', { p_customer_id: customerId }),

    supabase
      .from('customer_notes')
      .select(`
        id, business_id, customer_id, staff_id, appointment_id, content, created_at,
        created_by, author_name,
        staff:staff_id ( full_name )
      `)
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false }),

    supabase
      .from('customer_tags')
      .select('tag')
      .eq('business_id', businessId)
      .eq('customer_id', customerId),

    supabase
      .from('staff')
      .select('id, full_name')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('full_name'),
  ])

  if (customerResult.error || !customerResult.data) return null
  const customer = customerResult.data as unknown as CustomerRecord

  // ── Resumen de compras (montos null para quien no es admin) ─────────────────
  if (salesSummaryResult.error) {
    console.error('[crm] get_customer_sales_summary', salesSummaryResult.error)
  }
  const summary = parseSalesSummary(salesSummaryResult.error ? null : salesSummaryResult.data)

  // ── Próximas citas ──────────────────────────────────────────────────────────
  type One<T> = T | T[] | null
  type UpcomingRow = {
    id: string
    start_time: string
    status: string
    services: One<{ name: string }>
    staff: One<{ full_name: string }>
  }
  const first = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

  const upcoming: CustomerUpcomingAppointment[] = ((upcomingResult.data ?? []) as unknown as UpcomingRow[]).map((a) => ({
    id:           a.id,
    start_time:   a.start_time,
    status:       a.status,
    service_name: first(a.services)?.name ?? 'Servicio',
    staff_name:   first(a.staff)?.full_name ?? null,
    products:     summary.upcoming_products.get(a.id) ?? [],
  }))
  const upcomingIds = new Set(upcoming.map((u) => u.id))

  // ── Historial (sin las próximas, que van en su propia sección) ──────────────
  type ApptRow = {
    id: string
    start_time: string
    status: string
    services: One<{ name: string }>
    staff: One<{ full_name: string }>
  }
  const visits: CustomerVisit[] = ((appointmentsResult.data ?? []) as unknown as ApptRow[])
    .filter((a) => !upcomingIds.has(a.id))
    .map((a) => ({
      id:           a.id,
      start_time:   a.start_time,
      status:       a.status,
      service_name: first(a.services)?.name ?? 'Servicio desconocido',
      staff_name:   first(a.staff)?.full_name ?? null,
      amount_paid:  summary.paid_by_appointment?.get(a.id) ?? null,
    }))

  // ── Productos comprados ─────────────────────────────────────────────────────
  const purchased_products: CustomerPurchasedProduct[] = summary.purchased_products

  // ── Notas ───────────────────────────────────────────────────────────────────
  type NoteRow = CustomerNote & {
    created_by: string | null
    author_name: string | null
    staff: One<{ full_name: string }>
  }
  const notes: CustomerNoteWithAuthor[] = ((notesResult.data ?? []) as unknown as NoteRow[]).map((n) => ({
    id:             n.id,
    business_id:    n.business_id,
    customer_id:    n.customer_id,
    staff_id:       n.staff_id,
    appointment_id: n.appointment_id,
    content:        n.content,
    created_at:     n.created_at,
    created_by:     n.created_by ?? null,
    author_name:    n.author_name ?? null,
    staff_name:     first(n.staff)?.full_name ?? null,
  }))

  const completedRows = (completedResult.data ?? []) as unknown as { start_time: string }[]
  const totalVisits = completedResult.count ?? completedRows.length

  return {
    customer,
    total_visits:       totalVisits,
    total_spent:        summary.total_spent,
    paid_sales:         summary.paid_sales,
    avg_ticket:         summary.avg_ticket,
    last_visit:         completedRows[0]?.start_time ?? null,
    tags:               (tagsResult.data ?? []).map((t) => (t as { tag: string }).tag),
    notes,
    visits,
    upcoming,
    purchased_products,
    staff_list:         (staffResult.data ?? []) as unknown as Pick<Staff, 'id' | 'full_name'>[],
  }
}

// ════════════════════════════════════════════════════════════════════════════
// addCustomerNote
// Autor = usuario de la sesión: created_by, author_name (perfil) y staff_id
// (ficha de barbero con user_id = usuario, o null para admins sin ficha).
// ════════════════════════════════════════════════════════════════════════════

export async function addCustomerNote(
  customerId:     string,
  content:        string,
  appointmentId?: string,
): Promise<ActionResult & { note?: CustomerNoteWithAuthor }> {
  const text = (content ?? '').trim()
  if (!text) return { error: 'El contenido de la nota no puede estar vacío.' }
  if (text.length > 1000) return { error: 'La nota no puede superar 1000 caracteres.' }

  const supabase = await createClient()
  const ctx = await getTenantContext(supabase)
  if (!ctx) return { error: NOT_AUTHENTICATED }

  if (!(await customerBelongsToBusiness(supabase, ctx.businessId, customerId))) {
    return { error: CUSTOMER_NOT_FOUND }
  }

  if (appointmentId) {
    const { data: appt } = await supabase
      .from('appointments')
      .select('id')
      .eq('business_id', ctx.businessId)
      .eq('customer_id', customerId)
      .eq('id', appointmentId)
      .maybeSingle()
    if (!appt) return { error: 'Cita no encontrada.' }
  }

  // staff.id del usuario (si tiene ficha de barbero)
  const { data: staffRow } = await supabase
    .from('staff')
    .select('id')
    .eq('business_id', ctx.businessId)
    .eq('user_id', ctx.userId)
    .maybeSingle()
  const staffId = (staffRow as { id?: string } | null)?.id ?? null

  const { data, error } = await supabase
    .from('customer_notes')
    .insert({
      business_id:    ctx.businessId,
      customer_id:    customerId,
      staff_id:       staffId,
      created_by:     ctx.userId,
      author_name:    ctx.fullName,
      appointment_id: appointmentId ?? null,
      content:        text,
    })
    .select(`
      id, business_id, customer_id, staff_id, appointment_id, content, created_at,
      created_by, author_name,
      staff:staff_id ( full_name )
    `)
    .single()

  if (error) return { error: error.message }

  type Row = CustomerNote & {
    created_by: string | null
    author_name: string | null
    staff: { full_name: string } | { full_name: string }[] | null
  }
  const row = data as unknown as Row
  const staffJoin = Array.isArray(row.staff) ? (row.staff[0] ?? null) : row.staff

  const note: CustomerNoteWithAuthor = {
    id:             row.id,
    business_id:    row.business_id,
    customer_id:    row.customer_id,
    staff_id:       row.staff_id ?? null,
    appointment_id: row.appointment_id ?? null,
    content:        row.content,
    created_at:     row.created_at,
    created_by:     row.created_by ?? ctx.userId,
    author_name:    row.author_name ?? ctx.fullName,
    staff_name:     staffJoin?.full_name ?? null,
  }

  revalidatePath('/[slug]/dashboard/crm', 'page')
  return { success: true, note }
}

// ════════════════════════════════════════════════════════════════════════════
// createCustomer / updateCustomer
// Cualquier rol del negocio puede crear/editar. businessId desde el perfil.
// ════════════════════════════════════════════════════════════════════════════

export async function createCustomer(
  input: CustomerInput,
): Promise<ActionResult & { customerId?: string }> {
  const validated = validateCustomerInput(input)
  if ('error' in validated) return { error: validated.error }
  const v = validated.value

  const supabase = await createClient()
  const ctx = await getTenantContext(supabase)
  if (!ctx) return { error: NOT_AUTHENTICATED }

  const { data: dup } = await supabase
    .from('customers')
    .select('id')
    .eq('business_id', ctx.businessId)
    .eq('phone', v.phone)
    .maybeSingle()
  if (dup) return { error: DUPLICATE_PHONE_ERROR }

  const { data, error } = await supabase
    .from('customers')
    .insert({
      business_id: ctx.businessId,
      full_name:   v.full_name,
      phone:       v.phone,
      email:       v.email,
      birthday:    v.birthday,
    })
    .select('id')
    .single()

  if (error) {
    return { error: error.code === '23505' ? DUPLICATE_PHONE_ERROR : error.message }
  }

  revalidatePath('/[slug]/dashboard/crm', 'page')
  return { success: true, customerId: (data as { id: string } | null)?.id }
}

export async function updateCustomer(
  customerId: string,
  input:      CustomerInput,
): Promise<ActionResult> {
  const validated = validateCustomerInput(input)
  if ('error' in validated) return { error: validated.error }
  const v = validated.value

  const supabase = await createClient()
  const ctx = await getTenantContext(supabase)
  if (!ctx) return { error: NOT_AUTHENTICATED }

  if (!(await customerBelongsToBusiness(supabase, ctx.businessId, customerId))) {
    return { error: CUSTOMER_NOT_FOUND }
  }

  const { data: dup } = await supabase
    .from('customers')
    .select('id')
    .eq('business_id', ctx.businessId)
    .eq('phone', v.phone)
    .neq('id', customerId)
    .maybeSingle()
  if (dup) return { error: DUPLICATE_PHONE_ERROR }

  const { error } = await supabase
    .from('customers')
    .update({
      full_name: v.full_name,
      phone:     v.phone,
      email:     v.email,
      birthday:  v.birthday,
    })
    .eq('business_id', ctx.businessId)
    .eq('id', customerId)

  if (error) {
    return { error: error.code === '23505' ? DUPLICATE_PHONE_ERROR : error.message }
  }

  revalidatePath('/[slug]/dashboard/crm', 'page')
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// updateCustomerTags
// Reemplaza todas las etiquetas del cliente (DELETE + INSERT).
// ════════════════════════════════════════════════════════════════════════════

export async function updateCustomerTags(
  customerId: string,
  tags:       string[],
): Promise<ActionResult> {
  const supabase = await createClient()
  const ctx = await getTenantContext(supabase)
  if (!ctx) return { error: NOT_AUTHENTICATED }
  const { businessId } = ctx

  if (!(await customerBelongsToBusiness(supabase, businessId, customerId))) {
    return { error: CUSTOMER_NOT_FOUND }
  }

  const { error: delError } = await supabase
    .from('customer_tags')
    .delete()
    .eq('business_id', businessId)
    .eq('customer_id', customerId)

  if (delError) return { error: delError.message }

  const uniqueTags = [...new Set(tags.map((t) => t.trim().slice(0, 40)).filter((t) => t.length > 0))]

  if (uniqueTags.length > 0) {
    const rows = uniqueTags.map((tag) => ({
      customer_id: customerId,
      business_id: businessId,
      tag,
    }))

    const { error: insError } = await supabase.from('customer_tags').insert(rows)
    if (insError) return { error: insError.message }
  }

  revalidatePath('/[slug]/dashboard/crm', 'page')
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// updateCustomerPreferences
// Barbero preferido (debe ser del mismo negocio). SOLO el administrador lo cambia: se exige aquí
// y también en la base (trigger trg_customers_preferred_staff_guard).
// ════════════════════════════════════════════════════════════════════════════

export async function updateCustomerPreferences(
  customerId: string,
  data:       { preferred_staff_id?: string | null },
): Promise<ActionResult> {
  const supabase = await createClient()
  const ctx = await getTenantContext(supabase)
  if (!ctx) return { error: NOT_AUTHENTICATED }
  const { businessId } = ctx
  if (ctx.role !== 'admin' && ctx.role !== 'super_admin') return { error: ADMIN_ONLY_PREFERRED }

  if (!(await customerBelongsToBusiness(supabase, businessId, customerId))) {
    return { error: CUSTOMER_NOT_FOUND }
  }

  const preferred = data.preferred_staff_id || null
  if (preferred) {
    const { data: staffRow } = await supabase
      .from('staff')
      .select('id')
      .eq('business_id', businessId)
      .eq('id', preferred)
      .maybeSingle()
    if (!staffRow) return { error: 'Barbero no encontrado.' }
  }

  const { error } = await supabase
    .from('customers')
    .update({ preferred_staff_id: preferred })
    .eq('id', customerId)
    .eq('business_id', businessId)

  if (error) {
    if (error.message === 'invalid_preferred_staff') return { error: 'Barbero no encontrado.' }
    return { error: error.message === 'admin_required' ? ADMIN_ONLY_PREFERRED : error.message }
  }

  revalidatePath('/[slug]/dashboard/crm', 'page')
  return { success: true }
}
