'use client'

import React, { useState, useEffect, useTransition, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Users,
  Plus,
  X,
  Play,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Phone,
  Scissors,
  Clock,
  UserCheck,
  Loader2,
  Banknote,
  Flag,
  AlertTriangle,
  Sparkles,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  getWalkInQueue,
  getWalkInHistory,
  getStaffStatusNow,
  addWalkIn,
  startWalkIn,
  updateWalkInStatus,
  reserveWalkIn,
  releaseWalkIn,
  setWalkInService,
  getWalkInSuggestions,
  removeFromQueue,
} from '@/actions/walk-ins'
import type { WalkInWithRelations, WalkInSuggestion } from '@/actions/walk-ins'
import { updateAppointmentStatus } from '@/actions/appointments'
import { CheckoutModal } from '@/components/finance/CheckoutModal'
import { formatApptTime } from '@/lib/agenda-time'
import { estimateWaits, businessNowAsUtcMs, isReservedTurn } from '@/lib/walk-in-wait'
import type { StaffStatusNow } from '@/lib/walk-in-wait'
import type { Staff, Service, ServiceAudience } from '@xinuco/types'
import { groupServicesForSelect } from '@/lib/service-audience'
import { formatArrivalRelative, formatBusinessClock } from '@/lib/walk-in-time'
import {
  canAttend, canChangeStaff, canRelease, isForSomeoneElse, sortWaitingForBarber,
  type WalkInActor,
} from '@/lib/walk-in-permissions'

// ── Tipos de props ────────────────────────────────────────────────────────────

interface WalkInQueueProps {
  initialQueue:       WalkInWithRelations[]
  initialHistory:     WalkInWithRelations[]
  initialStaffStatus: StaffStatusNow[]
  /** Barberos recomendados por turno en espera sin apartar (walkInId → lista) */
  initialSuggestions: Record<string, WalkInSuggestion[]>
  staffList:          Pick<Staff, 'id' | 'full_name'>[]
  serviceList:        Pick<Service, 'id' | 'name' | 'price_cop' | 'duration_minutes' | 'audience'>[]
  serviceAudiences:   ServiceAudience[]
  businessId:         string
  slug:               string
  activeShiftId:      string | null
  /** admin/super_admin: ve y opera toda la fila */
  isAdmin:            boolean
  /** profesional ligado a la cuenta del barbero (null si es admin o no está ligada) */
  viewerStaffId:      string | null
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
}

// ── Estado del barbero ───────────────────────────────────────────────────────

type PanelStatus = StaffStatusNow['status'] | 'unknown'

