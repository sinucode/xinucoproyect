'use server'
// actions/inventory.ts — RF Inventario (Inventory Management)

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/actions/audit'
import { parseReservations, type InventoryReservation } from '@/lib/inventory-reservations'
import type {
  InventoryItem,
  InventoryMovement,
  InventoryMovementResult,
  InventoryCategory,
  MovementType,
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
  current_stock: number   // INTEGER
  min_stock:     number   // INTEGER
  unit_price?:   number | null  // INTEGER COP
  unit_cost?:    number | null  // INTEGER COP
  bookable_online?: boolean     // ofrecible para apartar en la reserva en línea
  created_by?:   string | null
}

export type UpdateInventoryItemInput = Partial<Omit<CreateInventoryItemInput, 'created_by'>>

// ════════════════════════════════════════════════════════════════════════════
// getInventoryItems
// Lista todos los ítems activos de un negocio, ordenados por nombre.
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
// Retorna ítems donde current_stock <= min_stock y están activos.
// ════════════════════════════════════════════════════════════════════════════

export async function getLowStockItems(
  businessId: string
): Promise<{ data: InventoryItem[] | null; error: string | null }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'No autenticado.' }

  // Supabase no soporta columna <= columna directamente; se usa RPC o se filtra en JS.
  // Traemos los items activos y filtramos en memoria para no complicar la query.
  const { data, error } = await supabase
    .from('inventory_items')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)

  if (error) return { data: null, error: error.message }

  const items = (data ?? []) as InventoryItem[]
  const lowStock = items.filter((item) => item.current_stock <= item.min_stock)

  return { data: lowStock, error: null }
}

// ════════════════════════════════════════════════════════════════════════════
// createInventoryItem
// Inserta un nuevo ítem de inventario. Audita la acción (best-effort).
// ════════════════════════════════════════════════════════════════════════════

export async function createInventoryItem(
  businessId:    string,
  input:         CreateInventoryItemInput,
  businessSlug?: string
): Promise<ActionResult & { id?: string }> {
  if (!input.name?.trim()) {
    return { error: 'El nombre del producto es requerido.' }
  }
  if (!Number.isInteger(input.current_stock) || input.current_stock < 0) {
    return { error: 'El stock inicial debe ser un entero mayor o igual a 0.' }
  }
  if (!Number.isInteger(input.min_stock) || input.min_stock < 0) {
    return { error: 'El stock mínimo debe ser un entero mayor o igual a 0.' }
  }
  if (input.unit_price !== undefined && input.unit_price !== null) {
    if (!Number.isInteger(input.unit_price) || input.unit_price < 0) {
      return { error: 'El precio de venta debe ser un entero COP mayor o igual a 0.' }
    }
  }
  if (input.unit_cost !== undefined && input.unit_cost !== null) {
    if (!Number.isInteger(input.unit_cost) || input.unit_cost < 0) {
      return { error: 'El costo unitario debe ser un entero COP mayor o igual a 0.' }
    }
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      business_id:   businessId,
      name:          input.name.trim(),
      sku:           input.sku?.trim() ?? null,
      category:      input.category,
      description:   input.description?.trim() ?? null,
      current_stock: input.current_stock,
      min_stock:     input.min_stock,
      unit_price:    input.unit_price    ?? null,
      unit_cost:     input.unit_cost     ?? null,
      bookable_online: input.bookable_online ?? false,
      is_active:     true,
      created_by:    input.created_by ?? user.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  // Audit log — best effort, never blocks main operation
  try {
    await logAction({
      businessId,
      actorId:    user.id,
      actorName:  user.email ?? null,
      action:     'inventory_item.created',
      entityType: 'inventory_item',
      entityId:   data.id,
      newValue:   { name: input.name, category: input.category, current_stock: input.current_stock },
    })
  } catch {
    // intentionally silent
  }

  if (businessSlug) {
    revalidatePath(`/${businessSlug}/dashboard/inventory`)
  } else {
    revalidatePath('/[slug]/dashboard/inventory', 'page')
  }

  return { success: true, id: data.id }
}

// ════════════════════════════════════════════════════════════════════════════
// updateInventoryItem
// Actualiza campos de un ítem existente. Audita la acción (best-effort).
// ════════════════════════════════════════════════════════════════════════════

export async function updateInventoryItem(
  businessId:    string,
  itemId:        string,
  input:         UpdateInventoryItemInput,
  businessSlug?: string
): Promise<ActionResult> {
  if (input.name !== undefined && !input.name.trim()) {
    return { error: 'El nombre del producto no puede estar vacío.' }
  }
  if (input.current_stock !== undefined) {
    if (!Number.isInteger(input.current_stock) || input.current_stock < 0) {
      return { error: 'El stock debe ser un entero mayor o igual a 0.' }
    }
  }
  if (input.min_stock !== undefined) {
    if (!Number.isInteger(input.min_stock) || input.min_stock < 0) {
      return { error: 'El stock mínimo debe ser un entero mayor o igual a 0.' }
    }
  }
  if (input.unit_price !== undefined && input.unit_price !== null) {
    if (!Number.isInteger(input.unit_price) || input.unit_price < 0) {
      return { error: 'El precio de venta debe ser un entero COP mayor o igual a 0.' }
    }
  }
  if (input.unit_cost !== undefined && input.unit_cost !== null) {
    if (!Number.isInteger(input.unit_cost) || input.unit_cost < 0) {
      return { error: 'El costo unitario debe ser un entero COP mayor o igual a 0.' }
    }
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  // Build payload with only provided fields
  const payload: Record<string, unknown> = {}
  if (input.name          !== undefined) payload.name          = input.name.trim()
  if (input.sku           !== undefined) payload.sku           = input.sku?.trim() ?? null
  if (input.category      !== undefined) payload.category      = input.category
  if (input.description   !== undefined) payload.description   = input.description?.trim() ?? null
  if (input.current_stock !== undefined) payload.current_stock = input.current_stock
  if (input.min_stock     !== undefined) payload.min_stock     = input.min_stock
  if (input.unit_price    !== undefined) payload.unit_price    = input.unit_price
  if (input.unit_cost     !== undefined) payload.unit_cost     = input.unit_cost
  if (input.bookable_online !== undefined) payload.bookable_online = input.bookable_online

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
      actorId:    user.id,
      actorName:  user.email ?? null,
      action:     'inventory_item.updated',
      entityType: 'inventory_item',
      entityId:   itemId,
      newValue:   payload as any,
    })
  } catch {
    // intentionally silent
  }

  if (businessSlug) {
    revalidatePath(`/${businessSlug}/dashboard/inventory`)
  } else {
    revalidatePath('/[slug]/dashboard/inventory', 'page')
  }

  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// deactivateInventoryItem
