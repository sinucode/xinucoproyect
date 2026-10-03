'use client'

// Panel lateral para registrar un movimiento de un profesional:
//  - 'settle'  → Liquidar (pago del saldo, con período y medio de pago)
//  - 'advance' → Anticipo (plata que se le adelanta)
//  - 'adjust'  → Ajuste (bono / a favor o descuento, con motivo obligatorio)

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { X, Loader2, Info, AlertTriangle } from 'lucide-react'
import type { StaffLedgerEntry, TeamPaymentMethod } from '@xinuco/types'
import { formatCOP } from '@xinuco/utils'
import { recordTeamMovement, type TeamMovementInput } from '@/actions/ledger'
import type { TeamReceiptResult } from '@/lib/team-payments'
import { FundsWarning, useFundsCheck } from '@/components/finance/FundsWarning'
import { AccountPicker } from '@/components/finance/AccountPicker'
import { accountIdOrNull, paymentMethodForAccount, pickedAccount } from '@/lib/money-accounts'

export type SheetKind = 'settle' | 'advance' | 'adjust'

const MAX_AMOUNT = 50_000_000

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, 8)
}

function formatThousands(digits: string): string {
  return digits ? Number(digits).toLocaleString('es-CO') : ''
}

export interface SavedMovement {
  kind:        SheetKind
  entry:       StaffLedgerEntry
  method:      TeamPaymentMethod | null
  periodFrom:  string | null
  periodTo:    string | null
  /** Resultado del recibo por correo (solo anticipo/pago con "Enviar recibo" marcado). */
  receipt:     TeamReceiptResult | null
}

