// lib/email/notifications.ts — Xinuco RF18: Funciones de alto nivel para notificaciones por correo
// Todas las funciones son best-effort: nunca lanzan, nunca bloquean la operación principal.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@xinuco/types'
import { formatCOP }                        from '@xinuco/utils'
import { sendEmail }                       from './resend'
import {
  appointmentConfirmationEmail,
  appointmentReminderEmail,
  appointmentCancellationEmail,
  recurringExpenseReminderEmail,
  teamPaymentReceiptEmail,
  type EmailBrand,
} from './templates'
import { maskEmail } from '@/lib/team-utils'
import {
  formatMoneyPlain,
  receiptBreakdown,
  type LedgerEntryLike,
  type TeamReceiptResult,
} from '@/lib/team-payments'

// ── Tipo de cliente Supabase tipado con el esquema de Xinuco ─────────────────
type XinucoSupabase = SupabaseClient<Database>

// ── Tipo del log de notificaciones ──────────────────────────────────────────
type NotificationType = 'confirmation' | 'reminder' | 'cancellation'

// ── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Verifica si el negocio tiene la feature `notifications_email` habilitada
 * (vía RPC get_public_business, que expone el flag como `email_notifications`).
 * Retorna false si hay cualquier error (seguro para best-effort).
 */
async function isEmailEnabled(
  supabase: XinucoSupabase,
  businessId: string,
): Promise<boolean> {
  if (!businessId) return false
  const { data } = await (supabase as any)
    .rpc('get_public_business', { p_id: businessId })
    .maybeSingle() as { data: { email_notifications: boolean } | null }

  return data?.email_notifications === true
}

/**
 * Carga los datos de la cita junto con cliente, servicio y staff en un solo join.
 */
async function loadAppointmentData(supabase: XinucoSupabase, appointmentId: string) {
  const { data } = await supabase
    .from('appointments')
    .select(`
      id,
      start_time,
      service_id,
      staff_id,
      customer_id,
      business_id,
      public_token,
      customers!inner ( full_name, email ),
      services!inner  ( name, duration_minutes, price_cop ),
      staff            ( full_name )
    `)
    .eq('id', appointmentId)
    .returns<any[]>()
    .single()

  return data
}

// Base pública de las reservas (el correo siempre enlaza a producción).
const PUBLIC_SITE_URL = 'https://www.xinuco.com'

/**
 * Nombre + marca del negocio para los correos: logo y color principal de
 * brand_config (fuente de verdad) con respaldo en branding.
 */
async function loadBusinessBrand(
  supabase: XinucoSupabase,
  businessId: string,
  publicToken?: string | null,
): Promise<{ business: { name: string; slug: string } | null; brand: EmailBrand | undefined; cancelUrl: string | null }> {
  const { data } = await (supabase as any)
    .rpc('get_public_business', { p_id: businessId })
    .maybeSingle() as {
      data: {
        name: string
        slug: string
        branding: { logo_url?: string | null; primary_color?: string | null } | null
        brand_config: { logoUrl?: string | null; primaryColor?: string | null } | null
      } | null
    }
  if (!data) return { business: null, brand: undefined, cancelUrl: null }

  return {
    business: { name: data.name, slug: data.slug },
    brand: {
      name:         data.name,
      logoUrl:      data.brand_config?.logoUrl ?? data.branding?.logo_url ?? null,
      primaryColor: data.brand_config?.primaryColor ?? data.branding?.primary_color ?? null,
      bookingUrl:   `${PUBLIC_SITE_URL}/${data.slug}/book`,
    },
    // Enlace privado (token) para que el cliente cancele desde el correo.
    cancelUrl: publicToken ? `${PUBLIC_SITE_URL}/${data.slug}/cancelar/${publicToken}` : null,
  }
}

/**
 * Productos apartados al reservar (best-effort: [] si falla).
 */
async function loadReservedProducts(
  supabase: XinucoSupabase,
  appointmentId: string,
): Promise<{ name: string; quantity: number; unitPrice: number }[]> {
  try {
    const { data } = await (supabase as any)
      .from('appointment_products')
      .select('quantity, unit_price, inventory_items(name)')
      .eq('appointment_id', appointmentId) as {
        data: { quantity: number; unit_price: number; inventory_items: { name: string } | { name: string }[] | null }[] | null
      }
    return (data ?? []).map((row) => {
      const inv = Array.isArray(row.inventory_items) ? row.inventory_items[0] : row.inventory_items
      return { name: inv?.name ?? 'Producto', quantity: row.quantity, unitPrice: row.unit_price }
    })
  } catch {
    return []
  }
}

