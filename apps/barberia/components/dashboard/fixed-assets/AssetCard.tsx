'use client'
// components/dashboard/fixed-assets/AssetCard.tsx — tarjeta de un equipo (en uso o dado de baja)

import React, { useState } from 'react'
import { ChevronDown, Loader2, Pencil, PackageX } from 'lucide-react'
import { getDepreciationSchedule } from '@/actions/fixed-assets'
import {
  DISPOSAL_REASONS,
  METHOD_LABELS,
  PURCHASE_PAYMENT_LABELS,
  SALE_PAYMENT_LABELS,
  categoryLabel,
  disposalResult,
  estimateValue,
  formatDateES,
  fullyDepreciatedOn,
  lifeLabel,
  monthYearES,
  monthlyDepreciation,
  firstMonthDepreciation,
  usedPercent,
} from '@/lib/fixed-assets-utils'
import type { DepreciationSchedule, FixedAsset } from '@xinuco/types'
import { categoryIcon, formatCOP } from './shared'

interface AssetCardProps {
  asset:     FixedAsset
  /** Fecha de hoy en Colombia ('YYYY-MM-DD'). */
  today:     string
  disposed?: boolean
  onEdit?:   (asset: FixedAsset) => void
  onDispose?: (asset: FixedAsset) => void
}

function barColor(pct: number): string {
  if (pct >= 100) return '#ef4444'
  if (pct >= 75) return '#f59e0b'
  return 'var(--primary-color)'
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="text-sm font-semibold text-zinc-200 tabular-nums break-words">{value}</span>
    </div>
  )
}

