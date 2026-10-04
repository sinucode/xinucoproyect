'use client'

// "Mover plata": aportes, préstamos y retiros del dueño, devoluciones, traslados y ajustes.
// Paso 1: elegir el tipo. Paso 2: formulario según el tipo, con vista previa de los saldos.
// Móvil = hoja inferior; escritorio = diálogo (ResponsiveSheet).

import { useState, useTransition } from 'react'
import {
  AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowLeftRight, ArrowUpFromLine, HandCoins,
  Landmark, Loader2, PiggyBank, SlidersHorizontal, type LucideIcon,
} from 'lucide-react'
import type { AccountMovementKind, MoneyAccountStatus } from '@xinuco/types'
import { recordAccountMovement } from '@/actions/money-accounts'
import {
  MOVEMENT_KINDS,
  buildMovementPayload,
  formatMoney,
  movementEnds,
  movementLabel,
  movementShape,
  previewBalances,
  type AdjustmentDirection,
} from '@/lib/money-accounts'
import { ResponsiveSheet } from '@/components/layout/ResponsiveSheet'
import { MoneyField } from '@/components/finance/MoneyField'

const KIND_ICONS: Record<AccountMovementKind, LucideIcon> = {
  owner_contribution: PiggyBank,
  owner_loan:         HandCoins,
  loan_repayment:     Landmark,
  owner_withdrawal:   ArrowUpFromLine,
  transfer:           ArrowLeftRight,
  adjustment:         SlidersHorizontal,
}

export interface MoveMoneyPreset {
  /** Salta directo al formulario de este tipo. */
  kind?:   AccountMovementKind
  toId?:   string
  fromId?: string
  amount?: number
}

interface MoveMoneySheetProps {
  open:               boolean
  onClose:            () => void
  accounts:           MoneyAccountStatus[]
  ownerLoansPending:  number
  hasOpenShift:       boolean
  preset?:            MoveMoneyPreset
  /** Se llama con el texto de confirmación cuando se registró. */
  onDone:             (message: string) => void
}

const LABEL = 'text-xs font-semibold uppercase tracking-wider text-xinuco-muted'

export function MoveMoneySheet(props: MoveMoneySheetProps) {
  const { open, onClose, preset } = props
  // El formulario se monta de nuevo cada vez que se abre (estado limpio y preset fresco)
  return (
    <ResponsiveSheet
      open={open}
      onClose={onClose}
      title="Mover plata"
      subtitle="Aportes, préstamos, retiros y traslados entre tus medios"
    >
      <MoveMoneyBody {...props} key={preset ? JSON.stringify(preset) : 'none'} />
    </ResponsiveSheet>
  )
}

