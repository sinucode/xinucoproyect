'use client'
// components/dashboard/accounting/AccountingJournal.tsx — RF22 Trazabilidad Contable

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  BookOpen,
  BarChart2,
  ShoppingBag,
  Receipt,
  Wallet,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react'
import type { JournalEntry, JournalEntryType, JournalEntrySubtype, AccountingSummary } from '@xinuco/types'
import { formatCOP } from '@xinuco/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatEntryDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  })
}

const SUBTYPE_ICONS: Record<JournalEntrySubtype, React.FC<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  sale:              ShoppingBag,
  operating_expense: Receipt,
  staff_payout:      Wallet,
  asset_depreciation: Minus,
}

const SUBTYPE_LABELS: Record<JournalEntrySubtype, string> = {
  sale:              'Venta',
  operating_expense: 'Gasto operativo',
  staff_payout:      'Liquidación staff',
  asset_depreciation: 'Depreciación',
}

const CATEGORY_LABELS: Record<string, string> = {
  ventas:       'Ventas',
  rent:         'Arriendo',
  supplies:     'Insumos',
  utilities:    'Servicios',
  salary:       'Nómina',
  other:        'Otros',
  staff_ledger: 'Pagos al equipo',
}

function categoryLabel(cat: string | null): string {
  if (!cat) return '—'
  return CATEGORY_LABELS[cat] ?? cat
}

