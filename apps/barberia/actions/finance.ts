'use server'

import { ACCOUNT_UUID_RE } from '@/lib/account-resolve'

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import type { PaymentMethod, CashRegisterShift, Sale, SaleItem, Payment } from '@xinuco/types'
import { loyaltyErrorMessage, stampRewardCop, type CustomerLoyalty } from '@/lib/loyalty-utils'
import { businessTodayISODate, apptDateKey, dayLabel, formatApptTime } from '@/lib/agenda-time'
import { parseReservations, type InventoryReservation } from '@/lib/inventory-reservations'
import { mapAccountError } from '@/lib/money-accounts'

/**
 * getActiveShift — Obtiene el turno de caja abierto actualmente para un negocio.
 */
export async function getActiveShift(businessId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cash_register_shifts')
    .select('*')
    .eq('business_id', businessId)
    .eq('status', 'open')
    .maybeSingle()

  if (error) {
    console.error('Error fetching active shift:', error)
    return null
  }
  return data as CashRegisterShift | null
}

/**
 * getShiftSummary — Consolidados financieros de ventas y efectivo del turno.
 *
 * Se calcula en el servidor de la base (RPC get_shift_cash_summary, tenant-checked): la RLS de
 * staff_ledger solo deja leer al administrador, así que sumar los pagos al equipo desde aquí
 * daría un efectivo esperado incorrecto para el resto de roles.
 */
export async function getShiftSummary(shiftId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('get_shift_cash_summary', { p_shift_id: shiftId })

  if (error) {
    // No tumbar el dashboard: las partes no disponibles quedan en cero
    console.error('Error fetching shift cash summary:', error)
  }

  const summary = (error || !data || typeof data !== 'object' ? {} : data) as Record<string, unknown>
  const num = (value: unknown): number => {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }

  return {
    totalSales: num(summary.total_sales),
    totalCashCollected: num(summary.cash_collected),
    totalCashExpenses: num(summary.cash_expenses),
    totalCashTeamPayments: num(summary.cash_team_payments),
    totalCashInventoryPurchases: num(summary.cash_inventory_purchases),
    totalCashAssetPurchases: num(summary.cash_asset_purchases),
    totalCashAssetSales: num(summary.cash_asset_sales),
    // Aportes, préstamos, retiros y traslados que tocaron la caja durante el turno ("Mover plata")
    totalCashMovementsIn: num(summary.cash_movements_in),
    totalCashMovementsOut: num(summary.cash_movements_out),
  }
}

export interface ShiftMethodTotal {
  method: string
  amount: number
}

/**
 * getShiftPaymentsByMethod — Lo cobrado en el turno por medio de pago (sin ventas anuladas).
 * Nunca tumba el dashboard: ante un error devuelve una lista vacía.
 */
export async function getShiftPaymentsByMethod(shiftId: string): Promise<ShiftMethodTotal[]> {
  let data: unknown = null
  let error: unknown = null
  try {
    const supabase = await createClient()
    const res = await supabase
      .from('payments')
      .select('amount, payment_method, sales!inner(status)')
      .eq('shift_id', shiftId)
      .neq('sales.status', 'voided')
    data = res.data
    error = res.error
  } catch (e) {
    error = e
  }

  if (error || !Array.isArray(data)) {
    if (error) console.error('Error fetching shift payments by method:', error)
    return []
  }

  const totals = new Map<string, number>()
  for (const row of data as { amount: number | string | null; payment_method: string | null }[]) {
    const method = row.payment_method ?? 'other'
    const amount = Number(row.amount)
    if (!Number.isFinite(amount)) continue
    totals.set(method, (totals.get(method) ?? 0) + amount)
  }
  return [...totals.entries()]
    .map(([method, amount]) => ({ method, amount }))
    .filter(t => t.amount !== 0)
    .sort((a, b) => b.amount - a.amount)
}

/**
 * getActiveShiftDetails — Retorna el turno activo junto con su resumen financiero.
 */