function MoveMoneyBody({
  onClose, accounts, ownerLoansPending, hasOpenShift, preset, onDone,
}: MoveMoneySheetProps) {
  const [kind, setKind] = useState<AccountMovementKind | null>(preset?.kind ?? null)
  const [amount, setAmount] = useState(preset?.amount && preset.amount > 0 ? String(preset.amount) : '')
  const [fromId, setFromId] = useState<string | null>(preset?.fromId ?? accounts[0]?.id ?? null)
  const [toId, setToId] = useState<string | null>(
    preset?.toId ?? (accounts.find(a => a.id !== (preset?.fromId ?? accounts[0]?.id))?.id ?? accounts[0]?.id ?? null),
  )
  const [direction, setDirection] = useState<AdjustmentDirection>('up')
  const [adjustId, setAdjustId] = useState<string | null>(preset?.toId ?? accounts[0]?.id ?? null)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // ── Paso 1: elegir el tipo ──────────────────────────────────────────────────
  if (!kind) {
    return (
      <ul className="flex flex-col gap-2 pt-1" aria-label="¿Qué quieres registrar?">
        {MOVEMENT_KINDS.map(k => {
          const Icon = KIND_ICONS[k.kind]
          const noLoans = k.kind === 'loan_repayment' && ownerLoansPending <= 0
          const needsTwo = k.kind === 'transfer' && accounts.length < 2
          const disabled = noLoans || needsTwo
          return (
            <li key={k.kind}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setKind(k.kind)
                  if (k.kind === 'loan_repayment' && !amount) setAmount(String(ownerLoansPending))
                }}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-xinuco-border bg-xinuco-surface px-3 py-2 text-left transition-colors active:bg-fg/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'color-mix(in srgb, var(--primary-color) 15%, transparent)', color: 'var(--primary-color)' }}
                >
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-xinuco-text">{k.label}</span>
                  <span className="block text-xs text-xinuco-muted">
                    {noLoans ? 'No hay préstamos del dueño pendientes.' : needsTwo ? 'Necesitas al menos dos medios.' : k.hint}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  // ── Paso 2: formulario ──────────────────────────────────────────────────────
  const info = MOVEMENT_KINDS.find(k => k.kind === kind)!
  const shape = movementShape(kind)
  const amountN = amount === '' ? NaN : Number(amount)
  const form = { kind, amount: amountN, fromId, toId, direction, adjustId, notes }
  const ends = movementEnds(form)
  const preview = Number.isFinite(amountN) && amountN > 0
    ? previewBalances({ amount: amountN, from: ends.from, to: ends.to }, accounts)
    : []
  const goesNegative = preview.filter(p => p.after < 0)
  const touchesCash = [ends.from, ends.to].some(id => accounts.find(a => a.id === id)?.is_cash_drawer)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const built = buildMovementPayload(form, { ownerLoansPending })
    if ('error' in built) return setError(built.error)
    const { payload } = built

    startTransition(async () => {
      try {
        const result = await recordAccountMovement({
          kind: payload.kind, amount: payload.amount, from: payload.from, to: payload.to, notes: payload.notes,
        })
        if (result.error) return setError(result.error)
        onDone(`Listo: ${movementLabel(payload.kind).toLowerCase()} de ${formatMoney(payload.amount)} registrado.`)
      } catch {
        setError('Error inesperado. Intenta de nuevo.')
      }
    })
  }

  const accountOptions = accounts.map(a => (
    <option key={a.id} value={a.id}>{a.name} · {formatMoney(a.balance)}</option>
  ))

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 pt-1">
      <div className="flex items-start gap-2">
        {!preset?.kind && (
          <button
            type="button"
            onClick={() => { setKind(null); setError(null) }}
            aria-label="Cambiar el tipo de movimiento"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-xinuco-border text-xinuco-muted hover:text-xinuco-text"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-xinuco-text">{info.label}</p>
          <p className="text-xs text-xinuco-muted">{info.hint}</p>
        </div>
      </div>

      {kind === 'adjustment' && (
        <div className="flex flex-col gap-2">
          <span id="mm-dir-label" className={LABEL}>¿Qué quieres hacer? *</span>
          <div role="radiogroup" aria-labelledby="mm-dir-label" className="grid grid-cols-2 gap-2">
            {([
              { value: 'up',   label: 'Subir saldo', icon: ArrowDownToLine },
              { value: 'down', label: 'Bajar saldo', icon: ArrowUpFromLine },
            ] as const).map(opt => {
              const selected = direction === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setDirection(opt.value)}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors"
                  style={selected ? {
                    borderColor: 'var(--primary-color)',
                    color: 'var(--primary-color)',
                    background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
                  } : { borderColor: 'var(--border-color)', color: 'var(--text-color)' }}
                >
                  <opt.icon size={14} aria-hidden="true" />
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="mm-amount" className={LABEL}>Monto *</label>
        <MoneyField id="mm-amount" value={amount} onChange={setAmount} placeholder="50.000" autoFocus />
      </div>

      {shape.from && (
        <div className="flex flex-col gap-2">
          <label htmlFor="mm-from" className={LABEL}>
            {kind === 'transfer' ? 'Desde' : 'Sale de'} *
          </label>
          <select id="mm-from" value={fromId ?? ''} onChange={e => setFromId(e.target.value)} className="input-base min-h-11">
            {accountOptions}
          </select>
        </div>
      )}

      {shape.to && (
        <div className="flex flex-col gap-2">
          <label htmlFor="mm-to" className={LABEL}>
            {kind === 'transfer' ? 'Hacia' : 'Entra a'} *
          </label>
          <select id="mm-to" value={toId ?? ''} onChange={e => setToId(e.target.value)} className="input-base min-h-11">
            {accountOptions}
          </select>
        </div>
      )}

      {kind === 'adjustment' && (
        <div className="flex flex-col gap-2">
          <label htmlFor="mm-adjust" className={LABEL}>Medio a ajustar *</label>
          <select id="mm-adjust" value={adjustId ?? ''} onChange={e => setAdjustId(e.target.value)} className="input-base min-h-11">
            {accountOptions}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="mm-notes" className={LABEL}>
          {shape.noteRequired ? 'Motivo *' : 'Nota (opcional)'}
        </label>
        <input
          id="mm-notes"
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          maxLength={200}
          placeholder={shape.noteRequired ? 'Ej: Conté mal el domingo' : 'Ej: Para cubrir el arriendo'}
          className="input-base min-h-11"
        />
      </div>

      {preview.length > 0 && (
        <div className="rounded-xl border border-xinuco-border bg-xinuco-surface px-3 py-3" aria-live="polite">
          <p className={`${LABEL} mb-2`}>Así quedan tus saldos</p>
          <ul className="flex flex-col gap-1.5">
            {preview.map(p => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="text-xinuco-text">{p.name}</span>
                <span className="tabular-nums text-xinuco-muted">
                  {formatMoney(p.before)} →{' '}
                  <span className={`font-bold ${p.after < 0 ? 'text-red-400' : 'text-xinuco-text'}`}>{formatMoney(p.after)}</span>
                </span>
              </li>
            ))}
          </ul>
          {goesNegative.length > 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-400">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              {goesNegative.map(p => p.name).join(' y ')} quedaría en negativo. Puedes registrarlo igual, pero revisa el monto.
            </p>
          )}
        </div>
      )}

      {touchesCash && (
        <p className="text-xs text-xinuco-muted">
          {hasOpenShift
            ? 'Toca la caja: queda en el turno abierto y cuenta en el arqueo.'
            : 'No hay caja abierta: se suma o resta al efectivo que quedó en el último cierre.'}
        </p>
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
          {isPending && <Loader2 size={15} className="animate-spin" />}
          {isPending ? 'Guardando…' : 'Registrar'}
        </button>
      </div>
    </form>
  )
}
