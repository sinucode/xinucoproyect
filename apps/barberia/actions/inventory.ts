'use server'
// actions/inventory.ts — RF Inventario (Inventory Management)

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/actions/audit'
import { parseReservations, type InventoryReservation } from '@/lib/inventory-reservations'
import {
  INVENTORY_CATEGORIES,
  MAX_NOTE,
  MOVEMENT_PAGE_SIZE,
  MAX_STOCK_QTY,
  MAX_UNIT_COST,
  MAX_UNIT_PRICE,
  PURCHASE_PAYMENTS,
  stockErrorMessage,
  type PurchasePayment,
} from '@/lib/inventory-utils'
import type {
  InventoryItem,
  InventoryMovement,
  InventoryCategory,
} from '@xinuco/types'

// ── Tipos de resultado ────────────────────────────────────────────────────────

interface ActionResult {
  success?: boolean
  error?:   string
}

export interface CreateInventoryItemInput {
  name:          string
  sku?:          string | null
  category:      InventoryCategory
  description?:  string | null
  current_stock: number   // INTEGER — stock inicial (entra como compra "Stock inicial")
  min_stock:     number   // INTEGER
  unit_price?:   number | null  // INTEGER COP
  unit_cost?:    number | null  // INTEGER COP
  bookable_online?: boolean     // ofrecible para apartar en la reserva en línea
}

// El stock NO se edita directamente: solo cambia con compras, ventas, conteos y mermas.
export type UpdateInventoryItemInput = Partial<Omit<CreateInventoryItemInput, 'current_stock'>>

export interface PurchaseInput {
  itemId:         string
  quantity:       number
  unitCost:       number
  supplier?:      string | null
  paymentMethod:  PurchasePayment
}

export interface CountInput {
  itemId:  string
  counted: number
  reason:  string
}

export interface WasteInput {
  itemId:   string
  quantity: number
  reason:   string
}

export interface StockMovementResult extends ActionResult {
  newStock?:  number
  delta?:     number
  unitCost?:  number
}

export interface MovementHistoryRow extends InventoryMovement {
  created_by_name: string | null
  sale:            { total_amount: number; customer_name: string | null } | null
}

const NOT_ADMIN = 'Solo un administrador puede gestionar el inventario.'

type Supabase = Awaited<ReturnType<typeof createClient>>

// ── Autorización ──────────────────────────────────────────────────────────────
// La RLS de inventory_items ya limita las escrituras al admin, pero la restricción se
// repite aquí y el business_id sale SIEMPRE del perfil (nunca del cliente).

async function requireAdmin(): Promise<
  { supabase: Supabase; businessId: string; userId: string; userEmail: string | null } | { error: string }
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

  return { supabase, businessId, userId: user.id, userEmail: user.email ?? null }
}

function revalidateInventory() {
  revalidatePath('/[slug]/dashboard/inventory', 'page')
  revalidatePath('/[slug]/dashboard/retail', 'page')
  revalidatePath('/[slug]/dashboard/expenses', 'page')
  // Caja (efectivo esperado) y aviso de stock bajo viven en el dashboard
  revalidatePath('/[slug]/dashboard', 'layout')
}

// ── Validación ────────────────────────────────────────────────────────────────

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n)
}

interface CleanItemFields {
  name?:            string
  sku?:             string | null
  category?:        InventoryCategory
  description?:     string | null
  min_stock?:       number
  unit_price?:      number | null
  unit_cost?:       number | null
  bookable_online?: boolean
}

