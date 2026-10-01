'use client'

// AvailabilityClient — "Horario y días cerrados".
//  1. Horario del negocio (se muestra en la página de reservas).
//  2. Festivos de Colombia: Abrimos / Cerramos.
//  3. Cierres propios: vacaciones, remodelación…
// El horario de cada profesional se maneja en Equipo; los cierres bloquean a todos.

import { useState, useTransition } from 'react'
import { Loader2, Save, CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import type { OperatingHours } from '@xinuco/types'
import { updateAvailability } from '@/actions/availability'
import { WeeklyScheduleEditor } from '@/components/dashboard/staff/WeeklyScheduleEditor'
import { HolidaysPanel } from '@/components/dashboard/settings/HolidaysPanel'
import { CustomClosuresPanel } from '@/components/dashboard/settings/CustomClosuresPanel'
import { SectionHeader, cardStyle, type ClosureRow } from '@/components/dashboard/settings/ClosuresShared'
import { operatingHoursToState, stateToOperatingHours, hasOperatingHours, validateOperatingHours } from '@/lib/business-hours'
import type { WeeklyScheduleState } from '@/lib/team-utils'

interface AvailabilityClientProps {
  slug:                  string
  todayKey:              string
  initialOperatingHours: OperatingHours | null
  initialClosures:       ClosureRow[]
}

export function AvailabilityClient({ slug, todayKey, initialOperatingHours, initialClosures }: AvailabilityClientProps) {
  const [closures, setClosures] = useState<ClosureRow[]>(initialClosures)

  // ── Horario del negocio ──────────────────────────────────────────────────
  const [schedule, setSchedule] = useState<WeeklyScheduleState>(() => operatingHoursToState(initialOperatingHours))
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [statusMsg, setStatusMsg] = useState('')
  const defined = hasOperatingHours(initialOperatingHours)

  function handleChange(next: WeeklyScheduleState) {
    setSchedule(next)
    setStatus('idle')
  }

  function handleSave() {
    const hours = stateToOperatingHours(schedule)
    const checked = validateOperatingHours(hours)
    if (!checked.ok) {
      setStatus('error'); setStatusMsg(checked.error)
      return
    }
    setStatus('idle')
    startTransition(async () => {
      const result = await updateAvailability({ operating_hours: checked.value })
      if (result.error) {
        setStatus('error'); setStatusMsg(result.error)
      } else {
        setStatus('success'); setStatusMsg('Horario guardado.')
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── 1. Horario del negocio ───────────────────────────────────────── */}
      <section className="rounded-2xl p-5 flex flex-col gap-5" style={cardStyle()} aria-label="Horario del negocio">
        <SectionHeader
          icon={<Clock size={17} style={{ color: 'var(--primary-color)' }} />}
          title="Horario del negocio"
          subtitle="Se muestra en tu página de reservas. Las horas de cada profesional se manejan en Equipo."
        />

        {!defined && (
          <p className="text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2">
            Aún no has guardado el horario. Ajusta los días y toca Guardar horario.
          </p>
        )}

        <WeeklyScheduleEditor value={schedule} onChange={handleChange} disabled={isPending} />

        {status !== 'idle' && (
          <div
            role={status === 'error' ? 'alert' : 'status'}
            className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${
              status === 'success' ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'
            }`}
          >
            {status === 'success'
              ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              : <AlertCircle size={14} className="shrink-0 mt-0.5" />}
            <span>{statusMsg}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl transition-all disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
          >
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Guardar horario
          </button>
        </div>
      </section>

      {/* ── 2. Festivos ──────────────────────────────────────────────────── */}
      <HolidaysPanel
        slug={slug}
        todayKey={todayKey}
        closures={closures}
        onAdd={row => setClosures(prev => [...prev, row])}
        onRemove={id => setClosures(prev => prev.filter(c => c.id !== id))}
      />

      {/* ── 3. Cierres propios ───────────────────────────────────────────── */}
      <CustomClosuresPanel
        slug={slug}
        todayKey={todayKey}
        closures={closures}
        onAdd={row => setClosures(prev => [...prev, row])}
        onRemove={id => setClosures(prev => prev.filter(c => c.id !== id))}
      />
    </div>
  )
}