export async function getActiveShiftDetails(businessId: string) {
  const shift = await getActiveShift(businessId)
  if (!shift) return null

  const [summary, byMethod] = await Promise.all([
    getShiftSummary(shift.id),
    getShiftPaymentsByMethod(shift.id),
  ])

  return {
    shift,
    totalSales: summary.totalSales,
    totalCashCollected: summary.totalCashCollected,
    totalCashExpenses: summary.totalCashExpenses,
    totalCashTeamPayments: summary.totalCashTeamPayments,
    totalCashInventoryPurchases: summary.totalCashInventoryPurchases,
    totalCashAssetPurchases: summary.totalCashAssetPurchases,
    totalCashAssetSales: summary.totalCashAssetSales,
    totalCashMovementsIn: summary.totalCashMovementsIn,
    totalCashMovementsOut: summary.totalCashMovementsOut,
    byMethod,
    // Efectivo esperado = base + cobros en efectivo − gastos pagados con efectivo de la caja
    //                     − pagos/anticipos al equipo pagados con efectivo de la caja
    //                     − compras de inventario pagadas con efectivo de la caja
    //                     − compras de equipos pagadas con efectivo de la caja
    //                     + ventas de equipos cobradas en efectivo a la caja
    //                     + aportes/traslados que entran a la caja − retiros/traslados que salen de ella
    expectedCashBalance:
      shift.opening_balance +
      summary.totalCashCollected -
      summary.totalCashExpenses -
      summary.totalCashTeamPayments -
      summary.totalCashInventoryPurchases -
      summary.totalCashAssetPurchases +
      summary.totalCashAssetSales +
      summary.totalCashMovementsIn -
      summary.totalCashMovementsOut,
  }
}

/**
 * openShift — Abre un nuevo turno de caja registrando la base inicial.
 */
export async function openShift(businessId: string, startingCash: number) {
  const supabase = await createClient()
  
  // Seguridad: obtener usuario autenticado
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autorizado. Por favor inicia sesión.' }

  // Validar si ya hay un turno abierto
  const existing = await getActiveShift(businessId)
  if (existing) {
    return { error: 'Ya existe un turno de caja abierto para este negocio.' }
  }

  const { error } = await supabase
    .from('cash_register_shifts')
    .insert({
      business_id:            businessId,
      opened_by:              user.id,
      opened_at:              new Date().toISOString(),
      status:                 'open',
      opening_balance:        startingCash,
      actual_closing_balance: null,
    })

  if (error) {
    console.error('Error opening shift:', error)
    return { error: `Error de base de datos: ${error.message}` }
  }

  revalidatePath('/[slug]/dashboard', 'page')
  return { success: true }
}

/**
 * closeShift — Cierra el turno activo validando integridad operativa (citas en curso).
 */
export async function closeShift(businessId: string, shiftId: string, actualClosingBalance: number) {
  const supabase = await createClient()
  
  // Seguridad
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autorizado. Por favor inicia sesión.' }

  // 1. Integridad: Verificar si hay citas en estado 'in_progress'
  const { count, error: countError } = await supabase
    .from('appointments')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('status', 'in_progress')

  if (countError) {
    console.error('Error counting in_progress appointments:', countError)
  } else if (count && count > 0) {
    return {
      error: 'integrity_error',
      message: `No es posible cerrar la caja. Hay ${count} cita(s) En Curso actualmente. Por favor, termínalas o cancélalas primero.`,
    }
  }

  // 2. Cerrar turno en BD
  const { error } = await supabase
    .from('cash_register_shifts')
    .update({
      closed_by:              user.id,
      closed_at:              new Date().toISOString(),
      status:                 'closed',
      actual_closing_balance: actualClosingBalance,
    })
    .eq('id', shiftId)

  if (error) {
    console.error('Error closing shift:', error)
    return { error: `Error de base de datos: ${error.message}` }
  }

  revalidatePath('/[slug]/dashboard', 'page')
  return { success: true }
}

