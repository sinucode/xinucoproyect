'use client'

// Configuración → Medios de pago: los medios que el negocio ve al cobrar y al pagar.
// Efectivo es la caja (se puede renombrar, no apagar; su saldo lo maneja la caja).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Info, Loader2, Pencil, Plus, Wallet } from 'lucide-react'
import type { MoneyAccount, MoneyAccountKind } from '@xinuco/types'
import { reorderMoneyAccounts, saveMoneyAccount } from '@/actions/money-accounts'
import {
  MAX_ACCOUNT_NAME,
  METHOD_KIND_LABELS,
  SELECTABLE_METHOD_KINDS,
  formatMoney,
  methodKindLabel,
  moveInOrder,
  validateAccountForm,
} from '@/lib/money-accounts'
import { formatDateES } from '@/lib/fixed-assets-utils'
import { ResponsiveSheet } from '@/components/layout/ResponsiveSheet'
import { MoneyField } from '@/components/finance/MoneyField'

interface PaymentMethodsManagerProps {
  accounts: MoneyAccount[]
  /** 'YYYY-MM-DD' en hora de Bogotá. */
  today:    string
}

const ICON_BTN =
  'flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-xinuco-border text-xinuco-muted transition-colors hover:text-xinuco-text disabled:opacity-30 disabled:cursor-not-allowed'

