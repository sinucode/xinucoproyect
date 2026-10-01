// lib/pos-utils.ts — tipos y helpers PUROS del Punto de Venta (sin Supabase, sin React).
// Compartidos por las server actions (actions/retail.ts) y los componentes de cliente.

import { formatMoney, maxRedeemablePoints, type LoyaltyMode } from '@/lib/loyalty-utils'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type PosPaymentMethod = 'cash' | 'card' | 'transfer'

export const POS_PAYMENT_METHODS: PosPaymentMethod[] = ['cash', 'card', 'transfer']

export const POS_METHOD_LABELS: Record<PosPaymentMethod, string> = {
  cash:     'Efectivo',
  card:     'Tarjeta',
  transfer: 'Transferencia',
}

export interface PosProduct {
  id:            string
  name:          string
  category:      string
  /** Precio de venta (COP entero). 0 / null = sin precio: no se puede vender. */
  unit_price:    number
  current_stock: number
  /** Unidades apartadas por reservas en línea (citas abiertas). */
  reserved:      number
  /** Lo que realmente se puede vender ahora: existencias − apartado (nunca negativo). */
  available:     number
}

export interface PosStaff {
  id:        string
  full_name: string
}

export interface PosLoyaltyConfig {
  enabled:         boolean
  mode:            LoyaltyMode
  point_value_cop: number
  min_redeem:      number
}

export interface PosCatalog {
  products: PosProduct[]
  staff:    PosStaff[]
  /** Caja abierta del negocio (null = hay que abrirla desde el inicio). */
  shiftId:  string | null
  loyalty:  PosLoyaltyConfig
}

/** Una venta del turno (de punto de venta o de cobro de cita). */
export interface ShiftSale {
  id:            string
  createdAt:     string
  customerName:  string | null
  sellerName:    string | null
  items:         { description: string; quantity: number }[]
  paymentMethod: PosPaymentMethod | null
  total:         number
  status:        'paid' | 'voided'
  voidReason:    string | null
  /** 'pos' = venta de mostrador; 'appointment' = cobro de una cita. */
  source:        'pos' | 'appointment'
}

export const CATEGORY_LABELS: Record<string, string> = {
  general:  'General',
  hair:     'Cabello',
  skincare: 'Skincare',
  tools:    'Herramientas',
  other:    'Otros',
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

export const MAX_CART_ITEMS = 50
export const MAX_LINE_QTY = 999
export const MIN_VOID_REASON = 3
export const MAX_VOID_REASON = 200

// ── Carrito y totales ─────────────────────────────────────────────────────────

export interface CartLine {
  itemId:   string
  quantity: number
}

export function cartSubtotal(lines: { unit_price: number; quantity: number }[]): number {
  return lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0)
}

export interface PosTotals {
  subtotal:        number
  discount:        number
  loyaltyDiscount: number
  total:           number
}

/**
 * Totales tal como los calcula la base: el descuento manual no puede superar el subtotal y el canje
 * de puntos no puede superar lo que queda. El servidor vuelve a calcular todo; esto es solo la vista.
 */
export function computePosTotals(input: {
  subtotal:      number
  discount:      number
  loyaltyUnits:  number
  pointValueCop: number
}): PosTotals {
  const subtotal = Math.max(0, Math.round(input.subtotal))
  const discount = Math.min(Math.max(0, Math.round(input.discount || 0)), subtotal)
  const loyaltyDiscount = Math.min(
    Math.max(0, Math.round((input.loyaltyUnits || 0) * (input.pointValueCop || 0))),
    subtotal - discount,
  )
  return { subtotal, discount, loyaltyDiscount, total: subtotal - discount - loyaltyDiscount }
}

/** Puntos que se usarán realmente: lo pedido acotado por el máximo canjeable y el mínimo del negocio. */
export function effectiveLoyaltyUnits(input: {
  requested:     number | null   // null = el máximo
  balance:       number
  pointValueCop: number
  minRedeem:     number
  amountCop:     number          // subtotal − descuento manual
}): { max: number; units: number } {
  const max = maxRedeemablePoints(input.balance, input.pointValueCop, input.amountCop, input.minRedeem)
  if (max <= 0) return { max: 0, units: 0 }
  const wanted = input.requested === null ? max : Math.min(Math.max(0, Math.floor(input.requested)), max)
  if (wanted < Math.max(input.minRedeem, 1)) return { max, units: 0 }
  return { max, units: wanted }
}

/** Cambio a entregar en efectivo (0 si no alcanza o no es efectivo). */
export function cashChange(method: PosPaymentMethod, received: number, total: number): number {
  return method === 'cash' && received > total ? received - total : 0
}

/** Billetes sugeridos: múltiplos redondos estrictamente mayores al total (máx. 3). */
export function suggestedCashAmounts(total: number): number[] {
  return Array.from(
    new Set([5000, 10000, 20000, 50000, 100000].map((m) => (Math.floor(total / m) + 1) * m)),
  )
    .sort((a, b) => a - b)
    .slice(0, 3)
}

export const CASH_BILL_CHIPS = [1000, 2000, 5000, 10000, 20000, 50000, 100000]