/**
 * Registra el intento de envío en la tabla notification_log (best-effort).
 */
async function logNotification(
  supabase: XinucoSupabase,
  params: {
    businessId:       string
    appointmentId:    string | null
    notificationType: NotificationType
    recipientEmail:   string | null
    status:           'sent' | 'failed'
    errorMessage?:    string
  },
): Promise<void> {
  try {
    await (supabase as any).from('notification_log').insert({
      business_id:       params.businessId,
      appointment_id:    params.appointmentId,
      notification_type: params.notificationType,
      channel:           'email',
      recipient_email:   params.recipientEmail,
      status:            params.status,
      error_message:     params.errorMessage ?? null,
    })
  } catch {
    // Silenciar — el log nunca bloquea la operación principal
  }
}

// ── 1. Confirmación de reserva ────────────────────────────────────────────────

export async function sendBookingConfirmation(params: {
  supabase:      XinucoSupabase
  businessId:    string
  appointmentId: string
  customerId:    string
}): Promise<void> {
  const { supabase, businessId, appointmentId } = params

  // 1. Feature flag
  if (!(await isEmailEnabled(supabase, businessId))) return

  // 2. Cargar datos de la cita
  const appt = await loadAppointmentData(supabase, appointmentId)
  if (!appt) return

  // La relación puede venir como array o como objeto dependiendo del join
  const customer = Array.isArray(appt.customers) ? appt.customers[0] : appt.customers
  const service  = Array.isArray(appt.services)  ? appt.services[0]  : appt.services
  const staff    = Array.isArray(appt.staff)      ? appt.staff[0]     : appt.staff

  if (!customer?.email) return

  // 3. Cargar nombre y marca del negocio
  const { business, brand, cancelUrl } = await loadBusinessBrand(supabase, businessId, appt.public_token)

  // 3b. Productos apartados al reservar
  const reservedProducts = await loadReservedProducts(supabase, appointmentId)

  // 4. Construir y enviar el correo
  const html = appointmentConfirmationEmail({
    customerName:    customer.full_name,
    businessName:    business?.name ?? 'Xinuco',
    serviceName:     service.name,
    staffName:       staff?.full_name ?? null,
    startTime:       appt.start_time ?? new Date().toISOString(),
    durationMinutes: service.duration_minutes,
    priceCop:        service.price_cop,
    reservedProducts,
    brand,
    cancelUrl,
  })

  const result = await sendEmail({
    to:      customer.email,
    subject: `Confirmación de cita — ${business?.name ?? 'Xinuco'}`,
    html,
  })

  // 5. Registrar en el log
  await logNotification(supabase, {
    businessId,
    appointmentId,
    notificationType: 'confirmation',
    recipientEmail:   customer.email,
    status:           result.success ? 'sent' : 'failed',
    errorMessage:     result.error,
  })
}

// ── 2. Recordatorio 24 h antes ────────────────────────────────────────────────

export async function sendBookingReminder(params: {
  supabase:      XinucoSupabase
  businessId:    string
  appointmentId: string
}): Promise<void> {
  const { supabase, businessId, appointmentId } = params

  // 1. Feature flag
  if (!(await isEmailEnabled(supabase, businessId))) return

  // 2. Cargar datos de la cita
  const appt = await loadAppointmentData(supabase, appointmentId)
  if (!appt) return

  const customer = Array.isArray(appt.customers) ? appt.customers[0] : appt.customers
  const service  = Array.isArray(appt.services)  ? appt.services[0]  : appt.services
  const staff    = Array.isArray(appt.staff)      ? appt.staff[0]     : appt.staff

  if (!customer?.email) return

  // 3. Cargar nombre y marca del negocio
  const { business, brand, cancelUrl } = await loadBusinessBrand(supabase, businessId, appt.public_token)

  // 4. Construir y enviar el correo
  const html = appointmentReminderEmail({
    customerName:  customer.full_name,
    businessName:  business?.name ?? 'Xinuco',
    serviceName:   service.name,
    staffName:     staff?.full_name ?? null,
    startTime:     appt.start_time ?? new Date().toISOString(),
    reservedProducts: await loadReservedProducts(supabase, appointmentId),
    brand,
    cancelUrl,
  })

  const result = await sendEmail({
    to:      customer.email,
    subject: `Recordatorio: tu cita es mañana — ${business?.name ?? 'Xinuco'}`,
    html,
  })

  // 5. Registrar en el log
  await logNotification(supabase, {
    businessId,
    appointmentId,
    notificationType: 'reminder',
    recipientEmail:   customer.email,
    status:           result.success ? 'sent' : 'failed',
    errorMessage:     result.error,
  })
}

