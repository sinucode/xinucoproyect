'use client'

import type { ReactNode } from 'react'
import type { ProfitLossResult } from '@xinuco/types'
import { formatCOP } from '@xinuco/utils'
import { pctChange } from '@/lib/accounting-utils'

// ── Indicador de cambio frente al mes anterior ────────────────────────────────

function ChangeIndicator({
  current,
  previous,
  label,
  goodWhen,
}: {
  current:  number
  previous: number
  /** Nombre del mes anterior, p. ej. 'agosto' */
  label:    string
  /** 'up': subir es bueno (ingresos, utilidad). 'down': subir es malo (gastos). */
  goodWhen: 'up' | 'down'
}) {
  const pct = pctChange(current, previous)
  if (pct === null) return null

  const rounded = Math.round(pct)
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  const good = goodWhen === 'up' ? rounded > 0 : rounded < 0
  const bad = goodWhen === 'up' ? rounded < 0 : rounded > 0
  const color = good ? 'text-emerald-400' : bad ? 'text-red-400' : 'text-xinuco-muted'

  return (
    <span className={`text-[11px] font-medium tabular-nums ${color}`}>
      {sign}{Math.abs(rounded).toLocaleString('es-CO')} % vs {label}
    </span>
  )
}

// ── Fila ──────────────────────────────────────────────────────────────────────

function StatementRow({
  sign,
  label,
  value,
  hint,
  strong,
  extra,
}: {
  sign?:   '−' | '=' | '+'
  label:   string
  value:   number
  hint?:   string
  strong?: boolean
  extra?:  ReactNode
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="w-4 shrink-0 text-center text-sm text-xinuco-muted tabular-nums">{sign ?? ''}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${strong ? 'font-semibold' : ''} text-xinuco-text`}>{label}</p>
        {hint && <p className="text-[11px] text-xinuco-muted mt-0.5 break-words">{hint}</p>}
        {extra && <div className="mt-0.5">{extra}</div>}
      </div>
      <span className={`text-sm tabular-nums whitespace-nowrap ${strong ? 'font-bold' : 'font-medium'} text-xinuco-text`}>
        {sign === '−' && value > 0 ? '−' : sign === '+' && value > 0 ? '+' : ''}{formatCOP(value)}
      </span>
    </div>
  )
}

function formatPct(value: number): string {
  return `${value.toLocaleString('es-CO', { maximumFractionDigits: 1 })}%`
}

// ── Estado de resultados ──────────────────────────────────────────────────────

export interface ProfitLossStatementProps {
  result:         ProfitLossResult
  /** Mes anterior completo: si se pasa, se muestra el cambio en ingresos, gastos y utilidad neta. */
  previous?:      ProfitLossResult
  /** Mes que se está mostrando, p. ej. 'septiembre 2026' */
  monthLabel:     string
  /** Nombre del mes anterior para el indicador, p. ej. 'agosto' */
  previousLabel?: string
}

export function ProfitLossStatement({ result: pl, previous, monthLabel, previousLabel = 'el mes anterior' }: ProfitLossStatementProps) {
  const positive = pl.net_profit >= 0
  const netColor = positive ? 'text-emerald-400' : 'text-red-400'

  return (
    <section
      className="rounded-2xl p-4 sm:p-6"
      style={{ background: 'var(--surface-color, rgba(255,255,255,0.03))', border: '1px solid var(--border-color)' }}
      aria-label="Estado de resultados"
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="text-sm font-bold text-xinuco-text">Estado de resultados</h2>
        <span className="text-xs text-xinuco-muted capitalize">{monthLabel}</span>
      </div>

      <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
        <StatementRow
          label="Ingresos totales"
          value={pl.revenue.total}
          strong
          hint={`servicios ${formatCOP(pl.revenue.services)} · productos ${formatCOP(pl.revenue.retail)} · ${pl.revenue.sales_count} ${pl.revenue.sales_count === 1 ? 'venta' : 'ventas'}`}
          extra={previous && (
            <ChangeIndicator current={pl.revenue.total} previous={previous.revenue.total} label={previousLabel} goodWhen="up" />
          )}
        />
        <StatementRow sign="−" label="Costo de productos vendidos" value={pl.cost_of_goods} />
        <StatementRow sign="=" label="Utilidad bruta" value={pl.gross_profit} strong />
        <StatementRow sign="−" label="Comisiones del equipo" value={pl.commissions} />
        <StatementRow
          sign="−"
          label="Gastos"
          value={pl.expenses.total}
          extra={previous && (
            <ChangeIndicator current={pl.expenses.total} previous={previous.expenses.total} label={previousLabel} goodWhen="down" />
          )}
        />
        {(pl.depreciation ?? 0) > 0 && (
          <StatementRow
            sign="−"
            label="Desgaste de equipos"
            value={pl.depreciation}
            hint="Lo que se gastaron tus equipos este período (se calcula en Activos fijos)"
          />
        )}
        {(pl.asset_disposals ?? 0) !== 0 && (
          <StatementRow
            sign={pl.asset_disposals > 0 ? '+' : '−'}
            label="Venta o baja de equipos"
            value={Math.abs(pl.asset_disposals)}
            hint={pl.asset_disposals > 0 ? 'Ganancia al vender equipos por más de lo que valían' : 'Pérdida al vender o dar de baja equipos'}
          />
        )}
      </div>

      <div
        className="mt-3 pt-4 flex items-end justify-between gap-3 border-t-2"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">= Utilidad neta</p>
          {pl.margin_pct !== null && (
            <p className="text-xs text-xinuco-muted mt-1">Margen {formatPct(pl.margin_pct)}</p>
          )}
          {previous && (
            <div className="mt-0.5">
              <ChangeIndicator current={pl.net_profit} previous={previous.net_profit} label={previousLabel} goodWhen="up" />
            </div>
          )}
        </div>
        <span className={`text-2xl sm:text-4xl font-bold tabular-nums ${netColor}`}>
          {!positive ? '−' : ''}{formatCOP(Math.abs(pl.net_profit))}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-1 text-[11px] text-xinuco-muted">
        <p>Las propinas ({formatCOP(pl.tips)}) no cuentan como ingreso: son del profesional.</p>
        {pl.revenue.discounts > 0 && <p>Incluye {formatCOP(pl.revenue.discounts)} en descuentos.</p>}
        <p>El costo de productos usa el costo registrado en Inventario.</p>
      </div>
    </section>
  )
}
