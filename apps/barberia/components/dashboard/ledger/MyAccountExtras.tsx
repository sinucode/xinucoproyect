'use client'

// Piezas de "Mi cuenta" (profesional): resumen Hoy / Semana / Mes, último pago y solicitudes de
// pago o anticipo. Una solicitud NO mueve plata: solo le avisa al administrador, que la paga
// desde "Pagos al equipo".

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { HandCoins, Loader2, Send } from 'lucide-react'
import { formatCOP } from '@xinuco/utils'
import { ResponsiveSheet } from '@/components/layout/ResponsiveSheet'
import { cancelPayoutRequest, requestPayout, type StaffAccount } from '@/actions/ledger'
import { lastPayoutLabel } from '@/lib/my-account'
import {
  PAYOUT_KIND_LABELS,
  PAYOUT_MAX_AMOUNT,
  PAYOUT_STATUS_LABELS,
  buildOptimisticRequest,
  paidDifferenceLabel,
  type PayoutRequestKind,
  type PayoutRequestStatus,
  type PayoutRequestView,
} from '@/lib/payout-requests'
import { formatLedgerDateTime } from '@/lib/team-payments'

const CARD_STYLE = {
  border: '1px solid var(--border-color)',
  background: 'rgb(var(--fg) / 0.03)',
}

// ── Resumen por período ───────────────────────────────────────────────────────

