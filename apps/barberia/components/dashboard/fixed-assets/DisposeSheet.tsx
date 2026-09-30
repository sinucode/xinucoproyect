'use client'
// components/dashboard/fixed-assets/DisposeSheet.tsx — dar de baja un equipo

import React, { useState, useTransition } from 'react'
import { PackageX } from 'lucide-react'
import { disposeFixedAsset } from '@/actions/fixed-assets'
import { businessTodayISODate } from '@/lib/agenda-time'
import {
  DISPOSAL_REASONS,
  DISPOSAL_REASON_ORDER,
  MAX_ASSET_PRICE,
  PAYMENT_ORDER,
  SALE_PAYMENT_LABELS,
  disposalNeedsNote,
  disposalResult,
  estimateValue,
  mapAssetError,
} from '@/lib/fixed-assets-utils'
import type { AssetPaymentMethod, DisposalReason, FixedAsset } from '@xinuco/types'
import { SidePanel, PanelFooter, panelLabelCls as labelCls } from '../inventory/SidePanel'
import { ChoiceButtons, ErrorBox, MoneyInput, formatCOP, inputCls, inputStyle, toInt } from './shared'

interface DisposeSheetProps {
  asset:        FixedAsset
  hasOpenShift: boolean
  onClose:      () => void
  onDone:       (message: string) => void
}

/** "ganancia de $X" / "pérdida de $X" / "sin ganancia ni pérdida". */
export function resultText(result: number): string {
  if (result > 0) return `ganancia de ${formatCOP(result)}`
  if (result < 0) return `pérdida de ${formatCOP(-result)}`
  return 'sin ganancia ni pérdida'
}

export function DisposeSheet({ asset, hasOpenShift, onClose, onDone }: DisposeSheetProps) {
  const today = businessTodayISODate()

  const [reason, setReason]   = useState<DisposalReason>('sold')
  const [date, setDate]       = useState(today)
  const [price, setPrice]     = useState('')
  const [payment, setPayment] = useState<AssetPaymentMethod>('transfer')
  const [notes, setNotes]     = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const dateOk  = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today && date >= asset.purchase_date
  const bookValue = dateOk ? estimateValue(asset, date) : null
  const priceN  = toInt(price)
  const priceOk = Number.isFinite(priceN) && priceN >= 0 && priceN <= MAX_ASSET_PRICE
  const needsNote = disposalNeedsNote(reason)

  const result = bookValue !== null
    ? disposalResult(reason === 'sold' && priceOk ? priceN : 0, bookValue)
    : null

  const handleSubmit = () => {
    setError(null)
    if (!dateOk) { setError(mapAssetError('invalid_date')); return }
    if (reason === 'sold') {
      if (!priceOk) { setError('Escribe en cuánto lo vendiste (puede ser $0).'); return }
      if (payment === 'cash_register' && !hasOpenShift) { setError(mapAssetError('shift_not_open')); return }
    }
    if (needsNote && !notes.trim()) { setError(mapAssetError('reason_required')); return }

    startTransition(async () => {
      const res = await disposeFixedAsset(asset.id, {
        date,
        reason,
        price:         reason === 'sold' ? priceN : null,
        paymentMethod: reason === 'sold' ? payment : null,
        notes:         notes.trim() || null,
      })
      if (res.error) { setError(res.error); return }
      const r = res.result ?? result ?? 0
      onDone(`Dimos de baja «${asset.name}» (${DISPOSAL_REASONS[reason].toLowerCase()}): ${resultText(r)}.`)
      onClose()
    })
  }

  return (
    <SidePanel
      title="Dar de baja"
      subtitle={asset.name}
      icon={<PackageX size={16} style={{ color: 'var(--primary-color)' }} />}
      onClose={onClose}
      footer={
        <PanelFooter
          onCancel={onClose}
          onConfirm={handleSubmit}
          confirmLabel="Dar de baja"
          pending={isPending}
        />
      }
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className={labelCls}>¿Qué pasó con el equipo?</span>
          <ChoiceButtons<DisposalReason>
            ariaLabel="Motivo de la baja"
            value={reason}
            onChange={setReason}
            options={DISPOSAL_REASON_ORDER.map((r) => ({ value: r, label: DISPOSAL_REASONS[r] }))}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelCls} htmlFor="dispose-date">Fecha</label>
          <input
            id="dispose-date"
            type="date" min={asset.purchase_date} max={today}
            className={`${inputCls} min-w-0`} style={inputStyle}
            value={date} onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {reason === 'sold' && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>¿En cuánto lo vendiste? <span className="text-red-400">*</span></label>
              <MoneyInput value={price} onChange={setPrice} placeholder="0" autoFocus ariaLabel="Precio de venta" />
            </div>

            <div className="flex flex-col gap-2">
              <span className={labelCls}>¿Cómo lo recibiste?</span>
              <ChoiceButtons<AssetPaymentMethod>
                ariaLabel="¿Cómo lo recibiste?"
                columns={3}
                value={payment}
                onChange={setPayment}
                options={PAYMENT_ORDER.map((p) => ({ value: p, label: SALE_PAYMENT_LABELS[p] }))}
                disabled={(p) => p === 'cash_register' && !hasOpenShift}
              />
              {!hasOpenShift && (
                <p className="text-[11px] text-zinc-500">Abre la caja para recibir el dinero en su efectivo.</p>
              )}
              {payment === 'cash_register' && hasOpenShift && (
                <p className="text-[11px] text-zinc-500">Se suma al efectivo esperado del turno abierto.</p>
              )}
            </div>
          </>
        )}

        {/* Cuánto valía y qué resultó */}
        <div
          className="rounded-xl border px-4 py-3 flex flex-col gap-1.5 text-sm"
          style={{ borderColor: 'var(--border-color)' }}
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-400">Valía ese día</span>
            <span className="font-bold text-zinc-100 tabular-nums">{bookValue !== null ? formatCOP(bookValue) : '—'}</span>
          </div>
          {result !== null && (reason !== 'sold' || priceOk) && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-400">
                {result > 0 ? 'Ganancia' : result < 0 ? 'Pérdida' : 'Resultado'}
              </span>
              <span
                className={`font-bold tabular-nums ${result > 0 ? 'text-emerald-400' : result < 0 ? 'text-red-400' : 'text-zinc-300'}`}
              >
                {formatCOP(Math.abs(result))}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelCls} htmlFor="dispose-notes">
            {needsNote ? '¿Qué pasó?' : 'Nota'}{' '}
            {needsNote
              ? <span className="text-red-400">*</span>
              : <span className="text-zinc-600 font-normal normal-case">(opcional)</span>}
          </label>
          <textarea
            id="dispose-notes"
            rows={2} maxLength={300}
            className={`${inputCls} resize-none`} style={inputStyle}
            placeholder={needsNote ? 'Cuéntanos brevemente' : 'Ej: se lo vendí a un colega'}
            value={notes} onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <p className="text-[11px] text-zinc-500 rounded-lg bg-white/[0.03] px-3 py-2">
          Al dar de baja, el equipo pasa a «Dados de baja» y ya no se puede editar.
        </p>

        <ErrorBox message={error} />
      </div>
    </SidePanel>
  )
}