// ── Errores de los RPC → español ──────────────────────────────────────────────

const GENERIC_SALE_ERROR = 'No se pudo registrar la venta. Intenta de nuevo.'

/** Nombre que viene después de "código:" en el mensaje del RPC (hasta el fin de línea). */
function nameAfter(raw: string, code: string): string {
  const i = raw.indexOf(`${code}:`)
  if (i < 0) return ''
  return raw.slice(i + code.length + 1).split('\n')[0].trim()
}

const SALE_ERRORS: [string, string][] = [
  ['invalid_payment_method',     'Elige cómo paga el cliente.'],
  ['shift_not_open',             'No hay una caja abierta. Ábrela desde el inicio para vender.'],
  ['customer_not_found',         'El cliente no existe en este negocio.'],
  ['staff_not_found',            'El profesional que vendió no está disponible.'],
  ['empty_cart',                 'Agrega al menos un producto a la venta.'],
  ['too_many_items',             'Una venta admite hasta 50 productos distintos.'],
  ['invalid_quantity',           'La cantidad de cada producto debe ser entre 1 y 999.'],
  ['item_not_found',             'Un producto ya no está disponible en el inventario.'],
  ['discount_too_high',          'El descuento no puede superar el subtotal.'],
  ['loyalty_requires_customer',  'Para usar puntos elige primero al cliente.'],
  ['loyalty_not_available',      'La lealtad por puntos no está activa en este negocio.'],
  ['loyalty_below_minimum',      'El cliente no alcanza el mínimo de puntos para canjear.'],
  ['invalid_account',            'Elige un medio de pago activo.'],
  ['account_method_mismatch',    'Ese medio de pago no corresponde con la forma de pago elegida. Elígelo de nuevo.'],
  ['forbidden',                  'Solo un administrador puede hacer esto.'],
]

/** Traduce el mensaje de una excepción de create_pos_sale. */
export function posSaleErrorMessage(raw: string | null | undefined): string {
  const text = raw ?? ''
  if (text.includes('insufficient_stock:')) {
    const name = nameAfter(text, 'insufficient_stock')
    return `No hay suficiente "${name}" disponible (hay unidades apartadas para reservas).`
  }
  if (text.includes('item_without_price:')) {
    const name = nameAfter(text, 'item_without_price')
    return `"${name}" no tiene precio de venta. Defínelo en Inventario.`
  }
  for (const [code, message] of SALE_ERRORS) {
    if (text.includes(code)) return message
  }
  return GENERIC_SALE_ERROR
}

const VOID_ERRORS: [string, string][] = [
  ['shift_closed',     'Esa venta es de una caja ya cerrada; no se puede anular.'],
  ['not_paid',         'Esa venta ya estaba anulada o no está pagada.'],
  ['reason_required',  'Escribe el motivo de la anulación (mínimo 3 letras).'],
  ['forbidden',        'Solo un administrador puede anular ventas.'],
  ['not_found',        'No se encontró la venta.'],
]

/** Traduce el mensaje de una excepción de void_sale. */
export function voidSaleErrorMessage(raw: string | null | undefined): string {
  const text = raw ?? ''
  for (const [code, message] of VOID_ERRORS) {
    if (text.includes(code)) return message
  }
  return 'No se pudo anular la venta. Intenta de nuevo.'
}

// ── Recibo ────────────────────────────────────────────────────────────────────

export interface ReceiptData {
  lines:           { name: string; quantity: number; unit_price: number }[]
  subtotal:        number
  discount:        number
  loyaltyDiscount: number
  total:           number
  method:          PosPaymentMethod
  /** Nombre del medio de pago del negocio (Nequi, Bancolombia…); sin él se usa el método. */
  accountName?:    string | null
  received:        number | null
  change:          number
  customerName:    string | null
}

/** Texto plano del recibo (para WhatsApp). */
export function receiptText(r: ReceiptData, businessName?: string | null): string {
  const out: string[] = []
  out.push(businessName ? `Recibo de ${businessName}` : 'Recibo de compra')
  if (r.customerName) out.push(`Cliente: ${r.customerName}`)
  out.push('')
  for (const l of r.lines) {
    out.push(`• ${l.quantity} × ${l.name}: ${formatMoney(l.unit_price * l.quantity)}`)
  }
  out.push('')
  if (r.discount > 0 || r.loyaltyDiscount > 0) out.push(`Subtotal: ${formatMoney(r.subtotal)}`)
  if (r.discount > 0) out.push(`Descuento: -${formatMoney(r.discount)}`)
  if (r.loyaltyDiscount > 0) out.push(`Descuento por puntos: -${formatMoney(r.loyaltyDiscount)}`)
  out.push(`Total: ${formatMoney(r.total)} (${r.accountName || POS_METHOD_LABELS[r.method]})`)
  out.push('¡Gracias por tu compra!')
  return out.join('\n')
}

// ── Hora ──────────────────────────────────────────────────────────────────────

/** '3:45 p. m.' — created_at es un instante real: se muestra en la zona del negocio. */
export function formatSaleTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CO', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota',
  })
}