export function TeamMovementSheet({
  kind,
  slug,
  staffId,
  staffName,
  receiptEmailMasked,
  balance,
  hasActiveShift,
  today,
  suggestedPeriod,
  initialAmount,
  initialNotes,
  payoutRequestId,
  onClose,
  onSaved,
}: {
  kind:            SheetKind
  slug:            string
  staffId:         string
  staffName:       string
  /** Correo enmascarado al que llegan los recibos del profesional; null = sin correo. */
  receiptEmailMasked: string | null
  /** Saldo total actual del profesional (puede ser negativo). */
  balance:         number
  hasActiveShift:  boolean
  today:           string
  suggestedPeriod: { from: string; to: string }
  /** Solicitud de pago/anticipo que se atiende: monto y nota precargados (el admin puede ajustarlos). */
  initialAmount?:  number
  initialNotes?:   string
  /** El movimiento se inserta con esta solicitud: la base la marca pagada en la misma transacción. */
  payoutRequestId?: string
  onClose:         () => void
  onSaved:         (saved: SavedMovement) => void
}) {
  const backdropRef = useRef<HTMLDivElement>(null)

  const [adjustType, setAdjustType] = useState<'bonus' | 'deduction'>('bonus')
  const [amountDigits, setAmountDigits] = useState(
    initialAmount && initialAmount > 0
      ? String(Math.min(Math.round(initialAmount), MAX_AMOUNT))
      : kind === 'settle' && balance > 0 ? String(Math.min(balance, MAX_AMOUNT)) : '',
  )
  // Medio de pago: arranca en la caja si hay turno abierto; si no, en el primer medio digital
  const [accountChoice, setAccountChoice] = useState<string | null>(null)
  const [periodFrom, setPeriodFrom] = useState(suggestedPeriod.from)
  const [periodTo, setPeriodTo] = useState(suggestedPeriod.to)
  const [notes, setNotes] = useState(initialNotes ?? (kind === 'settle' ? 'Liquidación' : ''))
  const [formError, setFormError] = useState<string | null>(null)
  /** Pago mayor al saldo: espera confirmación del administrador. */
  const [overpay, setOverpay] = useState<{ balance: number } | null>(null)
  // Recibo por correo: marcado por defecto cuando el profesional tiene correo
  const [sendReceipt, setSendReceipt] = useState(true)
  const [isPending, startTransition] = useTransition()

  const needsMethod = kind === 'settle' || kind === 'advance'
  const amount = Number(amountDigits)
  // Aviso de saldo del medio con el que se paga (liquidación y anticipo; el ajuste no mueve plata)
  const funds = useFundsCheck({ accountId: accountChoice, amount, enabled: needsMethod })
  const account = pickedAccount(funds.accounts, accountChoice)
  const isCash = needsMethod && !!account?.is_cash_drawer
  const method: TeamPaymentMethod = account ? (paymentMethodForAccount(account, 'outflow') as TeamPaymentMethod) : 'other'

  useEffect(() => {
    if (!needsMethod || accountChoice !== null || !funds.loaded) return
    const first = (hasActiveShift ? funds.accounts.find(a => a.is_cash_drawer) : null)
      ?? funds.accounts.find(a => !a.is_cash_drawer)
    if (first) setAccountChoice(first.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funds.loaded])

  // Cerrar con ESC
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Bloquear scroll del body
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  function validate(): string | null {
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
      return 'El monto debe estar entre $1 y $50.000.000.'
    }
    if (kind !== 'settle') {
      const motive = notes.trim()
      if (motive.length < 3 || motive.length > 200) return 'El motivo debe tener entre 3 y 200 caracteres.'
    } else if (notes.trim().length > 200) {
      return 'La nota no puede superar 200 caracteres.'
    }
    if (needsMethod && accountChoice === null) return 'Elige cómo se pagó.'
    if (isCash && !hasActiveShift) return 'No hay caja abierta. Abre la caja o elige otro medio de pago.'
    if (kind === 'settle') {
      if (!periodFrom || !periodTo) return 'Indica el período que se está liquidando.'
      if (periodFrom > periodTo) return 'El inicio del período no puede ser posterior a su final.'
    }
    return null
  }

  function submit(allowOverpay: boolean) {
    setFormError(null)
    const invalid = validate()
    if (invalid) return setFormError(invalid)

    const type: TeamMovementInput['type'] =
      kind === 'settle' ? 'payment' : kind === 'advance' ? 'advance' : adjustType

    const input: TeamMovementInput = {
      staffId,
      type,
      amount,
      notes: notes.trim(),
      payment_method: needsMethod ? method : null,
      ...(needsMethod ? { account_id: accountIdOrNull(accountChoice) } : {}),
      ...(kind === 'settle' ? { period_from: periodFrom, period_to: periodTo } : {}),
      ...(allowOverpay ? { allowOverpay: true } : {}),
      ...(needsMethod ? { sendReceipt: !!receiptEmailMasked && sendReceipt } : {}),
      ...(payoutRequestId && needsMethod ? { payoutRequestId } : {}),
    }

    startTransition(async () => {
      try {
        const result = await recordTeamMovement(input)
        if (result.overpay) {
          // No es un error: pide confirmación y, si se acepta, reenvía con allowOverpay
          setOverpay(result.overpay)
          return
        }
        if (result.error || !result.entry) {
          setOverpay(null)
          setFormError(result.error ?? 'No se pudo registrar. Intenta de nuevo.')
          return
        }
        onSaved({
          kind,
          entry: result.entry,
          method: needsMethod ? method : null,
          periodFrom: kind === 'settle' ? periodFrom : null,
          periodTo:   kind === 'settle' ? periodTo : null,
          receipt:    result.receipt ?? null,
        })
      } catch {
        setOverpay(null)
        setFormError('Error inesperado. Intenta de nuevo.')
      }
    })
  }

  const labelClass = 'text-xs font-semibold text-xinuco-muted uppercase tracking-wider'
  const title = kind === 'settle' ? 'Liquidar' : kind === 'advance' ? 'Registrar anticipo' : 'Registrar ajuste'
  const subtitle = kind === 'settle'
    ? `Pago del saldo a ${staffName}.`
    : kind === 'advance'
      ? `Plata que se le adelanta a ${staffName}; se descuenta de su saldo.`
      : `Corrige la cuenta de ${staffName} con un bono o un descuento.`
  const submitLabel = kind === 'settle' ? 'Registrar pago' : kind === 'advance' ? 'Registrar anticipo' : 'Registrar ajuste'

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        className="h-dvh overflow-y-auto pb-[env(safe-area-inset-bottom)] animate-slide-in-right w-[95vw] sm:w-[440px]"
        style={{ background: 'var(--bg-color)', borderLeft: '1px solid var(--border-color)' }}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-5"
          style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-color)' }}
        >
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-xinuco-text">{title}</h2>
            <p className="text-xs text-xinuco-muted mt-0.5">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel"
            className="p-2 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.05] transition-colors shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); if (!overpay) submit(false) }}
          className="p-6 flex flex-col gap-5"
        >
          {/* Tipo de ajuste */}
          {kind === 'adjust' && (
            <div className="flex flex-col gap-2">
              <span id="mv-adjust-label" className={labelClass}>Tipo de ajuste *</span>
              <div role="radiogroup" aria-labelledby="mv-adjust-label" className="grid grid-cols-2 gap-2">
                {([
                  { value: 'bonus',     label: 'Bono / a favor' },
                  { value: 'deduction', label: 'Descuento' },
                ] as const).map(opt => {
                  const selected = adjustType === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setAdjustType(opt.value)}
                      className="rounded-xl px-3 py-2.5 text-xs font-semibold border transition-colors"
                      style={selected ? {
                        borderColor: 'var(--primary-color)',
                        color: 'var(--primary-color)',
                        background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
                      } : { borderColor: 'var(--border-color)', color: 'var(--text-color)' }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-xinuco-muted flex items-start gap-1.5">
                <Info size={12} className="shrink-0 mt-0.5" />
                {adjustType === 'bonus'
                  ? 'Suma a lo que se le debe: un bono, o corregir algo que faltó.'
                  : 'Resta de lo que se le debe: una multa, o corregir algo que se sumó de más.'}
              </p>
            </div>
          )}

          {/* Monto */}
          <div className="flex flex-col gap-2">
            <label htmlFor="mv-amount" className={labelClass}>Monto (COP) *</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-xinuco-muted pointer-events-none">$</span>
              <input
                id="mv-amount"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={formatThousands(amountDigits)}
                onChange={e => { setAmountDigits(digitsOnly(e.target.value)); setOverpay(null) }}
                placeholder="50.000"
                className="input-base pl-7 tabular-nums"
              />
            </div>
            {kind === 'settle' && (
              <p className="text-xs text-xinuco-muted">
                Saldo total: <span className="font-semibold text-xinuco-text tabular-nums">
                  {balance < 0 ? '−' : ''}{formatCOP(Math.abs(balance))}
                </span>
              </p>
            )}
          </div>

          {/* ¿Cómo se paga? */}
          {needsMethod && (
            <div className="flex flex-col gap-2">
              <span id="mv-method-label" className={labelClass}>¿Cómo se paga? *</span>
              {!funds.loaded ? (
                <p className="flex items-center gap-2 text-xs text-xinuco-muted">
                  <Loader2 size={14} className="animate-spin" /> Cargando medios de pago…
                </p>
              ) : (
                <AccountPicker
                  accounts={funds.accounts}
                  balances={funds.balances}
                  value={accountChoice}
                  onChange={id => { setAccountChoice(id); setOverpay(null) }}
                  allowOther
                  disabledIds={hasActiveShift ? [] : funds.accounts.filter(a => a.is_cash_drawer).map(a => a.id)}
                  ariaLabel="¿Cómo se paga?"
                />
              )}
              {!hasActiveShift && (
                <p className="text-xs text-xinuco-muted flex items-center gap-1.5">
                  <Info size={12} className="shrink-0" />
                  Abre la caja para pagar con Efectivo.
                </p>
              )}
              {isCash && (
                <p className="text-xs text-xinuco-muted flex items-center gap-1.5">
                  <Info size={12} className="shrink-0" />
                  Se resta del efectivo esperado al cerrar la caja.
                </p>
              )}
              <FundsWarning check={funds} />
            </div>
          )}

          {/* Período (solo liquidación) */}
          {kind === 'settle' && (
            <div className="flex flex-col gap-2">
              <span className={labelClass}>Período que se liquida *</span>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-[11px] text-xinuco-muted">
                  Desde
                  <input
                    type="date"
                    value={periodFrom}
                    max={periodTo || today}
                    onChange={e => setPeriodFrom(e.target.value)}
                    className="input-base !py-2.5"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-xinuco-muted">
                  Hasta
                  <input
                    type="date"
                    value={periodTo}
                    min={periodFrom || undefined}
                    max={today}
                    onChange={e => setPeriodTo(e.target.value)}
                    className="input-base !py-2.5"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Motivo / nota */}
          <div className="flex flex-col gap-2">
            <label htmlFor="mv-notes" className={labelClass}>
              {kind === 'settle' ? 'Nota' : 'Motivo *'}
            </label>
            <input
              id="mv-notes"
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              maxLength={200}
              placeholder={
                kind === 'settle' ? 'Liquidación'
                : kind === 'advance' ? 'Ej: Adelanto de la quincena'
                : adjustType === 'bonus' ? 'Ej: Bono por cumplir la meta' : 'Ej: Faltó a su turno'
              }
              className="input-base"
            />
          </div>

          {/* Recibo por correo (anticipo y liquidación) */}
          {needsMethod && (
            receiptEmailMasked ? (
              <label className="flex items-start gap-2.5 text-xs text-xinuco-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendReceipt}
                  onChange={e => setSendReceipt(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Enviar recibo por correo a{' '}
                  <span className="font-semibold tabular-nums">{receiptEmailMasked}</span>
                </span>
              </label>
            ) : (
              <p className="text-xs text-xinuco-muted flex items-start gap-1.5">
                <Info size={12} className="shrink-0 mt-0.5" />
                <span>
                  Sin correo: agrégalo en{' '}
                  <Link
                    href={`/${slug}/dashboard/staff`}
                    className="underline hover:text-xinuco-text"
                    style={{ color: 'var(--primary-color)' }}
                  >
                    Equipo
                  </Link>{' '}
                  para enviarle recibos.
                </span>
              </p>
            )
          )}

          {/* Confirmación de pago mayor al saldo */}
          {overpay && (
            <div
              role="alert"
              className="flex flex-col gap-3 text-xs rounded-lg px-4 py-3 animate-fade-in border"
              style={{ color: '#fbbf24', borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.08)' }}
            >
              <p className="flex items-start gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-px" />
                <span>
                  El pago supera el saldo ({formatCOP(Math.max(overpay.balance, 0))}). La diferencia quedará como anticipo.
                </span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOverpay(null)}
                  disabled={isPending}
                  className="flex-1 py-2 rounded-lg text-xs font-medium text-xinuco-text border transition-colors hover:bg-white/[0.05]"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  Corregir monto
                </button>
                <button
                  type="button"
                  onClick={() => submit(true)}
                  disabled={isPending}
                  className="flex-1 btn-primary !py-2 !text-xs"
                >
                  {isPending ? <Loader2 size={13} className="animate-spin" /> : 'Sí, registrar'}
                </button>
              </div>
            </div>
          )}

          {formError && (
            <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5 animate-fade-in">
              {formError}
            </p>
          )}

          {!overpay && (
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 rounded-lg text-sm font-medium text-xinuco-muted border transition-colors hover:text-xinuco-text hover:bg-white/[0.03]"
                style={{ borderColor: 'var(--border-color)' }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isPending || funds.blocked}
                className="flex-1 btn-primary !py-3"
              >
                {isPending ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Guardando…
                  </>
                ) : submitLabel}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
