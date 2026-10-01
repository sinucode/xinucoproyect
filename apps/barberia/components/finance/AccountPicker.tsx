'use client'

// Selector de medio de pago: una cuadrícula de botones con los medios activos del negocio
// (Efectivo = la caja, bancos, tarjeta, Mercado Pago…). Sirve para cobrar y para pagar.
//
//   <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />
//   <AccountPicker ... allowOther balances={{ [id]: 120000 }} />   // pagos: "Otro medio" y saldos
//
// `value` es el id del medio elegido, OTHER_ACCOUNT_ID para "Otro medio" o null si aún no eligió.

import { Banknote, CreditCard, Landmark, QrCode, Wallet, type LucideIcon } from 'lucide-react'
import type { CheckoutAccount, MoneyAccountKind } from '@xinuco/types'
import { OTHER_ACCOUNT_ID, OTHER_ACCOUNT_LABEL, formatMoney } from '@/lib/money-accounts'

const KIND_ICONS: Record<MoneyAccountKind, LucideIcon> = {
  cash:        Banknote,
  transfer:    Landmark,
  card:        CreditCard,
  mercadopago: QrCode,
}

export function accountIcon(kind: string | null | undefined): LucideIcon {
  return KIND_ICONS[kind as MoneyAccountKind] ?? Wallet
}

interface AccountPickerProps {
  accounts:   CheckoutAccount[]
  value:      string | null
  onChange:   (value: string) => void
  /** Ofrece "Otro medio (fuera de tus cuentas)": solo para pagos. */
  allowOther?: boolean
  /** Saldo disponible por id de medio (solo el administrador puede leerlos). */
  balances?:  Record<string, number>
  /** Medios que no se pueden elegir ahora (p. ej. la caja sin turno abierto). */
  disabledIds?: string[]
  disabled?:  boolean
  ariaLabel?: string
}

export function AccountPicker({
  accounts, value, onChange, allowOther = false, balances, disabledIds, disabled = false, ariaLabel = 'Medio de pago',
}: AccountPickerProps) {
  const options = [
    ...accounts.map(a => ({
      id:      a.id,
      name:    a.is_cash_drawer ? 'Efectivo' : a.name,
      Icon:    accountIcon(a.method_kind),
      balance: balances ? balances[a.id] : undefined,
    })),
    ...(allowOther
      ? [{ id: OTHER_ACCOUNT_ID, name: OTHER_ACCOUNT_LABEL, Icon: Wallet, balance: undefined as number | undefined }]
      : []),
  ]

  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
      {options.map(o => {
        const active = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.balance !== undefined ? `${o.name}, saldo ${formatMoney(o.balance)}` : o.name}
            disabled={disabled || !!disabledIds?.includes(o.id)}
            onClick={() => onChange(o.id)}
            className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl border p-3 text-center transition-all disabled:cursor-not-allowed disabled:opacity-50
              ${o.id === OTHER_ACCOUNT_ID ? 'col-span-2 sm:col-span-1' : ''}
              ${active
                ? 'border-[var(--primary-color)] bg-[var(--primary-color)]/[0.08] text-[var(--primary-color)]'
                : 'border-zinc-900 bg-zinc-900/30 text-zinc-400 hover:border-zinc-800 hover:text-zinc-200'
              }`}
          >
            <o.Icon size={20} aria-hidden="true" />
            <span className="w-full text-xs font-semibold leading-tight [overflow-wrap:normal]">{o.name}</span>
            {o.balance !== undefined && (
              <span className={`text-[11px] tabular-nums ${o.balance < 0 ? 'text-red-400' : 'text-xinuco-muted'}`}>
                {formatMoney(o.balance)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
