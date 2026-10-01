'use client'

import { useCallback, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { addDaysToDateKey, dayLabel } from '@/lib/agenda-time'

export interface AgendaStaffOption {
  id: string
  full_name: string
}

interface AgendaFiltersProps {
  /** Hoy en la zona del negocio ('YYYY-MM-DD'), calculado en el servidor. */
  todayKey: string
  staffOptions: AgendaStaffOption[]
  /** Los barberos siempre ven solo lo suyo → se oculta el selector. */
  showStaff: boolean
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'active', label: 'Activas' },
  { value: 'completed', label: 'Completadas' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'no_show', label: 'No asistió' },
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-color)]'

const NAV_BTN = `inline-flex h-11 w-11 items-center justify-center text-xinuco-muted hover:text-xinuco-text transition-colors ${FOCUS_RING} focus-visible:ring-inset`

/** 'jue 1 oct' (sin puntos), a partir de 'YYYY-MM-DD'. */
function shortDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00Z`)
    .toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(/[.,]/g, '')
    .replace(/\bde\b\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function selectClass(active: boolean): string {
  return [
    'h-11 w-auto max-w-[9.5rem] truncate rounded-lg border px-2 text-xs bg-transparent cursor-pointer transition-colors',
    FOCUS_RING,
    active
      ? 'border-[var(--primary-color)] text-[var(--primary-color)]'
      : 'border-xinuco-border text-xinuco-muted hover:text-xinuco-text',
  ].join(' ')
}

export function AgendaFilters({ todayKey, staffOptions, showStaff }: AgendaFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)

  const rawDate = searchParams.get('date')
  const date = rawDate && DATE_RE.test(rawDate) ? rawDate : 'upcoming'
  const rawStatus = searchParams.get('status')
  const status = STATUS_OPTIONS.some((s) => s.value === rawStatus) ? (rawStatus as string) : 'all'
  const rawStaff = searchParams.get('staff')
  const staff = rawStaff && staffOptions.some((s) => s.id === rawStaff) ? rawStaff : ''

  const hasFilters = date !== 'upcoming' || status !== 'all' || staff !== ''

  const update = useCallback(
    (patch: { date?: string; staff?: string; status?: string }) => {
      const params = new URLSearchParams(searchParams.toString())
      const apply = (key: string, value: string | undefined, defaultValue: string) => {
        if (value === undefined) return
        if (!value || value === defaultValue) params.delete(key)
        else params.set(key, value)
      }
      apply('date', patch.date, 'upcoming')
      apply('staff', patch.staff, '')
      apply('status', patch.status, 'all')
      const qs = params.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  const isUpcoming = date === 'upcoming'
  const base = isUpcoming ? todayKey : date
  const prevKey = addDaysToDateKey(base, -1)
  const nextKey = addDaysToDateKey(base, 1)

  let dateText = 'Próximas'
  if (!isUpcoming) {
    const label = dayLabel(date, todayKey)
    dateText = ['Hoy', 'Ayer', 'Mañana'].includes(label) ? `${label} · ${shortDate(date)}` : shortDate(date)
  }

  const openPicker = () => {
    const el = inputRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker()
        return
      } catch {
        /* cae al fallback */
      }
    }
    el.focus()
    el.click()
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="search" aria-label="Filtros de agenda">
      {/* Navegador de fecha */}
      <div className="relative inline-flex items-center rounded-lg border border-xinuco-border bg-xinuco-surface overflow-hidden">
        <button type="button" aria-label="Día anterior" onClick={() => update({ date: prevKey })} className={NAV_BTN}>
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          title="Alternar entre Próximas y un día"
          onClick={() => update({ date: isUpcoming ? todayKey : 'upcoming' })}
          className={`h-11 px-2 text-xs font-medium whitespace-nowrap transition-colors ${FOCUS_RING} focus-visible:ring-inset ${
            isUpcoming ? 'text-xinuco-text' : 'text-[var(--primary-color)]'
          }`}
        >
          {dateText}
        </button>
        <button type="button" aria-label="Día siguiente" onClick={() => update({ date: nextKey })} className={NAV_BTN}>
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          aria-label="Elegir fecha"
          onClick={openPicker}
          className={`${NAV_BTN} border-l border-xinuco-border`}
        >
          <CalendarDays size={15} />
        </button>
        <input
          ref={inputRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={isUpcoming ? '' : date}
          onChange={(e) => update({ date: e.target.value || 'upcoming' })}
          className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
        />
      </div>

      {/* Barbero */}
      {showStaff && (
        <select
          aria-label="Filtrar por barbero"
          value={staff}
          onChange={(e) => update({ staff: e.target.value })}
          className={selectClass(staff !== '')}
        >
          <option value="">Barbero: Todos</option>
          {staffOptions.map((s) => (
            <option key={s.id} value={s.id}>
              Barbero: {s.full_name}
            </option>
          ))}
        </select>
      )}

      {/* Estado */}
      <select
        aria-label="Filtrar por estado"
        value={status}
        onChange={(e) => update({ status: e.target.value })}
        className={selectClass(status !== 'all')}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            Estado: {o.label}
          </option>
        ))}
      </select>

      {hasFilters && (
        <button
          type="button"
          aria-label="Limpiar filtros"
          title="Limpiar filtros"
          onClick={() => router.push(pathname, { scroll: false })}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-lg text-xinuco-muted hover:text-xinuco-text transition-colors ${FOCUS_RING}`}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