export function AssetCard({ asset, today, disposed = false, onEdit, onDispose }: AssetCardProps) {
  const [open, setOpen] = useState(false)
  const [schedule, setSchedule] = useState<DepreciationSchedule | null>(null)
  const [loading, setLoading] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  const Icon = categoryIcon(asset.category)

  const valueNow = disposed
    ? (asset.book_value_at_disposal ?? estimateValue(asset, asset.disposed_at ?? today))
    : estimateValue(asset, today)
  const pct = usedPercent(asset, valueNow)
  const finished = pct >= 100 || today >= fullyDepreciatedOn(asset)
  const perMonth = asset.depreciation_method === 'straight_line'
    ? monthlyDepreciation(asset.purchase_price, asset.salvage_value, asset.useful_life_months)
    : firstMonthDepreciation(asset)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !schedule && !loading && !disposed) {
      setLoading(true)
      setScheduleError(null)
      getDepreciationSchedule(asset.id)
        .then((res) => {
          if (res.error) setScheduleError(res.error)
          else setSchedule(res.data)
        })
        .catch(() => setScheduleError('No se pudo cargar el detalle. Intenta de nuevo.'))
        .finally(() => setLoading(false))
    }
  }

  // ── Baja ───────────────────────────────────────────────────────────────────
  const reasonLabel = asset.disposal_reason ? DISPOSAL_REASONS[asset.disposal_reason] : 'Dado de baja'
  const result = disposed && asset.book_value_at_disposal !== null
    ? disposalResult(asset.disposal_reason === 'sold' ? asset.disposal_price : 0, asset.book_value_at_disposal)
    : null

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: 'var(--card-color, #111111)', borderColor: 'var(--border-color)' }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full text-left p-4 flex flex-col gap-3 hover:bg-fg/[0.02] transition-colors"
      >
        {/* Nombre y categoría */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
                border:          '1px solid color-mix(in srgb, var(--primary-color) 22%, transparent)',
              }}
            >
              <Icon size={16} style={{ color: 'var(--primary-color)' }} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm text-xinuco-text truncate">{asset.name}</p>
              <p className="text-[11px] text-xinuco-muted truncate">{categoryLabel(asset.category)}</p>
            </div>
          </div>
          <ChevronDown
            size={16}
            className={`text-zinc-500 flex-shrink-0 mt-2 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>

        <p className="text-[11px] text-xinuco-muted">
          Comprado {formatDateES(asset.purchase_date)} por {formatCOP(asset.purchase_price)}
        </p>

        {disposed ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-zinc-300 border border-zinc-700 bg-zinc-800/60">
                {reasonLabel}
              </span>
              {asset.disposed_at && (
                <span className="text-[11px] text-xinuco-muted">{formatDateES(asset.disposed_at)}</span>
              )}
            </div>
            {asset.book_value_at_disposal !== null ? (
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Valía" value={formatCOP(asset.book_value_at_disposal)} />
                {asset.disposal_reason === 'sold' && asset.disposal_price !== null && (
                  <Stat label="Vendido por" value={formatCOP(asset.disposal_price)} />
                )}
              </div>
            ) : (
              <p className="text-[11px] text-xinuco-muted">Este equipo se desactivó antes de que se guardara el detalle de la baja.</p>
            )}
            {result !== null && (
              <p
                className={`text-sm font-bold tabular-nums ${
                  result > 0 ? 'text-emerald-400' : result < 0 ? 'text-red-400' : 'text-zinc-400'
                }`}
              >
                {result > 0 ? 'Ganancia ' : result < 0 ? 'Pérdida ' : 'Sin ganancia ni pérdida '}
                {result !== 0 && formatCOP(Math.abs(result))}
              </p>
            )}
            {asset.disposal_notes && (
              <p className="text-[11px] text-xinuco-muted break-words">«{asset.disposal_notes}»</p>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Vale hoy</span>
              <span className="font-bold text-2xl tabular-nums" style={{ color: 'var(--primary-color)' }}>
                {formatCOP(valueNow)}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>Desgastado</span>
                <span className="tabular-nums">{pct}%</span>
              </div>
              <div
                className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${asset.name}: ${pct}% desgastado`}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: barColor(pct) }}
                />
              </div>
              <p className="text-[11px] text-xinuco-muted">
                {finished
                  ? 'Ya terminó de desgastarse'
                  : `Se desgasta ${formatCOP(perMonth)}/mes · termina ${monthYearES(fullyDepreciatedOn(asset))}`}
              </p>
            </div>
          </>
        )}

        {(asset.location || asset.serial_number) && (
          <p className="text-[11px] text-xinuco-muted truncate">
            {[asset.location, asset.serial_number ? `Serial ${asset.serial_number}` : null].filter(Boolean).join(' · ')}
          </p>
        )}
      </button>

      {/* Detalle */}
      {open && (
        <div className="px-4 pb-4 pt-3 flex flex-col gap-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Vida útil" value={lifeLabel(asset.useful_life_months)} />
            <Stat label="Método" value={METHOD_LABELS[asset.depreciation_method]} />
            <Stat label="Valor residual" value={formatCOP(asset.salvage_value)} />
            <Stat
              label="Se pagó con"
              value={asset.payment_method ? PURCHASE_PAYMENT_LABELS[asset.payment_method] : 'Sin dato'}
            />
            {disposed && asset.disposal_reason === 'sold' && asset.disposal_payment_method && (
              <Stat label="Lo recibiste por" value={SALE_PAYMENT_LABELS[asset.disposal_payment_method]} />
            )}
          </div>

          {!disposed && (
            <div className="rounded-lg border px-3 py-2.5 grid grid-cols-2 gap-3" style={{ borderColor: 'var(--border-color)' }}>
              {loading && (
                <p className="col-span-2 flex items-center gap-2 text-xs text-zinc-500">
                  <Loader2 size={12} className="animate-spin" /> Calculando…
                </p>
              )}
              {scheduleError && <p className="col-span-2 text-xs text-red-400">{scheduleError}</p>}
              {schedule && (
                <>
                  <Stat label="Vale hoy" value={formatCOP(schedule.current_value)} />
                  <Stat label="Ya se desgastó" value={formatCOP(schedule.accumulated_depreciation)} />
                  <Stat label="Meses transcurridos" value={String(schedule.months_elapsed)} />
                  <Stat label="Meses que faltan" value={String(schedule.months_remaining)} />
                  <Stat label="Desgaste por mes" value={formatCOP(schedule.monthly_depreciation)} />
                  <Stat label="Termina el" value={formatDateES(schedule.fully_depreciated_on)} />
                </>
              )}
            </div>
          )}

          {asset.description && (
            <p className="text-xs text-xinuco-muted break-words">{asset.description}</p>
          )}

          {!disposed && (onEdit || onDispose) && (
            <div className="flex gap-2">
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(asset)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:bg-fg/[0.04] transition-colors"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <Pencil size={14} /> Editar
                </button>
              )}
              {onDispose && (
                <button
                  type="button"
                  onClick={() => onDispose(asset)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                  style={{ borderColor: 'rgba(239,68,68,0.3)' }}
                >
                  <PackageX size={14} /> Dar de baja
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
