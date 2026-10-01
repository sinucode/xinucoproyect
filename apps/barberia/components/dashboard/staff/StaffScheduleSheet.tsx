'use client'

// StaffScheduleSheet — Horario semanal, almuerzos/descansos y permisos de un profesional.

import { useState, useEffect, useRef, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2, Save, CalendarDays, Plus, Trash2, CheckCircle2 } from 'lucide-react'
import { saveStaffSchedulesBatch, saveStaffSchedulesForMany } from '@/actions/staff'
import {
  getStaffAvailability,
  deleteStaffBreak,
  deleteStaffTimeOff,
  type StaffAvailability,
} from '@/actions/staff-availability'
import { BreakForm, TimeOffForm } from '@/components/dashboard/agenda/StaffAvailabilityForms'
import { TIME_OFF_KIND_LABEL } from '@/components/dashboard/agenda/staff-day-utils'
import { apptDateKey, dayLabel } from '@/lib/agenda-time'
import {
  WEEK_DAYS,
  formatHour,
  scheduleRowsToState,
  stateToScheduleRows,
  summarizeSchedule,
  validateWeeklySchedule,
  type WeeklyScheduleState,
} from '@/lib/team-utils'
import { WeeklyScheduleEditor } from './WeeklyScheduleEditor'

const TABS = [
  { id: 'weekly',   label: 'Horario semanal' },
  { id: 'breaks',   label: 'Almuerzo y descansos' },
  { id: 'time_off', label: 'Permisos' },
] as const
type TabId = (typeof TABS)[number]['id']

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
  /** Todo el equipo (para "Copiar de…" y "Aplicar también a…"). Puede incluir a este profesional. */
  teamMembers: { id: string; full_name: string; is_active?: boolean; schedules: ScheduleRowInput[] }[]
  /** Hoy en la zona del negocio ('YYYY-MM-DD'). */
  todayKey: string
  onClose: () => void
}

