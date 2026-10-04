'use client'

// WeeklyScheduleEditor — Editor controlado del horario semanal.
// "Horario rápido": se elige una vez días + entrada/salida y se aplica a toda la semana;
// después cada día se puede ajustar por separado (excepciones).

import { useId, useState } from 'react'
import { Zap } from 'lucide-react'
import {
  WEEK_DAYS,
  DEFAULT_START_TIME,
  DEFAULT_END_TIME,
  DEFAULT_WORK_DAYS,
  applyQuickSchedule,
  stateToScheduleRows,
  validateWeeklySchedule,
  type WeeklyScheduleState,
} from '@/lib/team-utils'

const PRESETS: { label: string; days: number[] }[] = [
  { label: 'Lun–Sáb',        days: [1, 2, 3, 4, 5, 6] },
  { label: 'Lun–Vie',        days: [1, 2, 3, 4, 5] },
  { label: 'Todos los días', days: [1, 2, 3, 4, 5, 6, 0] },
]

const sameDays = (a: number[], b: number[]) =>
  a.length === b.length && a.every(d => b.includes(d))

const timeInputStyle = {
  borderColor: 'var(--border-color)',
  '--tw-ring-color': 'color-mix(in srgb, var(--primary-color) 25%, transparent)',
} as React.CSSProperties

/** Punto de partida del "Horario rápido": lo que ya trabaja la persona, o Lun–Sáb 9:00–19:00. */
function initialQuick(value: WeeklyScheduleState): { days: number[]; start: string; end: string } {
  const working = WEEK_DAYS.filter(d => value[d.index]?.isWorking)
  if (working.length === 0) {
    return { days: [...DEFAULT_WORK_DAYS], start: DEFAULT_START_TIME, end: DEFAULT_END_TIME }
  }
  // Horas más repetidas entre los días que trabaja
  const counts = new Map<string, { n: number; start: string; end: string }>()
  for (const d of working) {
    const { start_time, end_time } = value[d.index]
    const key = `${start_time}-${end_time}`
    const cur = counts.get(key)
    if (cur) cur.n += 1
    else counts.set(key, { n: 1, start: start_time, end: end_time })
  }
  let best = { n: 0, start: DEFAULT_START_TIME, end: DEFAULT_END_TIME }
  for (const c of counts.values()) if (c.n > best.n) best = c
  return { days: working.map(d => d.index), start: best.start, end: best.end }
}

interface WeeklyScheduleEditorProps {
  value: WeeklyScheduleState
  onChange: (next: WeeklyScheduleState) => void
  disabled?: boolean
}

