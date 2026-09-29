'use client'

// StaffScheduleSheet — Horario semanal, almuerzos/descansos y permisos de un profesional.

import { useState, useEffect, useRef, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2, Save, CalendarDays, Plus, Trash2, CheckCircle2 } from 'lucide-react'
import { saveStaffSchedulesBatch } from '@/actions/staff'
import {
  getStaffAvailability,
  deleteStaffBreak,
  deleteStaffTimeOff,
  type StaffAvailability,
} from '@/actions/staff-availability'
import { BreakForm, TimeOffForm } from '@/components/dashboard/agenda/StaffAvailabilityForms'
import { TIME_OFF_KIND_LABEL } from '@/components/dashboard/agenda/staff-day-utils'
import { apptDateKey, dayLabel } from '@/lib/agenda-time'
import { formatHour, validateWeeklySchedule } from '@/lib/team-utils'

// 0 = Domingo, 1 = Lunes ... 6 = Sábado (semana empezando en lunes)
const DAYS_ORDER = [
  { index: 1, name: 'Lunes',     short: 'Lun' },
  { index: 2, name: 'Martes',    short: 'Mar' },
  { index: 3, name: 'Miércoles', short: 'Mié' },
  { index: 4, name: 'Jueves',    short: 'Jue' },
  { index: 5, name: 'Viernes',   short: 'Vie' },
  { index: 6, name: 'Sábado',    short: 'Sáb' },
  { index: 0, name: 'Domingo',   short: 'Dom' },
]

const TABS = [
  { id: 'weekly',   label: 'Horario semanal' },
  { id: 'breaks',   label: 'Almuerzo y descansos' },
  { id: 'time_off', label: 'Permisos' },
] as const
type TabId = (typeof TABS)[number]['id']

interface DayState {
  day_of_week: number
  isWorking: boolean
  start_time: string
  end_time: string
}

interface ScheduleRowInput {
  day_of_week: number
  start_time: string
  end_time: string
}

interface StaffScheduleSheetProps {
  businessId: string
  staffId: string
  staffName: string
  /** Horario semanal actual (viene del servidor con la página). */
  schedules: ScheduleRowInput[]
  /** Hoy en la zona del negocio ('YYYY-MM-DD'). */
  todayKey: string
  onClose: () => void
}

/** Estado inicial de los 7 días a partir de las filas guardadas. */
function buildDaysState(schedules: ScheduleRowInput[]): Record<number, DayState> {
  const state: Record<number, DayState> = {}
  DAYS_ORDER.forEach(day => {
    const rows = schedules.filter(s => s.day_of_week === day.index)
    if (rows.length > 0) {
      // Si hay varias filas ese día: entrada más temprana y salida más tardía
      const starts = rows.map(r => r.start_time.substring(0, 5)).sort()
      const ends = rows.map(r => r.end_time.substring(0, 5)).sort()
      state[day.index] = {
        day_of_week: day.index,
        isWorking: true,
        start_time: starts[0],
        end_time: ends[ends.length - 1],
      }
    } else {
      state[day.index] = { day_of_week: day.index, isWorking: false, start_time: '09:00', end_time: '18:00' }
    }
  })
  return state
}