export function StaffScheduleSheet({
  businessId,
  staffId,
  staffName,
  schedules,
  teamMembers,
  todayKey,
  onClose,
}: StaffScheduleSheetProps) {
  const router = useRouter()
  const backdropRef = useRef<HTMLDivElement>(null)

  const [tab, setTab] = useState<TabId>('weekly')
  const [daysState, setDaysState] = useState<WeeklyScheduleState>(() => scheduleRowsToState(schedules))
  const [isSaving, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [copyFrom, setCopyFrom] = useState('')
  const [applyTo, setApplyTo] = useState<Set<string>>(new Set())

  // Otros profesionales: origen de "Copiar de…" y destino de "Aplicar también a…"
  const otherMembers = teamMembers.filter(m => m.id !== staffId)
  const otherActive = otherMembers.filter(m => m.is_active !== false)

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

  const handleScheduleChange = (next: WeeklyScheduleState) => {
    setSavedMessage(null)
    setDaysState(next)
  }

  const handleCopyFrom = (memberId: string) => {
    setCopyFrom(memberId)
    const source = otherMembers.find(m => m.id === memberId)
    if (!source) return
    setSavedMessage(null)
    setError(null)
    setDaysState(scheduleRowsToState(source.schedules))
  }

  const toggleApplyTo = (id: string) => {
    setSavedMessage(null)
    setApplyTo(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = otherActive.length > 0 && otherActive.every(m => applyTo.has(m.id))
  const toggleAllTeam = () => {
    setSavedMessage(null)
    setApplyTo(allSelected ? new Set() : new Set(otherActive.map(m => m.id)))
  }

  const handleSave = () => {
    setError(null)
    setSavedMessage(null)

    // 1. Solo los días activos, en orden de semana
    const activeSchedules = stateToScheduleRows(daysState)

    // 2. Validar en el cliente (el servidor vuelve a validar)
    const validation = validateWeeklySchedule(activeSchedules)
    if (validation) {
      setError(validation)
      return
    }

    const extraIds = otherActive.filter(m => applyTo.has(m.id)).map(m => m.id)

    startTransition(async () => {
      try {
        // 3. Enviar el horario completo en un solo viaje
        if (extraIds.length === 0) {
          const result = await saveStaffSchedulesBatch(businessId, staffId, activeSchedules)
          if (result.error) {
            setError(result.error)
            return
          }
          setSavedMessage('Horario guardado.')
        } else {
          const result = await saveStaffSchedulesForMany(businessId, [staffId, ...extraIds], activeSchedules)
          if (result.error) {
            setError(result.error)
            return
          }
          if (result.failed.length > 0) {
            setError(`No se pudo guardar el horario de: ${result.failed.join(', ')}.`)
          }
          if (result.saved > 0) {
            setSavedMessage(`Horario guardado para ${result.saved} ${result.saved === 1 ? 'profesional' : 'profesionales'}.`)
            setApplyTo(new Set())
          }
        }
        router.refresh()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Ocurrió un error inesperado al guardar.')
      }
    })
  }

  const dayShort = (dow: number) => WEEK_DAYS.find(d => d.index === dow)?.short ?? ''
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
        className="h-dvh overflow-y-auto pb-[env(safe-area-inset-bottom)] animate-slide-in-right w-[95vw] sm:w-[450px] flex flex-col"
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
              <div className="flex flex-col gap-5">
                {otherMembers.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <label htmlFor="schedule-copy-from" className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
                      Copiar de…
                    </label>
                    <select
                      id="schedule-copy-from"
                      value={copyFrom}
                      onChange={(e) => handleCopyFrom(e.target.value)}
                      disabled={isSaving}
                      className="input-base"
                    >
                      <option value="" disabled>Elige a alguien del equipo…</option>
                      {otherMembers.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.full_name} — {summarizeSchedule(m.schedules)}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-xinuco-muted">Se carga aquí; no se guarda hasta que pulses Guardar horario.</p>
                  </div>
                )}

                <WeeklyScheduleEditor value={daysState} onChange={handleScheduleChange} disabled={isSaving} />

                <p className="text-xs text-xinuco-muted">
                  ¿Un día puntual distinto (festivo, cita médica)? Usa la pestaña{' '}
                  <button
                    type="button"
                    onClick={() => setTab('time_off')}
                    className="font-semibold underline underline-offset-2 hover:text-xinuco-text transition-colors"
                    style={{ color: 'var(--primary-color)' }}
                  >
                    Permisos
                  </button>
                  .
                </p>

                {otherActive.length > 0 && (
                  <details className="rounded-xl group" style={{ border: '1px solid var(--border-color)' }}>
                    <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-xinuco-text flex items-center justify-between gap-2">
                      <span>Aplicar también a…</span>
                      {applyTo.size > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: 'color-mix(in srgb, var(--primary-color) 18%, transparent)', color: 'var(--primary-color)' }}>
                          {applyTo.size}
                        </span>
                      )}
                    </summary>
                    <div className="flex flex-col" style={{ borderTop: '1px solid var(--border-color)' }}>
                      <label
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-xinuco-text cursor-pointer hover:bg-white/[0.03]"
                        style={{ borderBottom: '1px solid var(--border-color)' }}
                      >
                        <input type="checkbox" checked={allSelected} onChange={toggleAllTeam} disabled={isSaving} />
                        Todo el equipo
                      </label>
                      {otherActive.map((m, idx) => (
                        <label
                          key={m.id}
                          className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-xinuco-text cursor-pointer hover:bg-white/[0.03]"
                          style={{ borderBottom: idx === otherActive.length - 1 ? 'none' : '1px solid var(--border-color)' }}
                        >
                          <input type="checkbox" checked={applyTo.has(m.id)} onChange={() => toggleApplyTo(m.id)} disabled={isSaving} />
                          <span className="flex-1 min-w-0 break-words">{m.full_name}</span>
                          <span className="text-[11px] text-xinuco-muted shrink-0">{summarizeSchedule(m.schedules)}</span>
                        </label>
                      ))}
                      <p className="px-4 py-2.5 text-[11px] text-xinuco-muted" style={{ borderTop: '1px solid var(--border-color)' }}>
                        Su horario actual será reemplazado por este.
                      </p>
                    </div>
                  </details>
                )}
              </div>

              {error && error !== validateWeeklySchedule(stateToScheduleRows(daysState)) && (
                <p role="alert" className="mt-4 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5 animate-fade-in">
                  {error}
                </p>
              )}
              {savedMessage && (
                <p role="status" className="mt-4 flex items-center gap-2 text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-4 py-2.5 animate-fade-in">
                  <CheckCircle2 size={14} />
                  {savedMessage}
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
