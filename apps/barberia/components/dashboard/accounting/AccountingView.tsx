'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import type { ExpenseCategoryRow, MoneyMovement, StaffProduction } from '@xinuco/types'
import type { MonthResults } from '@/actions/accounting'
import { monthLabel, monthName, monthRange, nextMonth, previousMonth } from '@/lib/accounting-utils'
import { ProfitLossStatement } from './ProfitLossStatement'
import { MovementsPanel } from './MovementsPanel'
import { StaffPanel } from './StaffPanel'
import { AccountantPanel } from './AccountantPanel'

export type AccountingTab = 'resultados' | 'movimientos' | 'profesionales' | 'contador'

const TABS: { key: AccountingTab; label: string }[] = [
  { key: 'resultados',  label: 'Resultados' },
  { key: 'movimientos', label: 'Movimientos' },
  { key: 'profesionales', label: 'Por profesional' },
  { key: 'contador',    label: 'Para el contador' },
]

export interface AccountingViewProps {
  slug:           string
  /** Mes mostrado 'YYYY-MM' */
  mes:            string
  /** Mes actual del negocio 'YYYY-MM' (no se puede pasar de aquí) */
  currentMes:     string
  initialTab:     AccountingTab
  today:          string
  results:        MonthResults | null
  resultsError:   string | null
  movements:      MoneyMovement[] | null
  movementsError: string | null
  staff:          StaffProduction[] | null
  staffError:     string | null
  /** Categorías de gasto del negocio (para los nombres en el CSV) */
  categories:     Pick<ExpenseCategoryRow, 'slug' | 'name' | 'color' | 'is_hidden'>[]
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <section
      role="alert"
      className="rounded-2xl p-5 flex items-start gap-3"
      style={{ background: 'rgb(var(--fg) / 0.03)', border: '1px solid var(--border-color)' }}
    >
      <AlertCircle size={18} className="text-amber-400 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-xinuco-text">{title}</h2>
        <p className="text-xs text-xinuco-muted mt-1">{message}</p>
      </div>
    </section>
  )
}

export function AccountingView({
  slug,
  mes,
  currentMes,
  initialTab,
  today,
  results,
  resultsError,
  movements,
  movementsError,
  staff,
  staffError,
  categories,
}: AccountingViewProps) {
  const router = useRouter()
  const [tab, setTab] = useState<AccountingTab>(initialTab)
  const [navPending, startNav] = useTransition()

  const basePath = `/${slug}/dashboard/accounting`
  const canGoNext = mes < currentMes
  const label = monthLabel(mes)

  function goToMonth(key: string) {
    startNav(() => router.push(`${basePath}?mes=${key}&tab=${tab}`))
  }

  function selectTab(next: AccountingTab) {
    setTab(next)
    // La pestaña queda en la URL sin volver a cargar los datos
    try {
      window.history.replaceState(null, '', `${basePath}?mes=${mes}&tab=${next}`)
    } catch {
      /* sin historial: la pestaña igual cambia en pantalla */
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Selector de mes */}
      <div className="flex items-center justify-between gap-2" role="group" aria-label="Mes">
        <button
          type="button"
          onClick={() => goToMonth(previousMonth(mes))}
          disabled={navPending}
          aria-label="Mes anterior"
          className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-xinuco-muted hover:text-xinuco-text transition-colors disabled:opacity-50"
          style={{ border: '1px solid var(--border-color)' }}
        >
          <ChevronLeft size={18} />
        </button>
        <p className="flex-1 text-center text-base font-semibold text-xinuco-text capitalize" aria-live="polite">
          {label}
        </p>
        <button
          type="button"
          onClick={() => goToMonth(nextMonth(mes))}
          disabled={!canGoNext || navPending}
          aria-label="Mes siguiente"
          className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-xinuco-muted hover:text-xinuco-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ border: '1px solid var(--border-color)' }}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Pestañas */}
      <div
        role="tablist"
        aria-label="Secciones de contabilidad"
        className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 rounded-xl"
        style={{ background: 'rgb(var(--fg) / 0.03)', border: '1px solid var(--border-color)' }}
      >
        {TABS.map(t => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`acc-tab-${t.key}`}
              aria-selected={active}
              aria-controls={`acc-panel-${t.key}`}
              onClick={() => selectTab(t.key)}
              className={`min-h-10 px-1.5 py-2 rounded-lg text-xs sm:text-sm font-semibold leading-tight text-center transition-colors ${
                active ? 'text-xinuco-text' : 'text-xinuco-muted hover:text-xinuco-text'
              }`}
              style={active ? { background: 'color-mix(in srgb, var(--primary-color) 18%, transparent)', color: 'var(--primary-color)' } : undefined}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`acc-panel-${tab}`}
        aria-labelledby={`acc-tab-${tab}`}
        className={`transition-opacity ${navPending ? 'opacity-60' : ''}`}
        aria-busy={navPending}
      >
        {navPending && <p className="text-xs text-xinuco-muted mb-3">Cargando…</p>}

        {tab === 'resultados' && (
          results ? (
            <ProfitLossStatement
              result={results.current}
              previous={results.previous}
              monthLabel={label}
              previousLabel={
                results.prevTo === monthRange(previousMonth(mes)).to
                  ? monthName(previousMonth(mes))
                  : `1–${Number(results.prevTo.slice(8, 10))} de ${monthName(previousMonth(mes))}`
              }
            />
          ) : (
            <ErrorCard
              title="Estado de resultados"
              message={resultsError ?? 'No se pudo calcular el estado de resultados. Intenta de nuevo.'}
            />
          )
        )}

        {tab === 'movimientos' && (
          movements ? (
            <MovementsPanel key={mes} rows={movements} today={today} />
          ) : (
            <ErrorCard
              title="Movimientos de plata"
              message={movementsError ?? 'No se pudieron cargar los movimientos. Intenta de nuevo.'}
            />
          )
        )}

        {tab === 'profesionales' && (
          staff ? (
            <StaffPanel key={mes} slug={slug} rows={staff} />
          ) : (
            <ErrorCard
              title="Por profesional"
              message={staffError ?? 'No se pudo cargar lo del equipo. Intenta de nuevo.'}
            />
          )
        )}

        {tab === 'contador' && (
          <AccountantPanel slug={slug} currentMes={currentMes} categories={categories} />
        )}
      </div>
    </div>
  )
}
