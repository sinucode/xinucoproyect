'use client'

import { useId, useState, type ReactNode } from 'react'
import { CHART } from './theme'

export interface LegendItem {
  label: string
  color: string
}

export interface TableData {
  columns: string[]
  rows:    (string | number)[][]
}

/**
 * Tarjeta de un gráfico: título, subtítulo, leyenda (si hay 2+ series) y el botón
 * "Ver tabla" que muestra los mismos datos en una tabla (accesibilidad).
 */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
  footer,
  className = '',
}: {
  title:      string
  subtitle?:  string
  legend?:    LegendItem[]
  table?:     TableData
  children:   ReactNode
  footer?:    ReactNode
  className?: string
}) {
  const [showTable, setShowTable] = useState(false)
  const tableId = useId()

  return (
    <section
      className={`rounded-2xl p-4 sm:p-5 min-w-0 ${className}`}
      style={{ background: 'rgb(var(--fg) / 0.03)', border: '1px solid var(--border-color)' }}
      aria-label={title}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-xinuco-text">{title}</h3>
          {subtitle && <p className="text-xs text-xinuco-muted mt-0.5">{subtitle}</p>}
        </div>
        {table && (
          <button
            type="button"
            onClick={() => setShowTable(v => !v)}
            aria-expanded={showTable}
            aria-controls={tableId}
            className="shrink-0 min-h-[32px] px-2.5 rounded-lg text-[11px] font-medium text-xinuco-muted hover:text-xinuco-text transition-colors"
            style={{ border: '1px solid var(--border-color)' }}
          >
            {showTable ? 'Ver gráfico' : 'Ver tabla'}
          </button>
        )}
      </div>

      {legend && legend.length >= 2 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-3" aria-label="Leyenda">
          {legend.map(l => (
            <li key={l.label} className="flex items-center gap-1.5 text-xs" style={{ color: CHART.ink2 }}>
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3" id={tableId}>
        {showTable && table ? (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  {table.columns.map((c, i) => (
                    <th
                      key={i}
                      scope="col"
                      className={`py-1.5 font-semibold text-xinuco-muted whitespace-nowrap ${i === 0 ? 'text-left pr-3' : 'text-right pl-3'}`}
                      style={{ borderBottom: `1px solid ${CHART.axis}` }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={`py-1.5 tabular-nums text-xinuco-text ${ci === 0 ? 'text-left pr-3' : 'text-right pl-3 whitespace-nowrap'}`}
                        style={{ borderBottom: `1px solid ${CHART.grid}` }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>

      {footer && <div className="mt-3">{footer}</div>}
    </section>
  )
}
