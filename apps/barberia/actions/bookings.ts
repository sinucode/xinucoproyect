'use server'

import { createClient, createAdminClient } from '@xinuco/supabase/server'
import { isValid, parseISO } from 'date-fns'
import { sendBookingConfirmation } from '@/lib/email/notifications'
import { Preference } from 'mercadopago'
import { getMPClient } from '@/lib/mercadopago/client'

// ── Tipos compartidos ─────────────────────────────────────────────────────────

export interface BookingData {
  full_name:   string
  phone:       string
  email?:      string | null
  service_id:  string
  staff_id:    string | null
  start_time:  string
  business_id: string
}

// ── RPC create_public_booking (SECURITY DEFINER) ─────────────────────────────
// El anon no puede escribir customers/appointments bajo RLS, así que la reserva
// pública pasa por esta RPC, que valida el slot y crea cliente + cita atómicamente.

interface PublicBookingRpcResult {
  appointment_id: string
  customer_id:    string
  staff_id:       string | null
}

const RPC_ERROR_MESSAGES: Record<string, string> = {
  slot_unavailable:   'Ese horario ya no está disponible. Elige otro.',
  service_not_found:  'El servicio no está disponible.',
  business_not_found: 'La barbería no está disponible.',
  missing_fields:     'Faltan datos obligatorios.',
}

async function callCreatePublicBooking(
  supabase: Awaited<ReturnType<typeof createClient>>,
  data: BookingData,
  status: 'scheduled' | 'payment_pending',
): Promise<
  | { ok: true; result: PublicBookingRpcResult }
  | { ok: false; error: { error: string; message: string } }
> {
  const { data: rpcData, error } = await supabase.rpc('create_public_booking', {
    p_business_id: data.business_id,
    p_service_id:  data.service_id,
    p_staff_id:    data.staff_id === 'any' || !data.staff_id ? null : data.staff_id,
    p_start_time:  data.start_time,
    p_full_name:   data.full_name,
    p_phone:       data.phone,
    p_email:       data.email || null,
    p_status:      status,
  })

  if (error) {
    const known = Object.keys(RPC_ERROR_MESSAGES).find((k) => error.message?.includes(k))
    if (known) return { ok: false, error: { error: known, message: RPC_ERROR_MESSAGES[known] } }
    console.error('create_public_booking failed:', error)
    return { ok: false, error: { error: 'db_error', message: 'No pudimos crear la cita. Inténtalo de nuevo.' } }
  }

  const result = rpcData as PublicBookingRpcResult | null
  if (!result?.appointment_id) {
    console.error('create_public_booking returned no appointment:', rpcData)
    return { ok: false, error: { error: 'db_error', message: 'No pudimos crear la cita. Inténtalo de nuevo.' } }
  }
  return { ok: true, result }
}

// ── createBooking — reserva directa sin pago online ──────────────────────────

export async function createBooking(bookingData: BookingData) {
  const supabase = await createClient()

  if (!bookingData.phone?.trim()) {
    return { error: 'validation_error', message: 'El teléfono es requerido.' }
  }
  if (!isValid(parseISO(bookingData.start_time))) {
    return { error: 'validation_error', message: 'La fecha/hora de inicio no es válida.' }
  }

  const { business_id } = bookingData

  const rpc = await callCreatePublicBooking(supabase, bookingData, 'scheduled')
  if (!rpc.ok) return rpc.error
  const { appointment_id, customer_id } = rpc.result

  // Notificación (best-effort). Cliente service-role: el anon no puede leer de
  // vuelta la cita/cliente bajo RLS.
  try {
    const admin = await createAdminClient()
    await sendBookingConfirmation({ supabase: admin, businessId: business_id,
      appointmentId: appointment_id, customerId: customer_id })
  } catch { /* silenciar */ }

  return { success: true, appointment_id, customer_id }
}

// ── createBookingWithPayment — reserva + pago online con MercadoPago ─────────
//
// Flujo:
//  1-2. RPC create_public_booking: cliente + cita con status 'payment_pending'
//  3. Crea preferencia MP con external_reference = 'booking_{appointmentId}'
//  4. Guarda registro en mp_payments (status: pending)
//  5. Devuelve QR + link al wizard para mostrárselo al cliente
//
// El webhook /api/webhooks/mercadopago detecta el prefix 'booking_' y
// actualiza el appointment a 'scheduled' cuando el pago es aprobado.

