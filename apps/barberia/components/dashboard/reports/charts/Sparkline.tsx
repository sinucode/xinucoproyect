'use client'

import { formatMoneyCompact } from '@/lib/report-utils'
import { CHART, FONT_SIZE } from './theme'
import { useChartFrame, type TipContent } from './useChartFrame'

export interface SparkPoint {
  label:   string
  value:   number
  tooltip: TipContent
}

/**
 * Línea de 2 px de una sola serie (p. ej. utilidad de los últimos 12 meses).
 * Etiquetas directas solo en el máximo, el mínimo y el último punto.
 */
export function Sparkline({
  points,
  height = 112,
  ariaLabel,
  format = formatMoneyCompact,
}: {
  points:     SparkPoint[]
  height?:    number
  ariaLabel:  string
  format?:    (n: number) => string
}) {
  const { ref, width, bind, clear, tooltip } = useChartFrame()
  const n = points.length

  const padL = 8
  const padR = 12
  const padT = 20
  const padB = 34
  const plotW = Math.max(0, width - padL - padR)
  const plotH = Math.max(0, height - padT - padB)

  const values = points.map(p => p.value)
  const vmin = Math.min(0, ...values)
  const vmax = Math.max(0, ...values)
  const span = vmax - vmin || 1

  const xAt = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const yAt = (v: number) => padT + plotH - ((v - vmin) / span) * plotH

  let maxI = 0
  let minI = 0
  values.forEach((v, i) => {
    if (v > values[maxI]) maxI = i
    if (v < values[minI]) minI = i
  })
  const lastI = n - 1
  const labeled = new Set<number>([lastI])
  if (n > 2) {
    labeled.add(maxI)
    if (values[minI] !== values[maxI]) labeled.add(minI)
  }

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(' ')
  const zeroY = yAt(0)

  const labelAnchor = (i: number): 'start' | 'middle' | 'end' => (i === 0 ? 'start' : i === lastI ? 'end' : 'middle')
  // Etiquetas de valor: encima del punto si es el máximo o el último, debajo si es el mínimo
  const labelY = (i: number) => (i === minI && i !== maxI && i !== lastI ? yAt(values[i]) + 15 : yAt(values[i]) - 10)

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} onClick={clear}>
          {vmin < 0 && vmax > 0 && (
            <line x1={padL} x2={width - padR} y1={zeroY} y2={zeroY} stroke={CHART.axis} strokeWidth={1} />
          )}
          {n > 1 && <path d={line} fill="none" stroke={CHART.blue} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}

          {points.map((p, i) => {
            const cx = xAt(i)
            const cy = yAt(p.value)
            const slot = n <= 1 ? plotW : plotW / (n - 1)
            return (
              <g key={p.label + i}>
                {labeled.has(i) && <circle cx={cx} cy={cy} r={4} fill={CHART.blue} stroke={CHART.surface} strokeWidth={1.5} />}
                {/* Zona de toque ancha (≥ 24 px) */}
                <rect
                  x={cx - Math.max(slot / 2, 12)}
                  y={0}
                  width={Math.max(slot, 24)}
                  height={height}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  {...bind(`s${i}`, { x: cx, y: cy }, p.tooltip)}
                />
              </g>
            )
          })}

          {[...labeled].map(i => (
            <text
              key={`l${i}`}
              x={Math.min(width - 2, Math.max(2, xAt(i)))}
              y={labelY(i)}
              textAnchor={labelAnchor(i)}
              fontSize={FONT_SIZE}
              fontWeight={600}
              fill={CHART.ink}
              pointerEvents="none"
            >
              {format(values[i])}
            </text>
          ))}

          {n > 0 && (
            <>
              <text x={padL} y={height - 5} fontSize={FONT_SIZE} fill={CHART.muted} textAnchor="start" pointerEvents="none">{points[0].label}</text>
              {n > 1 && (
                <text x={width - padR + 4} y={height - 5} fontSize={FONT_SIZE} fill={CHART.muted} textAnchor="end" pointerEvents="none">{points[lastI].label}</text>
              )}
            </>
          )}
        </svg>
      )}
      {tooltip}
    </div>
  )
}
