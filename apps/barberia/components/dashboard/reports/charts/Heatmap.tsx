'use client'

import { useId } from 'react'
import type { ManagementHeatCell } from '@xinuco/types'
import {
  buildHeatmapGrid, cellOccupancy, formatHourShort, heatCellText, rampColor, DOW_NAMES, formatHour,
} from '@/lib/report-utils'
import { CHART, FONT_SIZE } from './theme'
import { useChartFrame } from './useChartFrame'

const LABEL_W = 34
const AXIS_H = 20
const CELL_H = 28
const GAP = 2
const LEGEND_H = 34

/** Ocupación por día de la semana y hora. Una sola tonalidad azul: oscuro = vacío, claro = lleno. */
export function Heatmap({ cells, ariaLabel }: { cells: ManagementHeatCell[]; ariaLabel: string }) {
  const { ref, width, bind, clear, tooltip } = useChartFrame()
  const gradId = `heat-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  const grid = buildHeatmapGrid(cells)
  const nCols = grid.hours.length
  const nRows = grid.rows.length

  const cellW = nCols > 0 ? (width - LABEL_W) / nCols : 0
  const height = AXIS_H + nRows * CELL_H + LEGEND_H
  const stride = Math.max(1, Math.ceil(28 / Math.max(cellW, 1)))
  const showPct = cellW >= 34

  return (
    <div ref={ref} className="relative w-full" style={{ height: width > 0 && nCols > 0 ? height : 0 }}>
      {width > 0 && nCols > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} onClick={clear}>
          {/* Horas */}
          {grid.hours.map((h, ci) =>
            ci % stride === 0 ? (
              <text key={h} x={LABEL_W + ci * cellW + cellW / 2} y={13} textAnchor="middle" fontSize={FONT_SIZE} fill={CHART.muted}>
                {formatHourShort(h)}
              </text>
            ) : null,
          )}

          {grid.rows.map((row, ri) => {
            const y = AXIS_H + ri * CELL_H
            return (
              <g key={row.dow}>
                <text x={0} y={y + CELL_H / 2 + 4} fontSize={FONT_SIZE} fill={CHART.ink2}>{row.label}</text>
                {grid.hours.map((h, ci) => {
                  const cell = grid.get(row.dow, h)
                  const x = LABEL_W + ci * cellW
                  const occ = cell ? cellOccupancy(cell) : null
                  const tip = cell
                    ? { title: heatCellText(cell) }
                    : { title: `${DOW_NAMES[row.dow]} ${formatHour(h)}: sin horario de trabajo` }
                  return (
                    <g key={h}>
                      <rect
                        x={x + GAP / 2}
                        y={y + GAP / 2}
                        width={Math.max(1, cellW - GAP)}
                        height={CELL_H - GAP}
                        rx={3}
                        fill={occ === null ? CHART.empty : rampColor(occ)}
                        stroke={occ === null ? CHART.grid : 'none'}
                        strokeDasharray={occ === null ? '2 2' : undefined}
                      />
                      {showPct && occ !== null && (
                        <text
                          x={x + cellW / 2}
                          y={y + CELL_H / 2 + 4}
                          textAnchor="middle"
                          fontSize={FONT_SIZE}
                          fill={occ > 0.6 ? '#0b1f3a' : '#ffffff'}
                          pointerEvents="none"
                        >
                          {Math.round(occ * 100)}
                        </text>
                      )}
                      <rect
                        x={x} y={y} width={cellW} height={CELL_H}
                        fill="transparent"
                        style={{ cursor: 'pointer' }}
                        {...bind(`c${row.dow}-${h}`, { x: x + cellW / 2, y: y + CELL_H / 2 }, tip)}
                      />
                    </g>
                  )
                })}
              </g>
            )
          })}

          {/* Leyenda: rampa 0–100 % */}
          {(() => {
            const ly = AXIS_H + nRows * CELL_H + 14
            const lw = Math.min(140, width - LABEL_W - 120)
            return (
              <g>
                <defs>
                  <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
                    {[0, 0.25, 0.5, 0.75, 1].map(t => (
                      <stop key={t} offset={`${t * 100}%`} stopColor={rampColor(t)} />
                    ))}
                  </linearGradient>
                </defs>
                <text x={LABEL_W} y={ly + 9} fontSize={FONT_SIZE} fill={CHART.muted} textAnchor="start">0 %</text>
                <rect x={LABEL_W + 30} y={ly} width={Math.max(40, lw)} height={10} rx={3} fill={`url(#${gradId})`} />
                <text x={LABEL_W + 30 + Math.max(40, lw) + 6} y={ly + 9} fontSize={FONT_SIZE} fill={CHART.muted} textAnchor="start">100 % ocupado</text>
              </g>
            )
          })()}
        </svg>
      )}
      {tooltip}
    </div>
  )
}
