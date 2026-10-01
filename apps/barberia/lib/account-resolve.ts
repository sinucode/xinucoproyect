// lib/account-resolve.ts — Resuelve en el servidor el medio de pago elegido por el cliente.
//
// Los pagos que se insertan directo en la base (gastos, pagos al equipo) no pasan por una función
// que valide el medio, así que se comprueba aquí: debe ser un medio del negocio de la sesión (y
// activo, salvo que ya fuera el que tenía el registro que se edita). El método de pago "de siempre"
// se deriva del medio, nunca se confía en el que mande el cliente.

import type { CheckoutAccount, MoneyAccountKind } from '@xinuco/types'

/** Lo mínimo que necesitamos del cliente de Supabase (evita acoplar este módulo al paquete). */
interface AccountsClient {
  from: (table: string) => any
}

export const INVALID_ACCOUNT_MESSAGE = 'Elige un medio de pago activo.'

/** UUID v1-v5 (formato). */
export const ACCOUNT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Busca el medio dentro del negocio. `allowInactiveId`: un medio ya apagado sigue valiendo si es el
 * que ya tenía el registro que se edita (así editar la descripción no obliga a cambiar de medio).
 */
export async function resolveAccount(
  supabase: AccountsClient,
  businessId: string,
  accountId: string,
  allowInactiveId?: string | null,
): Promise<{ account: CheckoutAccount } | { error: string }> {
  if (typeof accountId !== 'string' || !ACCOUNT_UUID_RE.test(accountId)) {
    return { error: INVALID_ACCOUNT_MESSAGE }
  }

  const { data, error } = await supabase
    .from('money_accounts')
    .select('id, name, method_kind, is_cash_drawer, is_active')
    .eq('id', accountId)
    .eq('business_id', businessId)
    .maybeSingle()

  const row = data as { id: string; name: string; method_kind: string; is_cash_drawer: boolean; is_active: boolean } | null
  if (error || !row) return { error: INVALID_ACCOUNT_MESSAGE }
  if (!row.is_active && row.id !== allowInactiveId) return { error: INVALID_ACCOUNT_MESSAGE }

  return {
    account: {
      id:             row.id,
      name:           row.name,
      method_kind:    row.method_kind as MoneyAccountKind,
      is_cash_drawer: row.is_cash_drawer === true,
    },
  }
}
