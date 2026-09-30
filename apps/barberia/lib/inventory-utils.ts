// lib/inventory-utils.ts — helpers puros del módulo Inventario (compartidos por
// las Server Actions, la UI y los tests). Sin dependencias de servidor.

import type { InventoryCategory, InventoryMovement } from '@xinuco/types'

export const MAX_STOCK_QTY = 100_000
export const MAX_UNIT_COST = 10_000_000
export const MAX_UNIT_PRICE = 100_000_000
export const MAX_NOTE = 200
export const MOVEMENT_PAGE_SIZE = 50

export const INVENTORY_CATEGORIES: InventoryCategory[] = ['general', 'hair', 'skincare', 'tools', 'other']

export type PurchasePayment = 'cash_register' | 'transfer' | 'other'
export const PURCHASE_PAYMENTS: PurchasePayment[] = ['cash_register', 'transfer', 'other']

export const PAYMENT_LABELS: Record<PurchasePayment, string> = {
  cash_register: 'Efectivo de la caja',
  transfer:      'Transferencia',
  other:         'Otro',
}

export const WASTE_REASONS = ['Vencido', 'Dañado', 'Uso interno', 'Otro'] as const
export type WasteReason = (typeof WASTE_REASONS)[number]

/** Nota de la merma: "Vencido: detalle" (o solo el motivo si no hay detalle). */
export function wasteNote(reason: string, detail: string): string {
  const d = detail.trim()
  return d ? `${reason}: ${d}` : reason
}

/**
 * Costo promedio ponderado tras una compra — mismo cálculo que el RPC
 * record_stock_movement: (stock × costo + cantidad × costo nuevo) / (stock + cantidad).
 */
export function weightedAverageCost(
  currentStock: number,
  currentCost:  number | null,
  quantity:     number,
  unitCost:     number,
): number {
  const stock = Math.max(currentStock, 0)
  const total = stock + quantity
  if (total <= 0) return unitCost
  return Math.round((stock * (currentCost ?? 0) + quantity * unitCost) / total)
}

// ── Historial de movimientos ─────────────────────────────────────────────────

export type MovementKind = 'purchase' | 'sale' | 'void_return' | 'count' | 'waste'

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  purchase:    'Compra',
  sale:        'Venta',
  void_return: 'Devolución por anulación',
  count:       'Ajuste por conteo',
  waste:       'Merma',
}

/** Tipo "humano" del movimiento: una 'sale' positiva es la devolución de una venta anulada. */
export function movementKind(m: Pick<InventoryMovement, 'movement_type' | 'quantity'>): MovementKind {
  switch (m.movement_type) {
    case 'purchase':   return 'purchase'
    case 'waste':      return 'waste'
    case 'adjustment': return 'count'
    case 'sale':       return m.quantity > 0 ? 'void_return' : 'sale'
    default:           return 'count'
  }
}

/** "+5" / "−3" (con el signo menos tipográfico). */
export function signedQty(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0'
}

/** Fecha y hora Colombia de un timestamp real (created_at viene en UTC verdadero). */
export function formatMovementDate(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    day:      'numeric',
    month:    'short',
    year:     'numeric',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   true,
    timeZone: 'America/Bogota',
  })
}

/** Traduce los errores del RPC record_stock_movement / record_inventory_movement. */
export function stockErrorMessage(raw: string | null | undefined): string {
  const msg = raw ?? ''
  const table: [string, string][] = [
    ['shift_not_open',        'No hay caja abierta. Abre la caja o elige otro medio de pago.'],
    ['no_change',             'El conteo es igual al stock actual; no hay nada que ajustar.'],
    ['insufficient_stock',    'No hay suficiente stock para esa cantidad.'],
    ['reason_required',       'Indica el motivo.'],
    ['invalid_quantity',      'La cantidad no es válida.'],
    ['invalid_cost',          'El costo unitario no es válido.'],
    ['invalid_payment_method','El medio de pago no es válido.'],
    ['item_not_found',        'Producto no encontrado.'],
    ['item_inactive',         'El producto está desactivado.'],
    ['forbidden',             'Solo un administrador puede gestionar el inventario.'],
    ['invalid_kind',          'Tipo de movimiento no válido.'],
  ]
  for (const [code, text] of table) {
    if (msg.includes(code)) return text
  }
  return 'No se pudo registrar el movimiento. Intenta de nuevo.'
}