/** Valida los campos presentes (create exige los obligatorios; update solo lo enviado). */
function validateItemFields(
  input: UpdateInventoryItemInput,
  requireAll: boolean,
): { fields: CleanItemFields } | { error: string } {
  const out: CleanItemFields = {}

  if (input.name !== undefined || requireAll) {
    const name = (input.name ?? '').trim()
    if (name.length < 2 || name.length > 80) return { error: 'El nombre debe tener entre 2 y 80 caracteres.' }
    out.name = name
  }
  if (input.sku !== undefined) {
    const sku = (input.sku ?? '').trim()
    if (sku.length > 40) return { error: 'El SKU no puede superar los 40 caracteres.' }
    out.sku = sku || null
  }
  if (input.category !== undefined || requireAll) {
    if (!input.category || !INVENTORY_CATEGORIES.includes(input.category)) return { error: 'Categoría no válida.' }
    out.category = input.category
  }
  if (input.description !== undefined) {
    const description = (input.description ?? '').trim()
    if (description.length > 300) return { error: 'La descripción no puede superar los 300 caracteres.' }
    out.description = description || null
  }
  if (input.min_stock !== undefined || requireAll) {
    if (!isInt(input.min_stock) || input.min_stock < 0 || input.min_stock > MAX_STOCK_QTY) {
      return { error: 'El stock mínimo debe ser un entero mayor o igual a 0.' }
    }
    out.min_stock = input.min_stock
  }
  if (input.unit_price !== undefined && input.unit_price !== null) {
    if (!isInt(input.unit_price) || input.unit_price < 0 || input.unit_price > MAX_UNIT_PRICE) {
      return { error: 'El precio de venta debe ser un entero COP mayor o igual a 0.' }
    }
  }
  if (input.unit_price !== undefined) out.unit_price = input.unit_price
  if (input.unit_cost !== undefined && input.unit_cost !== null) {
    if (!isInt(input.unit_cost) || input.unit_cost < 0 || input.unit_cost > MAX_UNIT_COST) {
      return { error: 'El costo unitario debe ser un entero COP mayor o igual a 0.' }
    }
  }
  if (input.unit_cost !== undefined) out.unit_cost = input.unit_cost
  if (input.bookable_online !== undefined) out.bookable_online = !!input.bookable_online

  return { fields: out }
}

// ════════════════════════════════════════════════════════════════════════════
// getInventoryItems
// Lista todos los ítems activos de un negocio, ordenados por nombre.
// Lectura abierta a cualquier usuario del negocio (el cobro/POS la necesita); la RLS aísla por tenant.
// ════════════════════════════════════════════════════════════════════════════

export async function getInventoryItems(
  businessId: string
): Promise<{ data: InventoryItem[] | null; error: string | null }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'No autenticado.' }

  const { data, error } = await supabase
    .from('inventory_items')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) return { data: null, error: error.message }
  return { data: (data ?? []) as InventoryItem[], error: null }
}

// ════════════════════════════════════════════════════════════════════════════
// getInventoryReservations
// Productos apartados en citas abiertas (RPC tenant get_inventory_reservations).
// ════════════════════════════════════════════════════════════════════════════

export async function getInventoryReservations(
  businessId: string
): Promise<{ data: InventoryReservation[] | null; error: string | null }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'No autenticado.' }

  const { data, error } = await supabase.rpc('get_inventory_reservations', {
    p_business_id: businessId,
  })

  if (error) return { data: null, error: error.message }
  return { data: parseReservations(data), error: null }
}


// ════════════════════════════════════════════════════════════════════════════
// getLowStockItems
// Ítems activos con current_stock <= min_stock (aviso del dashboard y de Inventario).
// Solo admin; el negocio sale del perfil.
// ════════════════════════════════════════════════════════════════════════════

export async function getLowStockItems(): Promise<{ data: InventoryItem[] | null; error: string | null }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { data: null, error: auth.error }
  const { supabase, businessId } = auth

  // Supabase no soporta columna <= columna directamente; se filtra en memoria.
  const { data, error } = await supabase
    .from('inventory_items')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) return { data: null, error: error.message }

  const items = (data ?? []) as InventoryItem[]
  return { data: items.filter((item) => item.current_stock <= item.min_stock), error: null }
}

