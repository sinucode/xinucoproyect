'use server'
// actions/money-accounts.ts — Medios de pago y cuentas de dinero.
//
// Solo el administrador. El negocio sale SIEMPRE del perfil de la sesión (nunca del cliente) y la
// base de datos lo vuelve a comprobar dentro de cada función (save_money_account,
// get_money_accounts_status, record_account_movement). Los saldos los calcula la base.

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import type {
  AccountMovementKind,
  MoneyAccount,
  MoneyAccountKind,
  MoneyAccountsStatus,
  MoneyAccountStatus,
} from '@xinuco/types'
import { MOVEMENT_KINDS, mapAccountError } from '@/lib/money-accounts'

const NOT_ADMIN = 'Solo un administrador puede manejar los medios de pago y la plata del negocio.'
const LOAD_FAILED = 'No se pudo cargar la información. Intenta de nuevo.'

type Supabase = Awaited<ReturnType<typeof createClient>>

// ── Autorización ──────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<
  { supabase: Supabase; businessId: string; userId: string } | { error: string }
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

  return { supabase, businessId, userId: user.id }
}

function revalidateMoney() {
  // Inicio (tarjeta "Tu plata" y caja), contabilidad y la pantalla de medios
  revalidatePath('/[slug]/dashboard', 'layout')
  revalidatePath('/[slug]/dashboard/accounting', 'page')
  revalidatePath('/[slug]/dashboard/settings', 'page')
  revalidatePath('/[slug]/dashboard/settings/payment-methods', 'page')
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// ── Estado de los medios (saldos y resultado de hoy) ──────────────────────────

export async function getMoneyAccountsStatus(): Promise<{ data?: MoneyAccountsStatus; error?: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }

  const { data, error } = await auth.supabase.rpc('get_money_accounts_status')
  if (error || !data || typeof data !== 'object') {
    if (error) console.error('Error fetching money accounts status:', error)
    return { error: error ? mapAccountError(error.message) : LOAD_FAILED }
  }

  const raw = data as Record<string, unknown>
  const rows = Array.isArray(raw.accounts) ? (raw.accounts as Record<string, unknown>[]) : []
  const accounts: MoneyAccountStatus[] = rows.map(r => ({
    id:              String(r.id),
    name:            String(r.name ?? ''),
    method_kind:     String(r.method_kind) as MoneyAccountKind,
    is_cash_drawer:  r.is_cash_drawer === true,
    opening_balance: num(r.opening_balance),
    opening_date:    String(r.opening_date ?? ''),
    today_in:        num(r.today_in),
    today_out:       num(r.today_out),
    today_net:       num(r.today_net),
    balance:         num(r.balance),
  }))

  return {
    data: {
      today:               String(raw.today ?? ''),
      accounts,
      owner_loans_pending: num(raw.owner_loans_pending),
      open_shift_id:       typeof raw.open_shift_id === 'string' ? raw.open_shift_id : null,
    },
  }
}

// ── Lista de medios (todos, también los apagados: para Configuración) ─────────

export async function listMoneyAccounts(): Promise<{ data?: MoneyAccount[]; error?: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }

  const { data, error } = await auth.supabase
    .from('money_accounts')
    .select('id, business_id, name, method_kind, is_cash_drawer, is_active, sort_order, opening_balance, opening_date')
    .eq('business_id', auth.businessId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error || !Array.isArray(data)) {
    if (error) console.error('Error listing money accounts:', error)
    return { error: LOAD_FAILED }
  }

  return {
    data: (data as Record<string, unknown>[]).map(r => ({
      id:              String(r.id),
      business_id:     String(r.business_id),
      name:            String(r.name ?? ''),
      method_kind:     String(r.method_kind) as MoneyAccountKind,
      is_cash_drawer:  r.is_cash_drawer === true,
      is_active:       r.is_active !== false,
      sort_order:      num(r.sort_order),
      opening_balance: num(r.opening_balance),
      opening_date:    String(r.opening_date ?? ''),
    })),
  }
}

// ── Crear / editar un medio ───────────────────────────────────────────────────

export interface SaveMoneyAccountInput {
  /** null/undefined = crear. */
  id?:             string | null
  name:            string
  method_kind:     MoneyAccountKind
  opening_balance: number
  /** 'YYYY-MM-DD' */
  opening_date:    string
  is_active:       boolean
  sort_order?:     number | null
}

export async function saveMoneyAccount(
  input: SaveMoneyAccountInput,
): Promise<{ success?: boolean; id?: string; error?: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }

  const { data, error } = await auth.supabase.rpc('save_money_account', {
    p_id:              input.id ?? null,
    p_name:            input.name,
    p_method_kind:     input.method_kind,
    p_opening_balance: input.opening_balance,
    p_opening_date:    input.opening_date,
    p_is_active:       input.is_active,
    p_sort_order:      input.sort_order ?? null,
  })

  if (error) {
    console.error('Error saving money account:', error)
    return { error: mapAccountError(error.message) }
  }

  revalidateMoney()
  return { success: true, id: typeof data === 'string' ? data : undefined }
}

/** Guarda el orden de los medios (el primero de la lista queda de primero al cobrar y pagar). */
export async function reorderMoneyAccounts(orderedIds: string[]): Promise<{ success?: boolean; error?: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return { success: true }

  const list = await listMoneyAccounts()
  if (!list.data) return { error: list.error ?? LOAD_FAILED }
  const byId = new Map(list.data.map(a => [a.id, a]))

  for (let i = 0; i < orderedIds.length; i++) {
    const a = byId.get(orderedIds[i])
    if (!a || a.sort_order === i) continue
    // La función reemplaza todo el medio: se reenvía lo que ya tiene y solo cambia el orden
    const { error } = await auth.supabase.rpc('save_money_account', {
      p_id:              a.id,
      p_name:            a.name,
      p_method_kind:     a.method_kind,
      p_opening_balance: a.opening_balance,
      p_opening_date:    a.opening_date,
      p_is_active:       a.is_active,
      p_sort_order:      i,
    })
    if (error) {
      console.error('Error reordering money accounts:', error)
      revalidateMoney()
      return { error: mapAccountError(error.message) }
    }
  }

  revalidateMoney()
  return { success: true }
}

// ── Mover plata ───────────────────────────────────────────────────────────────

export interface RecordAccountMovementInput {
  kind:   AccountMovementKind
  amount: number
  /** Medio del que sale la plata (según el tipo). */
  from?:  string | null
  /** Medio al que entra la plata (según el tipo). */
  to?:    string | null
  notes?: string | null
}

export async function recordAccountMovement(
  input: RecordAccountMovementInput,
): Promise<{ success?: boolean; id?: string; error?: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error }

  if (!MOVEMENT_KINDS.some(k => k.kind === input.kind)) return { error: mapAccountError('invalid_kind') }
  if (!Number.isInteger(input.amount) || input.amount <= 0) return { error: mapAccountError('invalid_amount') }

  const { data, error } = await auth.supabase.rpc('record_account_movement', {
    p_kind:   input.kind,
    p_amount: input.amount,
    p_from:   input.from ?? null,
    p_to:     input.to ?? null,
    p_notes:  input.notes?.trim() || null,
  })

  if (error) {
    console.error('Error recording account movement:', error)
    return { error: mapAccountError(error.message) }
  }

  revalidateMoney()
  return { success: true, id: typeof data === 'string' ? data : undefined }
}
