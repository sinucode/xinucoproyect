'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { addDaysToDateKey } from '@/lib/agenda-time'

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

const STATUS_CHIPS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'active', label: 'Activas' },
  { value: 'completed', label: 'Completadas' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'no_show', label: 'No asistió' },
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function chipClass(active: boolean): string {
  return [
    'text-xs px-3 py-1.5 rounded-full border transition-colors shrink-0 whitespace-nowrap',
    active
      ? 'font-bold text-black border-transparent bg-[var(--primary-color)]'
      : 'border-xinuco-border text-xinuco-muted hover:text-xinuco-text',
  ].join(' ')
}

export function AgendaFilters({ todayKey, staffOptions, showStaff }: AgendaFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const rawDate = searchParams.get('date')
  const date = rawDate && DATE_RE.test(rawDate) ? rawDate : 'upcoming'
  const rawStatus = searchParams.get('status')
  const status = STATUS_CHIPS.some((s) => s.value === rawStatus) ? (rawStatus as string) : 'all'
  const rawStaff = searchParams.get('staff')
  const staff = rawStaff && staffOptions.some((s) => s.id === rawStaff) ? rawStaff : ''

  const yesterdayKey = addDaysToDateKey(todayKey, -1)
  const tomorrowKey = addDaysToDateKey(todayKey, 1)

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

  const dateChips: { value: string; label: string }[] = [
    { value: 'upcoming', label: 'Próximas' },
    { value: yesterdayKey, label: 'Ayer' },
    { value: todayKey, label: 'Hoy' },
    { value: tomorrowKey, label: 'Mañana' },
  ]
  const dateIsChip = dateChips.some((c) => c.value === date)

  return (
    <div className="card !p-4 space-y-4" role="search" aria-label="Filtros de agenda">
      {/* Fecha */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-xinuco-muted">Fecha</p>
        <div className="flex flex-wrap items-center gap-2">
          {dateChips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => update({ date: chip.value })}
              className={chipClass(date === chip.value)}
              aria-pressed={date === chip.value}
            >
              {chip.label}
            </button>
          ))}
          <input
            type="date"
            aria-label="Elegir una fecha"
            value={date !== 'upcoming' ? date : ''}
            onChange={(e) => update({ date: e.target.value || 'upcoming' })}
            className={`input-base !w-auto !py-1.5 !px-3 !text-xs ${
              !dateIsChip ? '!border-[var(--primary-color)]' : ''
            }`}
          />
        </div>
      </div>

      {/* Staff */}
      {showStaff && (
        <div className="space-y-2">
          <label
            htmlFor="agenda-filter-staff"
            className="block text-[10px] font-semibold uppercase tracking-widest text-xinuco-muted"
          >
            Staff
          </label>
          <select
            id="agenda-filter-staff"
            value={staff}
            onChange={(e) => update({ staff: e.target.value })}
            className="input-base !py-2 !text-xs sm:!w-64"
          >
            <option value="">Todos</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Estado */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-xinuco-muted">Estado</p>
        <div className="flex flex-wrap gap-2">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => update({ status: chip.value })}
              className={chipClass(status === chip.value)}
              aria-pressed={status === chip.value}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => router.push(pathname, { scroll: false })}
          className="inline-flex items-center gap-1 text-xs text-xinuco-muted hover:text-xinuco-text underline underline-offset-2"
        >
          <X size={12} />
          Limpiar filtros
        </button>
      )}
    </div>
  )
}