// ── 3. Aviso de cancelación ───────────────────────────────────────────────────

export async function sendCancellationNotice(params: {
  supabase:      XinucoSupabase
  businessId:    string
  appointmentId: string
  reason?:       string | null
}): Promise<void> {
  const { supabase, businessId, appointmentId, reason } = params

  // 1. Feature flag
  if (!(await isEmailEnabled(supabase, businessId))) return

  // 2. Cargar datos de la cita
  const appt = await loadAppointmentData(supabase, appointmentId)
  if (!appt) return

  const customer = Array.isArray(appt.customers) ? appt.customers[0] : appt.customers
  const service  = Array.isArray(appt.services)  ? appt.services[0]  : appt.services

  if (!customer?.email) return

  // 3. Cargar nombre y marca del negocio
  const { business, brand } = await loadBusinessBrand(supabase, businessId)

  // 4. Construir y enviar el correo
  const html = appointmentCancellationEmail({
    customerName: customer.full_name,
    businessName: business?.name ?? 'Xinuco',
    serviceName:  service.name,
    startTime:    appt.start_time ?? new Date().toISOString(),
    reason,
    brand,
  })

  const result = await sendEmail({
    to:      customer.email,
    subject: `Tu cita ha sido cancelada — ${business?.name ?? 'Xinuco'}`,
    html,
  })

  // 5. Registrar en el log
  await logNotification(supabase, {
    businessId,
    appointmentId,
    notificationType: 'cancellation',
    recipientEmail:   customer.email,
    status:           result.success ? 'sent' : 'failed',
    errorMessage:     result.error,
  })
}

// ── 4. Aviso de gastos fijos que vencen mañana (a los administradores) ─────────

/**
 * Correos de los administradores del negocio (profiles.role = 'admin'), leídos de Auth.
 * Requiere cliente service-role (auth.admin). Best-effort: devuelve [] si algo falla.
 */
export async function loadAdminEmails(supabase: XinucoSupabase, businessId: string): Promise<string[]> {
  try {
    const { data: admins } = await (supabase as any)
      .from('profiles')
      .select('id')
      .eq('business_id', businessId)
      .eq('role', 'admin') as { data: { id: string }[] | null }

    const emails = new Set<string>()
    for (const admin of admins ?? []) {
      const { data } = await (supabase as any).auth.admin.getUserById(admin.id)
      const email = data?.user?.email as string | undefined
      if (email) emails.add(email)
    }
    return [...emails]
  } catch {
    return []
  }
}

/** Formatea 'YYYY-MM-DD' como '30 de septiembre' para el asunto y el cuerpo. */
function formatDueDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('es-CO', {
    day: 'numeric', month: 'long', timeZone: 'UTC',
  })
}

/**
 * Un correo por negocio a sus administradores: "Mañana vence: Arriendo · $1.500.000".
 * Best-effort: nunca lanza. Sin RESEND_API_KEY solo deja el registro en consola.
 */