export interface BookingWithPaymentResult {
  appointment_id:     string
  customer_id:        string
  preference_id:      string
  init_point:         string   // URL/QR activo (sandbox en test, producción en live)
  sandbox_init_point: string
  qr_url:             string
  mp_payment_db_id:   string
  is_test_mode:       boolean
  service_name:       string
  service_price_cop:  number
}

export async function createBookingWithPayment(
  bookingData: BookingData & { service_name: string; service_price_cop: number }
): Promise<{ data: BookingWithPaymentResult } | { error: string; message: string }> {

  const supabase = await createClient()
  const {
    full_name, phone, email, service_id, staff_id, start_time, business_id,
    service_name, service_price_cop,
  } = bookingData

  // ── Validaciones ──────────────────────────────────────────────────────────
  if (!phone?.trim()) return { error: 'validation_error', message: 'El teléfono es requerido.' }
  if (!isValid(parseISO(start_time))) return { error: 'validation_error', message: 'Fecha/hora inválida.' }
  if (!process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN === 'APP_USR-...') {
    return { error: 'mp_not_configured', message: 'MercadoPago no está configurado en este negocio.' }
  }

  // ── 1-2. Cliente + cita en estado payment_pending (RPC atómica) ────────────
  const rpc = await callCreatePublicBooking(supabase, bookingData, 'payment_pending')
  if (!rpc.ok) return rpc.error
  const { appointment_id: appointmentId, customer_id: customerId } = rpc.result

  const externalRef    = `booking_${appointmentId}`   // prefijo que el webhook detecta
  const appUrl         = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.xinuco.com'
  const isTestMode     = (process.env.MP_ACCESS_TOKEN ?? '').startsWith('TEST-')

  // ── 3. Crear preferencia en MercadoPago ───────────────────────────────────
  try {
    const preferenceApi = new Preference(getMPClient())
    const mpResult = await preferenceApi.create({
      body: {
        items: [{
          id:          service_id,
          title:       service_name,
          description: `Cita: ${service_name} — ${start_time.split('T')[0]} ${start_time.split('T')[1]?.substring(0, 5)}`,
          quantity:    1,
          unit_price:  service_price_cop,
          currency_id: 'COP',
        }],
        payer:              email ? { email } : undefined,
        external_reference: externalRef,
        back_urls: {
          success: `${appUrl}/book/result?status=success&ref=${externalRef}`,
          failure: `${appUrl}/book/result?status=failure&ref=${externalRef}`,
          pending: `${appUrl}/book/result?status=pending&ref=${externalRef}`,
        },
        auto_return:          'approved',
        notification_url:     `${appUrl}/api/webhooks/mercadopago`,
        statement_descriptor: 'XINUCO CITA',
        metadata: {
          business_id:    business_id,
          appointment_id: appointmentId,
          customer_id:    customerId,
          booking_flow:   true,
        },
      },
    })

    const preferenceId     = mpResult.id!
    const initPoint        = (isTestMode ? mpResult.sandbox_init_point : mpResult.init_point) ?? ''
    const sandboxInitPoint = mpResult.sandbox_init_point ?? ''
    const qrUrl            = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(initPoint)}`

    // ── 4. Guardar registro mp_payments (pending) ───────────────────────────
    // Service-role: el anon no puede insertar en mp_payments.
    const admin = await createAdminClient()
    const { data: mpRow } = await admin
      .from('mp_payments')
      .insert({
        business_id,
        appointment_id:     appointmentId,
        mp_preference_id:   preferenceId,
        mp_status:          'pending',
        payment_method:     'qr',
        gross_amount_cop:   service_price_cop,
        fee_amount_cop:     0,
        net_amount_cop:     service_price_cop,
        fee_rate_bp:        0,
        external_reference: externalRef,
      })
      .select('id')
      .single() as { data: { id: string } | null }

    return {
      data: {
        appointment_id:     appointmentId,
        customer_id:        customerId,
        preference_id:      preferenceId,
        init_point:         initPoint,
        sandbox_init_point: sandboxInitPoint,
        qr_url:             qrUrl,
        mp_payment_db_id:   mpRow?.id ?? '',
        is_test_mode:       isTestMode,
        service_name,
        service_price_cop,
      },
    }
  } catch (err) {
    // MP falló — revertir la cita a cancelada para no dejar citas huérfanas
    // (service-role: el anon no puede actualizar citas bajo RLS)
    const adminForRevert = await createAdminClient()
    await adminForRevert.from('appointments')
      .update({ status: 'cancelled' as const })
      .eq('id', appointmentId)

    const msg = err instanceof Error ? err.message : 'Error creando preferencia de pago.'
    return { error: 'mp_error', message: msg }
  }
}
