/**
 * Medios de pago y cuentas de dinero (money_accounts / account_movements).
 * Los saldos y movimientos los calcula la base de datos (ver migración 20261001100000_money_accounts).
 */

/** Tipo de medio. 'cash' es solo Efectivo (la caja). */
export type MoneyAccountKind = 'cash' | 'transfer' | 'card' | 'mercadopago'

/** Tipos que se pueden elegir al crear o editar un medio (Efectivo siempre existe). */
export type MoneyAccountCustomKind = Exclude<MoneyAccountKind, 'cash'>

export interface MoneyAccount {
  id:              string
  business_id:     string
  name:            string
  method_kind:     MoneyAccountKind
  is_cash_drawer:  boolean
  is_active:       boolean
  sort_order:      number
  opening_balance: number
  /** 'YYYY-MM-DD' */
  opening_date:    string
}

/** Un medio dentro de get_money_accounts_status(): saldo y resultado de hoy. */
export interface MoneyAccountStatus {
  id:              string
  name:            string
  method_kind:     MoneyAccountKind
  is_cash_drawer:  boolean
  opening_balance: number
  opening_date:    string
  today_in:        number
  today_out:       number
  today_net:       number
  /** Efectivo = lo que debe haber en la caja; los demás = saldo inicial + entradas − salidas. */
  balance:         number
}

export interface MoneyAccountsStatus {
  /** 'YYYY-MM-DD' (hoy en Bogotá) */
  today:               string
  accounts:            MoneyAccountStatus[]
  /** Lo que el negocio le debe al dueño por préstamos sin devolver. */
  owner_loans_pending: number
  open_shift_id:       string | null
}

export type AccountMovementKind =
  | 'owner_contribution'
  | 'owner_loan'
  | 'loan_repayment'
  | 'owner_withdrawal'
  | 'transfer'
  | 'adjustment'

export interface AccountMovement {
  id:              string
  business_id:     string
  kind:            AccountMovementKind
  from_account_id: string | null
  to_account_id:   string | null
  amount:          number
  notes:           string | null
  shift_id:        string | null
  occurred_at:     string
}