export function PeriodSummary({ earnings }: { earnings: StaffAccount['periodEarnings'] }) {
  const tiles = [
    { label: 'Hoy',         value: earnings.today },
    { label: 'Esta semana', value: earnings.week },
    { label: 'Este mes',    value: earnings.month },
  ]
  return (
    <section aria-label="Lo que has ganado" className="flex flex-col gap-2 animate-fade-in">
      <div className="grid grid-cols-3 gap-2">
        {tiles.map(t => (
          <div key={t.label} className="rounded-2xl px-3 py-3.5 flex flex-col gap-1 min-w-0" style={CARD_STYLE}>
            <span className="text-[10px] font-semibold text-xinuco-muted uppercase tracking-wider truncate">
              {t.label}
            </span>
            <span
              className="text-base sm:text-xl font-bold tabular-nums leading-tight"
              style={{ color: 'var(--primary-color)' }}
            >
              {formatCOP(t.value)}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-xinuco-muted">Comisiones y propinas.</p>
    </section>
  )
}

// ── Último pago ───────────────────────────────────────────────────────────────

export function LastPayoutLine({ lastPayout }: { lastPayout: StaffAccount['lastPayout'] }) {
  return (
    <p className="flex items-center gap-2 text-sm text-xinuco-muted">
      <HandCoins size={15} className="shrink-0" style={{ color: 'var(--primary-color)' }} />
      {lastPayoutLabel(lastPayout)}
    </p>
  )
}

// ── Estado de una solicitud ───────────────────────────────────────────────────

const STATUS_STYLE: Record<PayoutRequestStatus, string> = {
  pending:   'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  paid:      'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  rejected:  'text-red-400 bg-red-400/10 border-red-400/20',
  cancelled: 'text-xinuco-muted bg-fg/[0.04] border-fg/10',
}

function StatusChip({ status }: { status: PayoutRequestStatus }) {
  return (
    <span
      className={`inline-flex text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_STYLE[status]}`}
    >
      {PAYOUT_STATUS_LABELS[status]}
    </span>
  )
}

function requestTitle(r: PayoutRequestView): string {
  return `${PAYOUT_KIND_LABELS[r.kind]} · ${formatCOP(r.amount)}`
}

// ── Solicitudes: pendiente (arriba) + historial (abajo) ───────────────────────

/** Tarjeta de la solicitud pendiente del profesional, con su botón "Cancelar solicitud". */
export function PendingRequestCard({
  request,
  onCancelled,
}: {
  request: PayoutRequestView | null
  /** Se llama tras cancelar con éxito, para reflejarlo de inmediato sin esperar al refresco del servidor. */
  onCancelled?: (id: string) => void
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function cancel(id: string) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await cancelPayoutRequest(id)
        if (res.error) setError(res.error)
        else onCancelled?.(id)
        router.refresh()
      } catch {
        setError('Error inesperado. Intenta de nuevo.')
      }
    })
  }

  if (!request && !error) return null

  return (
    <section aria-label="Tu solicitud de pago" className="flex flex-col gap-3">
      {request && (
        <div
          className="rounded-2xl p-4 flex flex-col gap-3 border animate-fade-in"
          style={{
            borderColor: 'color-mix(in srgb, var(--primary-color) 35%, transparent)',
            background: 'color-mix(in srgb, var(--primary-color) 6%, transparent)',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex flex-col gap-1">
              <span className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
                Tu solicitud
              </span>
              <span className="text-base font-bold text-xinuco-text">{requestTitle(request)}</span>
              {request.note && <span className="text-xs text-xinuco-muted break-words">“{request.note}”</span>}
              <span className="text-[11px] text-xinuco-muted">
                Pedida el {formatLedgerDateTime(request.created_at)} · El administrador la revisará
              </span>
            </div>
            <StatusChip status="pending" />
          </div>
          <button
            type="button"
            onClick={() => cancel(request.id)}
            disabled={isPending}
            className="btn-ghost !py-2.5 text-xs min-h-11 self-start"
          >
            {isPending ? <Loader2 size={13} className="animate-spin" /> : null}
            Cancelar solicitud
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5">
          {error}
        </p>
      )}
    </section>
  )
}

/** Historial de solicitudes ya resueltas (pagadas, rechazadas o canceladas). */
export function PayoutRequestsHistory({ requests }: { requests: PayoutRequestView[] }) {
  const history = requests.filter(r => r.status !== 'pending')
  if (history.length === 0) return null

  return (
    <section aria-label="Historial de solicitudes" className="flex flex-col gap-2">
      <h2 className="text-sm font-bold text-xinuco-text uppercase tracking-wider">Tus solicitudes</h2>
      <ul className="rounded-xl overflow-hidden" style={CARD_STYLE}>
        {history.map((r, i) => (
          <li
            key={r.id}
            className="flex items-start justify-between gap-3 px-4 py-3"
            style={i === 0 ? undefined : { borderTop: '1px solid var(--border-color)' }}
          >
            <div className="min-w-0 flex flex-col gap-0.5">
              <span className="text-sm text-xinuco-text font-medium">{requestTitle(r)}</span>
              <span className="text-[11px] text-xinuco-muted">{formatLedgerDateTime(r.created_at)}</span>
              {paidDifferenceLabel(r) && (
                <span className="text-xs text-xinuco-muted">{paidDifferenceLabel(r)}</span>
              )}
              {r.status === 'rejected' && r.resolution_note && (
                <span className="text-xs text-red-400 break-words">Motivo: {r.resolution_note}</span>
              )}
            </div>
            <StatusChip status={r.status} />
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── Botón + panel "Pedir pago o anticipo" ─────────────────────────────────────

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, 8)
}

function formatThousands(digits: string): string {
  return digits ? Number(digits).toLocaleString('es-CO') : ''
}

export function RequestPayoutButton({
  balance,
  hasPending,
  onRequested,
}: {
  balance: number
  hasPending: boolean
  /** Se llama tras enviar con éxito, con la solicitud recién creada (para mostrarla ya, sin recargar). */
  onRequested?: (request: PayoutRequestView) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={hasPending}
        title={hasPending ? 'Ya tienes una solicitud pendiente' : undefined}
        className="btn-primary !py-2.5 min-h-11"
      >
        <Send size={15} />
        Pedir pago o anticipo
      </button>
      <ResponsiveSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Pedir pago o anticipo"
        subtitle="Le avisamos al administrador. Esto no mueve plata: él la paga desde Pagos al equipo."
      >
        <RequestForm
          balance={balance}
          onClose={() => setOpen(false)}
          onSent={request => { onRequested?.(request); setOpen(false) }}
        />
      </ResponsiveSheet>
    </>
  )
}

function RequestForm({
  balance,
  onClose,
  onSent,
}: {
  balance: number
  onClose: () => void
  onSent: (request: PayoutRequestView) => void
}) {
  const router = useRouter()
  const canAskPayout = balance > 0
  const [kind, setKind] = useState<PayoutRequestKind>(canAskPayout ? 'payout' : 'advance')
  const [amountDigits, setAmountDigits] = useState(canAskPayout ? String(Math.min(balance, PAYOUT_MAX_AMOUNT)) : '')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const amount = Number(amountDigits)
  const labelClass = 'text-xs font-semibold text-xinuco-muted uppercase tracking-wider'

  function chooseKind(next: PayoutRequestKind) {
    setKind(next)
    setError(null)
    // El pago arranca con todo lo que se le debe; cambiar a anticipo no deja ese monto pegado
    if (next === 'payout' && canAskPayout) setAmountDigits(String(Math.min(balance, PAYOUT_MAX_AMOUNT)))
    if (next === 'advance' && amountDigits === String(Math.min(balance, PAYOUT_MAX_AMOUNT))) setAmountDigits('')
  }

  function submit() {
    setError(null)
    if (!Number.isInteger(amount) || amount < 1 || amount > PAYOUT_MAX_AMOUNT) {
      return setError('El monto debe estar entre $1 y $50.000.000.')
    }
    if (kind === 'payout' && amount > balance) {
      return setError(`No puedes pedir más de lo que se te debe (${formatCOP(Math.max(balance, 0))}). Si necesitas más, pide un anticipo.`)
    }
    startTransition(async () => {
      try {
        const res = await requestPayout({ kind, amount, note })
        if (res.error) {
          setError(res.error)
          return
        }
        onSent(buildOptimisticRequest({ id: res.id, kind, amount, note }))
        router.refresh()
      } catch {
        setError('Error inesperado. Intenta de nuevo.')
      }
    })
  }

  return (
    <form
      onSubmit={e => { e.preventDefault(); submit() }}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-2">
        <span id="rq-kind-label" className={labelClass}>¿Qué necesitas? *</span>
        <div role="radiogroup" aria-labelledby="rq-kind-label" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {([
            { value: 'payout',  label: 'Pago de lo que me deben' },
            { value: 'advance', label: 'Anticipo' },
          ] as const).map(opt => {
            const selected = kind === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => chooseKind(opt.value)}
                className="rounded-xl px-3 py-3 text-sm font-semibold border transition-colors min-h-12"
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
        <p className="text-xs text-xinuco-muted">
          {kind === 'payout'
            ? <>Lo que se te debe hoy: <span className="font-semibold text-xinuco-text tabular-nums">{formatCOP(Math.max(balance, 0))}</span></>
            : 'Plata que se te adelanta; se descuenta de tu saldo en tu próxima liquidación.'}
        </p>
        {kind === 'payout' && !canAskPayout && (
          <p className="text-xs text-yellow-400">Hoy no tienes saldo a favor. Puedes pedir un anticipo.</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="rq-amount" className={labelClass}>Monto (COP) *</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-xinuco-muted pointer-events-none">$</span>
          <input
            id="rq-amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={formatThousands(amountDigits)}
            onChange={e => setAmountDigits(digitsOnly(e.target.value))}
            placeholder="50.000"
            className="input-base pl-7 tabular-nums"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="rq-note" className={labelClass}>Nota (opcional)</label>
        <input
          id="rq-note"
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={200}
          placeholder="Ej: Lo necesito para el arriendo"
          className="input-base"
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5">
          {error}
        </p>
      )}

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-3 rounded-lg text-sm font-medium text-xinuco-muted border transition-colors hover:text-xinuco-text hover:bg-fg/[0.03] min-h-11"
          style={{ borderColor: 'var(--border-color)' }}
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isPending || (kind === 'payout' && !canAskPayout)}
          className="flex-1 btn-primary !py-3 min-h-11"
        >
          {isPending ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Enviando…
            </>
          ) : 'Enviar solicitud'}
        </button>
      </div>
    </form>
  )
}
