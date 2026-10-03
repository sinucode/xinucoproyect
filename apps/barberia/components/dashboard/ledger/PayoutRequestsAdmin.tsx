'use client'

// PayoutRequestsAdmin — sección "Solicitudes (N)" de "Pagos al equipo" (admin): lo que los
// profesionales piden (pago de lo que se les debe o anticipo). "Pagar" abre el flujo normal de
// liquidar / anticipo ya con el profesional, el tipo y el monto; "Rechazar" pide un motivo.
// Esta lista nunca mueve plata por sí sola.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BellRing, HandCoins, Loader2, X } from 'lucide-react'
import { formatCOP } from '@xinuco/utils'
import { resolvePayoutRequest } from '@/actions/ledger'
import { PAYOUT_KIND_LABELS, PAYOUT_MIN_REASON, type PayoutRequestView } from '@/lib/payout-requests'
import { formatLedgerDateTime } from '@/lib/team-payments'

export function PayoutRequestsAdmin({
  requests,
  payableStaffIds,
  onPay,
}: {
  requests:        PayoutRequestView[]
  /** Profesionales que aparecen en la lista de pagos (los demás no se pueden pagar desde aquí). */
  payableStaffIds: string[]
  onPay:           (request: PayoutRequestView) => void
}) {
  const router = useRouter()
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (requests.length === 0) return null

  function startReject(id: string) {
    setRejectingId(id)
    setReason('')
    setError(null)
  }

  function confirmReject(id: string) {
    setError(null)
    if (reason.trim().length < PAYOUT_MIN_REASON) {
      setError(`Escribe el motivo (mínimo ${PAYOUT_MIN_REASON} caracteres).`)
      return
    }
    startTransition(async () => {
      try {
        const res = await resolvePayoutRequest(id, 'rejected', reason)
        if (res.error) {
          setError(res.error)
          return
        }
        setRejectingId(null)
        setReason('')
        router.refresh()
      } catch {
        setError('Error inesperado. Intenta de nuevo.')
      }
    })
  }

  return (
    <section
      aria-label="Solicitudes de pago"
      className="rounded-2xl p-5 flex flex-col gap-3 animate-fade-in border"
      style={{
        borderColor: 'color-mix(in srgb, var(--primary-color) 35%, transparent)',
        background: 'color-mix(in srgb, var(--primary-color) 6%, transparent)',
      }}
    >
      <h2 className="flex items-center gap-2 text-sm font-bold text-xinuco-text uppercase tracking-wider">
        <BellRing size={15} style={{ color: 'var(--primary-color)' }} />
        Solicitudes ({requests.length})
      </h2>

      <ul className="flex flex-col gap-2">
        {requests.map(r => {
          const canPay = payableStaffIds.includes(r.staff_id)
          const rejecting = rejectingId === r.id
          return (
            <li
              key={r.id}
              className="rounded-xl p-4 flex flex-col gap-3"
              style={{ border: '1px solid var(--border-color)', background: 'var(--bg-color)' }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="min-w-0 flex flex-col gap-0.5">
                  <p className="text-sm font-semibold text-xinuco-text break-words">
                    {r.staff_name}
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border text-yellow-400 bg-yellow-400/10 border-yellow-400/20">
                      {PAYOUT_KIND_LABELS[r.kind]}
                    </span>
                  </p>
                  <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--primary-color)' }}>
                    {formatCOP(r.amount)}
                  </p>
                  {r.note && <p className="text-xs text-xinuco-muted break-words">“{r.note}”</p>}
                  <p className="text-[11px] text-xinuco-muted">Pedida el {formatLedgerDateTime(r.created_at)}</p>
                </div>

                {!rejecting && (
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    {canPay ? (
                      <button
                        type="button"
                        onClick={() => onPay(r)}
                        disabled={isPending}
                        className="btn-primary !py-2.5 !px-4 !text-xs min-h-10"
                      >
                        <HandCoins size={14} />
                        Pagar
                      </button>
                    ) : (
                      <span className="text-[11px] text-xinuco-muted self-center">
                        Profesional inactivo sin saldo: no aparece en la lista de pagos.
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => startReject(r.id)}
                      disabled={isPending}
                      className="btn-ghost !py-2.5 !px-4 !text-xs min-h-10"
                    >
                      <X size={14} />
                      Rechazar
                    </button>
                  </div>
                )}
              </div>

              {rejecting && (
                <div className="flex flex-col gap-2 animate-fade-in">
                  <label htmlFor={`reject-${r.id}`} className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
                    Motivo del rechazo *
                  </label>
                  <input
                    id={`reject-${r.id}`}
                    type="text"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    maxLength={200}
                    autoFocus
                    placeholder="Ej: Se paga el viernes con la liquidación"
                    className="input-base"
                  />
                  {error && (
                    <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                      {error}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setRejectingId(null); setError(null) }}
                      disabled={isPending}
                      className="btn-ghost !py-2.5 !px-4 !text-xs min-h-10"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => confirmReject(r.id)}
                      disabled={isPending}
                      className="btn-primary !py-2.5 !px-4 !text-xs min-h-10"
                    >
                      {isPending ? <Loader2 size={13} className="animate-spin" /> : 'Rechazar solicitud'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
