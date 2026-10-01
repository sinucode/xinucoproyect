// lib/money-accounts.ts — medios de pago y cuentas de dinero (puro, sin acceso a datos).
//
// Etiquetas, validaciones y el mismo mapeo "método de siempre → medio" que hace la base de datos
// (para avisar antes de pagar sin saldo suficiente). Los saldos los calcula la base.

import type {
  AccountMovementKind,
  MoneyAccountCustomKind,
  MoneyAccountKind,
  MoneyAccountStatus,
} from '@xinuco/types'

// ── Tipos de medio ────────────────────────────────────────────────────────────

export const METHOD_KIND_LABELS: Record<MoneyAccountKind, string> = {
  cash:        'Efectivo',
  transfer:    'Transferencia / Banco',
  card:        'Tarjeta (datáfono)',
  mercadopago: 'Mercado Pago',
}

/** Tipos que el administrador puede elegir al agregar o editar un medio. */
export const SELECTABLE_METHOD_KINDS: MoneyAccountCustomKind[] = ['transfer', 'card', 'mercadopago']

export function methodKindLabel(kind: string | null | undefined): string {
  return METHOD_KIND_LABELS[kind as MoneyAccountKind] ?? 'Otro'
}

export const MAX_ACCOUNT_NAME = 40
export const MIN_ACCOUNT_NAME = 2
/** Tope del saldo (espejo de la base de datos). */
export const MAX_ACCOUNT_BALANCE = 2_000_000_000

// ── Formato ───────────────────────────────────────────────────────────────────

/** "$1.200.000" — y "−$50.000" si es negativo. */
export function formatMoney(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0)
  return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('es-CO')
}

/** "+$20.000" / "−$5.000" / "$0": para el resultado del día. */
export function formatSignedMoney(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0)
  if (v === 0) return '$0'
  return (v > 0 ? '+$' : '−$') + Math.abs(v).toLocaleString('es-CO')
}

// ── Movimientos de plata ──────────────────────────────────────────────────────

export interface MovementKindInfo {
  kind:  AccountMovementKind
  label: string
  /** Una línea que explica el efecto contable. */
  hint:  string
}

/** En el orden en que se ofrecen al administrador. */
export const MOVEMENT_KINDS: MovementKindInfo[] = [
  { kind: 'owner_contribution', label: 'Aporte del dueño',      hint: 'El dueño pone plata y no la espera de vuelta. No cuenta como venta.' },
  { kind: 'owner_loan',         label: 'Préstamo del dueño',    hint: 'Queda como deuda del negocio con el dueño. No cuenta como venta.' },
  { kind: 'loan_repayment',     label: 'Devolver préstamo',     hint: 'El negocio le devuelve plata al dueño. No cuenta como gasto.' },
  { kind: 'owner_withdrawal',   label: 'Retiro del dueño',      hint: 'El dueño saca plata del negocio. No cuenta como gasto.' },
  { kind: 'transfer',           label: 'Traslado entre medios', hint: 'Pasas plata de un medio a otro (por ejemplo, de la caja al banco).' },
  { kind: 'adjustment',         label: 'Ajuste de saldo',       hint: 'Corriges un saldo que no cuadra. Debes explicar el motivo.' },
]

export function movementLabel(kind: AccountMovementKind): string {
  return MOVEMENT_KINDS.find(k => k.kind === kind)?.label ?? 'Movimiento'
}

export interface MovementShape {
  /** Pide el medio de origen ("Desde"). */
  from: boolean
  /** Pide el medio de destino ("Hacia"). */
  to: boolean
  /** La nota es obligatoria. */
  noteRequired: boolean
}

export function movementShape(kind: AccountMovementKind): MovementShape {
  switch (kind) {
    case 'owner_contribution':
    case 'owner_loan':       return { from: false, to: true,  noteRequired: false }
    case 'loan_repayment':
    case 'owner_withdrawal': return { from: true,  to: false, noteRequired: false }
    case 'transfer':         return { from: true,  to: true,  noteRequired: false }
    case 'adjustment':       return { from: false, to: false, noteRequired: true }
  }
}