export async function sendRecurringExpenseReminder(params: {
  supabase:   XinucoSupabase
  businessId: string
  /** Día en que vencen (mañana) 'YYYY-MM-DD'. */
  dueDate:    string
  items:      { description: string; categoryName: string; amount: number }[]
}): Promise<{ recipients: number; sent: number }> {
  const { supabase, businessId, dueDate, items } = params
  if (items.length === 0) return { recipients: 0, sent: 0 }

  try {
    const emails = await loadAdminEmails(supabase, businessId)
    if (emails.length === 0) return { recipients: 0, sent: 0 }

    if (!process.env.RESEND_API_KEY) {
      console.info(
        `[recurring-expenses] RESEND_API_KEY no configurada: aviso omitido ` +
        `(negocio=${businessId}, gastos=${items.length}, destinatarios=${emails.length})`,
      )
      return { recipients: emails.length, sent: 0 }
    }

    const { business, brand } = await loadBusinessBrand(supabase, businessId)
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || PUBLIC_SITE_URL).replace(/\/+$/, '')
    const expensesUrl = business?.slug ? `${appUrl}/${business.slug}/dashboard/expenses` : appUrl

    const html = recurringExpenseReminderEmail({
      businessName: business?.name ?? 'Xinuco',
      dueDate,
      items,
      expensesUrl,
      brand,
    })
    const subject = items.length === 1
      ? `Mañana vence: ${items[0].description} · ${formatCOP(items[0].amount)}`
      : `Mañana vencen ${items.length} gastos fijos`

    let sent = 0
    for (const to of emails) {
      const result = await sendEmail({ to, subject, html })
      if (result.success) sent++
    }
    console.info(
      `[recurring-expenses] Aviso ${formatDueDate(dueDate)}: negocio=${businessId} ` +
      `gastos=${items.length} enviados=${sent}/${emails.length}`,
    )
    return { recipients: emails.length, sent }
  } catch (err) {
    console.error('[recurring-expenses] Error enviando el aviso:', err)
    return { recipients: 0, sent: 0 }
  }
}

// ── 5. Recibo de anticipo / pago al profesional ────────────────────────────────

/**
 * Cliente con service role (bypass RLS, necesario para leer el correo de Auth de un usuario).
 * null si faltan las variables de entorno. Solo para uso en el servidor.
 */
export function createServiceClient(): XinucoSupabase | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/**
 * Correo del profesional: el suyo (staff.email) o, si no tiene, el del usuario vinculado
 * (staff.user_id → Auth). Requiere cliente service-role. Best-effort: null si algo falla.
 */
export async function resolveStaffEmail(
  service: XinucoSupabase,
  staff: { email?: string | null; user_id?: string | null },
): Promise<string | null> {
  const own = staff.email?.trim()
  if (own) return own
  if (!staff.user_id) return null
  try {
    const { data } = await (service as any).auth.admin.getUserById(staff.user_id)
    const email = (data?.user?.email as string | undefined)?.trim()
    return email || null
  } catch {
    return null
  }
}

const RECEIPT_METHOD_LABELS: Record<string, string> = {
  cash_register: 'Efectivo',
  transfer:      'Transferencia',
  other:         'Otro',
}

/** '29 de septiembre de 2026, 3:45 p. m.' en hora de Colombia. */
function formatReceiptDateTime(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso))
}

const RECEIPT_FETCH_SIZE = 1000
const RECEIPT_MAX_PAGES  = 50

/**
 * Envía al profesional el recibo de un anticipo o el comprobante de un pago.
 * Lo carga todo en el servidor con service role (el correo de Auth no es legible con RLS).
 * `businessId`, si se pasa, se contrasta con el del movimiento (defensa en profundidad).
 * Best-effort: nunca lanza; devuelve { sent, to (enmascarado), reason }.
 */