export interface CheckoutItemInput {
  description: string
  quantity: number
  unitPrice: number
  itemType: 'service' | 'product'
  staffId?: string | null
  /** Ítem de inventario vinculado (solo UI/servidor; NO se envía al RPC). */
  inventoryItemId?: string | null
}

export interface CheckoutAppointmentParams {
  appointmentId: string
  businessId: string
  shiftId: string
  paymentMethod: PaymentMethod
  /**
   * Medio de pago del negocio (money_accounts) con el que se cobra. La base valida que sea un medio
   * activo del negocio y que cuadre con paymentMethod (la caja ↔ efectivo). Sin medio, la base
   * asigna el de siempre.
   */
  accountId?: string | null
  receivedAmount: number
  tipAmount: number
  discountAmount: number
  items: CheckoutItemInput[]
  /**
   * Canje de lealtad en este cobro (solo métodos inmediatos, no MercadoPago):
   * puntos → `{ units }`; sellos → `{ stamps: true }` (servicio gratis).
   * El descuento NUNCA viene del cliente: se calcula aquí con el saldo real.
   */
  loyaltyRedeem?: { units: number } | { stamps: true }
}

/** Descuento de lealtad calculado en el servidor a partir del saldo real del cliente. */
interface LoyaltyRedemption {
  units:       number
  discountCop: number
}

/**
 * resolveLoyaltyRedemption — Valida el canje pedido y calcula el descuento.
 * Puntos: units entre el mínimo y el saldo; descuento = min(units × valor, total − descuento manual).
 * Sellos: requiere can_redeem; descuento = precio del primer servicio del ticket (con tope).
 */
async function resolveLoyaltyRedemption(
  supabase: Awaited<ReturnType<typeof createClient>>,
  appointmentId: string,
  request: NonNullable<CheckoutAppointmentParams['loyaltyRedeem']>,
  items: CheckoutItemInput[],
  manualDiscount: number,
): Promise<LoyaltyRedemption | { error: string; message: string }> {
  const invalid = (message: string) => ({ error: 'validation_error', message })

  const { data: appt } = await supabase
    .from('appointments')
    .select('customer_id')
    .eq('id', appointmentId)
    .maybeSingle()
  const customerId = (appt as { customer_id?: string | null } | null)?.customer_id
  if (!customerId) return invalid('La cita no tiene un cliente: no se puede canjear lealtad.')

  const { data: raw, error: loyaltyError } = await supabase.rpc('get_customer_loyalty', {
    p_customer_id: customerId,
  })
  if (loyaltyError || !raw) {
    console.error('[checkout] get_customer_loyalty failed', loyaltyError)
    return { error: 'db_error', message: loyaltyErrorMessage(loyaltyError?.message, 'No se pudo verificar el saldo de lealtad.') }
  }
  const loyalty = raw as CustomerLoyalty
  if (!loyalty.enabled) return invalid('La lealtad no está activa en este negocio.')

  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const payable  = Math.max(0, subtotal - Math.max(0, manualDiscount || 0))
  if (payable <= 0) return invalid('No hay valor pendiente sobre el cual aplicar lealtad.')

  if ('stamps' in request) {
    if (loyalty.mode !== 'stamps') return invalid('El programa del negocio no es de sellos.')
    if (!loyalty.can_redeem) return invalid('El cliente aún no completa sus sellos.')
    const service = items.find((item) => item.itemType === 'service')
    if (!service) return invalid('El ticket no tiene un servicio para canjear.')
    const discountCop = Math.min(stampRewardCop(service.unitPrice, loyalty.stamp_max_reward_cop), payable)
    if (discountCop <= 0) return invalid('El servicio no tiene valor para descontar.')
    return { units: loyalty.stamps_required, discountCop }
  }

  if (loyalty.mode !== 'points') return invalid('El programa del negocio no es de puntos.')
  const units = request.units
  if (!Number.isInteger(units) || units <= 0) return invalid('La cantidad de puntos a canjear no es válida.')
  if (units < loyalty.min_redeem) return invalid(`El mínimo para canjear es de ${loyalty.min_redeem} puntos.`)
  if (units > loyalty.balance) return invalid('El cliente no tiene esa cantidad de puntos.')
  // Nunca se gastan más puntos de los que el ticket puede absorber
  const usable = Math.min(units, Math.floor(payable / Math.max(loyalty.point_value_cop, 1)))
  const discountCop = usable * loyalty.point_value_cop
  if (usable <= 0 || discountCop <= 0) return invalid('Los puntos no tienen valor para descontar.')
  if (usable < loyalty.min_redeem) return invalid(`El mínimo para canjear es de ${loyalty.min_redeem} puntos.`)
  return { units: usable, discountCop }
}

