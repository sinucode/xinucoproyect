'use client'

import { formatInt } from '@/lib/report-utils'
import { niceScale, roundedBarPath } from './scale'
import { CHART, FONT_SIZE } from './theme'
import { useChartFrame, type TipContent } from './useChartFrame'

export interface StackSeries {
  name:  string
  color: string
}

export interface StackDatum {
  label:   string
  /** Un valor por serie, de abajo hacia arriba */
  values:  number[]
  tooltip: TipContent
}

const SEG_GAP = 2

/** Columnas apiladas (p. ej. clientes recurrentes abajo y nuevos arriba). Un solo eje de conteo. */
export function StackedColumns({
  data,
  series,
  height = 220,
  ariaLabel,
}: {
  data:      StackDatum[]
  series:    StackSeries[]
  height?:   number
  ariaLabel: string
}) {
  const { ref, width, bind, clear, tooltip } = useChartFrame()
  const n = data.length

  const padL = 34
  const padR = 8
  const padT = 24
  const padB = 26
  const plotW = Math.max(0, width - padL - padR)
  const plotH = Math.max(0, height - padT - padB)

  const totals = data.map(d => d.values.reduce((s, v) => s + v, 0))
  const scale = niceScale(0, Math.max(0, ...totals), 4, true)
  const span = scale.max - scale.min || 1
  const yAt = (v: number) => padT + plotH - ((v - scale.min) / span) * plotH

  const slot = n > 0 ? plotW / n : 0
  const bw = Math.max(6, Math.min(40, slot - 2))

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} onClick={clear}>
          {scale.ticks.map(t => (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={yAt(t)} y2={yAt(t)} stroke={t === 0 ? CHART.axis : CHART.grid} strokeWidth={1} />
              <text x={padL - 6} y={yAt(t) + 4} textAnchor="end" fontSize={FONT_SIZE} fill={CHART.muted}>{formatInt(t)}</text>
            </g>
          ))}

          {data.map((d, i) => {
            const cx = padL + slot * i + slot / 2
            const x = cx - bw / 2
            const lastNonZero = (() => {
              for (let k = d.values.length - 1; k >= 0; k--) if (d.values[k] > 0) return k
              return -1
            })()
            let acc = 0
            return (
              <g key={d.label + i}>
                {d.values.map((v, k) => {
                  if (v <= 0) return null
                  const y0 = yAt(acc)
                  const y1 = yAt(acc + v)
                  acc += v
                  // 2 px de separación entre segmentos apilados (se la quitamos al de arriba)
                  const h = Math.max(1, y0 - y1 - (k > 0 && acc - v > 0 ? SEG_GAP : 0))
                  const top = y1
                  const isTop = k === lastNonZero
                  return (
                    <path
                      key={k}
                      d={isTop ? roundedBarPath(x, top, bw, h, 4, 'up') : `M${x},${top} h${bw} v${h} h${-bw} Z`}
                      fill={series[k]?.color ?? CHART.blue}
                    />
                  )
                })}
                {i === n - 1 && totals[i] > 0 && (
                  <text x={cx} y={yAt(totals[i]) - 6} textAnchor="middle" fontSize={FONT_SIZE} fontWeight={600} fill={CHART.ink} pointerEvents="none">
                    {formatInt(totals[i])}
                  </text>
                )}
                <text x={cx} y={height - 7} textAnchor="middle" fontSize={FONT_SIZE} fill={CHART.muted}>{d.label}</text>
                <rect
                  x={padL + slot * i} y={padT - 8} width={slot} height={plotH + 16}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  {...bind(`k${i}`, { x: cx, y: yAt(totals[i]) }, d.tooltip)}
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