function statusMeta(s: { status: PanelStatus; busy_until: string | null }): { label: string; cls: string } {
  switch (s.status) {
    case 'free':
      return { label: 'Libre', cls: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/25' }
    case 'busy':
      return {
        label: s.busy_until ? `En cita hasta ${formatApptTime(s.busy_until)}` : 'En cita',
        cls: 'text-amber-400 bg-amber-400/10 border-amber-400/25',
      }
    case 'break':
      return { label: 'Almorzando', cls: 'text-sky-400 bg-sky-400/10 border-sky-400/25' }
    case 'time_off':
      return { label: 'Con permiso', cls: 'text-violet-400 bg-violet-400/10 border-violet-400/25' }
    case 'off':
      return { label: 'Fuera de horario', cls: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/25' }
    default:
      return { label: '', cls: '' }
  }
}

// ── Wait badges ──────────────────────────────────────────────────────────────

function ArrivalBadge({ arrivedAt }: { arrivedAt: string }) {
  const minutesWaited = minutesSince(arrivedAt)

  let colorClass: string
  if (minutesWaited < 15) {
    colorClass = 'text-emerald-400 bg-emerald-400/10 border-emerald-400/25'
  } else if (minutesWaited < 30) {
    colorClass = 'text-amber-400 bg-amber-400/10 border-amber-400/25'
  } else {
    colorClass = 'text-red-400 bg-red-400/10 border-red-400/25'
  }

  return (
    <span
      title={`Llegó a las ${formatBusinessClock(arrivedAt)}`}
      suppressHydrationWarning
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${colorClass}`}
    >
      <Clock size={9} />
      Llegó {formatArrivalRelative(arrivedAt)}
    </span>
  )
}

// ── Chip "Te espera a ti" (vista de barbero) ─────────────────────────────────

function MineChip() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
    >
      <UserCheck size={9} />
      Te espera a ti
    </span>
  )
}

// ── Staff Chip ─────────────────────────────────────────────────────────────

function StaffChip({ name }: { name?: string }) {
  if (!name) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border text-zinc-500 bg-zinc-500/10 border-zinc-500/25">
        <UserCheck size={9} />
        Sin asignar
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border"
      style={{
        color:            'var(--primary-color)',
        backgroundColor:  'color-mix(in srgb, var(--primary-color) 12%, transparent)',
        borderColor:      'color-mix(in srgb, var(--primary-color) 25%, transparent)',
      }}
    >
      <UserCheck size={9} />
      {name}
    </span>
  )
}

// ── Opciones de servicio (agrupadas por público si el negocio atiende varios) ─

function ServiceOptions({
  services, audiences,
}: {
  services:  Pick<Service, 'id' | 'name' | 'price_cop' | 'duration_minutes' | 'audience'>[]
  audiences: ServiceAudience[]
}) {
  const groups = groupServicesForSelect(services, audiences)
  if (audiences.length <= 1) {
    return (
      <>
        {(groups[0]?.items ?? []).map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </>
    )
  }
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g.key} label={g.label}>
          {g.items.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </optgroup>
      ))}
    </>
  )
}

// ── Panel "Atender" ──────────────────────────────────────────────────────────

interface AttendPanelProps {
  entry:       WalkInWithRelations
  staffStatus: StaffStatusNow[]
  staffList:   Pick<Staff, 'id' | 'full_name'>[]
  serviceList: Pick<Service, 'id' | 'name' | 'price_cop' | 'duration_minutes' | 'audience'>[]
  serviceAudiences: ServiceAudience[]
  /** Barbero: solo puede atender a nombre propio (el admin elige a cualquiera) */
  restrictToStaffId?: string | null
  onClose:     () => void
  onDone:      () => void
}

function AttendPanel({ entry, staffStatus, staffList, serviceList, serviceAudiences, restrictToStaffId, onClose, onDone }: AttendPanelProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError]            = useState<string | null>(null)

  // Barberos con estado (libres primero); sin estado (RPC caída) → lista simple
  const allOptions: { id: string; full_name: string; status: PanelStatus; busy_until: string | null }[] =
    staffStatus.length > 0
      ? [...staffStatus].sort((a, b) => Number(b.status === 'free') - Number(a.status === 'free'))
      : staffList.map((s) => ({ id: s.id, full_name: s.full_name, status: 'unknown' as const, busy_until: null }))
  const options = restrictToStaffId === undefined
    ? allOptions
    : allOptions.filter((o) => o.id === restrictToStaffId)

  const initialStaff = (() => {
    // Turno apartado: preseleccionar a su barbero para reutilizar la reserva
    if (isReservedTurn(entry) && entry.staff_id && options.some((o) => o.id === entry.staff_id)) {
      return entry.staff_id
    }
    const pre = options.find((o) => o.id === entry.staff_id && o.status === 'free')
    if (pre) return pre.id
    const firstFree = options.find((o) => o.status === 'free')
    if (firstFree) return firstFree.id
    return options.find((o) => o.id === entry.staff_id)?.id ?? ''
  })()

  const [staffId, setStaffId]     = useState(initialStaff)
  const [serviceId, setServiceId] = useState(entry.service_id ?? '')

  const needsService = !entry.service_id
  const selected     = options.find((o) => o.id === staffId)
  const showWarning  = selected && selected.status !== 'free' && selected.status !== 'unknown'

  const handleConfirm = () => {
    if (!staffId) { setError('Elige un barbero.'); return }
    if (needsService && !serviceId) { setError('Elige el servicio para atender.'); return }
    setError(null)
    startTransition(async () => {
      const result = await startWalkIn(entry.id, staffId, needsService ? serviceId : null)
      if (result.error) {
        setError(result.error)
      } else {
        onDone()
      }
    })
  }

  return (
    <div
      className="rounded-lg border p-3 flex flex-col gap-2.5"
      style={{ backgroundColor: 'var(--bg-color)', borderColor: 'var(--border-color)' }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-xinuco-muted">¿Quién lo atiende?</p>

      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Barbero">
        {options.length === 0 && (
          <p className="text-xs text-xinuco-muted">No hay barberos activos.</p>
        )}
        {options.map((o) => {
          const meta = statusMeta(o)
          const isSel = o.id === staffId
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={isSel}
              onClick={() => setStaffId(o.id)}
              className="flex items-center justify-between gap-2 text-left rounded-lg border px-2.5 py-1.5 text-xs transition-colors"
              style={{
                borderColor: isSel ? 'var(--primary-color)' : 'var(--border-color)',
                backgroundColor: isSel
                  ? 'color-mix(in srgb, var(--primary-color) 10%, transparent)'
                  : 'transparent',
              }}
            >
              <span className="font-medium text-xinuco-text truncate">{o.full_name}</span>
              {meta.label && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${meta.cls}`}>
                  {meta.label}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {showWarning && (
        <p className="flex items-center gap-1.5 text-[11px] text-amber-400">
          <AlertTriangle size={11} className="flex-shrink-0" />
          Está ocupado; el turno se le asignará igual.
        </p>
      )}

      {needsService && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-xinuco-muted">
            Servicio <span className="text-red-400">*</span>
          </label>
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="w-full text-xs rounded-lg px-2 py-1.5 border outline-none cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-color)',
              borderColor:     'var(--border-color)',
              color:           'var(--text-color, #F4F4F4)',
            }}
          >
            <option value="">Elige el servicio…</option>
            <ServiceOptions services={serviceList} audiences={serviceAudiences} />
          </select>
        </div>
      )}

      {error && <p className="text-[11px] text-red-400 bg-red-400/10 rounded-lg px-2.5 py-1.5">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending}
          className="flex min-h-11 sm:min-h-0 items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
        >
          {isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={11} />}
          Confirmar
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="min-h-11 sm:min-h-0 text-xs px-3 py-1.5 rounded-lg border text-xinuco-muted hover:text-xinuco-text transition-colors"
          style={{ borderColor: 'var(--border-color)' }}
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ── Apartar turno (turnos en espera) ─────────────────────────────────────────

