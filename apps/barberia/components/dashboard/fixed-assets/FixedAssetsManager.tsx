'use client'
// components/dashboard/fixed-assets/FixedAssetsManager.tsx — RF21 Activos fijos

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Package, Plus, TrendingDown, Wallet, Coins, X, AlertCircle } from 'lucide-react'
import { AdminPageHeader } from '@xinuco/ui'
import { businessTodayISODate } from '@/lib/agenda-time'
import type { AssetPortfolioSummary, FixedAsset } from '@xinuco/types'
import { AssetCard } from './AssetCard'
import { AssetSheet } from './AssetSheet'
import { DisposeSheet } from './DisposeSheet'
import { formatCOP } from './shared'

interface FixedAssetsManagerProps {
  /** Equipos en uso. */
  assets:       FixedAsset[]
  /** Equipos dados de baja. */
  disposed:     FixedAsset[]
  summary:      AssetPortfolioSummary | null
  /** Hay un turno de caja abierto (habilita pagar / recibir con el efectivo de la caja). */
  hasOpenShift: boolean
  /** Error al cargar (se muestra en lugar de una lista vacía engañosa). */
  loadError?:   string | null
}

type Tab = 'active' | 'disposed'
type Panel =
  | { kind: 'create' }
  | { kind: 'edit'; assetId: string }
  | { kind: 'dispose'; assetId: string }

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  className = '',
  big,
}: {
  icon:       React.ElementType
  label:      string
  value:      string
  hint?:      string
  className?: string
  big?:       boolean
}) {
  return (
    <div
      className={`rounded-xl px-4 py-3.5 flex flex-col gap-1.5 border min-w-0 ${className}`}
      style={{ backgroundColor: '#111111', borderColor: 'var(--border-color)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label}</span>
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)' }}
        >
          <Icon size={14} style={{ color: 'var(--primary-color)' }} />
        </div>
      </div>
      <span className={`${big ? 'text-2xl' : 'text-xl'} font-bold text-xinuco-text tabular-nums break-words`}>{value}</span>
      {hint && <span className="text-[11px] text-xinuco-muted">{hint}</span>}
    </div>
  )
}

export function FixedAssetsManager({
  assets,
  disposed,
  summary,
  hasOpenShift,
  loadError,
}: FixedAssetsManagerProps) {
  const router = useRouter()
  const [tab, setTab]       = useState<Tab>('active')
  const [panel, setPanel]   = useState<Panel | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const today = businessTodayISODate()

  const handleDone = (message: string) => {
    setNotice(message)
    router.refresh()
  }

  // El equipo del panel se busca en la lista viva (tras guardar, router.refresh la actualiza)
  const panelAsset = panel && panel.kind !== 'create'
    ? assets.find((a) => a.id === panel.assetId) ?? null
    : null

  const list = tab === 'active' ? assets : disposed

  const tabBtn = (key: Tab, label: string, count: number) => {
    const active = tab === key
    return (
      <button
        key={key}
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => setTab(key)}
        className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
          active ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
        }`}
        style={{
          backgroundColor: active ? 'color-mix(in srgb, var(--primary-color) 14%, transparent)' : 'transparent',
        }}
      >
        {label} <span className="text-xs font-normal text-zinc-500 tabular-nums">({count})</span>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <AdminPageHeader
        title="Activos fijos"
        subtitle="Los equipos del negocio: cuánto valen hoy y cuánto se desgastan cada mes."
        actionButton={
          <button
            type="button"
            onClick={() => setPanel({ kind: 'create' })}
            className="w-full sm:w-auto flex items-center justify-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl transition-all hover:scale-105"
            style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
          >
            <Plus size={15} />
            Agregar equipo
          </button>
        }
      />

      {notice && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm text-xinuco-text"
          style={{
            borderColor:     'color-mix(in srgb, var(--primary-color) 35%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--primary-color) 7%, transparent)',
          }}
        >
          <span className="min-w-0 break-words">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Cerrar aviso"
            className="text-zinc-500 hover:text-zinc-200 flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {loadError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Resumen */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <SummaryCard
          className="col-span-2 sm:col-span-1"
          big
          icon={Wallet}
          label="Valor hoy"
          value={summary ? formatCOP(summary.total_book_value) : '—'}
        />
        <SummaryCard
          icon={Coins}
          label="Invertido"
          value={summary ? formatCOP(summary.total_purchase_price) : '—'}
        />
        <SummaryCard
          icon={TrendingDown}
          label="Desgaste por mes"
          value={summary ? formatCOP(summary.monthly_depreciation) : '—'}
          hint="Se resta en Contabilidad como costo del mes"
        />
      </div>

      {/* Pestañas */}
      <div
        role="tablist"
        aria-label="Equipos"
        className="flex gap-1 p-1 rounded-xl border self-start w-full sm:w-auto"
        style={{ borderColor: 'var(--border-color)', backgroundColor: '#0D0D0D' }}
      >
        {tabBtn('active', 'En uso', assets.length)}
        {tabBtn('disposed', 'Dados de baja', disposed.length)}
      </div>

      {/* Lista */}
      {list.length === 0 ? (
        <div
          className="rounded-xl border px-5 py-10 flex flex-col items-center gap-3 text-center"
          style={{ borderColor: 'var(--border-color)', backgroundColor: '#111111' }}
        >
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)' }}
          >
            <Package size={20} style={{ color: 'var(--primary-color)' }} />
          </div>
          <p className="text-sm text-xinuco-muted max-w-sm">
            {tab === 'active'
              ? 'Aún no hay equipos registrados. Agrega las sillas, máquinas y demás equipos para saber cuánto valen y cuánto se desgastan.'
              : 'Todavía no has dado de baja ningún equipo.'}
          </p>
          {tab === 'active' && (
            <button
              type="button"
              onClick={() => setPanel({ kind: 'create' })}
              className="flex items-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl"
              style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
            >
              <Plus size={15} /> Agregar equipo
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {list.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              today={today}
              disposed={tab === 'disposed'}
              onEdit={(a) => setPanel({ kind: 'edit', assetId: a.id })}
              onDispose={(a) => setPanel({ kind: 'dispose', assetId: a.id })}
            />
          ))}
        </div>
      )}

      {/* Paneles */}
      {panel?.kind === 'create' && (
        <AssetSheet
          editAsset={null}
          hasOpenShift={hasOpenShift}
          onClose={() => setPanel(null)}
          onDone={handleDone}
        />
      )}
      {panel?.kind === 'edit' && panelAsset && (
        <AssetSheet
          editAsset={panelAsset}
          hasOpenShift={hasOpenShift}
          onClose={() => setPanel(null)}
          onDone={handleDone}
        />
      )}
      {panel?.kind === 'dispose' && panelAsset && (
        <DisposeSheet
          asset={panelAsset}
          hasOpenShift={hasOpenShift}
          onClose={() => setPanel(null)}
          onDone={handleDone}
        />
      )}
    </div>
  )
}
