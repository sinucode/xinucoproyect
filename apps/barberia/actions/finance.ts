'use server'

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import type { PaymentMethod, CashRegisterShift, Sale, SaleItem, Payment, Json } from '@xinuco/types'
import { logAction } from './audit'
import { earnPoints } from '@/actions/loyalty'
import { businessTodayISODate, apptDateKey, dayLabel, formatApptTime } from '@/lib/agenda-time'
import { parseReservations, type InventoryReservation } from '@/lib/inventory-reservations'

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
  }
}

/**
 * getActiveShiftDetails — Retorna el turno activo junto con su resumen financiero.
 */
export async function getActiveShiftDetails(businessId: string) {
  const shift = await getActiveShift(businessId)
  if (!shift) return null

  const summary = await getShiftSummary(shift.id)

  return {
    shift,
    totalSales: summary.totalSales,
    totalCashCollected: summary.totalCashCollected,
    totalCashExpenses: summary.totalCashExpenses,
    totalCashTeamPayments: summary.totalCashTeamPayments,
    // Efectivo esperado = base + cobros en efectivo − gastos pagados con efectivo de la caja
    //                     − pagos/anticipos al equipo pagados con efectivo de la caja
    expectedCashBalance:
      shift.opening_balance + summary.totalCashCollected - summary.totalCashExpenses - summary.totalCashTeamPayments,
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

  // ── Audit log ────────────────────────────────────────────────────────────────
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()

    await logAction({
      businessId:  businessId,
      actorId:     user.id,
      actorName:   profile?.full_name ?? null,
      action:      'shift.opened',
      entityType:  'shift',
      newValue:    { opening_balance: startingCash } as unknown as Json,
    })
  } catch {
    // Silenciar
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

  // ── Audit log ────────────────────────────────────────────────────────────────
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()

    await logAction({
      businessId:  businessId,
      actorId:     user.id,
      actorName:   profile?.full_name ?? null,
      action:      'shift.closed',
      entityType:  'shift',
      entityId:    shiftId,
      newValue:    { actual_closing_balance: actualClosingBalance, status: 'closed' } as unknown as Json,
    })
  } catch {
    // Silenciar
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
  receivedAmount: number
  tipAmount: number
  discountAmount: number
  items: CheckoutItemInput[]
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
 * llamada al RPC `checkout_appointment` que ejecuta todo en una transacción.
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
    tipAmount,
    discountAmount,
    items,
  } = params

  // Validaciones de entrada en el servidor (antes del RPC)
  if (!paymentMethod) {
    return { error: 'validation_error', message: 'El método de pago es requerido.' }
  }
  if (items.length === 0) {
    return { error: 'validation_error', message: 'Debe haber al menos un ítem para cobrar.' }
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

  // Una sola llamada — atomicidad garantizada por PostgreSQL
  const { data, error } = await supabase.rpc('checkout_appointment', {
    p_appointment_id:  appointmentId,
    p_business_id:     businessId,
    p_shift_id:        shiftId,
    p_payment_method:  paymentMethod,
    p_tip_amount:      tipAmount,
    p_discount_amount: discountAmount,
    p_items:           rpcItems,
  })

  if (error) {
    console.error('[checkout_appointment RPC]', error)
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

  // ── Programa de Lealtad (RF17) ────────────────────────────────────────────
  // Otorgar puntos al cliente si la cita tiene customer_id.
  // Operación best-effort: un fallo aquí NO revierte el cobro.
  if (result.sale_id) {
    try {
      const { data: appt } = await supabase
        .from('appointments')
        .select('customer_id')
        .eq('id', appointmentId)
        .maybeSingle()

      if (appt?.customer_id) {
        // Base de puntos = total cobrado (subtotal + tip - discount)
        const saleAmount = items.reduce(
          (sum, item) => sum + item.unitPrice * item.quantity,
          0
        ) + tipAmount - discountAmount

        if (saleAmount > 0) {
          await earnPoints(businessId, appt.customer_id, saleAmount, result.sale_id)
        }
      }
    } catch (loyaltyErr) {
      // No propagar — el cobro ya fue exitoso
      console.warn('[loyalty] earnPoints failed silently:', loyaltyErr)
    }
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
  return { success: true, saleId: result.sale_id }
}
