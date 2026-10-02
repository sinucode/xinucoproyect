// app/api/webhooks/mercadopago/route.ts
// ══════════════════════════════════════════════════════════════════════════════
// Webhook handler de MercadoPago.
//
// MP envía notificaciones para eventos: payment.created, payment.updated,
// preapproval (suscripciones SaaS).
//
// SEGURIDAD (fixes aplicados 2026-05-25):
//  - MP_WEBHOOK_SECRET es OBLIGATORIO. El endpoint devuelve 500 al arrancar
//    si la variable no está definida — nunca procesa sin firma verificada.
//  - En handlePreapproval se cruza el preapprovalId con mp_subscriptions
//    para evitar forgery via external_reference manipulado.
//  - Usa service role de Supabase — bypass RLS solo en rutas verificadas.
// ══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { Payment, PreApproval, WebhookSignatureValidator } from 'mercadopago'
import { getMPClient } from '@/lib/mercadopago/client'
import { calculateMPFee } from '@/lib/mercadopago/fees'
import type { MPPaymentMethod } from '@/lib/mercadopago/types'
import { PLAN_BUNDLES, PLAN_PRICES_COP, type PlanName } from '@xinuco/billing-catalog'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// ── Mapeo de payment_type_id de MP → MPPaymentMethod interno ─────────────────
const MP_METHOD_MAP: Record<string, MPPaymentMethod> = {
  credit_card:   'credit_card',
  debit_card:    'debit_card',
  bank_transfer: 'pse',        // PSE en Colombia
  account_money: 'nequi',      // Nequi / Daviplata usan account_money
  ticket:        'efecty',
}