// ════════════════════════════════════════════════════════════════════════════
// createInventoryItem
// Inserta el producto con stock 0 y, si hay stock inicial, lo registra como una
// compra "Stock inicial" (así el historial y el costo promedio quedan coherentes).
// ════════════════════════════════════════════════════════════════════════════

export async function createInventoryItem(
  input: CreateInventoryItemInput,
): Promise<ActionResult & { id?: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase, businessId, userId, userEmail } = auth

  const checked = validateItemFields(input, true)
  if ('error' in checked) return { error: checked.error }
  const f = checked.fields

  if (!isInt(input.current_stock) || input.current_stock < 0 || input.current_stock > MAX_STOCK_QTY) {
    return { error: 'El stock inicial debe ser un entero mayor o igual a 0.' }
  }
  const initialStock = input.current_stock

  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      business_id:     businessId,
      name:            f.name,
      sku:             f.sku ?? null,
      category:        f.category,
      description:     f.description ?? null,
      current_stock:   0,
      min_stock:       f.min_stock,
      unit_price:      f.unit_price ?? null,
      unit_cost:       null,
      bookable_online: f.bookable_online ?? false,
      is_active:       true,
      created_by:      userId,
    })
    .select('id')
    .single()

  if (error || !data) return { error: error?.message ?? 'No se pudo crear el producto.' }
  const itemId = (data as { id: string }).id

  if (initialStock > 0) {
    // Stock inicial = compra (sin caja: el dinero ya se gastó antes de cargarlo al sistema)
    const { error: rpcError } = await supabase.rpc('record_stock_movement', {
      p_item_id:        itemId,
      p_kind:           'purchase',
      p_quantity:       initialStock,
      p_unit_cost:      f.unit_cost ?? 0,
      p_supplier:       null,
      p_payment_method: 'other',
      p_notes:          'Stock inicial',
    })
    if (rpcError) {
      revalidateInventory()
      return {
        id:    itemId,
        error: `El producto se creó, pero no se pudo registrar el stock inicial: ${stockErrorMessage(rpcError.message)}`,
      }
    }
  } else if (f.unit_cost !== undefined && f.unit_cost !== null) {
    const { error: costError } = await supabase
      .from('inventory_items')
      .update({ unit_cost: f.unit_cost })
      .eq('id', itemId)
      .eq('business_id', businessId)
    if (costError) {
      revalidateInventory()
      return { id: itemId, error: `El producto se creó, pero no se pudo guardar el costo: ${costError.message}` }
    }
  }

  // Audit log — best effort, never blocks main operation
  try {
    await logAction({
      businessId,
      actorId:    userId,
      actorName:  userEmail,
      action:     'inventory_item.created',
      entityType: 'inventory_item',
      entityId:   itemId,
      newValue:   { name: f.name ?? null, category: f.category ?? null, current_stock: initialStock },
    })
  } catch {
    // intentionally silent
  }

  revalidateInventory()
  return { success: true, id: itemId }
}

// ════════════════════════════════════════════════════════════════════════════
// updateInventoryItem
// Edita datos del producto. NO acepta stock: solo cambia con movimientos.
// El costo unitario es una corrección de admin (las compras lo recalculan solas).
// ════════════════════════════════════════════════════════════════════════════

export async function updateInventoryItem(
  itemId: string,
  input:  UpdateInventoryItemInput,
): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase, businessId, userId, userEmail } = auth

  if (!itemId) return { error: 'Producto no encontrado.' }

  const checked = validateItemFields(input, false)
  if ('error' in checked) return { error: checked.error }
  const payload: Record<string, unknown> = { ...checked.fields }
  if (Object.keys(payload).length === 0) return { success: true }

  const { error } = await supabase
    .from('inventory_items')
    .update(payload)
    .eq('id', itemId)
    .eq('business_id', businessId)

  if (error) return { error: error.message }

  // Audit log — best effort
  try {
    await logAction({
      businessId,
      actorId:    userId,
      actorName:  userEmail,
      action:     'inventory_item.updated',
      entityType: 'inventory_item',
      entityId:   itemId,
      newValue:   payload as any,
    })
  } catch {
    // intentionally silent
  }

  revalidateInventory()
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// deactivateInventoryItem
// Soft-delete: marca is_active = false. NUNCA hace hard DELETE sobre datos de negocio.
// ════════════════════════════════════════════════════════════════════════════

