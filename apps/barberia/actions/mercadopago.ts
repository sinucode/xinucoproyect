'use server'

// actions/mercadopago.ts
// ══════════════════════════════════════════════════════════════════════════════
// Server Actions para MercadoPago.
//
// FLUJOS:
//  1. calculateFeePreview   — devuelve el desglose de fee al UI (sin llamar a MP)
//  2. createMPPreference    — crea una preferencia de Checkout Pro en MP
//                             y guarda el registro pendiente en mp_payments
//  3. getMPPaymentStatus    — el UI hace polling para saber si el pago fue aprobado
//
// SEGURIDAD:
//  - Cálculos financieros SIEMPRE en servidor
//  - Nunca se expone MP_ACCESS_TOKEN al cliente
//  - business_id se extrae del JWT de Supabase (no del body del request)
// ══════════════════════════════════════════════════════════════════════════════

import { revalidatePath } from 'next/cache'
import { Preference, PreApproval } from 'mercadopago'
import { getMPClient } from '@/lib/mercadopago/client'
import { calculateMPFee } from '@/lib/mercadopago/fees'
import type { MPFeeBreakdown, MPPaymentMethod } from '@/lib/mercadopago/types'
import { createClient, createAdminClient } from '@xinuco/supabase/server'
import { PLAN_PRICES_COP, PLAN_BUNDLES, type PlanName } from '@xinuco/billing-catalog'
import type { BusinessFeatures } from '@xinuco/types'

// ── Tipos de entrada ──────────────────────────────────────────────────────────

export interface MPPreferenceItem {
  title: string
  quantity: number
  unit_price_cop: number   // INTEGER
  description?: string
}

export interface CreateMPPreferenceParams {
  businessId:    string
  appointmentId?: string
  items:         MPPreferenceItem[]
  payerEmail?:   string
  /** Ej: `appt_${appointmentId}` o `sale_${saleId}` */
  externalRef:   string
}

export interface MPPreferenceResponse {
  preference_id:      string
  init_point:         string   // sandbox_init_point en modo test, init_point en producción
  sandbox_init_point: string
  qr_url:             string   // URL de imagen QR lista para <img src>
  mp_payment_db_id:   string   // ID del registro en mp_payments (para polling)
  is_test_mode:       boolean  // true cuando MP_ACCESS_TOKEN empieza con TEST-
}

// ── Autorización ─────────────────────────────────────────────────────────────

const NOT_ADMIN_MP = 'Solo un administrador puede gestionar los pagos en línea del negocio.'

/**
 * ¿El usuario es admin (o super_admin) del negocio? Se lee del perfil de la sesión.
 * Las tablas mp_* solo las lee el admin y solo se escriben con service role.
 */
async function isAdminOfBusiness(
  supabase:   Awaited<ReturnType<typeof createClient>>,
  userId:     string,
  businessId: string,
): Promise<boolean> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', userId)
    .single()
  const p = profile as { role?: string; business_id?: string | null } | null
  return !!p && p.business_id === businessId && (p.role === 'admin' || p.role === 'super_admin')
}

// ── 1. calculateFeePreview ───────────────────────────────────────────────────

/**
 * Calcula el desglose de fee de MP para un monto y método dados.
 * Se llama desde el UI cuando el usuario cambia el método de pago.
 *
 * Devuelve los datos serializables (no instancias de clase).
 */
export async function calculateFeePreview(
  grossAmountCop: number,
  method: MPPaymentMethod,
): Promise<MPFeeBreakdown> {
  if (!Number.isInteger(grossAmountCop) || grossAmountCop <= 0) {
    throw new Error('El monto debe ser un entero positivo en COP.')
  }
  return calculateMPFee(grossAmountCop, method)
}

// ── 2. createMPPreference ────────────────────────────────────────────────────

