'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { createStaffBreaks, createStaffTimeOff } from '@/actions/staff-availability'
import { countOverlapping, timeToMin, TIME_OFF_KIND_LABEL, type MinuteRange } from './staff-day-utils'

// Orden de presentación L M X J V S D → day_of_week (0 = domingo)
const DAY_CHIPS: { dow: number; short: string; name: string }[] = [
  { dow: 1, short: 'L', name: 'Lunes' },
  { dow: 2, short: 'M', name: 'Martes' },
  { dow: 3, short: 'X', name: 'Miércoles' },
  { dow: 4, short: 'J', name: 'Jueves' },
  { dow: 5, short: 'V', name: 'Viernes' },
  { dow: 6, short: 'S', name: 'Sábado' },
  { dow: 0, short: 'D', name: 'Domingo' },
]

const LABEL_CLASS = 'block text-[10px] font-semibold uppercase tracking-widest text-xinuco-muted mb-1'
const INPUT_CLASS = 'input-base !py-2 !text-xs'

function OverlapWarning({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <div className="p-2.5 bg-amber-950/20 border border-amber-900/30 rounded-xl text-amber-400 text-xs flex gap-2">
      <AlertTriangle size={14} className="shrink-0 mt-px" />
      <span>
        Hay {count} {count === 1 ? 'cita' : 'citas'} en ese horario; la pausa no {count === 1 ? 'la cancela' : 'las cancela'}.
      </span>
    </div>
  )
}

interface CommonProps {
  staffId: string
  /** Fecha visible en la vista de día ('YYYY-MM-DD') */
  dateKey: string
  /** Rangos (en minutos) de las citas del día visible, para avisar de cruces */
  apptRanges: MinuteRange[]
  onDone: () => void
  onCancel: () => void
}

// ── Pausa / almuerzo recurrente ──────────────────────────────────────────────

export function BreakForm({ staffId, dateKey, apptRanges, onDone, onCancel }: CommonProps) {
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [start, setStart] = useState('12:00')
  const [end, setEnd] = useState('13:00')
  const [label, setLabel] = useState('Almuerzo')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const visibleDow = new Date(`${dateKey}T00:00:00Z`).getUTCDay()
  const overlap =
    days.includes(visibleDow) && start && end && end > start
      ? countOverlapping(apptRanges, timeToMin(start), timeToMin(end))
      : 0

  const toggleDay = (dow: number) =>
    setDays((prev) => (prev.includes(dow) ? prev.filter((d) => d !== dow) : [...prev, dow]))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createStaffBreaks({ staffId, days, startTime: start, endTime: end, label })
      if ('error' in result) setError(result.error)
      else onDone()
    })
  }

  return (
    <form onSubmit={submit} className="card !p-4 space-y-3 border border-amber-900/30">
      <p className="text-sm font-semibold text-xinuco-text">Agregar almuerzo / pausa</p>

      <div>
        <span className={LABEL_CLASS}>Días de la semana</span>
        <div className="flex flex-wrap gap-1.5">
          {DAY_CHIPS.map((d) => {
            const on = days.includes(d.dow)
            return (
              <button
                key={d.dow}
                type="button"
                title={d.name}
                aria-label={d.name}
                aria-pressed={on}
                onClick={() => toggleDay(d.dow)}
                className={`w-8 h-8 rounded-full text-xs font-bold border transition-colors ${
                  on
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                    : 'border-xinuco-border text-xinuco-muted hover:text-xinuco-text'
                }`}
              >
                {d.short}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="break-start" className={LABEL_CLASS}>Inicio</label>
          <input id="break-start" type="time" required value={start} onChange={(e) => setStart(e.target.value)} className={INPUT_CLASS} />
        </div>
        <div>
          <label htmlFor="break-end" className={LABEL_CLASS}>Fin</label>
          <input id="break-end" type="time" required value={end} onChange={(e) => setEnd(e.target.value)} className={INPUT_CLASS} />
        </div>
      </div>

      <div>
        <label htmlFor="break-label" className={LABEL_CLASS}>Etiqueta</label>
        <input
          id="break-label"
          type="text"
          maxLength={60}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Almuerzo"
          className={INPUT_CLASS}
        />
      </div>

      <OverlapWarning count={overlap} />
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={isPending} className="btn-ghost !px-4 !py-2 !text-xs">
          Cancelar
        </button>
        <button type="submit" disabled={isPending || days.length === 0} className="btn-primary !px-4 !py-2 !text-xs">
          {isPending && <Loader2 size={13} className="animate-spin" />}
          Guardar pausa
        </button>
      </div>
    </form>
  )
}

// ── Permiso / bloqueo puntual ────────────────────────────────────────────────

interface TimeOffFormProps extends CommonProps {
  /** Horario del día visible ('HH:MM'), para "Todo el día" */
  schedule: { start: string; end: string } | null
}

export function TimeOffForm({ staffId, dateKey, apptRanges, schedule, onDone, onCancel }: TimeOffFormProps) {
  const [date, setDate] = useState(dateKey)
  const [allDay, setAllDay] = useState(false)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  const [kind, setKind] = useState('permission')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // "Todo el día": el horario del día visible si la fecha coincide; si no, el día completo
  const effStart = allDay ? (date === dateKey && schedule ? schedule.start : '00:00') : start
  const effEnd = allDay ? (date === dateKey && schedule ? schedule.end : '23:59') : end

  const overlap =
    date === dateKey && effEnd > effStart ? countOverlapping(apptRanges, timeToMin(effStart), timeToMin(effEnd)) : 0

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createStaffTimeOff({
        staffId,
        date,
        startTime: effStart,
        endTime: effEnd,
        kind,
        reason,
      })
      if ('error' in result) setError(result.error)
      else onDone()
    })
  }

  return (
    <form onSubmit={submit} className="card !p-4 space-y-3 border border-rose-900/30">
      <p className="text-sm font-semibold text-xinuco-text">Bloquear horario (permiso)</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="off-date" className={LABEL_CLASS}>Fecha</label>
          <input id="off-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={INPUT_CLASS} />
        </div>
        <div>
          <label htmlFor="off-kind" className={LABEL_CLASS}>Tipo</label>
          <select id="off-kind" value={kind} onChange={(e) => setKind(e.target.value)} className={INPUT_CLASS}>
            {Object.entries(TIME_OFF_KIND_LABEL).map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-xinuco-text cursor-pointer select-none">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
        Todo el día
      </label>

      {!allDay && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="off-start" className={LABEL_CLASS}>Inicio</label>
            <input id="off-start" type="time" required value={start} onChange={(e) => setStart(e.target.value)} className={INPUT_CLASS} />
          </div>
          <div>
            <label htmlFor="off-end" className={LABEL_CLASS}>Fin</label>
            <input id="off-end" type="time" required value={end} onChange={(e) => setEnd(e.target.value)} className={INPUT_CLASS} />
          </div>
        </div>
      )}

      <div>
        <label htmlFor="off-reason" className={LABEL_CLASS}>Motivo (opcional)</label>
        <input
          id="off-reason"
          type="text"
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej. Cita médica"
          className={INPUT_CLASS}
        />
      </div>

      <OverlapWarning count={overlap} />
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={isPending} className="btn-ghost !px-4 !py-2 !text-xs">
          Cancelar
        </button>
        <button type="submit" disabled={isPending} className="btn-primary !px-4 !py-2 !text-xs">
          {isPending && <Loader2 size={13} className="animate-spin" />}
          Bloquear horario
        </button>
      </div>
    </form>
  )
}