// Soft-delete: marca is_active = false. Audita la acción (best-effort).
// NUNCA hace hard DELETE sobre datos de negocio.
// ════════════════════════════════════════════════════════════════════════════

export async function deactivateInventoryItem(
  businessId:    string,
  itemId:        string,
  businessSlug?: string
): Promise<ActionResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

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
      actorId:    user.id,
      actorName:  user.email ?? null,
      action:     'inventory_item.deactivated',
      entityType: 'inventory_item',
      entityId:   itemId,
    })
  } catch {
    // intentionally silent
  }

  if (businessSlug) {
    revalidatePath(`/${businessSlug}/dashboard/inventory`)
  } else {
    revalidatePath('/[slug]/dashboard/inventory', 'page')
  }

  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// recordMovement
// Llama al RPC record_inventory_movement de forma atómica.
// El resultado se castea como unknown as InventoryMovementResult.
// ════════════════════════════════════════════════════════════════════════════

export async function recordMovement(
  businessId:    string,
  itemId:        string,
  quantity:      number,   // positivo = entrada, negativo = salida
  type:          MovementType,
  notes?:        string | null,
  businessSlug?: string
): Promise<{ data: InventoryMovementResult | null; error: string | null }> {
  if (!Number.isInteger(quantity) || quantity === 0) {
    return { data: null, error: 'La cantidad debe ser un entero distinto de 0.' }
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'No autenticado.' }

  const { data, error } = await supabase.rpc('record_inventory_movement', {
    p_business_id: businessId,
    p_item_id:     itemId,
    p_quantity:    quantity,
    p_type:        type,
    p_notes:       notes ?? null,
    p_user_id:     user.id,
  })

  if (error) return { data: null, error: error.message }
  if (!data)  return { data: null, error: null }

  const result = data as unknown as InventoryMovementResult & { error?: string }
  if (result.error) return { data: null, error: result.error }

  if (businessSlug) {
    revalidatePath(`/${businessSlug}/dashboard/inventory`)
  } else {
    revalidatePath('/[slug]/dashboard/inventory', 'page')
  }

  return { data: result as InventoryMovementResult, error: null }
}

// ════════════════════════════════════════════════════════════════════════════
// getMovementHistory
// Últimos 50 movimientos de un ítem específico.
// ════════════════════════════════════════════════════════════════════════════

export async function getMovementHistory(
  businessId: string,
  itemId:     string
): Promise<{ data: InventoryMovement[] | null; error: string | null }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { data: null, error: 'No autenticado.' }

  const { data, error } = await supabase
    .from('inventory_movements')
    .select('*')
    .eq('business_id', businessId)
    .eq('item_id', itemId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return { data: null, error: error.message }
  return { data: (data ?? []) as InventoryMovement[], error: null }
}