type RunAction = (fn: () => Promise<{ error?: string } | void>) => void

const selectStyle = {
  backgroundColor: 'var(--bg-color)',
  borderColor:     'var(--border-color)',
  color:           'var(--text-color, #F4F4F4)',
}

interface ReservationSectionProps {
  entry:        WalkInWithRelations
  staffList:    Pick<Staff, 'id' | 'full_name'>[]
  serviceList:  Pick<Service, 'id' | 'name' | 'price_cop' | 'duration_minutes' | 'audience'>[]
  serviceAudiences: ServiceAudience[]
  /** undefined = aún no cargadas (fuera del tope de 10 turnos) */
  suggestions?: WalkInSuggestion[]
  actor:        WalkInActor
  disabled:     boolean
  run:          RunAction
}

function ReservationSection({ entry, staffList, serviceList, serviceAudiences, suggestions, actor, disabled, run }: ReservationSectionProps) {
  const [changing, setChanging] = useState(false)
  const reserved = isReservedTurn(entry)
  const canChange  = canChangeStaff(actor, entry)
  const canFree    = canRelease(actor, entry, false)

  const btnPrimary = 'flex min-h-11 sm:min-h-0 items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50'
  const selectCls  = 'text-[11px] rounded-lg px-2 py-1 border outline-none cursor-pointer transition-colors disabled:opacity-50'

  // 1) Apartado: pill + cambiar barbero / liberar
  if (reserved && entry.appointment) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border"
            style={{
              color:           'var(--primary-color)',
              backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
              borderColor:     'color-mix(in srgb, var(--primary-color) 25%, transparent)',
            }}
          >
            <UserCheck size={10} />
            Apartado con {entry.staff?.full_name ?? 'barbero'} · {formatApptTime(entry.appointment.start_time)}
          </span>
          {!changing && (
            <>
              {canChange && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setChanging(true)}
                  className="inline-flex min-h-11 sm:min-h-0 items-center text-[11px] font-medium text-xinuco-muted hover:text-xinuco-text underline-offset-2 hover:underline disabled:opacity-50"
                >
                  Cambiar barbero
                </button>
              )}
              {canFree && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => run(() => releaseWalkIn(entry.id))}
                  className="inline-flex min-h-11 sm:min-h-0 items-center text-[11px] font-medium text-xinuco-muted hover:text-red-400 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  Liberar
                </button>
              )}
            </>
          )}
        </div>
        {changing && (
          <div className="flex items-center gap-2">
            <select
              value=""
              disabled={disabled}
              onChange={(e) => {
                const id = e.target.value
                if (!id) return
                setChanging(false)
                run(() => reserveWalkIn(entry.id, id))
              }}
              className={selectCls}
              style={selectStyle}
            >
              <option value="">Elige el barbero…</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id} disabled={s.id === entry.staff_id}>{s.full_name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setChanging(false)}
              className="text-[11px] text-xinuco-muted hover:text-xinuco-text"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    )
  }

  // Barbero: un turno que pidió/apartó otro profesional es del admin; sin profesional ligado no hay nada que apartar
  if (!actor.isAdmin && (isForSomeoneElse(actor, entry) || !actor.staffId)) return null

  // 2) Sin servicio: la reserva lo requiere
  if (!entry.service_id) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-xinuco-muted">Elige el servicio para apartar el turno</label>
        <select
          value=""
          disabled={disabled}
          onChange={(e) => {
            const id = e.target.value
            if (id) run(() => setWalkInService(entry.id, id))
          }}
          className={`${selectCls} w-full`}
          style={selectStyle}
        >
          <option value="">Servicio…</option>
          <ServiceOptions services={serviceList} audiences={serviceAudiences} />
        </select>
      </div>
    )
  }

  // 3a) Barbero: solo aparta para sí mismo
  if (!actor.isAdmin) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => run(() => reserveWalkIn(entry.id, actor.staffId))}
          className={btnPrimary}
          style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
        >
          Apartar para mí
        </button>
        <span className="text-[11px] text-xinuco-muted">en tu próximo hueco libre de hoy</span>
      </div>
    )
  }

  // 3b) Admin: sin apartar, con recomendación
  if (suggestions === undefined) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => run(() => reserveWalkIn(entry.id, null))}
          className={btnPrimary}
          style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
        >
          Apartar
        </button>
        <span className="text-[11px] text-xinuco-muted">con el barbero que se libere primero</span>
      </div>
    )
  }

  if (suggestions.length === 0) {
    return <p className="text-[11px] text-xinuco-muted">Ningún barbero tiene espacio hoy</p>
  }

  const [first, ...others] = suggestions
  const when = (x: WalkInSuggestion) => (x.minutes_from_now === 0 ? 'disponible ahora' : formatApptTime(x.next_slot))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-[11px] text-xinuco-text min-w-0">
          <Sparkles size={11} className="flex-shrink-0" style={{ color: 'var(--primary-color)' }} />
          <span suppressHydrationWarning className="truncate">
            Recomendado: {first.full_name} · {when(first)}
          </span>
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => run(() => reserveWalkIn(entry.id, first.staff_id))}
          className={btnPrimary}
          style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
        >
          Apartar
        </button>
      </div>
      {others.length > 0 && (
        <select
          value=""
          disabled={disabled}
          onChange={(e) => {
            const id = e.target.value
            if (id) run(() => reserveWalkIn(entry.id, id))
          }}
          className={`${selectCls} w-full`}
          style={selectStyle}
        >
          <option value="">Otro barbero…</option>
          {others.map((o) => (
            <option key={o.staff_id} value={o.staff_id}>{o.full_name} · {when(o)}</option>
          ))}
        </select>
      )}
    </div>
  )
}

