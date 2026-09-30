'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Download, FileSpreadsheet, Loader2 } from 'lucide-react'
import type { ExpenseCategoryRow } from '@xinuco/types'
import { getAccountantPackage, type AccountantPackage } from '@/actions/accounting'
import {
  ACCOUNTANT_HISTORY_MONTHS,
  ACCOUNTANT_MAX_MONTHS,
  monthLabel,
  monthRangeLabel,
  monthsBetween,
  movementsCsv,
  previousMonth,
  profitLossMultiCsv,
  rangeFileSuffix,
  staffCsv,
} from '@/lib/accounting-utils'
import { categoryName } from '@/lib/expense-utils'

type CategoryInfo = Pick<ExpenseCategoryRow, 'slug' | 'name' | 'color' | 'is_hidden'>

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

const cardStyle = {
  background: 'var(--surface-color, rgba(255,255,255,0.03))',
  border: '1px solid var(--border-color)',
} as const

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('es-CO')} ${n === 1 ? one : many}`
}

function FileCard({
  title,
  description,
  summary,
  disabled,
  loading,
  onDownload,
}: {
  title:       string
  description: string
  summary:     string
  disabled:    boolean
  loading:     boolean
  onDownload:  () => void
}) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-3 min-w-0" style={{ border: '1px solid var(--border-color)' }}>
      <div className="flex items-start gap-3">
        <span
          className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center"
          style={{ background: 'color-mix(in srgb, var(--primary-color) 14%, transparent)', color: 'var(--primary-color)' }}
        >
          <FileSpreadsheet size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-xinuco-text">{title}</h3>
          <p className="text-xs text-xinuco-muted mt-1 leading-relaxed">{description}</p>
          <p className="text-xs font-semibold text-xinuco-text mt-2 tabular-nums" aria-live="polite">
            {loading ? 'Calculando…' : summary}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onDownload}
        disabled={disabled}
        className="w-full min-h-11 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ border: '1px solid var(--border-color)', color: 'var(--primary-color)' }}
      >
        {loading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Download size={16} aria-hidden />}
        Descargar Excel (CSV)
      </button>
    </div>
  )
}

export function AccountantPanel({
  slug,
  currentMes,
  categories,
}: {
  slug:       string
  /** Mes actual del negocio 'YYYY-MM' */
  currentMes: string
  categories: CategoryInfo[]
}) {
  const year = Number(currentMes.slice(0, 4))

  // Últimos 36 meses hasta el actual, el más reciente primero
  const options = useMemo(() => {
    const list: string[] = []
    let m = currentMes
    for (let i = 0; i < ACCOUNTANT_HISTORY_MONTHS; i++) {
      list.push(m)
      m = previousMonth(m)
    }
    return list
  }, [currentMes])

  const presets = useMemo(() => {
    let twelveAgo = currentMes
    for (let i = 0; i < 11; i++) twelveAgo = previousMonth(twelveAgo)
    return [
      { key: 'mes',   label: 'Este mes',         from: currentMes,        to: currentMes },
      { key: 'anio',  label: 'Este año',         from: `${year}-01`,      to: currentMes },
      { key: 'pasado', label: 'Año pasado',      from: `${year - 1}-01`,  to: `${year - 1}-12` },
      { key: '12m',   label: 'Últimos 12 meses', from: twelveAgo,         to: currentMes },
    ]
  }, [currentMes, year])

  const [fromMonth, setFromMonth] = useState(`${year}-01`)
  const [toMonth, setToMonth] = useState(currentMes)

  const [pkg, setPkg] = useState<AccountantPackage | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const requestId = useRef(0)

  const monthsCount = monthsBetween(fromMonth, toMonth).length
  const rangeError =
    toMonth < fromMonth
      ? 'El mes final no puede ser anterior al inicial.'
      : monthsCount > ACCOUNTANT_MAX_MONTHS
        ? `Elige máximo ${ACCOUNTANT_MAX_MONTHS} meses (más de un año se divide en dos descargas).`
        : null

  // Carga sobre la marcha al abrir la pestaña o cambiar el rango (solo si el rango es válido)
  useEffect(() => {
    if (rangeError) {
      setPkg(null)
      setLoadError(null)
      setLoading(false)
      return
    }
    const id = ++requestId.current
    setLoading(true)
    setLoadError(null)
    setPkg(null)
    getAccountantPackage(fromMonth, toMonth)
      .then(res => {
        if (id !== requestId.current) return
        if ('error' in res) setLoadError(res.error)
        else setPkg(res)
      })
      .catch(() => {
        if (id === requestId.current) setLoadError('No se pudo cargar la información. Intenta de nuevo.')
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false)
      })
  }, [fromMonth, toMonth, rangeError])

  const suffix = rangeFileSuffix(fromMonth, toMonth)
  const ready = !!pkg && !loading && !rangeError
  const rangeText = monthRangeLabel(fromMonth, toMonth)

  const selectClass =
    'w-full min-h-11 rounded-xl px-3 py-2 text-sm text-xinuco-text bg-transparent capitalize'

  return (
    <section
      className="rounded-2xl p-4 sm:p-6 flex flex-col gap-5"
      style={cardStyle}
      aria-label="Para el contador"
    >
      <div>
        <h2 className="text-sm font-bold text-xinuco-text">Para el contador</h2>
        <p className="text-sm text-xinuco-muted mt-1">
          Elige los meses y descarga los archivos en Excel para tu contador.
        </p>
      </div>

      {/* Rango de meses */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[11px] font-semibold text-xinuco-muted uppercase tracking-wider">Desde</span>
            <select
              value={fromMonth}
              onChange={e => setFromMonth(e.target.value)}
              className={selectClass}
              style={{ border: '1px solid var(--border-color)' }}
            >
              {options.map(m => (
                <option key={m} value={m} className="text-black">{capitalize(monthLabel(m))}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[11px] font-semibold text-xinuco-muted uppercase tracking-wider">Hasta</span>
            <select
              value={toMonth}
              onChange={e => setToMonth(e.target.value)}
              className={selectClass}
              style={{ border: '1px solid var(--border-color)' }}
            >
              {options.map(m => (
                <option key={m} value={m} className="text-black">{capitalize(monthLabel(m))}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Rangos rápidos">
          {presets.map(p => {
            const active = p.from === fromMonth && p.to === toMonth
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setFromMonth(p.from)
                  setToMonth(p.to)
                }}
                className={`min-h-10 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  active ? '' : 'text-xinuco-muted hover:text-xinuco-text'
                }`}
                style={
                  active
                    ? {
                        background: 'color-mix(in srgb, var(--primary-color) 18%, transparent)',
                        color: 'var(--primary-color)',
                        border: '1px solid var(--primary-color)',
                      }
                    : { border: '1px solid var(--border-color)' }
                }
              >
                {p.label}
              </button>
            )
          })}
        </div>

        {rangeError ? (
          <p role="alert" className="flex items-start gap-2 text-xs text-amber-400">
            <AlertCircle size={14} className="shrink-0 mt-0.5" aria-hidden />
            {rangeError}
          </p>
        ) : (
          <p className="text-xs text-xinuco-muted">
            Período: <span className="capitalize">{rangeText}</span> ({plural(monthsCount, 'mes', 'meses')}).
          </p>
        )}
      </div>

      {loadError && !rangeError && (
        <p role="alert" className="flex items-start gap-2 text-xs text-amber-400">
          <AlertCircle size={14} className="shrink-0 mt-0.5" aria-hidden />
          {loadError}
        </p>
      )}

      {/* Archivos */}
      <div className="flex flex-col gap-3">
        <FileCard
          title="Movimientos de plata"
          description="Cada peso que entró y salió: ventas por medio de pago (con la propina aparte), gastos, anticipos y pagos al equipo, compras de inventario y de equipos. Una fila por movimiento, con fecha y hora."
          summary={pkg ? plural(pkg.movements.length, 'movimiento', 'movimientos') : '—'}
          loading={loading && !rangeError}
          disabled={!ready || !pkg || pkg.movements.length === 0}
          onDownload={() => pkg && downloadCsv(`movimientos-${slug}-${suffix}.csv`, movementsCsv(pkg.movements))}
        />
        <FileCard
          title="Estado de resultados"
          description="Ingresos, costo de productos, comisiones, gastos por categoría, desgaste de equipos y utilidad. Una columna por mes y el total del período."
          summary={pkg ? plural(pkg.monthly.length, 'mes', 'meses') : '—'}
          loading={loading && !rangeError}
          disabled={!ready}
          onDownload={() =>
            pkg &&
            downloadCsv(
              `resultados-${slug}-${suffix}.csv`,
              profitLossMultiCsv(pkg.monthly, pkg.total, rangeText, s => categoryName(s, categories)),
            )
          }
        />
        <FileCard
          title="Pagos al equipo"
          description="Por cada profesional: lo que produjo, lo que ganó (comisiones, propinas, bonos), descuentos, lo que se le pagó (anticipos y pagos) y el saldo pendiente hoy."
          summary={pkg ? plural(pkg.staff.length, 'profesional', 'profesionales') : '—'}
          loading={loading && !rangeError}
          disabled={!ready || !pkg || pkg.staff.length === 0}
          onDownload={() => pkg && downloadCsv(`equipo-${slug}-${suffix}.csv`, staffCsv(pkg.staff))}
        />
      </div>

      <p className="text-[11px] text-xinuco-muted">Se abre en Excel. Montos en pesos, sin decimales.</p>
    </section>
  )
}