/**
 * Crea una preferencia de pago en MercadoPago y guarda un registro
 * pendiente en la tabla `mp_payments`.
 *
 * El UI muestra el QR y hace polling con `getMPPaymentStatus`.
 * Cuando el webhook confirma el pago, el status cambia a 'approved'
 * y el UI puede llamar `checkoutAppointment` con `payment_method: 'mercadopago'`.
 */
export async function createMPPreference(
  params: CreateMPPreferenceParams,
): Promise<{ data: MPPreferenceResponse } | { error: string }> {
  const { businessId, appointmentId, items, payerEmail, externalRef } = params

  // ── [SEC H-4] Verificar autenticación y que businessId pertenece al usuario ──
  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  const jwtBusinessId = user.app_metadata?.business_id as string | undefined
  if (!jwtBusinessId || jwtBusinessId !== businessId) {
    console.error(`[MP createPreference] SEGURIDAD: businessId del cliente (${businessId}) no coincide con JWT (${jwtBusinessId ?? 'none'}). user_id: ${user.id}`)
    return { error: 'Acceso denegado.' }
  }

  // Solo el administrador cobra (el barbero no ve ni abre la caja)
  if (!(await isAdminOfBusiness(supabaseAuth, user.id, businessId))) {
    return { error: NOT_ADMIN_MP }
  }

  // [SEC] 'booking_' y 'saas_' son referencias que crea solo el servidor (reserva en línea y
  // suscripción): el webhook actúa sobre ellas, así que no se aceptan desde el cliente.
  if (typeof externalRef !== 'string' || !externalRef || /^(booking_|saas_)/i.test(externalRef)) {
    return { error: 'Referencia de pago inválida.' }
  }
  // [SEC] La cita (si viene) debe ser de este negocio
  if (appointmentId) {
    const { data: appt } = await supabaseAuth
      .from('appointments')
      .select('id')
      .eq('id', appointmentId)
      .eq('business_id', businessId)
      .maybeSingle()
    if (!appt) return { error: 'Cita no encontrada.' }
  }

  // ── Validar que MP está configurado ────────────────────────────────────────
  if (!process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN === 'APP_USR-...') {
    return { error: 'MercadoPago no está configurado. Agrega MP_ACCESS_TOKEN en las variables de entorno.' }
  }

  // ── Calcular gross total (solo para logging, el monto real lo calcula MP) ──
  const grossTotal = items.reduce(
    (sum, item) => sum + item.unit_price_cop * item.quantity, 0
  )

  if (grossTotal <= 0) {
    return { error: 'El total de los ítems debe ser mayor a cero.' }
  }

  try {
    const client = getMPClient()
    const preferenceApi = new Preference(client)

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.xinuco.com'
    const slug = externalRef.split('_')[0] // heurístico; idealmente se pasa el slug

    // Crear preferencia en MP
    // Items requiere `id` (string) según el tipo Items del SDK v3
    const mpResult = await preferenceApi.create({
      body: {
        items: items.map((item, idx) => ({
          id:          String(idx + 1),
          title:       item.title,
          description: item.description ?? item.title,
          quantity:    item.quantity,
          unit_price:  item.unit_price_cop, // MP acepta enteros para COP
          currency_id: 'COP',
        })),
        payer: payerEmail ? { email: payerEmail } : undefined,
        external_reference: externalRef,
        back_urls: {
          success: `${appUrl}/mp/success?ref=${externalRef}`,
          failure: `${appUrl}/mp/failure?ref=${externalRef}`,
          pending: `${appUrl}/mp/pending?ref=${externalRef}`,
        },
        auto_return:        'approved',
        notification_url:   `${appUrl}/api/webhooks/mercadopago`,
        statement_descriptor: 'XINUCO OS',
        metadata: {
          business_id:    businessId,
          appointment_id: appointmentId ?? null,
          external_ref:   externalRef,
        },
      },
    })

    const preferenceId     = mpResult.id!
    const initPoint        = mpResult.init_point!
    const sandboxInitPoint = mpResult.sandbox_init_point!

    // ── Guardar registro pendiente en mp_payments ─────────────────────────────
    // mp_payments no está en el tipo generado → cast completo para evitar TS2353
    // Service role: mp_payments no admite escrituras de usuarios (RLS). El negocio ya se
    // validó arriba contra el JWT y el perfil admin; el insert va siempre con ese business_id.
    const supabase = await createAdminClient()
    const mpInsertPayload = {
      business_id:        businessId,
      appointment_id:     appointmentId ?? null,
      mp_preference_id:   preferenceId,
      mp_status:          'pending',
      payment_method:     'qr',
      gross_amount_cop:   grossTotal,
      fee_amount_cop:     0,
      net_amount_cop:     grossTotal,
      fee_rate_bp:        0,
      external_reference: externalRef,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dbRow, error: dbError } = await (supabase as any)
      .from('mp_payments')
      .insert(mpInsertPayload)
      .select('id')
      .single() as { data: { id: string } | null; error: { message: string } | null }

    if (dbError || !dbRow) {
      // Sin el registro, el webhook no encontraría el pago y la caja nunca lo vería: no mostrar el QR.
      console.error('[MP createPreference] DB error:', dbError?.message ?? 'sin fila')
      return { error: 'No se pudo registrar el pago. Inténtalo de nuevo.' }
    }

    // En modo test (token empieza con TEST-) usar sandbox_init_point
    const isTestMode    = (process.env.MP_ACCESS_TOKEN ?? '').startsWith('TEST-')
    const activePoint   = isTestMode ? sandboxInitPoint : initPoint
    const qrUrl         = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(activePoint)}`

    return {
      data: {
        preference_id:      preferenceId,
        init_point:         activePoint,   // sandbox en test, producción en live
        sandbox_init_point: sandboxInitPoint,
        qr_url:             qrUrl,
        mp_payment_db_id:   dbRow?.id ?? '',
        is_test_mode:       isTestMode,
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido al crear la preferencia.'
    console.error('[MP createPreference]', msg)
    return { error: msg }
  }
}

// ── 3. getMPPaymentStatus ────────────────────────────────────────────────────

/**
 * Polling endpoint: el UI consulta cada 3s para saber si el pago fue aprobado.
 * Devuelve el estado actual del registro en `mp_payments`.
 *
 * Nota: la RLS de mp_payments solo deja leer al admin del negocio; el polling anónimo
 * del flujo de reserva pública (BookingPaymentStep) queda bloqueado por la RLS (preexistente).
 */
export async function getMPPaymentStatus(
  mpPaymentDbId: string,
): Promise<{
  mp_status: string
  mp_payment_id: string | null
  payment_method: string
  gross_amount_cop: number
  fee_amount_cop: number
  net_amount_cop: number
} | null> {
  if (!mpPaymentDbId) return null

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('mp_payments' as any) as any)
    .select('mp_status, mp_payment_id, payment_method, gross_amount_cop, fee_amount_cop, net_amount_cop')
    .eq('id', mpPaymentDbId)
    .single() as {
      data: {
        mp_status: string; mp_payment_id: string | null; payment_method: string
        gross_amount_cop: number; fee_amount_cop: number; net_amount_cop: number
      } | null
      error: { message: string } | null
    }

  if (error) {
    console.error('[MP getPaymentStatus]', error.message)
    return null
  }

  return data
}

// ── 4. createMPSaaSSubscription ───────────────────────────────────────────────

/**
 * Crea una suscripción recurrente (PreApproval) en MercadoPago para el plan
 * SaaS de Xinuco. Devuelve el `init_point` al que redirigir al usuario para
 * que autorice los débitos mensuales.
 *
 * external_reference: `saas_${businessId}_${planId}`
 * El webhook detecta el prefix 'saas_' y actualiza business.features_enabled.
 */
export async function createMPSaaSSubscription(params: {
  businessId: string
  planId:     PlanName
  payerEmail: string
  slug:       string
}): Promise<{ init_point: string; preapproval_id: string } | { error: string }> {
  const { businessId, planId, payerEmail, slug } = params

  // ── [SEC H-4] Verificar autenticación y ownership del businessId ──────────
  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  const jwtBusinessId = user.app_metadata?.business_id as string | undefined
  if (!jwtBusinessId || jwtBusinessId !== businessId) {
    console.error(`[MP createSaaSSubscription] SEGURIDAD: businessId del cliente (${businessId}) no coincide con JWT (${jwtBusinessId ?? 'none'}). user_id: ${user.id}`)
    return { error: 'Acceso denegado.' }
  }

  // Solo el administrador contrata el plan del negocio
  if (!(await isAdminOfBusiness(supabaseAuth, user.id, businessId))) {
    return { error: 'Solo un administrador puede contratar o cambiar el plan.' }
  }

  if (planId === 'esencial') {
    return { error: 'El plan Esencial es de entrada — no requiere suscripción MP.' }
  }
  if (!process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN === 'APP_USR-...') {
    return { error: 'MercadoPago no está configurado.' }
  }

  const amountCop      = PLAN_PRICES_COP[planId]
  const appUrl         = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.xinuco.com'
  const externalRef    = `saas_${businessId}_${planId}`
  const planLabels: Record<'profesional' | 'elite', string> = {
    profesional: 'Plan Profesional',
    elite:       'Plan Élite',
  }

  try {
    const preapprovalApi = new PreApproval(getMPClient())

    // Fecha fin lejana — la suscripción es indefinida (se cancela si el cliente cancela)
    const endDate = new Date()
    endDate.setFullYear(endDate.getFullYear() + 10)

    // PreApprovalRequest del SDK v3 no incluye notification_url en su tipo,
    // pero la API de MP sí lo acepta.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const preapprovalBody: any = {
      reason:             `Xinuco ${planLabels[planId as 'profesional' | 'elite'] ?? planId}`,
      payer_email:        payerEmail,
      back_url:           `${appUrl}/${slug}/dashboard/settings/billing?result=subscription`,
      external_reference: externalRef,
      notification_url:   `${appUrl}/api/webhooks/mercadopago`,
      auto_recurring: {
        frequency:          1,
        frequency_type:     'months',
        transaction_amount: amountCop,
        currency_id:        'COP',
        start_date:         new Date().toISOString(),
        end_date:           endDate.toISOString(),
      },
    }
    const result = await preapprovalApi.create({ body: preapprovalBody })

    const preapprovalId = result.id!
    const initPoint     = result.init_point!

    // ── Upsert mp_subscriptions (pending hasta que el webhook confirme) ────────
    // Service role: mp_subscriptions no admite escrituras de usuarios (RLS); businessId ya validado.
    const supabase = await createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('mp_subscriptions')
      .upsert({
        business_id:        businessId,
        mp_subscription_id: preapprovalId,
        plan_id:            planId,
        status:             'pending',
        amount_cop:         amountCop,
        updated_at:         new Date().toISOString(),
      }, { onConflict: 'business_id' })

    // Invalida el router cache del cliente (staleTimes): Configuración > Plan muestra el estado "pendiente"
    revalidatePath('/[slug]/dashboard/settings', 'layout')

    return { init_point: initPoint, preapproval_id: preapprovalId }

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error creando la suscripción.'
    console.error('[MP createSaaSSubscription]', msg)
    return { error: msg }
  }
}

// ── 5. getMPSubscriptionStatus ────────────────────────────────────────────────

/**
 * Devuelve el estado actual de la suscripción SaaS del negocio.
 * Usado por el panel de billing para reflejar el estado en tiempo real.
 */
export async function getMPSubscriptionStatus(businessId: string): Promise<{
  plan_id:            string
  status:             string
  amount_cop:         number
  mp_subscription_id: string | null
  next_billing_date:  string | null
} | null> {
  const supabase = await createClient()

  // Solo un usuario autenticado del propio negocio (la RLS además limita la lectura al admin)
  const { data: { user } } = await supabase.auth.getUser()
  const jwtBusinessId = user?.app_metadata?.business_id as string | undefined
  if (!user || !jwtBusinessId || jwtBusinessId !== businessId) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('mp_subscriptions')
    .select('plan_id, status, amount_cop, mp_subscription_id, next_billing_date')
    .eq('business_id', businessId)
    .maybeSingle() as {
      data: {
        plan_id: string; status: string; amount_cop: number
        mp_subscription_id: string | null; next_billing_date: string | null
      } | null
      error: { message: string } | null
    }

  if (error) {
    console.error('[MP getSubscriptionStatus]', error.message)
    return null
  }

  return data
}

// ── 6. cancelMPSaaSSubscription ───────────────────────────────────────────────

/**
 * Cancela la suscripción activa del negocio vía MP PreApproval y actualiza
 * el estado en `mp_subscriptions`.
 * El negocio queda en plan Básico hasta el fin del período pagado.
 */
export async function cancelMPSaaSSubscription(
  businessId: string,
): Promise<{ success: true } | { error: string }> {
  // ── [SEC H-4 / L-2] Verificar auth y extraer businessId desde el JWT ──────
  // No se confía en el businessId recibido del cliente — se valida contra
  // app_metadata.business_id del JWT del usuario autenticado.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  const jwtBusinessId = user.app_metadata?.business_id as string | undefined
  if (!jwtBusinessId || jwtBusinessId !== businessId) {
    console.error(`[MP cancelSubscription] SEGURIDAD: businessId del cliente (${businessId}) no coincide con JWT (${jwtBusinessId ?? 'none'}). user_id: ${user.id}`)
    return { error: 'Acceso denegado.' }
  }

  // Solo el administrador del negocio puede cancelar la suscripción
  const { data: cancelProfile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', user.id)
    .single()
  if (
    !cancelProfile ||
    cancelProfile.business_id !== businessId ||
    (cancelProfile.role !== 'admin' && cancelProfile.role !== 'super_admin')
  ) {
    return { error: 'Solo un administrador puede cancelar la suscripción.' }
  }

  if (!process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN === 'APP_USR-...') {
    return { error: 'MercadoPago no está configurado.' }
  }

  // Obtener el preapproval_id guardado
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sub } = await (supabase as any)
    .from('mp_subscriptions')
    .select('mp_subscription_id')
    .eq('business_id', businessId)
    .maybeSingle() as { data: { mp_subscription_id: string | null } | null; error: unknown }

  const preapprovalId = sub?.mp_subscription_id
  if (!preapprovalId) {
    return { error: 'No se encontró suscripción activa.' }
  }

  try {
    const preapprovalApi = new PreApproval(getMPClient())
    await preapprovalApi.update({
      id:   preapprovalId,
      body: { status: 'cancelled' },
    })

    // Actualizar estado local (service role: mp_subscriptions no admite escrituras de usuarios;
    // el admin y el negocio ya se validaron arriba)
    const adminDb = await createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminDb as any)
      .from('mp_subscriptions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('business_id', businessId)

    // Revertir features al plan Esencial (entrada)
    const basicFeatures: BusinessFeatures = {
      ...(PLAN_BUNDLES.esencial.features as BusinessFeatures),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('businesses')
      .update({
        subscription_status: 'none',
        features_enabled:    basicFeatures as unknown as Record<string, boolean>,
      })
      .eq('id', businessId)

    // Los features/plan cambiaron: el layout del dashboard (sidebar, FeaturesProvider) debe re-renderizar
    // y el router cache del cliente (staleTimes) no debe servir la versión anterior.
    revalidatePath('/[slug]/dashboard', 'layout')

    return { success: true }

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error cancelando la suscripción.'
    console.error('[MP cancelSaaSSubscription]', msg)
    return { error: msg }
  }
}