export type AdjustmentDirection = 'up' | 'down'

export interface MovementForm {
  kind:      AccountMovementKind
  amount:    number
  fromId:    string | null
  toId:      string | null
  /** Solo para ajustes: subir (hacia) o bajar (desde) el saldo del medio elegido. */
  direction: AdjustmentDirection
  /** Medio del ajuste (se guarda como hacia o desde según la dirección). */
  adjustId:  string | null
  notes:     string
}

export interface MovementPayload {
  kind:   AccountMovementKind
  amount: number
  from:   string | null
  to:     string | null
  notes:  string | null
}

/** De qué medio sale y a cuál entra la plata, sin validar (para la vista previa mientras se llena). */
export function movementEnds(form: Pick<MovementForm, 'kind' | 'fromId' | 'toId' | 'direction' | 'adjustId'>): {
  from: string | null
  to:   string | null
} {
  if (form.kind === 'adjustment') {
    return form.direction === 'up'
      ? { from: null, to: form.adjustId }
      : { from: form.adjustId, to: null }
  }
  const shape = movementShape(form.kind)
  return { from: shape.from ? form.fromId : null, to: shape.to ? form.toId : null }
}

/** Convierte lo que llenó la persona en lo que recibe record_account_movement (o un error en español). */
export function buildMovementPayload(
  form: MovementForm,
  ctx: { ownerLoansPending: number },
): { payload: MovementPayload } | { error: string } {
  const shape = movementShape(form.kind)
  const amount = form.amount
  if (!Number.isInteger(amount) || amount < 1) return { error: 'Escribe un monto mayor a $0.' }
  if (amount > MAX_ACCOUNT_BALANCE) return { error: 'El monto es demasiado grande.' }

  const { from, to } = movementEnds(form)
  if (form.kind === 'adjustment') {
    if (!form.adjustId) return { error: 'Elige el medio que vas a ajustar.' }
  } else {
    if (shape.from && !from) return { error: 'Elige de qué medio sale la plata.' }
    if (shape.to && !to) return { error: 'Elige a qué medio entra la plata.' }
    if (shape.from && shape.to && from === to) return { error: 'El medio de origen y el de destino deben ser distintos.' }
  }

  const notes = form.notes.trim()
  if (shape.noteRequired && notes.length < 3) return { error: 'Cuéntanos el motivo del ajuste.' }
  if (notes.length > 200) return { error: 'La nota no puede superar 200 caracteres.' }

  if (form.kind === 'loan_repayment' && amount > ctx.ownerLoansPending) {
    return { error: `Solo le debes al dueño ${formatMoney(Math.max(ctx.ownerLoansPending, 0))}.` }
  }

  return { payload: { kind: form.kind, amount, from, to, notes: notes || null } }
}

export interface BalancePreview {
  id:     string
  name:   string
  before: number
  after:  number
}

/** Cómo quedan los saldos de los medios afectados (vista previa antes de guardar). */
export function previewBalances(
  payload: Pick<MovementPayload, 'amount' | 'from' | 'to'>,
  accounts: Pick<MoneyAccountStatus, 'id' | 'name' | 'balance'>[],
): BalancePreview[] {
  const out: BalancePreview[] = []
  const add = (id: string | null, delta: number) => {
    if (!id) return
    const a = accounts.find(x => x.id === id)
    if (a) out.push({ id: a.id, name: a.name, before: a.balance, after: a.balance + delta })
  }
  add(payload.from, -payload.amount)
  add(payload.to, payload.amount)
  return out
}

// ── Mapeo del método de siempre → medio (espejo de _default_account en la base) ───

type AccountRef = Pick<MoneyAccountStatus, 'id' | 'name' | 'method_kind' | 'is_cash_drawer' | 'balance'>

/**
 * Medio al que la base asigna un cobro/pago hecho con un método de siempre:
 *  - efectivo / efectivo de la caja → Efectivo (la caja)
 *  - transferencia / tarjeta / Mercado Pago / mixto → el primer medio activo que no sea la caja,
 *    prefiriendo el del mismo tipo
 *  - otro / vacío / puntos → fuera de las cuentas (null: no afecta saldos)
 * `accounts` debe venir en orden (sort_order) y solo con medios activos, como lo devuelve el estado.
 */
