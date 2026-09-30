'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Receipt, X } from 'lucide-react'
import { voidSale } from '@/actions/retail'
import { formatMoney } from '@/lib/loyalty-utils'
import {
  MAX_VOID_REASON,
  MIN_VOID_REASON,
  POS_METHOD_LABELS,
  formatSaleTime,
  type ShiftSale,
} from '@/lib/pos-utils'

interface ShiftSalesListProps {
  sales: ShiftSale[]
}

/** "Ventas de este turno": ventas de mostrador y cobros de citas, con anulación (solo admin). */
export function ShiftSalesList({ sales }: ShiftSalesListProps) {
  const router = useRouter()
  const [target, setTarget] = useState<ShiftSale | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const close = () => {
    if (isPending) return
    setTarget(null)
    setReason('')
    setError(null)
  }

  // Escape cierra el diálogo
  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) {
        setTarget(null)
        setReason('')
        setError(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, isPending])

  const cleanReason = reason.trim()
  const reasonValid = cleanReason.length >= MIN_VOID_REASON && cleanReason.length <= MAX_VOID_REASON

  const handleVoid = () => {
    if (!target || !reasonValid) return
    setError(null)
    startTransition(async () => {
      const res = await voidSale(target.id, cleanReason)
      if (res.error) {
        setError(res.error)
        return
      }
      setTarget(null)
      setReason('')
      router.refresh()
    })
  }

  return (
    <section aria-label="Ventas de este turno" className="space-y-3">
      <h2 className="font-semibold text-xinuco-text">
        Ventas de este turno
        {sales.length > 0 && (
          <span className="ml-2 text-xs font-medium text-xinuco-muted">({sales.length})</span>
        )}
      </h2>

      {sales.length === 0 ? (
        <div
          className="rounded-xl border p-6 flex flex-col items-center gap-2 text-center text-xinuco-muted"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <Receipt size={22} />
          <p className="text-sm">Aún no hay ventas en este turno.</p>
        </div>
      ) : (
        <ul
          className="rounded-xl border divide-y overflow-hidden"
          style={{ borderColor: 'var(--border-color)', background: 'var(--surface-color)' }}
        >
          {sales.map((sale) => {
            const voided = sale.status === 'voided'
            return (
              <li key={sale.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs font-semibold text-xinuco-muted">{formatSaleTime(sale.createdAt)}</span>
                    <span className="text-sm font-medium text-xinuco-text">
                      {sale.customerName ?? 'Sin cliente'}
                    </span>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        voided ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'
                      }`}
                    >
                      {voided ? 'Anulada' : 'Pagada'}
                    </span>
                    {sale.source === 'appointment' && (
                      <span className="text-[11px] text-xinuco-muted">Cobro de cita</span>
                    )}
                  </div>
                  <p className={`text-sm mt-0.5 ${voided ? 'line-through text-xinuco-muted' : 'text-xinuco-text'}`}>
                    {sale.items.map((i) => `${i.quantity} × ${i.description}`).join(', ') || 'Sin líneas'}
                  </p>
                  <p className="text-xs text-xinuco-muted mt-0.5">
                    {sale.paymentMethod ? POS_METHOD_LABELS[sale.paymentMethod] : 'Sin pago'}
                    {sale.sellerName ? ` · Vendió ${sale.sellerName}` : ''}
                  </p>
                  {voided && sale.voidReason && (
                    <p className="text-xs text-red-400 mt-1">Motivo: {sale.voidReason}</p>
                  )}
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <span
                    className={`text-base font-bold ${voided ? 'line-through text-xinuco-muted' : 'text-xinuco-text'}`}
                  >
                    {formatMoney(sale.total)}
                  </span>
                  {!voided && (
                    <button
                      type="button"
                      onClick={() => { setTarget(sale); setReason(''); setError(null) }}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-zinc-800 text-red-400 hover:border-red-500/50 hover:bg-red-500/[0.06] transition-colors"
                    >
                      Anular
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {target && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="void-sale-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border bg-zinc-950 shadow-2xl text-zinc-100 p-5 space-y-4"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="void-sale-title" className="text-lg font-bold text-xinuco-text">Anular venta</h3>
                <p className="text-sm text-xinuco-muted mt-0.5">
                  {formatSaleTime(target.createdAt)} · {formatMoney(target.total)}
                  {target.customerName ? ` · ${target.customerName}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Cerrar"
                className="p-1 rounded text-zinc-500 hover:text-zinc-200"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-sm text-xinuco-muted leading-relaxed">
              Se devuelve el inventario, se revierten la comisión y los puntos, y el dinero deja de contar en la caja.
            </p>

            <div>
              <label htmlFor="void-reason" className="block text-xs font-semibold text-xinuco-muted mb-1">
                Motivo (obligatorio)
              </label>
              <textarea
                id="void-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={MAX_VOID_REASON}
                disabled={isPending}
                placeholder="Ej: el cliente se arrepintió, error de precio…"
                className="w-full text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-700 resize-none"
              />
              <p className="text-[11px] text-xinuco-muted mt-1">
                Entre {MIN_VOID_REASON} y {MAX_VOID_REASON} caracteres ({cleanReason.length}/{MAX_VOID_REASON}).
              </p>
            </div>

            {error && (
              <div role="alert" className="p-3 bg-red-950/40 border border-red-900/30 rounded-xl text-red-400 text-xs leading-relaxed">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={close}
                disabled={isPending}
                className="flex-1 text-sm font-semibold py-2.5 rounded-lg border border-zinc-800 text-zinc-300 hover:border-zinc-700 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleVoid}
                disabled={!reasonValid || isPending}
                className="flex-1 flex items-center justify-center gap-2 text-sm font-bold py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending && <Loader2 size={14} className="animate-spin" />}
                Anular venta
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
