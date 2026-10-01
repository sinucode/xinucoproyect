'use server'

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { validateCustomerInput } from '@/lib/crm-utils'
import { parseReservations, reservedByItem } from '@/lib/inventory-reservations'
import {
  MAX_CART_ITEMS,
  MAX_LINE_QTY,
  MAX_VOID_REASON,
  MIN_VOID_REASON,
  POS_PAYMENT_METHODS,
  posSaleErrorMessage,
  voidSaleErrorMessage,
  type PosCatalog,
  type PosPaymentMethod,
  type PosProduct,
  type ShiftSale,
} from '@/lib/pos-utils'

// ════════════════════════════════════════════════════════════════════════════
// Punto de Venta — venta de productos sin cita y anulación de ventas.
//
// Toda la lógica de dinero vive en la base (create_pos_sale / void_sale): precio
// del catálogo, existencias menos lo apartado por reservas, comisión del vendedor
// y puntos por trigger. Aquí solo se valida la entrada, se resuelve el negocio y
// la caja abierta DESDE EL SERVIDOR y se traducen los errores. El business_id sale
// SIEMPRE del perfil, nunca del cliente.
// ════════════════════════════════════════════════════════════════════════════

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface CreatePosSaleInput {
  customerId?:     string | null
  sellerStaffId?:  string | null
  paymentMethod:   PosPaymentMethod
  /** Medio de pago del negocio (money_accounts); la base valida que cuadre con paymentMethod. */
  accountId?:      string | null
  /** Descuento manual (COP entero). */
  discount:        number
  items:           { itemId: string; quantity: number }[]
  /** Puntos a canjear (0 / omitido = sin canje). */
  loyaltyUnits?:   number
  /** Efectivo entregado por el cliente; solo sirve para calcular el cambio. */
  receivedAmount?: number
}

export interface CreatePosSaleResult {
  success?:         boolean
  error?:           string
  saleId?:          string
  subtotal?:        number
  discount?:        number
  loyaltyDiscount?: number
  loyaltyUnits?:    number
  total?:           number
  /** Cambio a entregar (solo efectivo con monto recibido). */
  change?:          number
}

export interface PosCustomer {
  id:        string
  full_name: string
  phone:     string
}

const NOT_ADMIN       = 'Solo un administrador puede usar el punto de venta.'
const NO_OPEN_SHIFT   = 'Abre la caja para vender.'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Supabase = Awaited<ReturnType<typeof createClient>>

// ── Autorización ──────────────────────────────────────────────────────────────
// El POS es solo para administradores (como antes). El negocio sale del perfil.

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

async function getOpenShiftId(supabase: Supabase, businessId: string): Promise<string | null> {
  const { data } = await supabase
    .from('cash_register_shifts')
    .select('id')
    .eq('business_id', businessId)
    .eq('status', 'open')
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/** Una venta o anulación mueve caja, inventario, comisiones, puntos y P&L. */
function revalidateMoneyPages() {
  revalidatePath('/[slug]/dashboard/retail', 'page')
  revalidatePath('/[slug]/dashboard', 'layout')
  revalidatePath('/[slug]/dashboard/inventory', 'page')
  revalidatePath('/[slug]/dashboard/commissions', 'page')
  revalidatePath('/[slug]/dashboard/loyalty', 'page')
  revalidatePath('/[slug]/dashboard/expenses', 'page')
}

const toInt = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}

// ════════════════════════════════════════════════════════════════════════════
// getPosCatalog — productos vendibles, equipo, caja abierta y lealtad
// ════════════════════════════════════════════════════════════════════════════

