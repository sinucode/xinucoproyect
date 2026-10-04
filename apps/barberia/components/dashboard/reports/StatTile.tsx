'use client'

import type { ReactNode } from 'react'
import { pctChange } from '@/lib/accounting-utils'
import { formatPct } from '@/lib/report-utils'
import { STATUS_TEXT } from './charts/theme'

/**
 * Cambio frente al período anterior: ▲/▼ + signo + %, en color Y con texto (nunca solo color).
 * `goodWhen`: 'up' si subir es bueno (ingresos, utilidad); 'down' si subir es malo (gastos).
 * `mode` 'pts': diferencia en puntos porcentuales (para el margen).
 */
export function Delta({
  current,
  previous,
  goodWhen = 'up',
  mode = 'pct',
  suffix = 'vs período anterior',
  className = '',
}: {
  current:   number | null
  previous:  number | null
  goodWhen?: 'up' | 'down'
  mode?:     'pct' | 'pts'
  suffix?:   string
  className?: string
}) {
  if (current === null || previous === null) {
    return <span className={`text-[11px] text-xinuco-muted ${className}`}>Sin período anterior para comparar</span>
  }

  let rounded: number
  let text: string
  if (mode === 'pts') {
    const diff = Math.round((current - previous) * 10) / 10
    rounded = diff
    text = `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(diff).toLocaleString('es-CO', { maximumFractionDigits: 1 })} pts`
  } else {
    const pct = pctChange(current, previous)
    if (pct === null) {
      return <span className={`text-[11px] text-xinuco-muted ${className}`}>Sin período anterior para comparar</span>
    }
    rounded = Math.round(pct)
    text = `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${formatPct(Math.abs(rounded))}`
  }

  if (rounded === 0) {
    return <span className={`text-[11px] font-medium text-xinuco-muted ${className}`}>● Igual {suffix}</span>
  }
  const up = rounded > 0
  const good = goodWhen === 'up' ? up : !up
  return (
    <span className={`text-[11px] font-medium tabular-nums ${good ? STATUS_TEXT.good : STATUS_TEXT.critical} ${className}`}>
      {up ? '▲' : '▼'} {text} {suffix}
    </span>
  )
}

/** Tarjeta de cifra: etiqueta, valor grande y cambio frente al período anterior. */
export function StatTile({
  label,
  value,
  delta,
  className = '',
}: {
  label:      string
  value:      ReactNode
  delta:      ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-xl px-3.5 py-3 min-w-0 flex flex-col gap-1 ${className}`}
      style={{ background: 'rgb(var(--fg) / 0.03)', border: '1px solid var(--border-color)' }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-xinuco-muted">{label}</span>
      <span className="text-xl sm:text-2xl font-bold tabular-nums text-xinuco-text leading-tight break-words">{value}</span>
      <div className="leading-snug">{delta}</div>
    </div>
  )
}
