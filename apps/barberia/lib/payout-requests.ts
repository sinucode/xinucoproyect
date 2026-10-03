// lib/payout-requests.ts — lógica PURA de las solicitudes de pago / anticipo del profesional.
// Una solicitud NUNCA mueve plata: solo avisa al administrador, que la paga con el flujo normal de
// "Pagos al equipo". Sin 'use client' ni 'use server'.

export type PayoutRequestKind = 'payout' | 'advance'
export type PayoutRequestStatus = 'pending' | 'paid' | 'rejected' | 'cancelled'

export const PAYOUT_KINDS: PayoutRequestKind[] = ['payout', 'advance']
export const PAYOUT_STATUSES: PayoutRequestStatus[] = ['pending', 'paid', 'rejected', 'cancelled']

export const PAYOUT_KIND_LABELS: Record<PayoutRequestKind, string> = {
  payout:  'Pago',
  advance: 'Anticipo',
}

export const PAYOUT_STATUS_LABELS: Record<PayoutRequestStatus, string> = {
  pending:   'Pendiente',
  paid:      'Pagada',
  rejected:  'Rechazada',
  cancelled: 'Cancelada',
}

export const PAYOUT_MAX_AMOUNT = 50_000_000
export const PAYOUT_MAX_NOTE = 200
export const PAYOUT_MIN_REASON = 3

/** Una solicitud lista para mostrar (lo que sale de payout_requests + nombre del profesional). */
export interface PayoutRequestView {
  id:              string
  staff_id:        string
  staff_name:      string
  kind:            PayoutRequestKind
  amount:          number
  note:            string | null
  status:          PayoutRequestStatus
  created_at:      string
  resolved_at:     string | null
  resolution_note: string | null
}

export function isPayoutKind(value: unknown): value is PayoutRequestKind {
  return value === 'payout' || value === 'advance'
}

export function isPayoutStatus(value: unknown): value is PayoutRequestStatus {
  return typeof value === 'string' && (PAYOUT_STATUSES as string[]).includes(value)
}

export interface PayoutRequestInput {
  kind:   PayoutRequestKind
  amount: number
  note?:  string | null
}

/** Valida lo que pide el profesional. El saldo (para el tope de un pago) lo vuelve a validar la base. */
export function validatePayoutRequestInput(
  input: PayoutRequestInput,
): { error: string } | { value: { kind: PayoutRequestKind; amount: number; note: string | null } } {
  if (!input || typeof input !== 'object') return { error: 'Datos inválidos.' }
  if (!isPayoutKind(input.kind)) return { error: 'Elige si pides un pago o un anticipo.' }
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > PAYOUT_MAX_AMOUNT) {
    return { error: 'El monto debe ser un entero entre $1 y $50.000.000.' }
  }
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (note.length > PAYOUT_MAX_NOTE) return { error: `La nota no puede superar ${PAYOUT_MAX_NOTE} caracteres.` }
  return { value: { kind: input.kind, amount: input.amount, note: note || null } }
}

/** Valida el motivo de un rechazo (obligatorio). */
export function validateRejectReason(reason: unknown): { error: string } | { value: string } {
  const text = typeof reason === 'string' ? reason.trim() : ''
  if (text.length < PAYOUT_MIN_REASON) return { error: `Escribe el motivo (mínimo ${PAYOUT_MIN_REASON} caracteres).` }
  if (text.length > PAYOUT_MAX_NOTE) return { error: `El motivo no puede superar ${PAYOUT_MAX_NOTE} caracteres.` }
  return { value: text }
}

function formatPlain(amount: number): string {
  return `$${String(Math.abs(Math.round(amount))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

/**
 * Traduce el error de las funciones request_payout / cancel_payout_request / resolve_payout_request
 * (el mensaje de la excepción ES el código) a un texto para la persona. `detail` trae el saldo en
 * 'exceeds_balance'. Lo desconocido (p. ej. la migración aún no corrió) cae en un mensaje genérico.
 */
export function mapPayoutRpcError(message: string | null | undefined, detail?: string | null): string {
  const code = (message ?? '').trim()
  switch (code) {
    case 'forbidden':             return 'No tienes permiso para esta acción.'
    case 'not_linked':            return 'Tu usuario aún no está vinculado a un profesional.'
    case 'invalid_kind':          return 'Elige si pides un pago o un anticipo.'
    case 'invalid_amount':        return 'El monto debe ser un entero entre $1 y $50.000.000.'
    case 'note_too_long':         return `La nota no puede superar ${PAYOUT_MAX_NOTE} caracteres.`
    case 'note_required':         return `Escribe el motivo (mínimo ${PAYOUT_MIN_REASON} caracteres).`
    case 'pending_exists':        return 'Ya tienes una solicitud pendiente. Espera la respuesta o cancélala.'
    case 'not_found':             return 'No encontramos la solicitud.'
    case 'not_pending':           return 'La solicitud ya no está pendiente.'
    case 'invalid_status':        return 'Estado no válido.'
    case 'invalid_ledger_entry':  return 'El movimiento no corresponde a esta solicitud.'
    case 'exceeds_balance': {
      const balance = Number(detail)
      return Number.isFinite(balance)
        ? `No puedes pedir más de lo que se te debe (${formatPlain(Math.max(balance, 0))}). Si necesitas más, pide un anticipo.`
        : 'No puedes pedir un pago mayor a lo que se te debe. Si necesitas más, pide un anticipo.'
    }
    default:
      return 'No se pudo completar la acción. Intenta de nuevo.'
  }
}
