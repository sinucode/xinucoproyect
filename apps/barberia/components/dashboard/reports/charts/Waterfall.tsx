'use client'

import { formatMoney, formatMoneySigned, type WaterfallStep } from '@/lib/report-utils'
import { fitText } from './scale'
import { CHART, FONT_SIZE, FONT_SIZE_LABEL } from './theme'
import { useChartFrame } from './useChartFrame'

const ROW_H = 48
const BAR_H = 10
const RIGHT_COL = 108

function per100Label(step: WaterfallStep): string {
  if (step.kind === 'start') return 'Todo lo que entra'
  const p = step.per100
  if (p === null) return '—'
  const sign = p < 0 ? '−' : step.kind === 'gain' ? '+' : ''
  return `${sign}$${Math.round(Math.abs(p))} de cada $100`
}

function amountLabel(step: WaterfallStep): string {
  if (step.kind === 'start') return formatMoney(step.value)
  if (step.kind === 'result') return `${step.value >= 0 ? '▲' : '▼'} ${formatMoney(step.value)}`
  return formatMoneySigned(step.value)
}

/**
 * Cascada horizontal: Ingresos → costos → Utilidad. Cada paso es una barra flotante que parte de
 * donde terminó el anterior; a la derecha, cuánto de cada $100 representa.
 */
export function Waterfall({ steps, ariaLabel }: { steps: WaterfallStep[]; ariaLabel: string }) {
  const { ref, width, bind, clear, tooltip } = useChartFrame()
  const n = steps.length
  const height = n * ROW_H + 4

  const barW = Math.max(60, width - RIGHT_COL)
  const all = steps.flatMap(s => [s.from, s.to, 0])
  const dmin = Math.min(...all)
  const dmax = Math.max(...all)
  const span = dmax - dmin || 1
  const xAt = (v: number) => ((v - dmin) / span) * (barW - 2) + 1

  const colorOf = (s: WaterfallStep) =>
    s.kind === 'start' ? CHART.blue
      : s.kind === 'cost' ? CHART.orange
        : s.kind === 'gain' ? CHART.good
          : s.value >= 0 ? CHART.good : CHART.critical

  return (
    <div ref={ref} className="relative w-full" style={{ height: width > 0 ? height : 0 }}>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} onClick={clear}>
          {dmin < 0 && <line x1={xAt(0)} x2={xAt(0)} y1={0} y2={height} stroke={CHART.axis} strokeWidth={1} />}

          {steps.map((s, i) => {
            const y = i * ROW_H + 2
            const a = xAt(Math.min(s.from, s.to))
            const b = xAt(Math.max(s.from, s.to))
            const w = Math.max(3, b - a)
            const strong = s.kind === 'start' || s.kind === 'result'
            const next = steps[i + 1]
            const amount = amountLabel(s)
            const label = fitText(s.label, width - amount.length * 7.2 - 12, 6.6)
            return (
              <g key={s.key}>
                {/* Conector con la barra siguiente */}
                {next && next.kind !== 'result' && (
                  <line
                    x1={xAt(s.to)} x2={xAt(s.to)}
                    y1={y + 24 + BAR_H} y2={y + ROW_H + 24}
                    stroke={CHART.axis} strokeWidth={1} strokeDasharray="2 2"
                  />
                )}
                <text x={0} y={y + 14} fontSize={FONT_SIZE_LABEL} fontWeight={strong ? 700 : 500} fill={strong ? CHART.ink : CHART.ink2}>{label}</text>
                <text x={width} y={y + 14} fontSize={FONT_SIZE_LABEL} fontWeight={700} fill={CHART.ink} textAnchor="end">{amount}</text>
                <rect x={a} y={y + 24} width={w} height={BAR_H} rx={3} fill={colorOf(s)} />
                <text x={width} y={y + 24 + BAR_H - 1} fontSize={FONT_SIZE} fill={CHART.muted} textAnchor="end">{per100Label(s)}</text>
                <rect
                  x={0} y={y - 2} width={width} height={ROW_H}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  {...bind(`w${s.key}`, { x: Math.min(width / 2, a + w / 2), y: y + 22 }, {
                    title: s.label,
                    rows: [
                      { label: s.kind === 'cost' ? 'Sale' : s.kind === 'gain' ? 'Entra' : 'Monto', value: formatMoney(Math.abs(s.value)), marker: colorOf(s) },
                      { label: 'Por cada $100 de ingresos', value: s.per100 === null ? '—' : `$${Math.round(Math.abs(s.per100))}` },
                      ...(s.kind === 'result' || s.kind === 'start' ? [] : [{ label: 'Queda después', value: formatMoney(s.to) }]),
                    ],
                  })}
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