function mapMPMethod(typeId: string | undefined): MPPaymentMethod {
  if (!typeId) return 'qr'
  return MP_METHOD_MAP[typeId] ?? 'qr'
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── [SEC C-1] MP_WEBHOOK_SECRET es OBLIGATORIO ────────────────────────────
  // Nunca se procesa un evento sin verificar la firma HMAC-SHA256.
  // Si la variable no está configurada, el servicio responde 500 para que
  // el operador lo detecte antes de llegar a producción.
  const webhookSecret = process.env.MP_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[MP webhook] CRÍTICO: MP_WEBHOOK_SECRET no está configurado. Endpoint deshabilitado.')
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 500 })
  }

  // ── 1. Leer body como texto para validación de firma ──────────────────────
  const body = await req.text()

  // ── 2. Validar firma HMAC-SHA256 (SIEMPRE requerida) ─────────────────────
  try {
    const xSignature = req.headers.get('x-signature') ?? ''
    const xRequestId = req.headers.get('x-request-id') ?? ''

    // El WebhookSignatureValidator de MP v3 requiere: signature, requestId, dataId
    const payload = JSON.parse(body) as { data?: { id?: string } }
    const dataId  = payload?.data?.id ?? ''

    // validate() es estático en MP v3 — lanza InvalidWebhookSignatureError si falla
    WebhookSignatureValidator.validate({
      xSignature: xSignature,
      xRequestId: xRequestId,
      dataId,
      secret:     webhookSecret,
    })
  } catch (err) {
    // InvalidWebhookSignatureError o cualquier otro error de validación
    console.warn('[MP webhook] Firma inválida — request rechazado:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  // ── 3. Parsear evento ─────────────────────────────────────────────────────
  let event: { type?: string; action?: string; data?: { id?: string } }
  try {
    event = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  // ── Dispatcher: payment vs preapproval ───────────────────────────────────────
  if (!event.data?.id) {
    return NextResponse.json({ status: 'ignored' })
  }

  // ── Evento de suscripción SaaS (preapproval) ──────────────────────────────
  if (event.type === 'preapproval') {
    return handlePreapproval(String(event.data.id))
  }

  // Solo procesar eventos de pago a partir de aquí
  if (event.type !== 'payment') {
    return NextResponse.json({ status: 'ignored' })
  }

  const mpPaymentId = String(event.data.id)

  // ── 4. Obtener detalles del pago desde la API de MP ───────────────────────
  try {
    const client     = getMPClient()
    const paymentApi = new Payment(client)
    const mpPayment  = await paymentApi.get({ id: mpPaymentId })

    const mpStatus     = mpPayment.status ?? 'pending'
    const externalRef  = mpPayment.external_reference ?? ''
    const methodTypeId = mpPayment.payment_type_id ?? ''
    const mpMethod     = mapMPMethod(methodTypeId)
    const grossAmount  = Math.round(mpPayment.transaction_amount ?? 0)
    const mpNetAmount  = Math.round(mpPayment.transaction_details?.net_received_amount ?? grossAmount)

    // ── 5. Recalcular fee localmente (gross - net del response de MP) ─────────
    let feeAmountCop = grossAmount - mpNetAmount
    let feeRateBp    = grossAmount > 0 ? Math.round((feeAmountCop * 10_000) / grossAmount) : 0
    let netAmountCop = mpNetAmount

    // Fallback: si MP no reporta el neto, calculamos con nuestra tabla
    if (feeAmountCop === 0 && grossAmount > 0) {
      const breakdown = calculateMPFee(grossAmount, mpMethod)
      feeAmountCop = breakdown.fee_amount_cop
      feeRateBp    = breakdown.effective_rate_bp
      netAmountCop = breakdown.net_amount_cop
    }

    // ── 6. Actualizar mp_payments usando service role (bypass RLS) ────────────
    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    // mp_payments no está en el tipo generado de Supabase — cast necesario
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mpTable = supabase.from('mp_payments' as any)
    const { error: updateError } = await mpTable
      .update({
        mp_payment_id:    mpPaymentId,
        mp_status:        mpStatus,
        payment_method:   mpMethod,
        gross_amount_cop: grossAmount,
        fee_amount_cop:   feeAmountCop,
        net_amount_cop:   netAmountCop,
        fee_rate_bp:      feeRateBp,
        webhook_payload:  mpPayment as unknown as Record<string, unknown>,
        updated_at:       new Date().toISOString(),
      })
      // MP v3 no expone preference_id directamente — usar external_reference
      .eq('external_reference', externalRef)

    if (updateError) {
      console.warn('[MP webhook] Update mp_payments:', updateError.message)
    }

    // ── 7. Si es un pago de reserva online (prefix 'booking_') ───────────────
    // Cuando el pago es aprobado, actualizar el appointment a 'scheduled'
    if (externalRef.startsWith('booking_') && mpStatus === 'approved') {
      const appointmentId = externalRef.replace('booking_', '')
      // [SEC] Confirmar solo si el pago registrado por el servidor es de esta misma cita y de
      // su negocio: así una referencia ajena no puede confirmar citas de otra barbería.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: payRows } = await (supabase.from('mp_payments' as any) as any)
        .select('business_id')
        .eq('external_reference', externalRef)
        .eq('appointment_id', appointmentId) as { data: { business_id: string }[] | null }
      const payBusinesses = new Set((payRows ?? []).map(r => r.business_id))
      if (payBusinesses.size !== 1) {
        console.error('[MP webhook] Pago de reserva sin registro único del negocio; no se confirma la cita', appointmentId)
        return NextResponse.json({ status: 'ok', mp_status: mpStatus })
      }
      const [payBusiness] = [...payBusinesses]

      const { error: apptError } = await supabase
        .from('appointments')
        .update({ status: 'scheduled', updated_at: new Date().toISOString() })
        .eq('id', appointmentId)
        .eq('business_id', payBusiness)
        .eq('status', 'payment_pending')   // solo si sigue pendiente (idempotente)

      if (apptError) {
        console.error('[MP webhook] Error actualizando appointment a scheduled:', apptError.message)
      } else {
        console.log(`[MP webhook] Appointment ${appointmentId} → scheduled ✓`)
      }
    }

    console.log(`[MP webhook] payment ${mpPaymentId} → ${mpStatus} | ${grossAmount} COP | fee: ${feeAmountCop}`)
    return NextResponse.json({ status: 'ok', mp_status: mpStatus })

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error procesando webhook'
    console.error('[MP webhook]', msg)
    // Retornar 200 para que MP no reintente infinitamente
    return NextResponse.json({ status: 'error', message: msg }, { status: 200 })
  }
}

// ── handlePreapproval — suscripciones SaaS ────────────────────────────────────
//
// Procesa eventos 'preapproval' de MercadoPago.
// external_reference = 'saas_{businessId}_{planId}'
//
// Cuando authorized:
//   1. Upsert mp_subscriptions con status y próxima fecha
//   2. Update businesses.subscription_status = 'active'
//   3. Update businesses.features_enabled con el plan correspondiente

async function handlePreapproval(preapprovalId: string): Promise<NextResponse> {
  try {
    const preapprovalApi = new PreApproval(getMPClient())
    const sub = await preapprovalApi.get({ id: preapprovalId })

    const subStatus   = sub.status ?? 'pending'
    const externalRef = (sub as unknown as Record<string, string>).external_reference ?? ''

    // Solo procesar suscripciones de Xinuco SaaS
    if (!externalRef.startsWith('saas_')) {
      return NextResponse.json({ status: 'ignored', reason: 'not_saas' })
    }

    // Parsear: saas_{businessId}_{planId}
    const parts      = externalRef.split('_')
    const businessId = parts[1]
    const planId     = parts[2] as PlanName

    if (!businessId || !planId || !(planId in PLAN_BUNDLES)) {
      console.warn('[MP webhook preapproval] external_reference inválido:', externalRef)
      return NextResponse.json({ status: 'ignored', reason: 'invalid_ref' })
    }

    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    )

    // ── [SEC C-2] Verificar ownership: el preapprovalId debe estar registrado
    // en mp_subscriptions vinculado a este businessId.
    // Esto previene que un atacante forje el external_reference con el UUID de
    // otro negocio para subirle el plan sin pago real.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingSub } = await (supabase as any)
      .from('mp_subscriptions')
      .select('business_id, mp_subscription_id')
      .eq('mp_subscription_id', preapprovalId)
      .maybeSingle() as { data: { business_id: string; mp_subscription_id: string } | null }

    if (!existingSub) {
      // El preapproval no fue iniciado desde nuestra plataforma → ignorar
      console.warn(`[MP webhook preapproval] preapprovalId ${preapprovalId} no encontrado en mp_subscriptions — ignorado`)
      return NextResponse.json({ status: 'ignored', reason: 'unknown_preapproval' })
    }

    if (existingSub.business_id !== businessId) {
      // Mismatch: el external_reference fue manipulado
      console.error(
        `[MP webhook preapproval] SEGURIDAD: businessId en external_reference (${businessId}) ` +
        `no coincide con el business_id en mp_subscriptions (${existingSub.business_id}). ` +
        `preapprovalId: ${preapprovalId} — request bloqueado.`
      )
      return NextResponse.json({ status: 'rejected', reason: 'ownership_mismatch' }, { status: 403 })
    }

    // Calcular próxima fecha de cobro (next month)
    const nextBilling = new Date()
    nextBilling.setMonth(nextBilling.getMonth() + 1)
    const nextBillingStr = nextBilling.toISOString().split('T')[0]

    // ── 1. Upsert mp_subscriptions ────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: subError } = await (supabase as any)
      .from('mp_subscriptions')
      .upsert({
        business_id:        businessId,
        mp_subscription_id: preapprovalId,
        plan_id:            planId,
        status:             subStatus,
        amount_cop:         PLAN_PRICES_COP[planId],
        next_billing_date:  subStatus === 'authorized' ? nextBillingStr : null,
        updated_at:         new Date().toISOString(),
      }, { onConflict: 'business_id' })

    if (subError) {
      console.warn('[MP webhook preapproval] upsert mp_subscriptions:', subError.message)
    }

    // ── 2 & 3. Si autorizado → activar plan en el negocio ─────────────────────
    if (subStatus === 'authorized') {
      const planFeatures = PLAN_BUNDLES[planId]?.features ?? {}

      const { error: bizError } = await supabase
        .from('businesses')
        .update({
          subscription_status: 'active',
          features_enabled:    planFeatures as unknown as Record<string, boolean>,
          updated_at:          new Date().toISOString(),
        })
        .eq('id', businessId)

      if (bizError) {
        console.error('[MP webhook preapproval] update businesses:', bizError.message)
      } else {
        console.log(`[MP webhook preapproval] ${businessId} → plan ${planId} ✓`)
      }
    }

    // Si cancelado → revertir a plan Esencial (entrada)
    if (subStatus === 'cancelled') {
      const basicFeatures = PLAN_BUNDLES.esencial.features ?? {}
      await supabase
        .from('businesses')
        .update({
          subscription_status: 'none',
          features_enabled:    basicFeatures as unknown as Record<string, boolean>,
          updated_at:          new Date().toISOString(),
        })
        .eq('id', businessId)

      console.log(`[MP webhook preapproval] ${businessId} → cancelled → reverted to basico`)
    }

    return NextResponse.json({ status: 'ok', preapproval_status: subStatus, plan: planId })

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error procesando preapproval'
    console.error('[MP webhook preapproval]', msg)
    return NextResponse.json({ status: 'error', message: msg }, { status: 200 })
  }
}