// Preset date range helper
function getPresetRange(preset: 'thisMonth' | 'lastMonth' | 'thisYear'): { from: string; to: string } {
  const now  = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()

  if (preset === 'thisMonth') {
    const from = new Date(year, month, 1)
    return {
      from: from.toISOString().slice(0, 10),
      to:   now.toISOString().slice(0, 10),
    }
  }
  if (preset === 'lastMonth') {
    const from = new Date(year, month - 1, 1)
    const to   = new Date(year, month, 0)
    return {
      from: from.toISOString().slice(0, 10),
      to:   to.toISOString().slice(0, 10),
    }
  }
  // thisYear
  return {
    from: `${year}-01-01`,
    to:   now.toISOString().slice(0, 10),
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface AccountingJournalProps {
  entries:         JournalEntry[]
  summary:         AccountingSummary | null
  businessId:      string
  slug:            string
  currentDateFrom: string
  currentDateTo:   string
  currentType?:    string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AccountingJournal({
  entries,
  summary,
  slug,
  currentDateFrom,
  currentDateTo,
  currentType,
}: AccountingJournalProps) {
  const router                    = useRouter()
  const [, startTransition]       = useTransition()
  const [localDateFrom, setLocalDateFrom] = useState(currentDateFrom)
  const [localDateTo,   setLocalDateTo]   = useState(currentDateTo)
  const [typeFilter, setTypeFilter]       = useState<'all' | JournalEntryType>(
    currentType === 'income' || currentType === 'expense' ? currentType : 'all'
  )

  // Push new search params → triggers server re-render with fresh data
  function applyFilters(from: string, to: string, type: 'all' | JournalEntryType = typeFilter) {
    const params = new URLSearchParams()
    params.set('dateFrom', from)
    params.set('dateTo',   to)
    if (type !== 'all') params.set('type', type)
    startTransition(() => {
      router.push(`/${slug}/dashboard/accounting?${params.toString()}`)
    })
  }

  function handlePreset(preset: 'thisMonth' | 'lastMonth' | 'thisYear') {
    const { from, to } = getPresetRange(preset)
    setLocalDateFrom(from)
    setLocalDateTo(to)
    applyFilters(from, to, typeFilter)
  }

  function handleCustomDateChange() {
    if (localDateFrom && localDateTo && localDateFrom <= localDateTo) {
      applyFilters(localDateFrom, localDateTo, typeFilter)
    }
  }

  function handleTypeChange(type: 'all' | JournalEntryType) {
    setTypeFilter(type)
    // Client-side filter only — no new server request needed for type
  }

  // Client-side type filter applied on top of server data
  const filteredEntries = typeFilter === 'all'
    ? entries
    : entries.filter((e) => e.entry_type === typeFilter)

  // Net position color
  const netPos     = summary?.net_position ?? 0
  const netColor   = netPos >= 0 ? '#22C55E' : '#EF4444'

  return (
    <div className="flex flex-col gap-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-4 pb-6 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background:   'color-mix(in srgb, var(--primary-color) 12%, transparent)',
            border:       '1px solid color-mix(in srgb, var(--primary-color) 25%, transparent)',
          }}
        >
          <BookOpen size={22} style={{ color: 'var(--primary-color)' }} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-xinuco-text">Trazabilidad Contable</h1>
          <p className="text-sm" style={{ color: 'rgba(244,244,244,0.50)' }}>
            Diario unificado de movimientos financieros
          </p>
        </div>
      </div>

      {/* ── Date range filter bar ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        {/* Preset buttons */}
        <div className="flex gap-2">
          {([
            { id: 'thisMonth', label: 'Este mes'     },
            { id: 'lastMonth', label: 'Mes anterior' },
            { id: 'thisYear',  label: 'Este año'     },
          ] as const).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => handlePreset(id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: 'color-mix(in srgb, var(--primary-color) 10%, transparent)',
                border:     '1px solid color-mix(in srgb, var(--primary-color) 20%, transparent)',
                color:      'var(--primary-color)',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom range inputs */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={localDateFrom}
            onChange={(e) => setLocalDateFrom(e.target.value)}
            onBlur={handleCustomDateChange}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-transparent outline-none"
            style={{
              border:  '1px solid var(--border-color)',
              color:   'var(--text-color, #F4F4F4)',
              colorScheme: 'dark',
            }}
          />
          <span className="text-xs" style={{ color: 'rgba(244,244,244,0.40)' }}>→</span>
          <input
            type="date"
            value={localDateTo}
            min={localDateFrom}
            onChange={(e) => setLocalDateTo(e.target.value)}
            onBlur={handleCustomDateChange}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-transparent outline-none"
            style={{
              border:  '1px solid var(--border-color)',
              color:   'var(--text-color, #F4F4F4)',
              colorScheme: 'dark',
            }}
          />
        </div>
      </div>

      {/* ── Summary cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Ingresos Totales */}
        <div
          className="rounded-xl p-5"
          style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color, #111111)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} style={{ color: '#22C55E' }} />
            <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'rgba(244,244,244,0.50)' }}>
              Ingresos Totales
            </span>
          </div>
          <p className="text-2xl font-bold" style={{ color: '#22C55E' }}>
            {formatCOP(summary?.total_income ?? 0)}
          </p>
        </div>

        {/* Egresos Totales */}
        <div
          className="rounded-xl p-5"
          style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color, #111111)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown size={16} style={{ color: '#EF4444' }} />
            <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'rgba(244,244,244,0.50)' }}>
              Egresos Totales
            </span>
          </div>
          <p className="text-2xl font-bold" style={{ color: '#EF4444' }}>
            {formatCOP(summary?.total_expense ?? 0)}
          </p>
        </div>

        {/* Posición Neta */}
        <div
          className="rounded-xl p-5"
          style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color, #111111)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 size={16} style={{ color: 'var(--primary-color, #C5A059)' }} />
            <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'rgba(244,244,244,0.50)' }}>
              Posición Neta
            </span>
          </div>
          <p className="text-2xl font-bold" style={{ color: netColor }}>
            {netPos >= 0 ? '+' : '−'}{formatCOP(Math.abs(netPos))}
          </p>
        </div>
      </div>

      {/* ── Type filter tabs ─────────────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--surface-color, #111111)', border: '1px solid var(--border-color)' }}>
        {([
          { value: 'all',     label: 'Todos',    count: entries.length },
          { value: 'income',  label: 'Ingresos', count: entries.filter(e => e.entry_type === 'income').length },
          { value: 'expense', label: 'Egresos',  count: entries.filter(e => e.entry_type === 'expense').length },
        ] as const).map(({ value, label, count }) => {
          const isActive = typeFilter === value
          return (
            <button
              key={value}
              onClick={() => handleTypeChange(value)}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all"
              style={{
                background: isActive ? 'color-mix(in srgb, var(--primary-color) 15%, transparent)' : 'transparent',
                color:      isActive ? 'var(--primary-color)' : 'rgba(244,244,244,0.50)',
                border:     isActive ? '1px solid color-mix(in srgb, var(--primary-color) 25%, transparent)' : '1px solid transparent',
              }}
            >
              {label}
              <span
                className="text-xs px-1.5 py-0.5 rounded-md font-normal"
                style={{ background: 'rgba(255,255,255,0.08)' }}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Journal table ────────────────────────────────────────────────────── */}
      {filteredEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: 'color-mix(in srgb, var(--primary-color) 8%, transparent)',
              border:     '1px solid color-mix(in srgb, var(--primary-color) 15%, transparent)',
            }}
          >
            <BarChart2 size={28} style={{ color: 'rgba(244,244,244,0.25)' }} />
          </div>
          <p className="text-sm font-medium" style={{ color: 'rgba(244,244,244,0.55)' }}>
            No hay movimientos en este período
          </p>
          <p className="text-xs mt-1" style={{ color: 'rgba(244,244,244,0.30)' }}>
            Ajusta el rango de fechas para ver otros movimientos.
          </p>
        </div>
      ) : (
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--border-color)' }}
        >
          {/* Table header — hidden on mobile, visible on md+ */}
          <div
            className="hidden md:grid grid-cols-[140px_80px_60px_1fr_120px_120px] gap-4 px-5 py-3 text-xs font-medium uppercase tracking-wide"
            style={{
              background: 'var(--surface-color, rgba(255,255,255,0.03))',
              borderBottom: '1px solid var(--border-color)',
              color: 'rgba(244,244,244,0.40)',
            }}
          >
            <span>Fecha</span>
            <span>Tipo</span>
            <span>Origen</span>
            <span>Descripción</span>
            <span>Categoría</span>
            <span className="text-right">Monto</span>
          </div>

          {/* Table rows */}
          {filteredEntries.map((entry) => {
            const isIncome  = entry.entry_type === 'income'
            const SubIcon   = SUBTYPE_ICONS[entry.entry_subtype] ?? Receipt
            const typeColor = isIncome ? '#22C55E' : '#EF4444'

            return (
              <div
                key={entry.entry_id}
                className="grid grid-cols-1 md:grid-cols-[140px_80px_60px_1fr_120px_120px] gap-2 md:gap-4 px-5 py-4"
                style={{ borderTop: '1px solid var(--border-color)' }}
              >
                {/* Date */}
                <span
                  className="text-xs font-mono"
                  style={{ color: 'rgba(244,244,244,0.55)' }}
                >
                  {formatEntryDate(entry.entry_date)}
                </span>

                {/* Type badge */}
                <span
                  className="inline-flex items-center justify-center w-fit px-2 py-0.5 rounded-full text-xs font-semibold"
                  style={{
                    background: `${typeColor}18`,
                    color:       typeColor,
                    border:     `1px solid ${typeColor}30`,
                  }}
                >
                  {isIncome ? 'Ingreso' : 'Egreso'}
                </span>

                {/* Subtype icon */}
                <div className="flex items-center" title={SUBTYPE_LABELS[entry.entry_subtype]}>
                  <SubIcon size={16} style={{ color: 'rgba(244,244,244,0.40)' }} />
                </div>

                {/* Description */}
                <span
                  className="text-sm truncate"
                  style={{ color: 'var(--text-color, #F4F4F4)' }}
                  title={entry.description}
                >
                  {entry.description}
                </span>

                {/* Category chip */}
                <span>
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      color:      'rgba(244,244,244,0.60)',
                      border:     '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    {categoryLabel(entry.category)}
                  </span>
                </span>

                {/* Amount */}
                <span
                  className="text-sm font-semibold text-right tabular-nums"
                  style={{ color: typeColor }}
                >
                  {isIncome ? '+' : '−'}{formatCOP(entry.amount)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Footer note ─────────────────────────────────────────────────────── */}
      {filteredEntries.length > 0 && (
        <p className="text-center text-xs pb-2" style={{ color: 'rgba(244,244,244,0.25)' }}>
          Mostrando {filteredEntries.length} movimiento{filteredEntries.length !== 1 ? 's' : ''} · Todos los montos en COP
        </p>
      )}
    </div>
  )
}