export function PaymentMethodsManager({ accounts, today }: PaymentMethodsManagerProps) {
  const router = useRouter()
  const [sheet, setSheet] = useState<{ account: MoneyAccount | null } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const ids = accounts.map(a => a.id)

  function move(id: string, delta: -1 | 1) {
    setError(null)
    setBusyId(id)
    startTransition(async () => {
      const result = await reorderMoneyAccounts(moveInOrder(ids, id, delta))
      if (result.error) setError(result.error)
      setBusyId(null)
      router.refresh()
    })
  }

  function toggleActive(a: MoneyAccount) {
    setError(null)
    setBusyId(a.id)
    startTransition(async () => {
      const result = await saveMoneyAccount({
        id: a.id, name: a.name, method_kind: a.method_kind,
        opening_balance: a.opening_balance, opening_date: a.opening_date,
        is_active: !a.is_active,
      })
      if (result.error) setError(result.error)
      setBusyId(null)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 rounded-xl border border-xinuco-border bg-xinuco-surface px-4 py-3 text-sm text-xinuco-muted">
        <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Los medios que configures aquí son los que verás al cobrar y al pagar.{' '}
          <span className="font-medium text-xinuco-text">Efectivo es la caja.</span>
        </span>
      </p>

      {error && (
        <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-2.5 text-xs text-red-400">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-3" aria-label="Medios de pago">
        {accounts.map((a, i) => {
          const rowBusy = busyId === a.id && isPending
          return (
            <li
              key={a.id}
              className={`rounded-2xl border border-xinuco-border bg-xinuco-surface p-4 ${a.is_active ? '' : 'opacity-60'}`}
            >
              <div className="flex items-start gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)', color: 'var(--primary-color)' }}
                >
                  <Wallet size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="break-words text-sm font-semibold text-xinuco-text">{a.name}</p>
                    {a.is_cash_drawer && (
                      <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">Caja</span>
                    )}
                    {!a.is_active && (
                      <span className="rounded-full border border-xinuco-border px-2 py-0.5 text-[11px] font-semibold text-xinuco-muted">Apagado</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-xinuco-muted">{methodKindLabel(a.method_kind)}</p>
                  <p className="mt-1 text-xs text-xinuco-muted">
                    {a.is_cash_drawer ? (
                      'Saldo: lo maneja la caja'
                    ) : (
                      <>
                        Saldo inicial{' '}
                        <span className="font-semibold tabular-nums text-xinuco-text">{formatMoney(a.opening_balance)}</span>
                        {' '}desde {formatDateES(a.opening_date)}
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-xinuco-border pt-3">
                <button
                  type="button"
                  aria-label={`Subir ${a.name}`}
                  onClick={() => move(a.id, -1)}
                  disabled={i === 0 || isPending}
                  className={ICON_BTN}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Bajar ${a.name}`}
                  onClick={() => move(a.id, 1)}
                  disabled={i === accounts.length - 1 || isPending}
                  className={ICON_BTN}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setSheet({ account: a })}
                  className="flex min-h-11 items-center gap-1.5 rounded-xl border border-xinuco-border px-3 text-sm font-medium text-xinuco-text hover:bg-white/[0.04]"
                >
                  <Pencil size={14} aria-hidden="true" />
                  Editar
                </button>

                <div className="ml-auto flex items-center gap-2">
                  {rowBusy && <Loader2 size={14} className="animate-spin text-xinuco-muted" aria-hidden="true" />}
                  {a.is_cash_drawer ? (
                    <span className="text-xs text-xinuco-muted">Siempre activo</span>
                  ) : (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={a.is_active}
                      aria-label={`${a.is_active ? 'Apagar' : 'Activar'} ${a.name}`}
                      onClick={() => toggleActive(a)}
                      disabled={isPending}
                      className="flex min-h-11 items-center gap-2 rounded-xl px-1 disabled:opacity-50"
                    >
                      <span
                        className="relative h-6 w-11 rounded-full transition-colors"
                        style={{ background: a.is_active ? 'var(--primary-color)' : 'var(--border-color)' }}
                      >
                        <span
                          className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
                          style={{ left: a.is_active ? '22px' : '2px' }}
                        />
                      </span>
                      <span className="w-14 text-left text-xs text-xinuco-muted">{a.is_active ? 'Activo' : 'Apagado'}</span>
                    </button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={() => setSheet({ account: null })}
        className="btn-primary min-h-12 w-full sm:w-auto sm:self-start"
      >
        <Plus size={16} aria-hidden="true" />
        Agregar medio
      </button>

      <AccountSheet
        key={sheet?.account?.id ?? 'new'}
        open={sheet !== null}
        account={sheet?.account ?? null}
        today={today}
        onClose={() => setSheet(null)}
        onSaved={() => { setSheet(null); router.refresh() }}
      />
    </div>
  )
}

// ── Agregar / editar un medio ─────────────────────────────────────────────────

function AccountSheet({
  open, account, today, onClose, onSaved,
}: {
  open:    boolean
  account: MoneyAccount | null
  today:   string
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = account !== null
  const isCash = account?.is_cash_drawer === true

  const [name, setName] = useState(account?.name ?? '')
  const [kind, setKind] = useState<MoneyAccountKind>(account?.method_kind ?? 'transfer')
  const [balance, setBalance] = useState(account ? String(Math.max(account.opening_balance, 0)) : '0')
  const [date, setDate] = useState(account?.opening_date ?? today)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const openingBalance = isCash ? 0 : balance === '' ? NaN : Number(balance)
    const invalid = validateAccountForm(
      { name, kind, openingBalance, openingDate: date, today },
      { isCashDrawer: isCash },
    )
    if (invalid) return setError(invalid)

    startTransition(async () => {
      try {
        const result = await saveMoneyAccount({
          id: account?.id ?? null,
          name: name.trim(),
          method_kind: kind,
          opening_balance: openingBalance,
          opening_date: date,
          is_active: account?.is_active ?? true,
        })
        if (result.error) return setError(result.error)
        onSaved()
      } catch {
        setError('Error inesperado. Intenta de nuevo.')
      }
    })
  }

  const label = 'text-xs font-semibold uppercase tracking-wider text-xinuco-muted'

  return (
    <ResponsiveSheet
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar medio' : 'Agregar medio'}
      subtitle="Así lo verás al cobrar y al pagar"
    >
      <form onSubmit={submit} className="flex flex-col gap-4 pt-1">
        <div className="flex flex-col gap-2">
          <label htmlFor="pm-name" className={label}>Nombre *</label>
          <input
            id="pm-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={MAX_ACCOUNT_NAME}
            placeholder="Nequi, Bancolombia, Daviplata…"
            autoFocus={!isEdit}
            className="input-base min-h-11"
          />
        </div>

        {isCash ? (
          <p className="rounded-xl border border-xinuco-border bg-xinuco-surface px-3 py-2.5 text-xs text-xinuco-muted">
            Efectivo es la caja: su saldo sale del arqueo de cada turno. Puedes cambiarle el nombre, pero no apagarlo.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <span id="pm-kind-label" className={label}>Tipo *</span>
              <div role="radiogroup" aria-labelledby="pm-kind-label" className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
                {SELECTABLE_METHOD_KINDS.map(k => {
                  const selected = kind === k
                  return (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setKind(k)}
                      className="min-h-11 rounded-xl border px-3 py-2 text-center text-xs font-semibold leading-tight transition-colors"
                      style={selected ? {
                        borderColor: 'var(--primary-color)',
                        color: 'var(--primary-color)',
                        background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
                      } : { borderColor: 'var(--border-color)', color: 'var(--text-color)' }}
                    >
                      {METHOD_KIND_LABELS[k]}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="pm-balance" className={label}>¿Cuánto tienes hoy en este medio? *</label>
              <MoneyField id="pm-balance" value={balance} onChange={setBalance} placeholder="0" />
              <p className="text-xs text-xinuco-muted">
                Es el saldo con el que empieza. Desde la fecha de abajo se suman los cobros y se restan los pagos.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="pm-date" className={label}>Saldo a la fecha *</label>
              <input
                id="pm-date"
                type="date"
                value={date}
                max={today}
                onChange={e => setDate(e.target.value)}
                className="input-base min-h-11"
                style={{ colorScheme: 'dark' }}
              />
            </div>

            {isEdit && (
              <p className="flex items-start gap-2 text-xs text-xinuco-muted">
                <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                Si cambias el saldo inicial o la fecha, queda anotado en Auditoría.
              </p>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2.5 text-xs text-red-400">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 flex-1 rounded-xl border border-xinuco-border text-sm font-medium text-xinuco-muted hover:text-xinuco-text"
          >
            Cancelar
          </button>
          <button type="submit" disabled={isPending} className="btn-primary min-h-11 flex-1">
            {isPending ? <Loader2 size={15} className="animate-spin" /> : null}
            {isPending ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Agregar medio'}
          </button>
        </div>
      </form>
    </ResponsiveSheet>
  )
}