export async function deactivateInventoryItem(itemId: string): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  const { supabase, businessId, userId, userEmail } = auth

  const { error } = await supabase
    .from('inventory_items')
    .update({ is_active: false })
    .eq('id', itemId)
    .eq('business_id', businessId)

  if (error) return { error: error.message }

  // Audit log — best effort
  try {
    await logAction({
      businessId,
      actorId:    userId,
      actorName:  userEmail,
      action:     'inventory_item.deactivated',
      entityType: 'inventory_item',
      entityId:   itemId,
    })
  } catch {
    // intentionally silent
  }

  revalidateInventory()
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// Movimientos de stock — RPC atómico record_stock_movement (solo admin)
// ════════════════════════════════════════════════════════════════════════════

async function callStockRpc(
  supabase: Supabase,
  args: {
    itemId:         string
    kind:           'purchase' | 'count' | 'waste'
    quantity:       number
    unitCost?:      number | null
    supplier?:      string | null
    paymentMethod?: PurchasePayment | null
    notes?:         string | null
  },
): Promise<StockMovementResult> {
  const { data, error } = await supabase.rpc('record_stock_movement', {
    p_item_id:        args.itemId,
    p_kind:           args.kind,
    p_quantity:       args.quantity,
    p_unit_cost:      args.unitCost ?? null,
    p_supplier:       args.supplier ?? null,
    p_payment_method: args.paymentMethod ?? null,
    p_notes:          args.notes ?? null,
  })

  if (error) return { error: stockErrorMessage(error.message) }

  const r = (data ?? {}) as { new_stock?: number; delta?: number; unit_cost?: number }
  revalidateInventory()
  return { success: true, newStock: r.new_stock, delta: r.delta, unitCost: r.unit_cost }
}

/** Compra: suma stock, recalcula el costo promedio y (opcional) sale de la caja. */
export async function recordPurchase(input: PurchaseInput): Promise<StockMovementResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }

  if (!input.itemId) return { error: 'Producto no encontrado.' }
  if (!isInt(input.quantity) || input.quantity < 1 || input.quantity > MAX_STOCK_QTY) {
    return { error: 'La cantidad debe ser un entero mayor a 0.' }
  }
  if (!isInt(input.unitCost) || input.unitCost < 0 || input.unitCost > MAX_UNIT_COST) {
    return { error: 'El costo unitario debe ser un entero COP mayor o igual a 0.' }
  }
  if (!PURCHASE_PAYMENTS.includes(input.paymentMethod)) {
    return { error: 'Elige cómo se pagó la compra.' }
  }
  const supplier = (input.supplier ?? '').trim()
  if (supplier.length > 80) return { error: 'El proveedor no puede superar los 80 caracteres.' }

  return callStockRpc(auth.supabase, {
    itemId:        input.itemId,
    kind:          'purchase',
    quantity:      input.quantity,
    unitCost:      input.unitCost,
    supplier:      supplier || null,
    paymentMethod: input.paymentMethod,
  })
}

/** Conteo físico: `counted` es lo que realmente hay; el RPC registra la diferencia. */
export async function recordCount(input: CountInput): Promise<StockMovementResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }

  if (!input.itemId) return { error: 'Producto no encontrado.' }
  if (!isInt(input.counted) || input.counted < 0 || input.counted > MAX_STOCK_QTY) {
    return { error: 'La cantidad contada debe ser un entero mayor o igual a 0.' }
  }
  const reason = (input.reason ?? '').trim()
  if (!reason) return { error: 'Indica el motivo del conteo.' }
  if (reason.length > MAX_NOTE) return { error: `El motivo no puede superar los ${MAX_NOTE} caracteres.` }

  return callStockRpc(auth.supabase, {
    itemId:   input.itemId,
    kind:     'count',
    quantity: input.counted,
    notes:    reason,
  })
}