/**
 * getAppointmentProducts — Productos que el cliente apartó al reservar en línea.
 * Cliente tenant (RLS): solo devuelve filas del negocio del usuario autenticado.
 * Se usa para pre-cargar el ticket del cobro; el cajero puede quitarlos/ajustarlos.
 */
export interface AppointmentProductLine {
  itemId:    string
  name:      string
  quantity:  number
  unitPrice: number
}

export async function getAppointmentProducts(
  appointmentId: string
): Promise<{ data: AppointmentProductLine[]; error: string | null }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: [], error: 'No autenticado.' }

  const { data, error } = await supabase
    .from('appointment_products')
    .select('item_id, quantity, unit_price, inventory_items(name)')
    .eq('appointment_id', appointmentId)

  if (error) return { data: [], error: error.message }

  type Row = {
    item_id: string
    quantity: number
    unit_price: number
    inventory_items: { name: string } | { name: string }[] | null
  }
  const lines = ((data ?? []) as Row[]).map((row) => {
    const inv = Array.isArray(row.inventory_items) ? row.inventory_items[0] : row.inventory_items
    return {
      itemId:    row.item_id,
      name:      inv?.name ?? 'Producto',
      quantity:  row.quantity,
      unitPrice: row.unit_price,
    }
  })
  return { data: lines, error: null }
}

/**
 * checkoutAppointment — Proceso de cobro atómico via RPC de PostgreSQL.
 *
 * Reemplaza el flujo anterior de 4 operaciones secuenciales (INSERT sales →
 * INSERT sale_items → INSERT payments → UPDATE appointments) por una única
 * llamada al RPC `checkout_appointment_secure` que ejecuta todo en una transacción.
 *
 * Garantía: si cualquier paso falla, PostgreSQL revierte la transacción
 * completa. No existe riesgo de estado financiero parcial.
 *
 * Migración requerida: supabase/migrations/20260523_checkout_atomic_rpc.sql
 */