export async function getPosCatalog(): Promise<PosCatalog | { error: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return auth
  const { supabase, businessId } = auth

  const [itemsRes, staffRes, bizRes, shiftId, reservationsRes] = await Promise.all([
    supabase
      .from('inventory_items')
      .select('id, name, category, unit_price, current_stock')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name', { ascending: true }),
    supabase
      .from('staff')
      .select('id, full_name')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('full_name', { ascending: true }),
    supabase
      .from('businesses')
      .select('features_enabled, loyalty_mode, loyalty_point_value_cop, loyalty_min_redeem_points')
      .eq('id', businessId)
      .maybeSingle(),
    getOpenShiftId(supabase, businessId),
    supabase.rpc('get_inventory_reservations', { p_business_id: businessId }),
  ])

  if (itemsRes.error) return { error: 'No se pudo cargar el inventario.' }
  if (staffRes.error) return { error: 'No se pudo cargar el equipo.' }

  // Lo apartado por reservas en línea no se puede vender (la base lo vuelve a verificar).
  // Si el RPC falla solo se ignora el apartado: la base rechaza si no alcanza.
  if (reservationsRes.error) console.error('[pos] reservas no disponibles', reservationsRes.error)
  const reserved = reservationsRes.error ? {} : reservedByItem(parseReservations(reservationsRes.data))

  type ItemRow = { id: string; name: string; category: string | null; unit_price: number | null; current_stock: number | null }
  const products: PosProduct[] = ((itemsRes.data ?? []) as ItemRow[]).map((row) => {
    const stock = toInt(row.current_stock)
    const held = reserved[row.id] ?? 0
    return {
      id:            row.id,
      name:          row.name,
      category:      row.category ?? 'general',
      unit_price:    toInt(row.unit_price),
      current_stock: stock,
      reserved:      held,
      available:     Math.max(0, stock - held),
    }
  })

  const biz = (bizRes.data ?? {}) as {
    features_enabled?: { loyalty?: boolean } | null
    loyalty_mode?: string | null
    loyalty_point_value_cop?: number | null
    loyalty_min_redeem_points?: number | null
  }

  return {
    products,
    staff: ((staffRes.data ?? []) as { id: string; full_name: string }[]).map((s) => ({
      id: s.id, full_name: s.full_name,
    })),
    shiftId,
    loyalty: {
      enabled:         biz.features_enabled?.loyalty === true,
      mode:            biz.loyalty_mode === 'stamps' ? 'stamps' : 'points',
      point_value_cop: toInt(biz.loyalty_point_value_cop),
      min_redeem:      toInt(biz.loyalty_min_redeem_points),
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════
// createPosSale — cobra una venta de mostrador (caja abierta resuelta aquí)
// ════════════════════════════════════════════════════════════════════════════

export async function createPosSale(input: CreatePosSaleInput): Promise<CreatePosSaleResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase, businessId } = auth

  // ── Validación de entrada ──
  if (!input || typeof input !== 'object') return { error: 'Venta inválida.' }
  if (!POS_PAYMENT_METHODS.includes(input.paymentMethod)) {
    return { error: posSaleErrorMessage('invalid_payment_method') }
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { error: posSaleErrorMessage('empty_cart') }
  }
  if (input.items.length > MAX_CART_ITEMS) return { error: posSaleErrorMessage('too_many_items') }
  for (const it of input.items) {
    if (!it || typeof it.itemId !== 'string' || !UUID_RE.test(it.itemId)) {
      return { error: 'Un producto del carrito no es válido.' }
    }
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > MAX_LINE_QTY) {
      return { error: posSaleErrorMessage('invalid_quantity') }
    }
  }
  const discount = input.discount ?? 0
  if (!Number.isInteger(discount) || discount < 0) {
    return { error: 'El descuento debe ser un número entero mayor o igual a 0.' }
  }
  const loyaltyUnits = input.loyaltyUnits ?? 0
  if (!Number.isInteger(loyaltyUnits) || loyaltyUnits < 0) {
    return { error: 'La cantidad de puntos no es válida.' }
  }
  const accountId = input.accountId || null
  if (accountId && !UUID_RE.test(accountId)) return { error: posSaleErrorMessage('invalid_account') }
  const customerId = input.customerId || null
  const sellerId = input.sellerStaffId || null
  if ((customerId && !UUID_RE.test(customerId)) || (sellerId && !UUID_RE.test(sellerId))) {
    return { error: 'Cliente o profesional inválido.' }
  }

  // ── Caja abierta: se resuelve aquí, no se confía en el cliente ──
  const shiftId = await getOpenShiftId(supabase, businessId)
  if (!shiftId) return { error: NO_OPEN_SHIFT }

  const { data, error } = await supabase.rpc('create_pos_sale', {
    p_business_id:     businessId,
    p_shift_id:        shiftId,
    p_customer_id:     customerId,
    p_seller_staff_id: sellerId,
    p_payment_method:  input.paymentMethod,
    p_discount:        discount,
    p_items:           input.items.map((it) => ({ item_id: it.itemId, quantity: it.quantity })),
    p_loyalty_units:   loyaltyUnits,
    // Solo se envía si hay medio elegido: sin él la función se llama como antes
    ...(accountId ? { p_account_id: accountId } : {}),
  })

  if (error) {
    console.error('[create_pos_sale RPC]', error)
    return { error: posSaleErrorMessage(error.message) }
  }

  const result = (data ?? {}) as {
    sale_id?: string
    subtotal?: number
    discount?: number
    loyalty_discount?: number
    loyalty_units?: number
    total?: number
  }
  if (!result.sale_id) return { error: posSaleErrorMessage(null) }

  revalidateMoneyPages()

  const total = toInt(result.total)
  const received = Number.isFinite(input.receivedAmount) ? Math.round(input.receivedAmount as number) : 0
  return {
    success:         true,
    saleId:          result.sale_id,
    subtotal:        toInt(result.subtotal),
    discount:        toInt(result.discount),
    loyaltyDiscount: toInt(result.loyalty_discount),
    loyaltyUnits:    toInt(result.loyalty_units),
    total,
    change:          input.paymentMethod === 'cash' && received > total ? received - total : 0,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// getShiftSales — ventas de la caja abierta (mostrador y cobros de citas)
// ════════════════════════════════════════════════════════════════════════════

export async function getShiftSales(): Promise<{ sales: ShiftSale[]; error?: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { sales: [], error: auth.error }
  const { supabase, businessId } = auth

  const shiftId = await getOpenShiftId(supabase, businessId)
  if (!shiftId) return { sales: [] }

  const { data, error } = await supabase
    .from('sales')
    .select(
      'id, created_at, total_amount, status, void_reason, appointment_id, ' +
      'customer:customer_id(full_name), seller:seller_staff_id(full_name), ' +
      'sale_items(description, quantity), payments(payment_method)',
    )
    .eq('business_id', businessId)
    .eq('shift_id', shiftId)
    .in('status', ['paid', 'voided'])
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[getShiftSales]', error)
    return { sales: [], error: 'No se pudieron cargar las ventas del turno.' }
  }

  type One<T> = T | T[] | null
  type Row = {
    id: string
    created_at: string
    total_amount: number
    status: string
    void_reason: string | null
    appointment_id: string | null
    customer: One<{ full_name: string }>
    seller: One<{ full_name: string }>
    sale_items: { description: string; quantity: number }[] | null
    payments: { payment_method: string }[] | null
  }
  const first = <T,>(v: One<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v)

  const sales = ((data ?? []) as unknown as Row[]).map((row): ShiftSale => {
    const method = row.payments?.[0]?.payment_method
    return {
      id:            row.id,
      createdAt:     row.created_at,
      customerName:  first(row.customer)?.full_name ?? null,
      sellerName:    first(row.seller)?.full_name ?? null,
      items:         (row.sale_items ?? []).map((i) => ({ description: i.description, quantity: toInt(i.quantity) })),
      paymentMethod: method === 'cash' || method === 'card' || method === 'transfer' ? method : null,
      total:         toInt(row.total_amount),
      status:        row.status === 'voided' ? 'voided' : 'paid',
      voidReason:    row.void_reason ?? null,
      source:        row.appointment_id ? 'appointment' : 'pos',
    }
  })

  return { sales }
}

// ════════════════════════════════════════════════════════════════════════════
// voidSale — anula una venta pagada de la caja abierta (solo admin)
// Devuelve inventario, revierte comisión/propina y puntos, la cita vuelve a
// "lista para pagar" y el dinero deja de contar en la caja.
// ════════════════════════════════════════════════════════════════════════════

export async function voidSale(
  saleId: string,
  reason: string,
): Promise<{ success?: boolean; error?: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase } = auth

  if (typeof saleId !== 'string' || !UUID_RE.test(saleId)) return { error: 'Venta inválida.' }
  const cleanReason = String(reason ?? '').trim()
  if (cleanReason.length < MIN_VOID_REASON || cleanReason.length > MAX_VOID_REASON) {
    return { error: `El motivo debe tener entre ${MIN_VOID_REASON} y ${MAX_VOID_REASON} caracteres.` }
  }

  const { error } = await supabase.rpc('void_sale', { p_sale_id: saleId, p_reason: cleanReason })
  if (error) {
    console.error('[void_sale RPC]', error)
    return { error: voidSaleErrorMessage(error.message) }
  }

  revalidateMoneyPages()
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// quickCreateCustomer — cliente nuevo desde el POS (nombre + celular)
// Si el celular ya existe en el negocio se devuelve ese cliente (sin duplicar).
// ════════════════════════════════════════════════════════════════════════════

export async function quickCreateCustomer(input: {
  full_name: string
  phone:     string
}): Promise<{ customer?: PosCustomer; existing?: boolean; error?: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase, businessId } = auth

  const validated = validateCustomerInput({
    full_name: input?.full_name ?? '',
    phone:     input?.phone ?? '',
    email:     null,
    birthday:  null,
  })
  if ('error' in validated) return { error: validated.error }
  const v = validated.value

  const { data: dup } = await supabase
    .from('customers')
    .select('id, full_name, phone')
    .eq('business_id', businessId)
    .eq('phone', v.phone)
    .maybeSingle()
  if (dup) return { customer: dup as PosCustomer, existing: true }

  const { data, error } = await supabase
    .from('customers')
    .insert({ business_id: businessId, full_name: v.full_name, phone: v.phone, email: null, birthday: null })
    .select('id, full_name, phone')
    .single()

  if (error || !data) {
    if (error?.code === '23505') return { error: 'Ya existe un cliente con ese celular.' }
    console.error('[quickCreateCustomer]', error)
    return { error: 'No se pudo crear el cliente.' }
  }

  revalidatePath('/[slug]/dashboard/crm', 'page')
  return { customer: data as PosCustomer, existing: false }
}