/** Merma: baja stock por producto vencido, dañado, de uso interno, etc. */
export async function recordWaste(input: WasteInput): Promise<StockMovementResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }

  if (!input.itemId) return { error: 'Producto no encontrado.' }
  if (!isInt(input.quantity) || input.quantity < 1 || input.quantity > MAX_STOCK_QTY) {
    return { error: 'La cantidad debe ser un entero mayor a 0.' }
  }
  const reason = (input.reason ?? '').trim()
  if (!reason) return { error: 'Indica el motivo de la merma.' }
  if (reason.length > MAX_NOTE) return { error: `El motivo no puede superar los ${MAX_NOTE} caracteres.` }

  return callStockRpc(auth.supabase, {
    itemId:   input.itemId,
    kind:     'waste',
    quantity: input.quantity,
    notes:    reason,
  })
}

// ════════════════════════════════════════════════════════════════════════════
// getMovementHistory
// Movimientos de un producto, del más nuevo al más viejo, 50 por página, con quién
// lo hizo y (en ventas) el total y el cliente. `page` empieza en 0.
// ════════════════════════════════════════════════════════════════════════════

export async function getMovementHistory(
  itemId: string,
  page = 0,
): Promise<{ data: { rows: MovementHistoryRow[]; hasMore: boolean } | null; error: string | null }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { data: null, error: auth.error }
  const { supabase, businessId } = auth

  const pageIdx = Number.isInteger(page) && page > 0 ? page : 0
  const from = pageIdx * MOVEMENT_PAGE_SIZE

  // Se piden 51 para saber si hay otra página
  const { data, error } = await supabase
    .from('inventory_movements')
    .select('*')
    .eq('business_id', businessId)
    .eq('item_id', itemId)
    .order('created_at', { ascending: false })
    .range(from, from + MOVEMENT_PAGE_SIZE)

  if (error) return { data: null, error: error.message }

  const all = (data ?? []) as InventoryMovement[]
  const hasMore = all.length > MOVEMENT_PAGE_SIZE
  const movements = all.slice(0, MOVEMENT_PAGE_SIZE)

  // Nombres de quien registró (best effort)
  const userIds = Array.from(new Set(movements.map((m) => m.created_by).filter((v): v is string => !!v)))
  const names = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds)
    for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) {
      if (p.full_name) names.set(p.id, p.full_name)
    }
  }

  // Ventas de referencia: total y cliente (best effort)
  const saleIds = Array.from(
    new Set(movements.filter((m) => m.movement_type === 'sale' && m.reference_id).map((m) => m.reference_id as string)),
  )
  const sales = new Map<string, { total_amount: number; customer_name: string | null }>()
  if (saleIds.length > 0) {
    const { data: saleRows } = await supabase
      .from('sales')
      .select('id, total_amount, customers(full_name)')
      .eq('business_id', businessId)
      .in('id', saleIds)
    for (const s of (saleRows ?? []) as unknown as {
      id: string
      total_amount: number
      customers: { full_name: string | null } | { full_name: string | null }[] | null
    }[]) {
      const c = Array.isArray(s.customers) ? s.customers[0] : s.customers
      sales.set(s.id, { total_amount: Number(s.total_amount), customer_name: c?.full_name ?? null })
    }
  }

  const rows: MovementHistoryRow[] = movements.map((m) => ({
    ...m,
    created_by_name: m.created_by ? names.get(m.created_by) ?? null : null,
    sale:            m.reference_id ? sales.get(m.reference_id) ?? null : null,
  }))

  return { data: { rows, hasMore }, error: null }
}
