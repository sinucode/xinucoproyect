'use server'

import { createClient } from '@xinuco/supabase/server'
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

// ── createBooking — reserva directa sin pago online ──────────────────────────

export async function createBooking(bookingData: BookingData) {
  const supabase = await createClient()

  if (!bookingData.phone?.trim()) {
    return { error: 'validation_error', message: 'El teléfono es requerido.' }
  }
  if (!isValid(parseISO(bookingData.start_time))) {
    return { error: 'validation_error', message: 'La fecha/hora de inicio no es válida.' }
  }

  const { full_name, phone, email, service_id, staff_id, start_time, business_id } = bookingData

  // Upsert cliente
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .upsert({ business_id, phone, full_name, email: email || null },
             { onConflict: 'business_id,phone' })
    .select('id')
    .single()

  if (customerError || !customer) {
    return { error: 'db_error', message: `Error en registro de cliente: ${customerError?.message}` }
  }

  // Insertar cita
  const { data: appointment, error: appointmentError } = await supabase
    .from('appointments')
    .insert({
      business_id,
      customer_id: customer.id,
      service_id,
      staff_id: staff_id === 'any' ? null : staff_id,
      start_time,
      status: 'scheduled' as const,
      notes: null,
    })
    .select('id')
    .single()

  if (appointmentError) {
    return { error: 'db_error', message: `Error al crear la cita: ${appointmentError.message}` }
  }

  // Notificación (best-effort)
  try {
    await sendBookingConfirmation({ supabase, businessId: business_id,
      appointmentId: appointment.id, customerId: customer.id })
  } catch { /* silenciar */ }

  return { success: true, appointment_id: appointment.id, customer_id: customer.id }
}

// ── createBookingWithPayment — reserva + pago online con MercadoPago ─────────
//
// Flujo:
//  1. Upsert cliente
//  2. Crea cita con status 'payment_pending'
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

  // ── 1. Upsert cliente ──────────────────────────────────────────────────────
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .upsert({ business_id, phone, full_name, email: email || null },
             { onConflict: 'business_id,phone' })
    .select('id')
    .single()

  if (customerError || !customer) {
    return { error: 'db_error', message: `Error de cliente: ${customerError?.message}` }
  }

  // ── 2. Crear cita en estado payment_pending ────────────────────────────────
  const { data: appointment, error: appointmentError } = await supabase
    .from('appointments')
    .insert({
      business_id,
      customer_id: customer.id,
      service_id,
      staff_id: staff_id === 'any' ? null : staff_id,
      start_time,
      status: 'payment_pending' as const,
      notes: null,
    })
    .select('id')
    .single()

  if (appointmentError) {
    return { error: 'db_error', message: `Error al crear la cita: ${appointmentError.message}` }
  }

  const appointmentId  = appointment.id
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
          customer_id:    customer.id,
          booking_flow:   true,
        },
      },
    })

    const preferenceId     = mpResult.id!
    const initPoint        = (isTestMode ? mpResult.sandbox_init_point : mpResult.init_point) ?? ''
    const sandboxInitPoint = mpResult.sandbox_init_point ?? ''
    const qrUrl            = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(initPoint)}`

    // ── 4. Guardar registro mp_payments (pending) ───────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: mpRow } = await (supabase as any)
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
        customer_id:        customer.id,
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
    await supabase.from('appointments')
      .update({ status: 'cancelled' as const })
      .eq('id', appointmentId)

    const msg = err instanceof Error ? err.message : 'Error creando preferencia de pago.'
    return { error: 'mp_error', message: msg }
  }
}
