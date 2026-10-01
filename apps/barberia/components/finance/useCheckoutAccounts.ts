'use client'

import { useEffect, useState } from 'react'
import type { CheckoutAccount } from '@xinuco/types'
import { listActiveAccountsForCheckout } from '@/actions/money-accounts'
import { LEGACY_CASH_ID } from '@/lib/money-accounts'

/** Efectivo de respaldo: si los medios no cargan, se cobra en efectivo como antes. */
const LEGACY_CASH: CheckoutAccount = {
  id: LEGACY_CASH_ID, name: 'Efectivo', method_kind: 'cash', is_cash_drawer: true,
}

/**
 * Medios activos del negocio para cobrar (cualquier miembro). Mientras cargan `loaded` es false;
 * si fallan o vienen vacíos queda solo el Efectivo de respaldo, para no bloquear el cobro.
 */
export function useCheckoutAccounts(enabled = true): { accounts: CheckoutAccount[]; loaded: boolean } {
  const [accounts, setAccounts] = useState<CheckoutAccount[] | null>(null)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    listActiveAccountsForCheckout()
      .then(r => { if (alive) setAccounts(r.data && r.data.length > 0 ? r.data : [LEGACY_CASH]) })
      .catch(() => { if (alive) setAccounts([LEGACY_CASH]) })
    return () => { alive = false }
  }, [enabled])

  return { accounts: accounts ?? [], loaded: accounts !== null }
}