export function StaffScheduleSheet({
  businessId,
  staffId,
  staffName,
  schedules,
  todayKey,
  onClose,
}: StaffScheduleSheetProps) {
  const router = useRouter()
  const backdropRef = useRef<HTMLDivElement>(null)

  const [tab, setTab] = useState<TabId>('weekly')
  const [daysState, setDaysState] = useState<Record<number, DayState>>(() => buildDaysState(schedules))
  const [isSaving, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Almuerzos/descansos y permisos
  const [availability, setAvailability] = useState<StaffAvailability | null>(null)
  const [availError, setAvailError] = useState<string | null>(null)
  const [showBreakForm, setShowBreakForm] = useState(false)
  const [showTimeOffForm, setShowTimeOffForm] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Cerrar con ESC
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Bloquear scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Cargar descansos y permisos
  const loadAvailability = useCallback(async () => {
    try {
      const result = await getStaffAvailability(staffId)
      if ('error' in result) {
        setAvailError(result.error)
      } else {
        setAvailError(null)
        setAvailability(result)
      }
    } catch {
      setAvailError('No se pudieron cargar los datos. Intenta de nuevo.')
    }
  }, [staffId])

  useEffect(() => { void loadAvailability() }, [loadAvailability])

  // Horario de HOY del profesional (para "Todo el día" en permisos)
  const todayDow = new Date(`${todayKey}T00:00:00Z`).getUTCDay()
  const todayRows = schedules.filter(s => s.day_of_week === todayDow)
  const todaySchedule = todayRows.length > 0
    ? {
        start: todayRows.map(r => r.start_time.substring(0, 5)).sort()[0],
        end:   todayRows.map(r => r.end_time.substring(0, 5)).sort().slice(-1)[0],
      }
    : null

  async function afterAvailabilityChange() {
    await loadAvailability()
    router.refresh()
  }

  async function handleDelete(kind: 'break' | 'time_off', id: string) {
    setDeletingId(id)
    setAvailError(null)
    try {
      const result = kind === 'break' ? await deleteStaffBreak(id) : await deleteStaffTimeOff(id)
      if ('error' in result) {
        setAvailError(result.error)
      } else {
        await afterAvailabilityChange()
      }
    } catch {
      setAvailError('No se pudo eliminar. Intenta de nuevo.')
    } finally {
      setDeletingId(null)
    }
  }

  const handleToggleDay = (dayIndex: number) => {
    setSaved(false)
    setDaysState(prev => ({
      ...prev,
      [dayIndex]: {
        ...prev[dayIndex],
        isWorking: !prev[dayIndex].isWorking
      }
    }))
  }

  const handleTimeChange = (dayIndex: number, field: 'start_time' | 'end_time', value: string) => {
    setSaved(false)
    setDaysState(prev => ({
      ...prev,
      [dayIndex]: {
        ...prev[dayIndex],
        [field]: value
      }
    }))
  }

  const handleSave = () => {
    setError(null)
    setSaved(false)

    // 1. Solo los días activos, en orden de semana
    const activeSchedules = DAYS_ORDER
      .map(d => daysState[d.index])
      .filter(day => day?.isWorking)
      .map(day => ({
        day_of_week: day.day_of_week,
        start_time: day.start_time,
        end_time: day.end_time,
      }))

    // 2. Validar en el cliente (el servidor vuelve a validar)
    const validation = validateWeeklySchedule(activeSchedules)
    if (validation) {
      setError(validation)
      return
    }

    startTransition(async () => {
      try {
        // 3. Enviar el horario completo en un solo viaje
        const result = await saveStaffSchedulesBatch(businessId, staffId, activeSchedules)

        if (result.error) {
          setError(result.error)
          return
        }

        setSaved(true)
        router.refresh()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Ocurrió un error inesperado al guardar.')
      }
    })
  }

  const dayShort = (dow: number) => DAYS_ORDER.find(d => d.index === dow)?.short ?? ''
  const hoursText = (start: string, end: string) => `${formatHour(start)}–${formatHour(end)}`
  const timeFromIso = (iso: string) => formatHour(iso.slice(11, 16))

  // Orden de semana empezando en lunes
  const sortedBreaks = availability
    ? [...availability.breaks].sort((a, b) => {
        const wa = (a.day_of_week + 6) % 7
        const wb = (b.day_of_week + 6) % 7
        return wa - wb || a.start_time.localeCompare(b.start_time)
      })
    : []

  const subtitle: Record<TabId, string> = {
    weekly:   'Define los días y horas laborales de esta persona.',
    breaks:   'Pausas recurrentes: no se ofrecen citas en esas horas.',
    time_off: 'Permisos, vacaciones e incapacidades puntuales.',
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        className="h-full overflow-y-auto animate-slide-in-right w-[95vw] sm:w-[450px] flex flex-col"
        style={{
          background: 'var(--bg-color)',
          borderLeft: '1px solid var(--border-color)'
        }}
      >
        {/* Header fijo */}
        <div className="sticky top-0 z-10" style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-color)' }}>
          <div className="flex items-center justify-between px-6 py-5">
            <div className="flex flex-col gap-1 min-w-0">
              <h2 className="text-lg font-bold text-xinuco-text flex items-center gap-2">
                <CalendarDays size={18} className="shrink-0" style={{ color: 'var(--primary-color)' }} />
                <span className="break-words min-w-0">Horario de {staffName}</span>
              </h2>
              <p className="text-xs text-xinuco-muted">{subtitle[tab]}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="p-2 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.05] transition-colors shrink-0"
            >
              <X size={20} />
            </button>
          </div>

          {/* Pestañas */}
          <div role="tablist" aria-label="Secciones del horario" className="flex gap-1 px-4 pb-3 overflow-x-auto">
            {TABS.map(t => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`schedule-tab-${t.id}`}
                  aria-selected={active}
                  aria-controls={`schedule-panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition-colors ${
                    active
                      ? 'text-xinuco-text border-transparent'
                      : 'text-xinuco-muted border-transparent hover:text-xinuco-text hover:bg-white/[0.04]'
                  }`}
                  style={active ? { background: 'color-mix(in srgb, var(--primary-color) 18%, transparent)', color: 'var(--primary-color)' } : undefined}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Horario semanal ─────────────────────────────────────────────── */}
        {tab === 'weekly' && (
          <>
            <div className="flex-1 p-6" role="tabpanel" id="schedule-panel-weekly" aria-labelledby="schedule-tab-weekly">
              <div className="flex flex-col gap-0 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.02))' }}>
                {DAYS_ORDER.map((day, idx) => {
                  const state = daysState[day.index]
                  if (!state) return null

                  const isLast = idx === DAYS_ORDER.length - 1

                  return (
                    <div
                      key={day.index}
                      className="flex flex-col p-4 transition-colors"
                      style={{
                        borderBottom: isLast ? 'none' : '1px solid var(--border-color)',
                        background: state.isWorking ? 'transparent' : 'rgba(0,0,0,0.2)'
                      }}
                    >
                      {/* Fila del día + Toggle */}
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-semibold ${state.isWorking ? 'text-xinuco-text' : 'text-xinuco-muted'}`}>
                          {day.name}
                        </span>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={state.isWorking}
                          aria-label={`Trabaja el ${day.name.toLowerCase()}`}
                          onClick={() => handleToggleDay(day.index)}
                          disabled={isSaving}
                          className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50"
                          style={{
                            backgroundColor: state.isWorking ? 'var(--primary-color)' : 'var(--border-color)',
                          }}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                              state.isWorking ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>

                      {/* Fila de horas (condicional) */}
                      {state.isWorking && (
                        <div className="grid grid-cols-2 gap-4 mt-4 animate-fade-in">
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor={`start-${day.index}`} className="text-[10px] font-semibold text-xinuco-muted uppercase tracking-wider">
                              Entrada
                            </label>
                            <input
                              id={`start-${day.index}`}
                              type="time"
                              value={state.start_time}
                              onChange={(e) => handleTimeChange(day.index, 'start_time', e.target.value)}
                              disabled={isSaving}
                              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-all bg-xinuco-bg text-xinuco-text border focus:ring-2 disabled:opacity-50"
                              style={{
                                borderColor: 'var(--border-color)',
                                '--tw-ring-color': 'color-mix(in srgb, var(--primary-color) 25%, transparent)'
                              } as React.CSSProperties}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor={`end-${day.index}`} className="text-[10px] font-semibold text-xinuco-muted uppercase tracking-wider">
                              Salida
                            </label>
                            <input
                              id={`end-${day.index}`}
                              type="time"
                              value={state.end_time}
                              onChange={(e) => handleTimeChange(day.index, 'end_time', e.target.value)}
                              disabled={isSaving}
                              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-all bg-xinuco-bg text-xinuco-text border focus:ring-2 disabled:opacity-50"
                              style={{
                                borderColor: 'var(--border-color)',
                                '--tw-ring-color': 'color-mix(in srgb, var(--primary-color) 25%, transparent)'
                              } as React.CSSProperties}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {error && (
                <p role="alert" className="mt-4 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5 animate-fade-in">
                  {error}
                </p>
              )}
              {saved && !error && (
                <p role="status" className="mt-4 flex items-center gap-2 text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-4 py-2.5 animate-fade-in">
                  <CheckCircle2 size={14} />
                  Horario guardado.
                </p>
              )}
            </div>

            {/* Footer con el botón de guardar */}
            <div className="p-6 sticky bottom-0" style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-color)' }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="w-full btn-primary !py-3.5 flex items-center justify-center gap-2 text-base font-semibold"
              >
                {isSaving ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    Guardar horario
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {/* ── Almuerzo y descansos ────────────────────────────────────────── */}
        {tab === 'breaks' && (
          <div className="flex-1 p-6 flex flex-col gap-4" role="tabpanel" id="schedule-panel-breaks" aria-labelledby="schedule-tab-breaks">
            {availError && (
              <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5">
                {availError}
              </p>
            )}

            {!availability && !availError ? (
              <LoadingBlock text="Cargando descansos..." />
            ) : availability && (
              <>
                {sortedBreaks.length === 0 ? (
                  <p className="text-sm text-xinuco-muted">Sin almuerzos ni descansos configurados.</p>
                ) : (
                  <ul className="flex flex-col rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
                    {sortedBreaks.map((b, idx) => (
                      <li
                        key={b.id}
                        className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-xinuco-text"
                        style={{ borderBottom: idx === sortedBreaks.length - 1 ? 'none' : '1px solid var(--border-color)' }}
                      >
                        <span className="min-w-0 break-words">
                          <span className="font-semibold">{dayShort(b.day_of_week)}</span>{' '}
                          {hoursText(b.start_time, b.end_time)}{' '}
                          <span className="text-xinuco-muted">{b.label}</span>
                        </span>
                        <DeleteButton
                          label={`Eliminar ${b.label} del ${dayShort(b.day_of_week)}`}
                          busy={deletingId === b.id}
                          onClick={() => handleDelete('break', b.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}

                {showBreakForm ? (
                  <BreakForm
                    staffId={staffId}
                    dateKey={todayKey}
                    apptRanges={[]}
                    onDone={() => { setShowBreakForm(false); void afterAvailabilityChange() }}
                    onCancel={() => setShowBreakForm(false)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowBreakForm(true)}
                    className="btn-ghost !py-2.5 text-xs flex items-center justify-center gap-2 w-fit"
                  >
                    <Plus size={14} />
                    Añadir
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Permisos ────────────────────────────────────────────────────── */}
        {tab === 'time_off' && (
          <div className="flex-1 p-6 flex flex-col gap-4" role="tabpanel" id="schedule-panel-time_off" aria-labelledby="schedule-tab-time_off">
            {availError && (
              <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5">
                {availError}
              </p>
            )}

            {!availability && !availError ? (
              <LoadingBlock text="Cargando permisos..." />
            ) : availability && (
              <>
                {availability.timeOff.length === 0 ? (
                  <p className="text-sm text-xinuco-muted">Sin permisos próximos.</p>
                ) : (
                  <ul className="flex flex-col rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
                    {availability.timeOff.map((t, idx) => {
                      const startDay = apptDateKey(t.starts_at)
                      const endDay = apptDateKey(t.ends_at)
                      const when = startDay === endDay
                        ? `${dayLabel(startDay, todayKey)} ${timeFromIso(t.starts_at)}–${timeFromIso(t.ends_at)}`
                        : `${dayLabel(startDay, todayKey)} ${timeFromIso(t.starts_at)} – ${dayLabel(endDay, todayKey)} ${timeFromIso(t.ends_at)}`
                      const kind = TIME_OFF_KIND_LABEL[t.kind] ?? t.kind
                      return (
                        <li
                          key={t.id}
                          className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-xinuco-text"
                          style={{ borderBottom: idx === availability.timeOff.length - 1 ? 'none' : '1px solid var(--border-color)' }}
                        >
                          <span className="min-w-0 break-words">
                            <span className="font-semibold">{when}</span>
                            <span className="text-xinuco-muted"> · {kind}{t.reason ? ` · ${t.reason}` : ''}</span>
                          </span>
                          <DeleteButton
                            label={`Eliminar permiso de ${when}`}
                            busy={deletingId === t.id}
                            onClick={() => handleDelete('time_off', t.id)}
                          />
                        </li>
                      )
                    })}
                  </ul>
                )}

                {showTimeOffForm ? (
                  <TimeOffForm
                    staffId={staffId}
                    dateKey={todayKey}
                    apptRanges={[]}
                    schedule={todaySchedule}
                    onDone={() => { setShowTimeOffForm(false); void afterAvailabilityChange() }}
                    onCancel={() => setShowTimeOffForm(false)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowTimeOffForm(true)}
                    className="btn-ghost !py-2.5 text-xs flex items-center justify-center gap-2 w-fit"
                  >
                    <Plus size={14} />
                    Añadir
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function LoadingBlock({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-xinuco-muted gap-3">
      <Loader2 className="animate-spin" size={24} style={{ color: 'var(--primary-color)' }} />
      <span className="text-sm font-medium">{text}</span>
    </div>
  )
}

function DeleteButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title="Eliminar"
      className="p-2 rounded-lg text-xinuco-muted hover:text-red-400 hover:bg-red-400/10 transition-colors shrink-0 disabled:opacity-50"
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
    </button>
  )
}
