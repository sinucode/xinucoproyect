'use client'

import { DollarSign } from 'lucide-react'
import { formatMoney } from '@/lib/loyalty-utils'
import { CASH_BILL_CHIPS, cashChange, suggestedCashAmounts } from '@/lib/pos-utils'

interface CashReceivedInputProps {
  /** Total a cobrar (COP). */
  total:        number
  /** Monto recibido ('' = aún no se escribe). */
  value:        number | ''
  onChange:     (value: number | '') => void
  /** Texto del cambio (el cobro de citas usa "Cambio a entregar:"). */
  changeLabel?: string
  disabled?:    boolean
}

const chipClass =
  'text-xs font-semibold py-2 rounded-lg border border-zinc-800 bg-zinc-950 hover:border-[var(--primary-color)] text-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed'

/**
 * Efectivo recibido + botones rápidos (Exacto, múltiplos redondos, billetes, Borrar) + cambio.
 * Compartido por el cobro de citas (CheckoutModal) y el Punto de Venta.
 */
export function CashReceivedInput({
  total,
  value,
  onChange,
  changeLabel = 'Cambio a entregar:',
  disabled = false,
}: CashReceivedInputProps) {
  const received = Number(value) || 0
  const change = cashChange('cash', received, total)
  const suggested = suggestedCashAmounts(total)

  return (
    <div className="p-4 bg-zinc-900/40 rounded-xl border border-zinc-900 space-y-3 animate-fade-in">
      <div>
        <label className="block text-xs font-semibold text-xinuco-muted mb-1">
          Monto Recibido de Cliente
        </label>
        <div className="relative">
          <DollarSign size={14} className="absolute left-2.5 top-2.5 text-zinc-500" />
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Monto con el que paga"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            className="w-full text-sm bg-zinc-950 border border-zinc-800 rounded-lg pl-7 pr-3 py-2 text-zinc-100 placeholder-zinc-650 focus:outline-none focus:border-zinc-700"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-xinuco-muted mb-1.5">Rápido</p>
          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(total)}
              className="col-span-2 text-xs font-bold py-2 rounded-lg bg-[var(--primary-color)] text-black hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              Exacto · {formatMoney(total)}
            </button>
            {suggested.map((amt) => (
              <button
                key={amt}
                type="button"
                disabled={disabled}
                onClick={() => onChange(amt)}
                className={chipClass}
              >
                {formatMoney(amt)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-xinuco-muted mb-1.5">Billetes</p>
          <div className="grid grid-cols-4 gap-2">
            {CASH_BILL_CHIPS.map((bill) => (
              <button
                key={bill}
                type="button"
                disabled={disabled}
                onClick={() => onChange(received + bill)}
                className={chipClass}
              >
                +{new Intl.NumberFormat('es-CO').format(bill)}
              </button>
            ))}
            <button type="button" disabled={disabled} onClick={() => onChange('')} className={chipClass}>
              Borrar
            </button>
          </div>
        </div>
      </div>

      {received > 0 && received < total && (
        <p className="text-xs text-xinuco-muted">Faltan {formatMoney(total - received)}</p>
      )}

      {received > 0 && received >= total && (
        <div className="flex items-center justify-between bg-[var(--primary-color)]/[0.05] border border-[var(--primary-color)]/20 p-2.5 rounded-lg text-sm">
          <span className="font-semibold text-zinc-300">{changeLabel}</span>
          <span className="font-extrabold text-[var(--primary-color)] text-base">{formatMoney(change)}</span>
        </div>
      )}
    </div>
  )
}