export function legacyMethodToAccount<T extends AccountRef>(
  method: string | null | undefined,
  accounts: T[],
): T | null {
  if (!method || method === 'other' || method === 'loyalty_points') return null
  if (method === 'cash' || method === 'cash_register') {
    return accounts.find(a => a.is_cash_drawer) ?? null
  }
  const others = accounts.filter(a => !a.is_cash_drawer)
  return others.find(a => a.method_kind === method) ?? others[0] ?? null
}

// ── Saldo suficiente ──────────────────────────────────────────────────────────

/** ¿El monto supera lo disponible? Un monto vacío o ≤ 0 nunca falta. */
export function insufficientFunds(balance: number, amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false
  return amount > balance
}

/** Cuánto falta para poder pagar el monto (0 si alcanza). */
export function fundsShortfall(balance: number, amount: number): number {
  return insufficientFunds(balance, amount) ? Math.round(amount - balance) : 0
}

// ── Validación de un medio ────────────────────────────────────────────────────

export interface AccountFormInput {
  name:           string
  kind:           MoneyAccountKind
  openingBalance: number
  openingDate:    string
  today:          string
}

export function validateAccountForm(input: AccountFormInput, opts: { isCashDrawer: boolean }): string | null {
  const name = input.name.trim()
  if (name.length < MIN_ACCOUNT_NAME || name.length > MAX_ACCOUNT_NAME) {
    return `El nombre debe tener entre ${MIN_ACCOUNT_NAME} y ${MAX_ACCOUNT_NAME} caracteres.`
  }
  if (!opts.isCashDrawer && !(SELECTABLE_METHOD_KINDS as string[]).includes(input.kind)) {
    return 'Elige un tipo de medio.'
  }
  if (!opts.isCashDrawer) {
    if (!Number.isInteger(input.openingBalance) || input.openingBalance < 0 || input.openingBalance > MAX_ACCOUNT_BALANCE) {
      return 'Escribe cuánto tienes hoy en este medio (un número desde $0).'
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.openingDate)) return 'Elige la fecha desde la que cuentas ese saldo.'
  if (input.openingDate > input.today) return 'La fecha no puede ser futura.'
  return null
}

/** Sube o baja un medio un puesto (devuelve los ids en el nuevo orden). */
export function moveInOrder(ids: string[], id: string, delta: -1 | 1): string[] {
  const i = ids.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= ids.length) return ids
  const next = [...ids]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

// ── Errores ───────────────────────────────────────────────────────────────────

const ERROR_TABLE: [string, string][] = [
  ['forbidden',        'Solo un administrador puede manejar los medios de pago y la plata del negocio.'],
  ['invalid_name',     'El nombre debe tener entre 2 y 40 caracteres.'],
  ['invalid_amount',   'El monto no es válido. Revisa el valor que escribiste.'],
  ['invalid_date',     'La fecha no puede ser futura.'],
  ['invalid_kind',     'Elige un tipo válido.'],
  ['not_found',        'No encontramos ese medio de pago.'],
  ['cash_required',    'Efectivo es la caja y no se puede desactivar.'],
  ['duplicate_name',   'Ya tienes un medio con ese nombre. Elige otro.'],
  ['exceeds_loan',     'Es más de lo que el negocio le debe al dueño.'],
  ['reason_required',  'Cuéntanos el motivo del ajuste.'],
  ['invalid_accounts', 'Revisa los medios elegidos: el de origen y el de destino deben ser distintos.'],
  ['invalid_account',  'Elige un medio de pago activo.'],
]

/** Traduce un código de error de la base (o un mensaje que lo contenga) a un texto en español. */
export function mapAccountError(code: string | null | undefined): string {
  const msg = code ?? ''
  for (const [key, text] of ERROR_TABLE) {
    if (msg.includes(key)) return text
  }
  return 'No se pudo completar la acción. Intenta de nuevo.'
}
