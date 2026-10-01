'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarOff, Loader2, AlertCircle, TriangleAlert } from 'lucide-react'
import { closeHoliday, removeClosure } from '@/actions/closures'
import { upcomingColombiaHolidays } from '@/lib/colombia-holidays'
import { appointmentsWarning, closureCoveringDate, shortDateLabel } from '@/lib/business-closures'
import { SectionHeader, cardStyle, type ClosureRow } from '@/components/dashboard/settings/ClosuresShared'

const INITIAL_VISIBLE = 8

interface HolidaysPanelProps {
  slug:      string
  todayKey:  string
  closures:  ClosureRow[]
  onAdd:     (row: ClosureRow) => void
  onRemove:  (id: string) => void
}

export function HolidaysPanel({ slug, todayKey, closures, onAdd, onRemove }: HolidaysPanelProps) {
  const holidays = useMemo(() => upcomingColombiaHolidays(todayKey, 12), [todayKey])
  const [showAll, setShowAll] = useState(false)
  const [pendingDate, setPendingDate] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [warnings, setWarnings] = useState<Record<string, number>>({})

  const closedCount = holidays.filter(h => {
    const c = closureCoveringDate(closures, h.date)
    return c?.kind === 'holiday'
  }).length

  const visible = showAll ? holidays : holidays.slice(0, INITIAL_VISIBLE)

  async function toggle(date: string, closure: ClosureRow | null) {
    setPendingDate(date)
    setErrors(prev => { const { [date]: _omit, ...rest } = prev; return rest })
    setWarnings(prev => { const { [date]: _omit, ...rest } = prev; return rest })

    if (closure) {
      // Volver a abrir
      const res = await removeClosure(closure.id)
      if (res.error) setErrors(prev => ({ ...prev, [date]: res.error! }))
      else onRemove(closure.id)
    } else {
      // Cerrar
      const res = await closeHoliday(date)
      if (res.error || !res.id) {
        setErrors(prev => ({ ...prev, [date]: res.error ?? 'No se pudo guardar.' }))
      } else {
        const holiday = holidays.find(h => h.date === date)
        onAdd({ id: res.id, date_from: date, date_to: date, kind: 'holiday', reason: holiday?.name ?? 'Festivo' })
        if ((res.appointments ?? 0) > 0) setWarnings(prev => ({ ...prev, [date]: res.appointments! }))
      }
    }
    setPendingDate(null)
  }

  return (
    <section className="rounded-2xl p-5 flex flex-col gap-4" style={cardStyle()} aria-label="Festivos de Colombia">
      <SectionHeader
        icon={<CalendarOff size={17} style={{ color: 'var(--primary-color)' }} />}
        title="Festivos de Colombia"
        subtitle="Por defecto abres. Marca “Cerramos” en los festivos que no atiendes y nadie podrá reservar ese día."
      />

      <p className="text-xs text-zinc-400">
        {closedCount === 0
          ? 'Abres todos los festivos de los próximos 12 meses.'
          : `Cierras ${closedCount} ${closedCount === 1 ? 'festivo' : 'festivos'} de los próximos 12 meses.`}
      </p>

      <ul className="flex flex-col rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
        {visible.map((h, idx) => {
          const covering = closureCoveringDate(closures, h.date)
          const holidayClosure = covering?.kind === 'holiday' ? covering : null
          const otherClosure = covering && !holidayClosure ? covering : null
          const closed = Boolean(holidayClosure)
          const busy = pendingDate === h.date
          const warning = warnings[h.date] ? appointmentsWarning(warnings[h.date]) : null

          return (
            <li
              key={h.date}
              className="flex flex-col gap-2 px-4 py-3"
              style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--border-color)' }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-sm font-semibold break-words ${closed ? 'text-xinuco-text' : 'text-zinc-200'}`}>{h.name}</p>
                  <p className="text-xs text-zinc-500">{shortDateLabel(h.date)}</p>
                </div>

                {otherClosure ? (
                  <span className="text-[11px] text-amber-400 text-right shrink-0 max-w-[45%]">
                    Ya cierras: {otherClosure.reason}
                  </span>
                ) : (
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className={`text-xs font-semibold ${closed ? 'text-red-400' : 'text-emerald-400'}`}>
                      {busy ? <Loader2 size={12} className="animate-spin inline" /> : closed ? 'Cerramos' : 'Abrimos'}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!closed}
                      aria-label={`${h.name}, ${shortDateLabel(h.date)}: ${closed ? 'cerramos' : 'abrimos'}`}
                      disabled={busy}
                      onClick={() => toggle(h.date, holidayClosure)}
                      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50"
                      style={{ backgroundColor: closed ? 'var(--border-color)' : 'var(--primary-color)' }}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                          closed ? 'translate-x-1' : 'translate-x-6'
                        }`}
                      />
                    </button>
                  </div>
                )}
              </div>

              {errors[h.date] && (
                <p role="alert" className="flex items-start gap-1.5 text-xs text-red-400">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />
                  {errors[h.date]}
                </p>
              )}

              {warning && (
                <p role="status" className="flex items-start gap-1.5 text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2">
                  <TriangleAlert size={12} className="shrink-0 mt-0.5" />
                  <span>
                    {warning}{' '}
                    <Link href={`/${slug}/dashboard/appointments`} className="font-semibold underline underline-offset-2 whitespace-nowrap">
                      Ir a la Agenda →
                    </Link>
                  </span>
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {holidays.length > INITIAL_VISIBLE && (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          className="text-xs font-semibold self-start underline underline-offset-2"
          style={{ color: 'var(--primary-color)' }}
        >
          {showAll ? 'Ver menos' : `Ver los ${holidays.length} festivos`}
        </button>
      )}
    </section>
  )
}