export async function checkoutAppointment(params: CheckoutAppointmentParams) {
  const supabase = await createClient()

  const {
    appointmentId,
    businessId,
    shiftId,
    paymentMethod,
    accountId,
    tipAmount,
    discountAmount,
    items,
    loyaltyRedeem,
  } = params

  // Validaciones de entrada en el servidor (antes del RPC)
  if (!paymentMethod) {
    return { error: 'validation_error', message: 'El método de pago es requerido.' }
  }
  if (items.length === 0) {
    return { error: 'validation_error', message: 'Debe haber al menos un ítem para cobrar.' }
  }

  // ── Lealtad: calcular el descuento aquí (nunca se confía en un monto del cliente) ──
  let loyaltyRedemption: LoyaltyRedemption | null = null
  if (loyaltyRedeem) {
    if (paymentMethod === 'mercadopago') {
      return { error: 'validation_error', message: 'Para usar puntos elige efectivo, tarjeta o transferencia.' }
    }
    const resolved = await resolveLoyaltyRedemption(supabase, appointmentId, loyaltyRedeem, items, discountAmount)
    if ('error' in resolved) return resolved
    loyaltyRedemption = resolved
  }

  // ── Inventario: agregar cantidades por ítem y verificar stock ANTES de cobrar ──
  const inventoryQty = new Map<string, number>()
  for (const item of items) {
    if (!item.inventoryItemId) continue
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { error: 'validation_error', message: 'La cantidad de cada producto debe ser un entero mayor a cero.' }
    }
    inventoryQty.set(
      item.inventoryItemId,
      (inventoryQty.get(item.inventoryItemId) ?? 0) + item.quantity
    )
  }

  if (inventoryQty.size > 0) {
    const { data: stockRows, error: stockError } = await supabase
      .from('inventory_items')
      .select('id, name, current_stock, business_id, is_active')
      .in('id', Array.from(inventoryQty.keys()))

    if (stockError) {
      console.error('[checkout] inventory stock check failed', stockError)
      return { error: 'db_error', message: 'No se pudo verificar el inventario. Intenta de nuevo.' }
    }

    // Apartados por OTRAS citas: el stock físico incluye lo apartado por otros clientes.
    // Best-effort: si el RPC falla no se bloquea el cobro (solo se ignora el apartado).
    const reservedOthers = new Map<string, InventoryReservation[]>()
    try {
      const { data: resData, error: resError } = (await supabase.rpc('get_inventory_reservations', {
        p_business_id: businessId,
      })) ?? { data: null, error: null }
      if (resError) {
        console.error('[checkout] reservations lookup failed', resError)
      } else {
        for (const r of parseReservations(resData)) {
          if (r.appointment_id === appointmentId) continue
          const list = reservedOthers.get(r.item_id) ?? []
          list.push(r)
          reservedOthers.set(r.item_id, list)
        }
      }
    } catch (resErr) {
      console.error('[checkout] reservations lookup failed', resErr)
    }

    const stockById = new Map((stockRows ?? []).map((row) => [row.id as string, row]))
    for (const [itemId, qty] of inventoryQty) {
      const row = stockById.get(itemId)
      if (!row || row.business_id !== businessId || row.is_active === false) {
        return { error: 'validation_error', message: 'Un producto del ticket no existe o no está disponible en el inventario.' }
      }
      const stock    = row.current_stock ?? 0
      const others   = reservedOthers.get(itemId) ?? []
      const reserved = others.reduce((sum, r) => sum + r.quantity, 0)
      if (stock - reserved < qty) {
        if (reserved === 0) {
          return {
            error: 'validation_error',
            message: `Stock insuficiente de ${row.name} (quedan ${stock}).`,
          }
        }
        const today = businessTodayISODate()
        const who = [...others]
          .sort((a, b) => a.start_time.localeCompare(b.start_time))
          .slice(0, 2)
          .map((r) => `${r.customer_name ?? 'Cliente'} ${dayLabel(apptDateKey(r.start_time), today)} ${formatApptTime(r.start_time)}`)
          .join(', ')
        return {
          error: 'validation_error',
          message: `Stock insuficiente de ${row.name}: ${stock} en inventario, ${reserved} apartada(s) para otras citas (${who}).`,
        }
      }
    }
  }

  // Mapear camelCase → snake_case para el JSONB del RPC
  const rpcItems = items.map((item) => ({
    description: item.description,
    quantity:    item.quantity,
    unit_price:  item.unitPrice,
    item_type:   item.itemType,
    staff_id:    item.staffId ?? null,
  }))

  // Una sola llamada — atomicidad garantizada por PostgreSQL.
  // Se usa la variante _secure: verifica que la cita y la caja sean del negocio del usuario.
  if (accountId != null && !ACCOUNT_UUID_RE.test(accountId)) {
    return { error: 'invalid_account', message: mapAccountError('invalid_account') }
  }
  const { data, error } = await supabase.rpc('checkout_appointment_secure', {
    p_appointment_id:  appointmentId,
    p_business_id:     businessId,
    p_shift_id:        shiftId,
    p_payment_method:  paymentMethod,
    p_tip_amount:      tipAmount,
    p_discount_amount: discountAmount + (loyaltyRedemption?.discountCop ?? 0),
    p_items:           rpcItems,
    // Solo se envía si hay medio elegido: sin él la función se llama como antes
    ...(accountId ? { p_account_id: accountId } : {}),
  })

  if (error) {
    console.error('[checkout_appointment RPC]', error)
    if (error.message?.includes('shift_not_open')) {
      return { error: 'shift_not_open', message: 'No hay una caja abierta.' }
    }
    if (error.message?.includes('appointment_not_found')) {
      return { error: 'appointment_not_found', message: 'No se encontró la cita.' }
    }
    if (error.message?.includes('invalid_account') || error.message?.includes('account_method_mismatch')) {
      return { error: 'invalid_account', message: mapAccountError(error.message) }
    }
    return { error: 'db_error', message: error.message }
  }

  const result = data as {
    success?: boolean
    sale_id?: string
    error?:   string
    message?: string
  }

  if (result?.error) {
    return { error: result.error, message: result.message }
  }

  // ── Programa de Lealtad ───────────────────────────────────────────────────
  // Ganar es automático (trigger de BD al pagar la venta). Aquí solo se registra el
  // canje, DESPUÉS del cobro. Si falla (carrera, saldo cambió) la venta se queda y se
  // avisa: un fallo aquí NO revierte el cobro.
  let loyaltyWarning: string | undefined
  let loyaltyApplied: { redeemed_units: number; discount_cop: number } | undefined
  if (loyaltyRedemption) {
    const warning =
      'El cobro se registró, pero no se pudo descontar el saldo de lealtad del cliente. Ajústalo manualmente en Lealtad.'
    if (!result.sale_id) {
      loyaltyWarning = warning
    } else {
      try {
        const { data: redeemData, error: redeemError } = await supabase.rpc('redeem_loyalty_for_sale', {
          p_sale_id:      result.sale_id,
          p_units:        loyaltyRedemption.units,
          p_discount_cop: loyaltyRedemption.discountCop,
        })
        const redeemResult = redeemData as { error?: string } | null
        if (redeemError || redeemResult?.error) {
          console.error('[loyalty] redeem_loyalty_for_sale failed', {
            saleId: result.sale_id,
            error: redeemError ?? redeemResult?.error,
          })
          loyaltyWarning = warning
        } else {
          loyaltyApplied = {
            redeemed_units: loyaltyRedemption.units,
            discount_cop:   loyaltyRedemption.discountCop,
          }
        }
      } catch (redeemErr) {
        console.error('[loyalty] redeem_loyalty_for_sale failed', { saleId: result.sale_id, error: redeemErr })
        loyaltyWarning = warning
      }
    }
    revalidatePath('/[slug]/dashboard/loyalty', 'page')
  }

  // ── Descuento de inventario ───────────────────────────────────────────────
  // Best-effort: un fallo en un movimiento NO revierte el cobro ya realizado.
  if (inventoryQty.size > 0) {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      for (const [itemId, qty] of inventoryQty) {
        try {
          const { data: mvData, error: mvError } = await supabase.rpc('record_inventory_movement', {
            p_business_id:  businessId,
            p_item_id:      itemId,
            p_quantity:     -qty,
            p_type:         'sale',
            p_notes:        'Venta en cobro de cita',
            p_reference_id: result.sale_id ?? appointmentId,
            p_user_id:      user?.id ?? null,
          })
          const mvResult = mvData as { error?: string } | null
          if (mvError || mvResult?.error) {
            console.error('[checkout] inventory movement failed', { itemId, qty, error: mvError ?? mvResult?.error })
          }
        } catch (mvErr) {
          console.error('[checkout] inventory movement failed', { itemId, qty, error: mvErr })
        }
      }
    } catch (userErr) {
      console.error('[checkout] inventory movement failed', userErr)
    }
    revalidatePath('/[slug]/dashboard/inventory', 'page')
  }

  revalidatePath('/[slug]/dashboard', 'page')
  return { success: true, saleId: result.sale_id, loyalty: loyaltyApplied, loyaltyWarning }
}