export async function sendTeamPaymentReceipt(params: {
  entryId:     string
  businessId?: string
}): Promise<TeamReceiptResult> {
  try {
    const service = createServiceClient()
    if (!service) {
      console.error('[team-receipt] Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
      return { sent: false, reason: 'error' }
    }
    const db = service as any

    // 1. El movimiento (solo anticipos y pagos llevan recibo)
    const { data: entry } = await db
      .from('staff_ledger')
      .select('id, business_id, staff_id, entry_type, amount, notes, payment_method, period_from, period_to, created_at, created_by')
      .eq('id', params.entryId)
      .maybeSingle() as {
        data: {
          id: string; business_id: string; staff_id: string; entry_type: string; amount: number
          notes: string | null; payment_method: string | null; period_from: string | null
          period_to: string | null; created_at: string; created_by: string | null
        } | null
      }
    if (!entry) return { sent: false, reason: 'error' }
    if (entry.entry_type !== 'advance' && entry.entry_type !== 'payment') return { sent: false, reason: 'error' }
    if (params.businessId && params.businessId !== entry.business_id) return { sent: false, reason: 'error' }
    const businessId = entry.business_id

    // 2. El profesional (del mismo negocio del movimiento) y a dónde enviarle el recibo
    const { data: staff } = await db
      .from('staff')
      .select('id, full_name, email, user_id')
      .eq('id', entry.staff_id)
      .eq('business_id', businessId)
      .maybeSingle() as { data: { id: string; full_name: string; email: string | null; user_id: string | null } | null }
    if (!staff) return { sent: false, reason: 'error' }

    const to = await resolveStaffEmail(service, staff)
    if (!to) return { sent: false, reason: 'no_email' }

    // 3. El negocio debe tener los correos habilitados
    if (!(await isEmailEnabled(service, businessId))) return { sent: false, reason: 'email_disabled' }

    // 4. Movimientos del profesional hasta este (para el saldo y el desglose del pago)
    const entries: LedgerEntryLike[] = []
    for (let page = 0; page < RECEIPT_MAX_PAGES; page++) {
      const { data, error } = await db
        .from('staff_ledger')
        .select('id, entry_type, amount, created_at, sale_item:sale_item_id(item_type)')
        .eq('business_id', businessId)
        .eq('staff_id', staff.id)
        .lte('created_at', entry.created_at)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(page * RECEIPT_FETCH_SIZE, page * RECEIPT_FETCH_SIZE + RECEIPT_FETCH_SIZE - 1)
      if (error) {
        console.error('[team-receipt] Error leyendo movimientos:', error.message)
        return { sent: false, reason: 'error' }
      }
      const batch = (data ?? []) as {
        id: string; entry_type: LedgerEntryLike['entry_type']; amount: number; created_at: string
        sale_item: { item_type: string | null } | { item_type: string | null }[] | null
      }[]
      for (const r of batch) {
        const item = Array.isArray(r.sale_item) ? r.sale_item[0] : r.sale_item
        entries.push({
          id: r.id, entry_type: r.entry_type, amount: r.amount, created_at: r.created_at,
          item_type: item?.item_type === 'product' ? 'product' : item?.item_type === 'service' ? 'service' : null,
        })
      }
      if (batch.length < RECEIPT_FETCH_SIZE) break
    }
    const breakdown = receiptBreakdown(entries, entry.id)
    if (!breakdown) return { sent: false, reason: 'error' }

    // 5. Marca del negocio y quién lo registró
    const { business, brand } = await loadBusinessBrand(service, businessId)
    const businessName = business?.name ?? 'Xinuco'

    let adminName: string | null = null
    if (entry.created_by) {
      const { data: admin } = await db
        .from('profiles')
        .select('full_name')
        .eq('id', entry.created_by)
        .eq('business_id', businessId)
        .maybeSingle() as { data: { full_name: string | null } | null }
      adminName = admin?.full_name?.trim() || null
    }

    // 6. Construir y enviar
    const kind = entry.entry_type as 'advance' | 'payment'
    const html = teamPaymentReceiptEmail({
      kind,
      businessName,
      staffName:     staff.full_name,
      amount:        entry.amount,
      dateTime:      formatReceiptDateTime(entry.created_at),
      methodLabel:   RECEIPT_METHOD_LABELS[entry.payment_method ?? ''] ?? 'Otro',
      notes:         entry.notes,
      periodFrom:    kind === 'payment' ? entry.period_from : null,
      periodTo:      kind === 'payment' ? entry.period_to : null,
      lines:         breakdown.lines,
      balanceAfter:  breakdown.balanceAfter,
      receiptNumber: entry.id.slice(0, 8).toUpperCase(),
      adminName,
      brand,
    })
    const subject = `${kind === 'payment' ? 'Comprobante de pago' : 'Recibo de anticipo'} · ${formatMoneyPlain(entry.amount)} · ${businessName}`

    const result = await sendEmail({ to, subject, html })
    if (!result.success) return { sent: false, reason: 'error' }

    console.info(`[team-receipt] Enviado: negocio=${businessId} movimiento=${entry.id} tipo=${kind}`)
    return { sent: true, to: maskEmail(to) }
  } catch (err) {
    console.error('[team-receipt] Error enviando el recibo:', err)
    return { sent: false, reason: 'error' }
  }
}
