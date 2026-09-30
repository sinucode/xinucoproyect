'use client'

import { Download, FileSpreadsheet } from 'lucide-react'
import type { MoneyMovement } from '@xinuco/types'
import type { MonthResults } from '@/actions/accounting'
import { monthLabel, movementsCsv, profitLossCsv } from '@/lib/accounting-utils'

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function DownloadButton({
  title,
  detail,
  disabled,
  onClick,
}: {
  title:    string
  detail:   string
  disabled: boolean
  onClick:  () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ border: '1px solid var(--border-color)' }}
    >
      <span
        className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center"
        style={{ background: 'color-mix(in srgb, var(--primary-color) 14%, transparent)', color: 'var(--primary-color)' }}
      >
        <FileSpreadsheet size={18} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-xinuco-text">{title}</span>
        <span className="block text-[11px] text-xinuco-muted mt-0.5">{detail}</span>
      </span>
      <Download size={16} className="shrink-0 text-xinuco-muted" aria-hidden />
    </button>
  )
}

export function AccountantPanel({
  slug,
  mes,
  movements,
  results,
  categoryNames,
}: {
  slug:          string
  mes:           string
  movements:     MoneyMovement[] | null
  results:       MonthResults | null
  categoryNames: Record<string, string>
}) {
  const label = monthLabel(mes)

  return (
    <section
      className="rounded-2xl p-4 sm:p-6 flex flex-col gap-4"
      style={{ background: 'var(--surface-color, rgba(255,255,255,0.03))', border: '1px solid var(--border-color)' }}
      aria-label="Para el contador"
    >
      <div>
        <h2 className="text-sm font-bold text-xinuco-text">Para el contador</h2>
        <p className="text-sm text-xinuco-muted mt-1">
          Descarga el mes en Excel para tu contador. <span className="capitalize">{label}</span>.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <DownloadButton
          title="Movimientos de plata (CSV)"
          detail={
            movements
              ? `${movements.length.toLocaleString('es-CO')} ${movements.length === 1 ? 'movimiento' : 'movimientos'} del mes`
              : 'No se pudieron cargar los movimientos'
          }
          disabled={!movements}
          onClick={() => movements && downloadCsv(`movimientos-${slug}-${mes}.csv`, movementsCsv(movements))}
        />
        <DownloadButton
          title="Estado de resultados (CSV)"
          detail={results ? 'Ingresos, gastos y utilidad del mes' : 'No se pudo calcular el estado de resultados'}
          disabled={!results}
          onClick={() =>
            results &&
            downloadCsv(
              `resultados-${slug}-${mes}.csv`,
              profitLossCsv(results.current, label, s => categoryNames[s] ?? s),
            )
          }
        />
      </div>

      <p className="text-[11px] text-xinuco-muted">Se abre en Excel. Montos en pesos, sin decimales.</p>
    </section>
  )
}
