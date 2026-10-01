'use client'

// Aviso antes de pagar: "Disponible en {medio}: $X" y, si el monto no alcanza, una caja ámbar
// con la opción de registrar un aporte o préstamo del dueño y una confirmación explícita
// ("Registrar de todas formas") que habilita el botón de guardar.
//
// Uso en un formulario de pago:
//   const funds = useFundsCheck({ accountId, amount, enabled: !isEdit })
//   <AccountPicker accounts={funds.accounts} balances={funds.balances} value={accountId} ... />
//   <FundsWarning check={funds} />
//   <button disabled={isPending || funds.blocked}>Guardar</button>
//
// El hook también entrega los medios activos (con saldos si es administrador) para el selector.
// `enabled` solo apaga el aviso (p. ej. al editar): los medios se cargan siempre.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import type { CheckoutAccount, MoneyAccountStatus, MoneyAccountsStatus } from '@xinuco/types'
import { getMoneyAccountsStatus, listActiveAccountsForCheckout } from '@/actions/money-accounts'
import { formatMoney, fundsShortfall, insufficientFunds } from '@/lib/money-accounts'

export interface FundsCheck {
  /** Medios activos para el selector (vacío mientras cargan). */
  accounts:     CheckoutAccount[]
  /** Saldo por medio; solo existe si se pudo leer el estado (administrador). */
  balances?:    Record<string, number>
  /** true cuando ya se cargó la lista de medios. */
  loaded:       boolean
  /** Medio al que se cargará el pago; null = "Otro medio" (fuera de las cuentas), sin elegir o aún cargando. */
  account:      MoneyAccountStatus | null
  insufficient: boolean
  shortfall:    number
  confirmed:    boolean
  setConfirmed: (v: boolean) => void
  /** true = el monto no alcanza y falta la confirmación: el botón de guardar debe estar apagado. */
  blocked:      boolean
}

export function useFundsCheck({
  accountId, amount, enabled = true,
}: {
  /** Id del medio elegido (null / "other" = fuera de las cuentas: no hay aviso). */
  accountId: string | null | undefined
  amount:    number
  enabled?:  boolean
}): FundsCheck {
  const [status, setStatus] = useState<MoneyAccountsStatus | null>(null)
  const [fallback, setFallback] = useState<CheckoutAccount[] | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  // Los medios y sus saldos se leen cada vez que se abre el formulario
  useEffect(() => {
    let alive = true
    ;(async () => {
      let st: MoneyAccountsStatus | null = null
      try { st = (await getMoneyAccountsStatus()).data ?? null } catch { st = null }
      if (!alive) return
      if (st) {
        setStatus(st)
      } else {
        // Sin permiso de ver saldos o con error: se ofrecen los medios sin saldo
        try { setFallback((await listActiveAccountsForCheckout()).data ?? null) } catch { setFallback(null) }
      }
      if (alive) setLoaded(true)
    })()
    return () => { alive = false }
  }, [])

  const accounts: CheckoutAccount[] = status
    ? status.accounts.map(a => ({ id: a.id, name: a.name, method_kind: a.method_kind, is_cash_drawer: a.is_cash_drawer }))
    : fallback ?? []
  const balances = status ? Object.fromEntries(status.accounts.map(a => [a.id, a.balance])) : undefined

  const account = enabled && status && accountId ? status.accounts.find(a => a.id === accountId) ?? null : null
  const insufficient = !!account && insufficientFunds(account.balance, amount)
  const shortfall = account ? fundsShortfall(account.balance, amount) : 0

  // Si ya alcanza (o cambia de medio), la confirmación anterior ya no vale
  const currentId = account?.id ?? null
  useEffect(() => { setConfirmed(false) }, [currentId, insufficient])

  return {
    accounts,
    balances,
    loaded,
    account,
    insufficient,
    shortfall,
    confirmed,
    setConfirmed,
    blocked: insufficient && !confirmed,
  }
}

export function FundsWarning({ check }: { check: FundsCheck }) {
  const params = useParams<{ slug?: string }>()
  const slug = params?.slug
  const { account, insufficient, shortfall, confirmed, setConfirmed } = check
  if (!account) return null

  const low = insufficient || account.balance < 0

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <p className={`text-xs ${low ? 'font-semibold text-red-400' : 'text-xinuco-muted'}`}>
        Disponible en {account.name}:{' '}
        <span className="tabular-nums">{formatMoney(account.balance)}</span>
      </p>

      {insufficient && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border px-3 py-3 text-xs animate-fade-in"
          style={{ color: '#fbbf24', borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.08)' }}
        >
          <p className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              No tienes suficiente en {account.name} (faltan{' '}
              <span className="font-bold tabular-nums">{formatMoney(shortfall)}</span>). Cambia el medio de pago o
              registra un aporte o préstamo del dueño.
            </span>
          </p>

          {slug && (
            <Link
              href={`/${slug}/dashboard?mover=1&hacia=${account.id}&monto=${shortfall}`}
              className="flex min-h-11 items-center justify-center rounded-xl border border-amber-400/40 px-3 text-center text-xs font-bold hover:bg-amber-400/10"
            >
              Registrar aporte o préstamo
            </Link>
          )}

          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-xs font-medium">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="h-5 w-5 shrink-0 accent-amber-400"
            />
            Registrar de todas formas
          </label>
        </div>
      )}
    </div>
  )
}
