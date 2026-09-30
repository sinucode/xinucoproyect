'use client'

import { fitText, roundedBarPath } from './scale'
import { CHART, FONT_SIZE, FONT_SIZE_LABEL } from './theme'
import { useChartFrame, type TipContent } from './useChartFrame'

export interface HBarItem {
  label:      string
  value:      number
  /** Texto del valor a la derecha (p. ej. '$450.000' o '38 %') */
  valueLabel: string
  /** Línea pequeña bajo la barra (p. ej. 'Produjo $1.200.000 · 34 servicios') */
  sub?:       string
  tooltip:    TipContent
}

const ROW_PLAIN = 40
const ROW_SUB = 58

/**
 * Lista de barras horizontales ordenadas (o en el orden dado), una sola tonalidad.
 * `max` fija el 100 % de la barra (por defecto, el mayor valor).
 */
export function HBarList({
  items,
  color = CHART.orange,
  max,
  ariaLabel,
}: {
  items:     HBarItem[]
  color?:    string
  max?:      number
  ariaLabel: string
}) {
  const { ref, width, bind, clear, tooltip } = useChartFrame()
  const top = max ?? Math.max(1, ...items.map(i => i.value))

  const rowH = items.some(i => i.sub) ? ROW_SUB : ROW_PLAIN
  const height = items.length * rowH + 2

  return (
    <div ref={ref} className="relative w-full" style={{ height: width > 0 ? height : 0 }}>
      {width > 0 && items.length > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} onClick={clear}>
          {items.map((it, i) => {
            const y = i * rowH + 2
            const w = Math.max(it.value > 0 ? 4 : 0, Math.min(1, it.value / top) * width)
            const label = fitText(it.label, width - it.valueLabel.length * 7.4 - 14, 6.6)
            return (
              <g key={it.label + i}>
                <text x={0} y={y + 14} fontSize={FONT_SIZE_LABEL} fill={CHART.ink2}>{label}</text>
                <text x={width} y={y + 14} fontSize={FONT_SIZE_LABEL} fontWeight={700} fill={CHART.ink} textAnchor="end">{it.valueLabel}</text>
                {/* Pista */}
                <rect x={0} y={y + 22} width={width} height={8} rx={4} fill={CHART.grid} />
                {w > 0 && <path d={roundedBarPath(0, y + 22, w, 8, 4, 'right')} fill={color} />}
                {it.sub && <text x={0} y={y + 46} fontSize={FONT_SIZE} fill={CHART.muted}>{fitText(it.sub, width, 5.9)}</text>}
                <rect
                  x={0} y={y - 2} width={width} height={rowH}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  {...bind(`h${i}`, { x: Math.min(width / 2, Math.max(40, w)), y: y + 22 }, it.tooltip)}
                />
              </g>
            )
          })}
        </svg>
      )}
      {tooltip}
    </div>
  )
}
