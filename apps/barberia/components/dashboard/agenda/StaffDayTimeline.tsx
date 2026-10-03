'use client'

import { useEffect, useState, useTransition } from 'react'
import { CalendarClock, Coffee, Plus, Trash2, UserX } from 'lucide-react'
import { deleteStaffBreak, deleteStaffTimeOff } from '@/actions/staff-availability'
import { QuickBookingSheet } from '@/components/agenda/QuickBookingSheet'
import { businessNowHHMM, dayLabel } from '@/lib/agenda-time'
import { BreakForm, TimeOffForm } from './StaffAvailabilityForms'
import { focusAppointmentCard } from './focus-appointment'
import {
  ROW_HEIGHT_REM,
  TIME_OFF_KIND_LABEL,
  apptRange,
  buildTimelineLayout,
  formatMinutes,
  minToHHMM,
  minToLabel,
  nowOffsetRem,
  remainingFreeMinutes,
  timeOffRange,
  timeToMin,
  type BreakRow,
  type TimeOffRow,
  type TimelineAppt,
} from './staff-day-utils'

interface StaffDayTimelineProps {
  slug: string
  isAdmin: boolean
  staffId: string
  staffName: string
  /** Día mostrado ('YYYY-MM-DD') */
  dateKey: string
  todayKey: string
  /** Hora actual del negocio 'HH:MM' (para atenuar filas pasadas hoy) */
  nowHHMM: string
  intervalMinutes: number
  /** Horario del staff ese día ('HH:MM' o 'HH:MM:SS'); null = no trabaja */
  schedule: { start: string; end: string } | null
  /** Pausas recurrentes del staff (todos los días de la semana) */
  breaks: BreakRow[]
  /** Permisos del staff que terminan después del inicio del día mostrado */
  timeOff: TimeOffRow[]
  /** Citas del día (sin canceladas / no asistió) */
  appointments: TimelineAppt[]
}

const STATUS_LABEL: Record<string, string> = {
  payment_pending: 'Pago pendiente',
  scheduled: 'Programada',
  in_progress: 'En curso',
  ready_to_pay: 'Lista para pagar',
  completed: 'Completada',
}

const ROW_HEIGHT = `${ROW_HEIGHT_REM}rem`
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_SHORT = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

function chipCls(tone: 'zinc' | 'primary' | 'amber' | 'rose' | 'emerald'): string {
  const tones = {
    zinc: 'bg-zinc-900 text-zinc-300 border-zinc-800',
    primary: 'text-[var(--primary-color)] border-[color:color-mix(in_srgb,var(--primary-color)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--primary-color)_10%,transparent)]',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  }
  return `inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${tones[tone]}`
}

function isoTimeHHMM(iso: string): string {
  return minToHHMM(timeToMin(new Date(iso).toISOString().slice(11, 16)))
}

