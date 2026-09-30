'use client'

import { formatMoneyCompact } from '@/lib/report-utils'
import { niceScale, roundedBarPath } from './scale'
import { CHART, FONT_SIZE } from './theme'
import { useChartFrame, type TipContent } from './useChartFrame'

export interface DivergingDatum {
  label:   string
  value:   number
  tooltip: TipContent
}

const signedCompact = (n: number) => (n > 0 ? `+${formatMoneyCompact(n)}` : formatMoneyCompact(n))

/**
 * Columnas que suben (ganancia, verde) o bajan (pérdida, rojo) desde una línea base en cero.
 * Un solo eje; etiquetas de valor solo en el mejor mes, el peor y el último.
 */
export function DivergingBars({
  data,
  height = 240,
  ariaLabel,
}: {
  data:      DivergingDatum[]
  height?:   number
  ariaLabel: string
}) {
  const { ref, width, bind, clear, tooltip } = useChartFrame()
  const n = data.length

  const padL = 50
  const padR = 8
  const padT = 26
  const padB = 26
  const plotW = Math.max(0, width - padL - padR)
  const plotH = Math.max(0, height - padT - padB)

  const values = data.map(d => d.value)
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const room = (hi - lo) * 0.14   // espacio para las etiquetas de valor
  const scale = niceScale(lo < 0 ? lo - room : 0, hi > 0 ? hi + room : 0, 4)
  const span = scale.max - scale.min || 1
  const yAt = (v: number) => padT + plotH - ((v - scale.min) / span) * plotH
  const zeroY = yAt(0)

  const slot = n > 0 ? plotW / n : 0
  const bw = Math.max(3, Math.min(28, slot - 2))

  // Etiquetas de valor: último, mejor y peor (sin empalmes)
  let maxI = 0
  let minI = 0
  values.forEach((v, i) => {
    if (v > values[maxI]) maxI = i
    if (v < values[minI]) minI = i
  })
  const wanted = [n - 1, maxI, minI].filter((i, k, arr) => i >= 0 && arr.indexOf(i) === k && values[i] !== 0)
  const labeled: number[] = []
  for (const i of wanted) {
    if (labeled.every(j => Math.abs(j - i) * slot >= 44)) labeled.push(i)
  }

  // Etiquetas del eje X: cada `stride` meses, terminando siempre en el último
  const stride = Math.max(1, Math.ceil(34 / Math.max(slot, 1)))
  const showX = (i: number) => (n - 1 - i) % stride === 0

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} onClick={clear}>
          {/* Líneas guía + eje Y */}
          {scale.ticks.map(t => (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={yAt(t)} y2={yAt(t)} stroke={t === 0 ? CHART.axis : CHART.grid} strokeWidth={1} />
              <text x={padL - 6} y={yAt(t) + 4} textAnchor="end" fontSize={FONT_SIZE} fill={CHART.muted}>{formatMoneyCompact(t)}</text>
            </g>
          ))}

          {data.map((d, i) => {
            const cx = padL + slot * i + slot / 2
            const x = cx - bw / 2
            const h = Math.abs(yAt(d.value) - zeroY)
            const positive = d.value >= 0
            return (
              <g key={d.label + i}>
                {d.value !== 0 && (
                  <path
                    d={positive ? roundedBarPath(x, zeroY - h, bw, h, 4, 'up') : roundedBarPath(x, zeroY, bw, h, 4, 'down')}
                    fill={positive ? CHART.good : CHART.critical}
                  />
                )}
                {showX(i) && (
                  <text x={cx} y={height - 7} textAnchor="middle" fontSize={FONT_SIZE} fill={CHART.muted}>{d.label}</text>
                )}
                {/* Zona de toque: toda la columna */}
                <rect
                  x={padL + slot * i}
                  y={padT - 8}
                  width={slot}
                  height={plotH + 16}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  {...bind(`d${i}`, { x: cx, y: yAt(d.value) }, d.tooltip)}
                />
              </g>
            )
          })}

          {labeled.map(i => {
            const cx = padL + slot * i + slot / 2
            const v = values[i]
            const anchor = cx < padL + 26 ? 'start' : cx > width - 26 ? 'end' : 'middle'
            const x = anchor === 'start' ? cx - bw / 2 : anchor === 'end' ? cx + bw / 2 : cx
            return (
              <text
                key={`v${i}`}
                x={x}
                y={v >= 0 ? yAt(v) - 6 : yAt(v) + 15}
                textAnchor={anchor}
                fontSize={FONT_SIZE}
                fontWeight={600}
                fill={CHART.ink}
                pointerEvents="none"
              >
                {v >= 0 ? '▲ ' : '▼ '}{signedCompact(v)}
              </text>
            )
          })}
        </svg>
      )}
      {tooltip}
    </div>
  )
}