export function WeeklyScheduleEditor({ value, onChange, disabled = false }: WeeklyScheduleEditorProps) {
  const uid = useId()
  const [quick] = useState(() => initialQuick(value))
  const [quickDays, setQuickDays] = useState<number[]>(quick.days)
  const [quickStart, setQuickStart] = useState(quick.start)
  const [quickEnd, setQuickEnd] = useState(quick.end)

  const quickValid = /^\d{2}:\d{2}$/.test(quickStart) && /^\d{2}:\d{2}$/.test(quickEnd) && quickEnd > quickStart
  const canApply = !disabled && quickDays.length > 0 && quickValid

  const validation = validateWeeklySchedule(stateToScheduleRows(value))

  function toggleQuickDay(index: number) {
    setQuickDays(prev => (prev.includes(index) ? prev.filter(d => d !== index) : [...prev, index]))
  }

  function handleApply() {
    if (!canApply) return
    onChange(applyQuickSchedule(value, quickDays, quickStart, quickEnd))
  }

  function patchDay(index: number, patch: Partial<WeeklyScheduleState[number]>) {
    onChange({ ...value, [index]: { ...value[index], ...patch } })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Horario rápido ─────────────────────────────────────────────── */}
      <div
        className="rounded-xl p-4 flex flex-col gap-3"
        style={{
          border: '1px solid var(--border-color)',
          background: 'color-mix(in srgb, var(--primary-color) 5%, transparent)',
        }}
      >
        <div className="flex flex-col gap-0.5">
          <h3 className="text-xs font-semibold text-xinuco-text uppercase tracking-wider flex items-center gap-1.5">
            <Zap size={13} style={{ color: 'var(--primary-color)' }} aria-hidden="true" />
            Horario rápido
          </h3>
          <p className="text-xs text-xinuco-muted">Ponlo una vez y luego ajusta el día que sea distinto.</p>
        </div>

        {/* Días */}
        <div className="flex flex-col gap-2">
          <div role="group" aria-label="Días que trabaja" className="flex flex-wrap gap-1.5">
            {WEEK_DAYS.map(day => {
              const on = quickDays.includes(day.index)
              return (
                <button
                  key={day.index}
                  type="button"
                  aria-pressed={on}
                  aria-label={day.name}
                  title={day.name}
                  disabled={disabled}
                  onClick={() => toggleQuickDay(day.index)}
                  className={`w-9 h-9 rounded-full text-xs font-bold border transition-colors disabled:opacity-50 ${
                    on ? 'border-transparent' : 'text-xinuco-muted hover:text-xinuco-text hover:bg-fg/[0.04]'
                  }`}
                  style={
                    on
                      ? { background: 'var(--primary-color)', color: '#fff' }
                      : { borderColor: 'var(--border-color)' }
                  }
                >
                  {day.letter}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(p => {
              const active = sameDays(quickDays, p.days)
              return (
                <button
                  key={p.label}
                  type="button"
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => setQuickDays(p.days)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors disabled:opacity-50 ${
                    active ? 'text-xinuco-text' : 'text-xinuco-muted hover:text-xinuco-text hover:bg-fg/[0.04]'
                  }`}
                  style={
                    active
                      ? {
                          borderColor: 'var(--primary-color)',
                          background: 'color-mix(in srgb, var(--primary-color) 15%, transparent)',
                        }
                      : { borderColor: 'var(--border-color)' }
                  }
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Horas + aplicar */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-quick-start`} className="text-[10px] font-semibold text-xinuco-muted uppercase tracking-wider">
              Entra
            </label>
            <input
              id={`${uid}-quick-start`}
              type="time"
              value={quickStart}
              onChange={(e) => setQuickStart(e.target.value)}
              disabled={disabled}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-all bg-xinuco-bg text-xinuco-text border focus:ring-2 disabled:opacity-50"
              style={timeInputStyle}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-quick-end`} className="text-[10px] font-semibold text-xinuco-muted uppercase tracking-wider">
              Sale
            </label>
            <input
              id={`${uid}-quick-end`}
              type="time"
              value={quickEnd}
              onChange={(e) => setQuickEnd(e.target.value)}
              disabled={disabled}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-all bg-xinuco-bg text-xinuco-text border focus:ring-2 disabled:opacity-50"
              style={timeInputStyle}
            />
          </div>
        </div>

        {!quickValid && (
          <p className="text-[11px] text-red-400">La hora de salida debe ser posterior a la de entrada.</p>
        )}

        <button
          type="button"
          onClick={handleApply}
          disabled={!canApply}
          className="btn-primary !py-2.5 text-sm font-semibold w-full disabled:opacity-50"
        >
          Aplicar
        </button>
      </div>

      {/* ── Días (excepciones) ─────────────────────────────────────────── */}
      <div
        className="flex flex-col gap-0 rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--border-color)', background: 'rgb(var(--fg) / 0.02)' }}
      >
        {WEEK_DAYS.map((day, idx) => {
          const state = value[day.index]
          if (!state) return null
          const isLast = idx === WEEK_DAYS.length - 1
          const differs =
            state.isWorking && quickValid && (state.start_time !== quickStart || state.end_time !== quickEnd)

          return (
            <div
              key={day.index}
              className="flex flex-col p-4 transition-colors"
              style={{
                borderBottom: isLast ? 'none' : '1px solid var(--border-color)',
                background: state.isWorking ? 'transparent' : 'rgba(0,0,0,0.2)',
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`text-sm font-semibold ${state.isWorking ? 'text-xinuco-text' : 'text-xinuco-muted'}`}>
                    {day.name}
                  </span>
                  {differs && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-fg/5 border-fg/10 text-xinuco-muted">
                      distinto
                    </span>
                  )}
                  {!state.isWorking && <span className="text-[11px] text-xinuco-muted">Descansa</span>}
                </span>

                <button
                  type="button"
                  role="switch"
                  aria-checked={state.isWorking}
                  aria-label={`Trabaja el ${day.name.toLowerCase()}`}
                  onClick={() => patchDay(day.index, { isWorking: !state.isWorking })}
                  disabled={disabled}
                  className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50"
                  style={{ backgroundColor: state.isWorking ? 'var(--primary-color)' : 'var(--border-color)' }}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      state.isWorking ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {state.isWorking && (
                <div className="grid grid-cols-2 gap-4 mt-4 animate-fade-in">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${uid}-start-${day.index}`} className="text-[10px] font-semibold text-xinuco-muted uppercase tracking-wider">
                      Entrada
                    </label>
                    <input
                      id={`${uid}-start-${day.index}`}
                      type="time"
                      value={state.start_time}
                      onChange={(e) => patchDay(day.index, { start_time: e.target.value })}
                      disabled={disabled}
                      className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-all bg-xinuco-bg text-xinuco-text border focus:ring-2 disabled:opacity-50"
                      style={timeInputStyle}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${uid}-end-${day.index}`} className="text-[10px] font-semibold text-xinuco-muted uppercase tracking-wider">
                      Salida
                    </label>
                    <input
                      id={`${uid}-end-${day.index}`}
                      type="time"
                      value={state.end_time}
                      onChange={(e) => patchDay(day.index, { end_time: e.target.value })}
                      disabled={disabled}
                      className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-all bg-xinuco-bg text-xinuco-text border focus:ring-2 disabled:opacity-50"
                      style={timeInputStyle}
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {validation && (
        <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5 animate-fade-in">
          {validation}
        </p>
      )}
    </div>
  )
}