export function StaffDayTimeline({
  slug,
  isAdmin,
  staffId,
  staffName,
  dateKey,
  todayKey,
  nowHHMM: nowHHMMProp,
  intervalMinutes,
  schedule,
  breaks,
  timeOff,
  appointments,
}: StaffDayTimelineProps) {
  const [panel, setPanel] = useState<'break' | 'timeoff' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  // "Agendar aquí": hora libre elegida (abre la reserva interna con día y hora prellenados)
  const [bookingTime, setBookingTime] = useState<string | null>(null)

  // Hora actual del negocio: parte de la del servidor y se refresca cada minuto (solo importa hoy)
  const [nowHHMM, setNowHHMM] = useState(nowHHMMProp)
  useEffect(() => setNowHHMM(nowHHMMProp), [nowHHMMProp])
  useEffect(() => {
    if (dateKey !== todayKey) return
    const t = setInterval(() => setNowHHMM(businessNowHHMM()), 60_000)
    return () => clearInterval(t)
  }, [dateKey, todayKey])

  const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay()
  const scheduleRange = schedule ? { startMin: timeToMin(schedule.start), endMin: timeToMin(schedule.end) } : null

  const dayBreaks = breaks
    .filter((b) => b.day_of_week === dow)
    .map((b) => ({ ...b, startMin: timeToMin(b.start_time), endMin: timeToMin(b.end_time) }))
    .sort((a, b) => a.startMin - b.startMin)

  const dayTimeOff = timeOff
    .map((t) => ({ ...t, ...timeOffRange(t, dateKey) }))
    .filter((t) => t.endMin > t.startMin && t.startMin < 1440)
    .sort((a, b) => a.startMin - b.startMin)

  const apptRanges = appointments.map((a) => apptRange(a, dateKey))

  // Hoy: minutos desde 00:00 de la hora actual del negocio (otro día = null → se cuenta todo el horario)
  const isToday = dateKey === todayKey
  const nowMin = timeToMin(nowHHMM)

  // Resumen (hoy solo cuenta el tiempo libre que QUEDA)
  const freeMin = scheduleRange
    ? remainingFreeMinutes(scheduleRange, [...apptRanges, ...dayBreaks, ...dayTimeOff], isToday ? nowMin : null)
    : 0

  const layout = scheduleRange
    ? buildTimelineLayout({
        schedule: scheduleRange,
        interval: intervalMinutes,
        breaks: dayBreaks,
        timeOff: dayTimeOff,
        appts: appointments,
        dateKey,
      })
    : null

  // Filas pasadas (hoy: antes de ahora; días anteriores: todas)
  const isRowPast = (rowEndMin: number) =>
    dateKey < todayKey || (dateKey === todayKey && rowEndMin <= nowMin)

  // Pausas agrupadas para la lista (mismo rango+etiqueta en varios días = una entrada)
  const breakGroups = Object.values(
    breaks.reduce<Record<string, { key: string; label: string; start: string; end: string; ids: string[]; days: number[] }>>(
      (acc, b) => {
        const start = minToHHMM(timeToMin(b.start_time))
        const end = minToHHMM(timeToMin(b.end_time))
        const key = `${b.label}|${start}|${end}`
        const g = (acc[key] ??= { key, label: b.label, start, end, ids: [], days: [] })
        g.ids.push(b.id)
        g.days.push(b.day_of_week)
        return acc
      },
      {},
    ),
  )

  const handleDeleteBreakGroup = (g: { label: string; ids: string[] }) => {
    if (!window.confirm(`¿Eliminar la pausa "${g.label}"?`)) return
    setError(null)
    startTransition(async () => {
      for (const id of g.ids) {
        const result = await deleteStaffBreak(id)
        if ('error' in result) {
          setError(result.error)
          return
        }
      }
    })
  }

  const handleDeleteTimeOff = (id: string) => {
    if (!window.confirm('¿Eliminar este permiso?')) return
    setError(null)
    startTransition(async () => {
      const result = await deleteStaffTimeOff(id)
      if ('error' in result) setError(result.error)
    })
  }

  const scheduleLabel = scheduleRange
    ? `${minToLabel(scheduleRange.startMin)}–${minToLabel(scheduleRange.endMin)}`
    : null

  return (
    <section aria-label={`Día de ${staffName}`} className="card !p-4 space-y-4">
      {/* Encabezado */}
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-xinuco-text truncate">{staffName}</h2>
            <p className="text-xs text-xinuco-muted">{dayLabel(dateKey, todayKey)}</p>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setPanel(panel === 'break' ? null : 'break')}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center gap-1"
              >
                <Coffee size={12} />
                Agregar almuerzo/pausa
              </button>
              <button
                type="button"
                onClick={() => setPanel(panel === 'timeoff' ? null : 'timeoff')}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition-colors flex items-center gap-1"
              >
                <UserX size={12} />
                Bloquear horario (permiso)
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {scheduleLabel ? (
            <>
              <span className={chipCls('zinc')}>Horario {scheduleLabel}</span>
              <span className={chipCls('primary')}>
                {appointments.length} {appointments.length === 1 ? 'cita' : 'citas'}
              </span>
              <span className={chipCls('emerald')}>
                {formatMinutes(freeMin)} {isToday ? 'libres hoy' : 'libres'}
              </span>
            </>
          ) : (
            <span className={chipCls('zinc')}>No trabaja este día</span>
          )}
          {dayBreaks.map((b) => (
            <span key={b.id} className={chipCls('amber')}>
              {b.label} {minToLabel(b.startMin)}–{minToLabel(b.endMin)}
            </span>
          ))}
          {dayTimeOff.map((t) => (
            <span key={t.id} className={chipCls('rose')}>
              {TIME_OFF_KIND_LABEL[t.kind] ?? 'Permiso'} {minToLabel(t.startMin)}–{minToLabel(t.endMin)}
            </span>
          ))}
        </div>
      </div>

      {/* Formularios (solo admin) */}
      {isAdmin && panel === 'break' && (
        <BreakForm
          staffId={staffId}
          dateKey={dateKey}
          apptRanges={apptRanges}
          onDone={() => setPanel(null)}
          onCancel={() => setPanel(null)}
        />
      )}
      {isAdmin && panel === 'timeoff' && (
        <TimeOffForm
          staffId={staffId}
          dateKey={dateKey}
          apptRanges={apptRanges}
          schedule={schedule ? { start: minToHHMM(timeToMin(schedule.start)), end: minToHHMM(timeToMin(schedule.end)) } : null}
          onDone={() => setPanel(null)}
          onCancel={() => setPanel(null)}
        />
      )}

      {error && (
        <div className="p-3 bg-amber-950/20 border border-amber-900/30 rounded-xl text-amber-400 text-xs">{error}</div>
      )}

      {/* Línea de tiempo */}
      {layout && layout.rowCount > 0 && (
        <div
          className="relative grid gap-x-3 gap-y-0.5"
          style={{ gridTemplateColumns: '3rem minmax(0, 1fr)', gridAutoRows: ROW_HEIGHT }}
        >
          {/* Línea "Ahora" (solo hoy, dentro del rango mostrado) */}
          {isToday && nowMin >= layout.rangeStart && nowMin < layout.rangeStart + layout.rowCount * layout.interval && (
            <div
              aria-label={`Ahora, ${nowHHMM}`}
              className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
              style={{ top: `${nowOffsetRem(nowMin, layout.rangeStart, layout.interval)}rem` }}
            >
              <span className="w-12 shrink-0 rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-[10px] font-bold uppercase leading-none text-white">
                Ahora
              </span>
              <span className="h-px flex-1 bg-rose-500" />
            </div>
          )}
          {/* Etiquetas de hora */}
          {Array.from({ length: layout.rowCount }, (_, i) => {
            const startMin = layout.rangeStart + i * layout.interval
            return (
              <time
                key={`t-${i}`}
                className={`text-[11px] font-semibold text-xinuco-muted text-right pt-2 ${
                  isRowPast(startMin + layout.interval) ? 'opacity-50' : ''
                }`}
                style={{ gridColumn: 1, gridRow: i + 1 }}
              >
                {minToHHMM(startMin)}
              </time>
            )
          })}

          {/* Bloques base: libre / pausa / permiso / fuera de horario */}
          {layout.segments.map((seg) => {
            const past = isRowPast(seg.endMin)
            const pos = { gridColumn: 2, gridRow: `${seg.row + 1} / span ${seg.span}` }
            const dim = past ? 'opacity-50' : ''

            if (seg.kind === 'free') {
              // Hora que ya pasó: apagada (no es "Libre" ni se puede agendar)
              if (dateKey < todayKey || (isToday && seg.startMin <= nowMin)) {
                return (
                  <div
                    key={`s-${seg.row}`}
                    className="rounded-lg border border-zinc-900 bg-zinc-950/40 text-zinc-600 text-xs px-3 flex items-center opacity-60"
                    style={pos}
                  >
                    Pasó
                  </div>
                )
              }
              // Hora libre futura: botón que abre la reserva interna con día y hora prellenados
              return (
                <button
                  key={`s-${seg.row}`}
                  type="button"
                  onClick={() => setBookingTime(minToHHMM(seg.startMin))}
                  aria-label={`Agendar a las ${minToHHMM(seg.startMin)}`}
                  className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-medium px-3 flex items-center justify-between gap-2 hover:bg-emerald-500/20 transition-colors text-left"
                  style={pos}
                >
                  <span>Libre</span>
                  <span className="flex items-center gap-1 font-semibold">
                    <Plus size={12} aria-hidden="true" />
                    Agendar aquí
                  </span>
                </button>
              )
            }

            if (seg.kind === 'outside') {
              return (
                <div
                  key={`s-${seg.row}`}
                  className={`rounded-lg border border-zinc-900 bg-zinc-950/40 text-zinc-600 text-xs px-3 flex items-center ${dim}`}
                  style={pos}
                >
                  Fuera de horario
                </div>
              )
            }

            if (seg.kind === 'break') {
              const b = dayBreaks.find((x) => x.id === seg.refId)
              return (
                <div
                  key={`s-${seg.row}`}
                  className={`rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-400 text-xs font-medium px-3 py-2 flex items-center gap-1.5 ${dim}`}
                  style={pos}
                >
                  <Coffee size={12} className="shrink-0" />
                  <span className="truncate">{b?.label ?? 'Pausa'}</span>
                </div>
              )
            }

            const t = dayTimeOff.find((x) => x.id === seg.refId)
            return (
              <div
                key={`s-${seg.row}`}
                className={`rounded-lg border border-rose-500/25 bg-rose-500/10 text-rose-400 text-xs font-medium px-3 py-2 flex items-center gap-1.5 min-w-0 ${dim}`}
                style={pos}
              >
                <UserX size={12} className="shrink-0" />
                <span className="truncate">
                  {TIME_OFF_KIND_LABEL[t?.kind ?? 'other'] ?? 'Permiso'}
                  {t?.reason ? ` · ${t.reason}` : ''}
                </span>
              </div>
            )
          })}

          {/* Citas (un bloque que abarca varias filas) */}
          {layout.appts.map(({ appt, row, span, endMin }) => {
            const dim = isRowPast(endMin) ? 'opacity-60' : ''
            return (
              <button
                key={appt.id}
                type="button"
                onClick={() => focusAppointmentCard(appt.id)}
                title="Ver la tarjeta de esta cita"
                className={`rounded-lg border px-3 py-1.5 min-w-0 flex flex-col justify-center overflow-hidden z-10 text-left ${dim}`}
                style={{
                  gridColumn: 2,
                  gridRow: `${row + 1} / span ${span}`,
                  background: 'color-mix(in srgb, var(--primary-color) 14%, var(--bg-color))',
                  borderColor: 'color-mix(in srgb, var(--primary-color) 35%, transparent)',
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-xs font-semibold text-xinuco-text truncate">
                    {appt.customer_name} <span className="text-xinuco-muted font-normal">· {appt.service_name}</span>
                  </p>
                  <span
                    className="badge !px-2 !py-0.5 !text-[10px] font-bold uppercase tracking-wider shrink-0 ml-auto"
                    style={{
                      color: 'var(--primary-color)',
                      background: 'color-mix(in srgb, var(--primary-color) 15%, transparent)',
                    }}
                  >
                    {STATUS_LABEL[appt.status] ?? appt.status}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Pausas y permisos existentes */}
      {(breakGroups.length > 0 || timeOff.length > 0) && (
        <div className="space-y-2 pt-3 border-t border-zinc-900">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-xinuco-muted">
            Pausas y permisos
          </p>
          <ul className="space-y-1.5">
            {breakGroups.map((g) => (
              <li
                key={g.key}
                className="flex items-center gap-2 text-xs rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"
              >
                <Coffee size={12} className="text-amber-400 shrink-0" />
                <span className="min-w-0 flex-1 text-xinuco-text">
                  <span className="font-medium">{g.label}</span> {g.start}–{g.end}
                  <span className="text-xinuco-muted">
                    {' '}· {DAY_ORDER.filter((d) => g.days.includes(d)).map((d) => DAY_SHORT[d]).join(' ')}
                  </span>
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleDeleteBreakGroup(g)}
                    disabled={isPending}
                    aria-label={`Eliminar pausa ${g.label}`}
                    className="p-1.5 rounded-lg text-xinuco-muted hover:text-red-400 transition-colors shrink-0 disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            ))}
            {timeOff.map((t) => {
              const startKey = new Date(t.starts_at).toISOString().slice(0, 10)
              const endKey = new Date(t.ends_at).toISOString().slice(0, 10)
              return (
                <li
                  key={t.id}
                  className="flex items-center gap-2 text-xs rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2"
                >
                  <CalendarClock size={12} className="text-rose-400 shrink-0" />
                  <span className="min-w-0 flex-1 text-xinuco-text">
                    <span className="font-medium">{TIME_OFF_KIND_LABEL[t.kind] ?? 'Permiso'}</span>{' '}
                    {dayLabel(startKey, todayKey)} {isoTimeHHMM(t.starts_at)}
                    {endKey !== startKey ? ` → ${dayLabel(endKey, todayKey)} ${isoTimeHHMM(t.ends_at)}` : `–${isoTimeHHMM(t.ends_at)}`}
                    {t.reason && <span className="text-xinuco-muted"> · {t.reason}</span>}
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleDeleteTimeOff(t.id)}
                      disabled={isPending}
                      aria-label="Eliminar permiso"
                      className="p-1.5 rounded-lg text-xinuco-muted hover:text-red-400 transition-colors shrink-0 disabled:opacity-50"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Reserva interna: día y hora prellenados; el profesional es el de esta vista */}
      <QuickBookingSheet
        slug={slug}
        open={bookingTime !== null}
        onClose={() => setBookingTime(null)}
        initialDate={dateKey}
        initialTime={bookingTime ?? undefined}
        staffId={staffId}
      />
    </section>
  )
}