// ── Turno (card) ─────────────────────────────────────────────────────────────

interface WalkInCardProps {
  entry:        WalkInWithRelations
  staffList:    Pick<Staff, 'id' | 'full_name'>[]
  serviceList:  Pick<Service, 'id' | 'name' | 'price_cop' | 'duration_minutes' | 'audience'>[]
  serviceAudiences: ServiceAudience[]
  staffStatus:  StaffStatusNow[]
  suggestions?: WalkInSuggestion[]
  /** Minutos estimados hasta ser atendido (solo turnos en espera); null si no hay barberos */
  waitMinutes?: number | null
  noStaffNow?:  boolean
  actor:        WalkInActor
  onRefresh:    () => void
  onCharge:     (entry: WalkInWithRelations) => void
}

function WalkInCard({
  entry, staffList, serviceList, serviceAudiences, staffStatus, suggestions, waitMinutes, noStaffNow, actor, onRefresh, onCharge,
}: WalkInCardProps) {
  const [isPending, startTransition]      = useTransition()
  const [showAttend, setShowAttend]         = useState(false)
  const [completedAnim, setCompletedAnim]   = useState(false)
  const [actionError, setActionError]       = useState<string | null>(null)

  const appointmentId = entry.appointment_id ?? null
  const hasAppointment = entry.status === 'in_progress' && !!appointmentId
  const apptStatus = entry.appointment?.status
  const readyToPay = apptStatus === 'ready_to_pay'

  // Flujo legacy (sin cita): solo cambia el estado del turno
  const handleLegacyComplete = () => {
    setCompletedAnim(true)
    setTimeout(() => setCompletedAnim(false), 800)
    startTransition(async () => {
      await updateWalkInStatus(entry.id, 'completed')
      onRefresh()
    })
  }

  const handleFinish = () => {
    if (!appointmentId) return
    setActionError(null)
    startTransition(async () => {
      const result = await updateAppointmentStatus(appointmentId, 'ready_to_pay')
      if (result?.error) setActionError(result.error)
      onRefresh()
    })
  }

  // Ejecuta una acción del turno (apartar/liberar/servicio), muestra su error y refresca
  const runAction: RunAction = (fn) => {
    setActionError(null)
    startTransition(async () => {
      const result = await fn()
      if (result && result.error) setActionError(result.error)
      onRefresh()
    })
  }

  const handleCancel = () => {
    // Confirmar nombrando al cliente (evita quitar a la persona equivocada con un toque)
    const msg = hasAppointment
      ? `¿Cancelar la cita de ${entry.customer_name} y quitarlo de la fila?`
      : `¿Quitar a ${entry.customer_name} de la fila?`
    if (!window.confirm(msg)) return
    setActionError(null)
    startTransition(async () => {
      if (hasAppointment && appointmentId) {
        // El trigger cierra el turno al cancelar la cita
        const result = await updateAppointmentStatus(appointmentId, 'cancelled')
        if (result?.error) setActionError(result.error)
      } else {
        const result = await removeFromQueue(entry.id)
        if (result?.error) setActionError(result.error)
      }
      onRefresh()
    })
  }

  const isWaiting = entry.status === 'waiting'
  const isReserved = isReservedTurn(entry)
  // Reglas de barbero (la BD las aplica igual): ver lib/walk-in-permissions.ts
  const attendAllowed = canAttend(actor, entry)
  const forOther      = isForSomeoneElse(actor, entry)
  const isMine        = !actor.isAdmin && !!actor.staffId && entry.staff_id === actor.staffId
  const removeAllowed = !isWaiting || canRelease(actor, entry, true)
  const waitLabel =
    isReserved ? (waitMinutes == null ? null : waitMinutes <= 0 ? 'Le toca ya' : `En ~${waitMinutes} min`)
    : noStaffNow ? 'Sin barberos disponibles'
    : waitMinutes == null ? null
    : waitMinutes <= 0 ? 'Le toca ya'
    : `Espera ~${waitMinutes} min`

  return (
    <div
      className={`rounded-xl p-4 flex flex-col gap-3 border transition-all duration-300 ${
        completedAnim ? 'scale-95 opacity-60' : 'opacity-100'
      }`}
      style={{
        backgroundColor: 'var(--surface-color)',
        borderColor:     'var(--border-color)',
      }}
    >
      {/* Row 1: name + position */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                color:           'var(--primary-color)',
                backgroundColor: 'color-mix(in srgb, var(--primary-color) 15%, transparent)',
              }}
            >
              {entry.position + 1}
            </span>
            <span className="font-semibold text-sm text-xinuco-text truncate">
              {entry.customer_name}
            </span>
          </div>
          {entry.customer_phone && (
            <span className="flex items-center gap-1 text-[11px] text-xinuco-muted ml-7">
              <Phone size={9} />
              {entry.customer_phone}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <ArrivalBadge arrivedAt={entry.arrived_at} />
          {isWaiting && waitLabel && (
            <span
              suppressHydrationWarning
              className={`text-[10px] font-semibold whitespace-nowrap ${noStaffNow && !isReserved ? 'text-zinc-500' : 'text-xinuco-text'}`}
            >
              {waitLabel}
            </span>
          )}
        </div>
      </div>

      {/* Row 2: service + staff chips */}
      <div className="flex flex-wrap gap-1.5 ml-0">
        {entry.service && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border text-zinc-300 bg-zinc-300/10 border-zinc-300/20">
            <Scissors size={9} />
            {entry.service.name}
          </span>
        )}
        {isWaiting && isMine && <MineChip />}
        {!isReserved && <StaffChip name={entry.staff?.full_name} />}
        {hasAppointment && entry.appointment?.start_time && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border text-zinc-400 bg-zinc-500/10 border-zinc-500/25">
            <Clock size={9} />
            Desde {formatApptTime(entry.appointment.start_time)}
          </span>
        )}
        {hasAppointment && readyToPay && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border text-emerald-400 bg-emerald-400/10 border-emerald-400/25">
            <Banknote size={9} />
            Listo para cobrar
          </span>
        )}
      </div>

      {/* Row 3: notes */}
      {entry.notes && (
        <p className="text-[11px] text-xinuco-muted italic border-l-2 pl-2" style={{ borderColor: 'var(--border-color)' }}>
          {entry.notes}
        </p>
      )}

      {/* Apartar turno en la agenda */}
      {isWaiting && !showAttend && (
        <ReservationSection
          entry={entry}
          staffList={staffList}
          serviceList={serviceList}
          serviceAudiences={serviceAudiences}
          suggestions={suggestions}
          actor={actor}
          disabled={isPending}
          run={runAction}
        />
      )}

      {/* Panel Atender */}
      {showAttend && isWaiting && (
        <AttendPanel
          entry={entry}
          staffStatus={staffStatus}
          staffList={staffList}
          serviceList={serviceList}
          serviceAudiences={serviceAudiences}
          restrictToStaffId={actor.isAdmin ? undefined : actor.staffId}
          onClose={() => setShowAttend(false)}
          onDone={() => { setShowAttend(false); onRefresh() }}
        />
      )}

      {actionError && (
        <p className="text-[11px] text-red-400 bg-red-400/10 rounded-lg px-2.5 py-1.5">{actionError}</p>
      )}

      {/* Row 4: actions */}
      <div className="flex items-center gap-2 flex-wrap pt-1 border-t" style={{ borderColor: 'var(--border-color)' }}>
        {isPending ? (
          <Loader2 size={14} className="animate-spin text-xinuco-muted" />
        ) : (
          <>
            {isWaiting && !showAttend && attendAllowed && (
              <button
                onClick={() => setShowAttend(true)}
                className="flex min-h-11 sm:min-h-0 items-center gap-1.5 text-sm sm:text-xs font-semibold px-4 sm:px-2.5 py-1.5 rounded-lg transition-all"
                style={{
                  color:           'var(--primary-color)',
                  backgroundColor: 'color-mix(in srgb, var(--primary-color) 15%, transparent)',
                }}
              >
                <Play size={13} />
                Atender
              </button>
            )}
            {isWaiting && forOther && (
              <span className="text-[11px] text-xinuco-muted">
                Es de {entry.staff?.full_name ?? 'otro profesional'}
              </span>
            )}
            {isWaiting && !actor.isAdmin && !actor.staffId && (
              <span className="text-[11px] text-xinuco-muted">
                Tu cuenta no está ligada a un profesional
              </span>
            )}

            {hasAppointment && !readyToPay && (
              <button
                onClick={handleFinish}
                className="flex min-h-11 sm:min-h-0 items-center gap-1.5 text-sm sm:text-xs font-semibold px-4 sm:px-2.5 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 transition-all"
              >
                <Flag size={11} />
                Terminar
              </button>
            )}
            {hasAppointment && readyToPay && (
              <button
                onClick={() => onCharge(entry)}
                className="flex min-h-11 sm:min-h-0 items-center gap-1.5 text-sm sm:text-xs font-semibold px-4 sm:px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 transition-all"
              >
                <Banknote size={11} />
                Cobrar
              </button>
            )}
            {entry.status === 'in_progress' && !hasAppointment && (
              <button
                onClick={handleLegacyComplete}
                className="flex min-h-11 sm:min-h-0 items-center gap-1.5 text-sm sm:text-xs font-semibold px-4 sm:px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 transition-all"
              >
                <CheckCircle size={11} />
                Completar
              </button>
            )}

            {/* Quitar (confirma con window.confirm nombrando al cliente) */}
            {removeAllowed && (
              <button
                onClick={handleCancel}
                className="ml-auto flex min-h-11 sm:min-h-0 items-center gap-1.5 text-sm sm:text-xs font-medium px-3 sm:px-2 py-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-400/10 transition-all"
                aria-label={hasAppointment ? `Cancelar la cita de ${entry.customer_name} y quitarlo de la fila` : `Quitar a ${entry.customer_name} de la fila`}
              >
                <X size={14} />
                {hasAppointment ? 'Cancelar cita' : 'Quitar de la fila'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Sheet: nuevo turno ─────────────────────────────────────────────────────

interface AddWalkInSheetProps {
  businessId:  string
  staffList:   Pick<Staff, 'id' | 'full_name'>[]
  serviceList: Pick<Service, 'id' | 'name' | 'price_cop' | 'duration_minutes' | 'audience'>[]
  serviceAudiences: ServiceAudience[]
  onClose:     () => void
  onSuccess:   () => void
}

function AddWalkInSheet({ businessId, staffList, serviceList, serviceAudiences, onClose, onSuccess }: AddWalkInSheetProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError]            = useState<string | null>(null)
  const formRef                      = React.useRef<HTMLFormElement>(null)

  const [form, setForm] = useState({
    customer_name:  '',
    customer_phone: '',
    service_id:     '',
    staff_id:       '',
    notes:          '',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.customer_name.trim()) {
      setError('El nombre del cliente es obligatorio.')
      return
    }
    setError(null)

    startTransition(async () => {
      const result = await addWalkIn(businessId, {
        customer_name:  form.customer_name,
        customer_phone: form.customer_phone || null,
        service_id:     form.service_id     || null,
        staff_id:       form.staff_id       || null,
        notes:          form.notes          || null,
      })
      if (result.error) {
        setError(result.error)
      } else {
        onSuccess()
        onClose()
      }
    })
  }

  const inputCls =
    'w-full rounded-xl px-3 py-2.5 text-sm border outline-none transition-colors placeholder-zinc-500'

  const inputStyle = {
    backgroundColor: 'var(--bg-color)',
    borderColor:     'var(--border-color)',
    color:           'var(--text-color, #F4F4F4)',
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 h-dvh z-50 w-full max-w-md flex flex-col shadow-2xl"
        style={{ backgroundColor: 'var(--bg-color)', borderLeft: '1px solid var(--border-color)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--primary-color) 15%, transparent)',
              }}
            >
              <Users size={16} style={{ color: 'var(--primary-color)' }} />
            </div>
            <span className="font-semibold text-sm text-xinuco-text">Nuevo turno</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.05] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form ref={formRef} onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          {/* Customer name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-xinuco-muted uppercase tracking-wide">
              Nombre del cliente <span className="text-red-400">*</span>
            </label>
            <input
              className={inputCls}
              style={inputStyle}
              placeholder="Ej: Juan García"
              value={form.customer_name}
              onChange={(e) => setForm((p) => ({ ...p, customer_name: e.target.value }))}
              autoFocus
            />
          </div>

          {/* Phone */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-xinuco-muted uppercase tracking-wide">
              Teléfono <span className="text-amber-400/80 font-normal normal-case">(recomendado)</span>
            </label>
            <input
              className={inputCls}
              style={inputStyle}
              placeholder="Para registrarlo en Clientes"
              type="tel"
              value={form.customer_phone}
              onChange={(e) => setForm((p) => ({ ...p, customer_phone: e.target.value }))}
            />
          </div>

          {/* Service */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-xinuco-muted uppercase tracking-wide">
              Servicio <span className="text-zinc-600 font-normal normal-case">(opcional)</span>
            </label>
            <select
              className={inputCls}
              style={inputStyle}
              value={form.service_id}
              onChange={(e) => setForm((p) => ({ ...p, service_id: e.target.value }))}
            >
              <option value="">Sin definir</option>
              <ServiceOptions services={serviceList} audiences={serviceAudiences} />
            </select>
          </div>

          {/* Staff */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-xinuco-muted uppercase tracking-wide">
              Barbero <span className="text-zinc-600 font-normal normal-case">(opcional)</span>
            </label>
            <select
              className={inputCls}
              style={inputStyle}
              value={form.staff_id}
              onChange={(e) => setForm((p) => ({ ...p, staff_id: e.target.value }))}
            >
              <option value="">Cualquier barbero</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-xinuco-muted uppercase tracking-wide">
              Notas <span className="text-zinc-600 font-normal normal-case">(opcional)</span>
            </label>
            <textarea
              className={`${inputCls} resize-none`}
              style={inputStyle}
              rows={3}
              placeholder="Ej: Cliente frecuente, prefiere corte clásico..."
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
          )}
        </form>

        {/* Footer */}
        <div
          className="px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t flex gap-3"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border text-sm font-medium text-xinuco-muted hover:text-xinuco-text transition-colors"
            style={{ borderColor: 'var(--border-color)' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => formRef.current?.requestSubmit()}
            disabled={isPending}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            style={{
              backgroundColor: 'var(--primary-color)',
              color:           '#080808',
            }}
          >
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Agregar a la fila
          </button>
        </div>
      </div>
    </>
  )
}

// ── History Item ─────────────────────────────────────────────────────────────

function HistoryItem({ entry }: { entry: WalkInWithRelations }) {
  const isCompleted = entry.status === 'completed'

  return (
    <div
      className="flex items-center gap-3 py-3 border-b last:border-b-0"
      style={{ borderColor: 'var(--border-color)' }}
    >
      <div
        className={`w-2 h-2 rounded-full flex-shrink-0 ${isCompleted ? 'bg-emerald-400' : 'bg-zinc-600'}`}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-xinuco-text truncate">{entry.customer_name}</p>
        <p className="text-[11px] text-xinuco-muted">
          {entry.service?.name ?? 'Sin servicio'} •{' '}
          {formatDistanceToNow(new Date(entry.arrived_at), { addSuffix: true, locale: es })}
        </p>
      </div>
      <span
        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
          isCompleted
            ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/25'
            : 'text-zinc-500 bg-zinc-500/10 border-zinc-500/25'
        }`}
      >
        {isCompleted ? 'Completado' : 'Cancelado'}
      </span>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function WalkInQueue({
  initialQueue,
  initialHistory,
  initialStaffStatus,
  initialSuggestions,
  staffList,
  serviceList,
  serviceAudiences,
  businessId,
  activeShiftId,
  isAdmin,
  viewerStaffId,
}: WalkInQueueProps) {
  const actor: WalkInActor = { isAdmin, staffId: viewerStaffId }
  const [queue, setQueue]           = useState<WalkInWithRelations[]>(initialQueue)
  const [history, setHistory]       = useState<WalkInWithRelations[]>(initialHistory)
  const [staffStatus, setStaffStatus] = useState<StaffStatusNow[]>(initialStaffStatus)
  const [suggestions, setSuggestions] = useState<Record<string, WalkInSuggestion[]>>(initialSuggestions)
  const [showAddSheet, setShowAdd]  = useState(false)

  // ?nuevo=1 (acción rápida "+" del menú móvil): abre el formulario y limpia el parámetro
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  useEffect(() => {
    if (searchParams.get('nuevo') !== '1') return
    setShowAdd(true)
    const next = new URLSearchParams(searchParams.toString())
    next.delete('nuevo')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [searchParams, pathname, router])
  const [showHistory, setShowHistory] = useState(false)
  const [checkoutEntry, setCheckoutEntry] = useState<WalkInWithRelations | null>(null)
  const [checkoutWarning, setCheckoutWarning] = useState<string | null>(null)
  const [, startTransition]         = useTransition()

  const waiting    = queue.filter((e) => e.status === 'waiting')
  const inProgress = queue.filter((e) => e.status === 'in_progress')
  const freeBarbers = staffStatus.filter((s) => s.status === 'free').length

  // Espera estimada por turno (busy_until y "ahora" en hora local del negocio como UTC)
  const estimate = estimateWaits(
    waiting.map((w) => ({
      id:               w.id,
      staff_id:         w.staff_id,
      duration_minutes: w.service?.duration_minutes ?? w.appointment?.services?.duration_minutes ?? null,
      reserved_start:   isReservedTurn(w) ? w.appointment?.start_time ?? null : null,
    })),
    staffStatus,
    businessNowAsUtcMs(),
  )

  // Refresh queue + barber status + history from server
  const refresh = useCallback(() => {
    startTransition(async () => {
      try {
        const [fresh, status, hist] = await Promise.all([
          getWalkInQueue(businessId),
          getStaffStatusNow(businessId),
          getWalkInHistory(businessId, 10),
        ])
        // Recomendaciones de los primeros 10 turnos en espera sin apartar
        const needSuggestions = fresh
          .filter((w) => w.status === 'waiting' && !isReservedTurn(w))
          .slice(0, 10)
          .map((w) => w.id)
        const fresher = needSuggestions.length > 0 ? await getWalkInSuggestions(needSuggestions) : {}
        setQueue(fresh)
        setStaffStatus(status)
        setHistory(hist)
        setSuggestions(fresher)
      } catch {
        // silent refresh failure — stale data is acceptable
      }
    })
  }, [businessId])

  // Auto-refresh every 30 seconds for multi-device sync
  useEffect(() => {
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  // Cobrar: mismo requisito que la Agenda (turno de caja abierto)
  const handleCharge = (entry: WalkInWithRelations) => {
    if (!activeShiftId) {
      setCheckoutWarning('⚠️ Debes abrir un turno de caja en el gestor antes de realizar cobros.')
      setTimeout(() => setCheckoutWarning(null), 5000)
      return
    }
    setCheckoutWarning(null)
    setCheckoutEntry(entry)
  }

  const handleCheckoutSuccess = () => {
    setCheckoutEntry(null)
    refresh() // el trigger completa el turno al cobrar la cita
  }

  const columnHeader = (
    label:    string,
    count:    number,
    isGold?:  boolean
  ) => (
    <div className="flex items-center gap-2 mb-4">
      <h3
        className="text-xs font-bold uppercase tracking-widest"
        style={{ color: isGold ? 'var(--primary-color)' : '#f59e0b' }}
      >
        {label}
      </h3>
      <span
        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
        style={
          isGold
            ? {
                color:           'var(--primary-color)',
                backgroundColor: 'color-mix(in srgb, var(--primary-color) 15%, transparent)',
              }
            : { color: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.12)' }
        }
      >
        {count}
      </span>
    </div>
  )

  const renderCard = (entry: WalkInWithRelations) => (
    <WalkInCard
      key={entry.id}
      entry={entry}
      staffList={staffList}
      serviceList={serviceList}
      serviceAudiences={serviceAudiences}
      staffStatus={staffStatus}
      suggestions={suggestions[entry.id]}
      waitMinutes={estimate.minutesById[entry.id] ?? null}
      noStaffNow={entry.status === 'waiting' && !estimate.available}
      actor={actor}
      onRefresh={refresh}
      onCharge={handleCharge}
    />
  )

  return (
    <div className="flex flex-col gap-6 pt-6">
      {/* Page Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
              border:          '1px solid color-mix(in srgb, var(--primary-color) 25%, transparent)',
            }}
          >
            <Users size={22} style={{ color: 'var(--primary-color)' }} />
          </div>
          <div>
            <h1 className="font-serif font-bold text-xl text-xinuco-text">Fila de espera</h1>
            <p className="text-xs text-xinuco-text mt-0.5 font-medium">
              {waiting.length} en espera · {inProgress.length} atendiendo ·{' '}
              {freeBarbers} {freeBarbers === 1 ? 'barbero libre' : 'barberos libres'}
            </p>
            <p className="text-[11px] text-xinuco-muted mt-0.5">
              Clientes sin cita previa · Se actualiza sola
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowAdd(true)}
          className="flex min-h-11 items-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl transition-colors hover:opacity-90 flex-shrink-0"
          style={{
            backgroundColor: 'var(--primary-color)',
            color:           '#080808',
          }}
        >
          <Plus size={15} />
          <span className="hidden sm:inline">Agregar a la fila</span>
          <span className="sm:hidden">Agregar</span>
        </button>
      </div>

      {/* Advertencia de caja cerrada al intentar cobrar */}
      {checkoutWarning && (
        <div className="p-3 bg-amber-950/20 border border-amber-900/30 rounded-xl text-amber-400 text-xs flex gap-2">
          <span>{checkoutWarning}</span>
        </div>
      )}

      {/* Empty state */}
      {queue.length === 0 ? (
        <div
          className="rounded-2xl flex flex-col items-center justify-center gap-4 py-16 border"
          style={{ backgroundColor: 'var(--surface-color)', borderColor: 'var(--border-color)' }}
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--primary-color) 10%, transparent)',
              border:          '1px solid color-mix(in srgb, var(--primary-color) 20%, transparent)',
            }}
          >
            <Users size={32} style={{ color: 'var(--primary-color)', opacity: 0.6 }} />
          </div>
          <div className="text-center">
            <p className="font-semibold text-xinuco-text">No hay clientes en espera</p>
            <p className="text-sm text-xinuco-muted mt-1">
              Agrega el primer turno para comenzar la fila
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--primary-color) 15%, transparent)',
              color:           'var(--primary-color)',
              border:          '1px solid color-mix(in srgb, var(--primary-color) 25%, transparent)',
            }}
          >
            <Plus size={14} />
            Agregar a la fila
          </button>
        </div>
      ) : (
        /* Kanban board */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* En Espera */}
          <div>
            {columnHeader('En Espera', waiting.length, false)}
            <div className="flex flex-col gap-3">
              {waiting.length === 0 ? (
                <div
                  className="rounded-xl py-8 flex flex-col items-center gap-2 border border-dashed"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <p className="text-xs text-xinuco-muted">Sin clientes en espera</p>
                </div>
              ) : (
                // Barbero: "los tuyos primero" (el admin ve el orden de la fila tal cual)
                (isAdmin ? waiting : sortWaitingForBarber(waiting, viewerStaffId)).map(renderCard)
              )}
            </div>
          </div>

          {/* En Atención */}
          <div>
            {columnHeader('En Atención', inProgress.length, true)}
            <div className="flex flex-col gap-3">
              {inProgress.length === 0 ? (
                <div
                  className="rounded-xl py-8 flex flex-col items-center gap-2 border border-dashed"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <p className="text-xs text-xinuco-muted">Ningún cliente en atención ahora</p>
                </div>
              ) : (
                inProgress.map(renderCard)
              )}
            </div>
          </div>
        </div>
      )}

      {/* History (collapsible) */}
      {history.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
            style={{ backgroundColor: 'var(--surface-color)' }}
          >
            <span className="text-xs font-bold uppercase tracking-widest text-xinuco-muted">
              Historial reciente
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-xinuco-muted">{history.length} registros</span>
              {showHistory ? (
                <ChevronUp size={14} className="text-xinuco-muted" />
              ) : (
                <ChevronDown size={14} className="text-xinuco-muted" />
              )}
            </div>
          </button>

          {showHistory && (
            <div className="px-5" style={{ backgroundColor: 'var(--bg-color)' }}>
              {history.map((entry) => (
                <HistoryItem key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sheet: nuevo turno */}
      {showAddSheet && (
        <AddWalkInSheet
          businessId={businessId}
          staffList={staffList}
          serviceList={serviceList}
          serviceAudiences={serviceAudiences}
          onClose={() => setShowAdd(false)}
          onSuccess={refresh}
        />
      )}

      {/* Checkout (mismo modal que la Agenda) */}
      {checkoutEntry && checkoutEntry.appointment_id && (
        <CheckoutModal
          appointment={{
            id:            checkoutEntry.appointment_id,
            customer_name: checkoutEntry.customer_name,
            customer_id:   checkoutEntry.customer_id ?? undefined,
            service_name:  checkoutEntry.appointment?.services?.name ?? checkoutEntry.service?.name,
            service_price: checkoutEntry.appointment?.services?.price_cop ?? checkoutEntry.service?.price_cop ?? 0,
            staff_id:      checkoutEntry.staff_id,
          }}
          businessId={businessId}
          activeShiftId={activeShiftId || ''}
          onClose={() => setCheckoutEntry(null)}
          onSuccess={handleCheckoutSuccess}
        />
      )}
    </div>
  )
}
