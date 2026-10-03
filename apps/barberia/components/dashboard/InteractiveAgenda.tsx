'use client'

import { useEffect, useState, useTransition } from 'react'
import { Play, Clock, CheckCircle2, XCircle, AlertCircle, AlertTriangle, CalendarX, Loader2, ArrowRight } from 'lucide-react'
import { updateAppointmentStatus } from '@/actions/appointments'
import { CheckoutModal } from '../finance/CheckoutModal'
import { FinishNoteSheet, type FinishNoteTarget } from './agenda/FinishNoteSheet'
import { apptCardId } from './agenda/focus-appointment'
import { apptDateKey, businessTodayISODate, dayLabel, formatApptTime } from '@/lib/agenda-time'
import { businessWallNowMs, isApptOverdue, splitUnresolvedPast } from '@/lib/agenda-status'
import { useIsAdmin } from '@/lib/features/role-context'
import type { AppointmentStatus } from '@xinuco/types'

interface InteractiveAgendaProps {
  appointments: any[]
  activeShiftId: string | null
  businessId: string
  slug: string
  /** true si hay filtros activos (fecha/staff/estado) → el estado vacío lo refleja */
  hasFilters?: boolean
  /** Ocupa todo el ancho: en PC muestra las citas en dos columnas */
  wide?: boolean
  /** Separa en un bloque "Sin cerrar" las citas de días anteriores que siguen abiertas (vista "Próximas") */
  separateUnresolved?: boolean
  /** "Ahora" del negocio (hora local como UTC, en ms) calculado en el servidor: evita desajustes de hidratación */
  nowWallMs?: number
}

interface StatusConfig {
  label: string
  textClass: string
  bgClass: string
  Icon: React.ElementType
}

const STATUS_CONFIG: Record<AppointmentStatus, StatusConfig> = {
  payment_pending: {
    label: 'Pago Pendiente',
    textClass: 'text-amber-500',
    bgClass: 'bg-zinc-950',
    Icon: AlertCircle,
  },
  scheduled: {
    label: 'Programada',
    textClass: 'text-xinuco-primary',
    bgClass: 'bg-xinuco-surface',
    Icon: Clock,
  },
  ready_to_pay: {
    label: 'Lista para Pagar',
    textClass: 'text-amber-400',
    bgClass: 'bg-zinc-950',
    Icon: CheckCircle2,
  },
  in_progress: {
    label: 'En curso',
    textClass: 'text-emerald-400',
    bgClass: 'bg-zinc-950',
    Icon: Play,
  },
  completed: {
    label: 'Completada',
    textClass: 'text-zinc-550',
    bgClass: 'bg-zinc-950',
    Icon: CheckCircle2,
  },
  cancelled: {
    label: 'Cancelada',
    textClass: 'text-zinc-550',
    bgClass: 'bg-zinc-950',
    Icon: XCircle,
  },
  no_show: {
    label: 'No asistió',
    textClass: 'text-zinc-550',
    bgClass: 'bg-zinc-950',
    Icon: AlertCircle,
  },
}

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

const SECONDARY_BTN =
  'min-h-11 2xl:min-h-0 w-full md:w-auto inline-flex items-center justify-center text-xs px-3 py-1.5 rounded-lg border border-xinuco-border text-xinuco-muted hover:text-xinuco-text transition-colors shrink-0'

export function InteractiveAgenda({
  appointments: initialAppointments,
  activeShiftId,
  businessId,
  slug,
  hasFilters = false,
  wide = false,
  separateUnresolved = false,
  nowWallMs,
}: InteractiveAgendaProps) {
  const isAdmin = useIsAdmin()
  const [appointments, setAppointments] = useState(initialAppointments)
  const [isPending, startTransition] = useTransition()

  // "Ahora" del negocio: parte del valor del servidor y se refresca cada minuto (citas atrasadas)
  const [nowMs, setNowMs] = useState(() => nowWallMs ?? businessWallNowMs())
  useEffect(() => {
    const t = setInterval(() => setNowMs(businessWallNowMs()), 60_000)
    return () => clearInterval(t)
  }, [])

  // "¿Dejar nota del corte?" tras terminar una cita
  const [noteTarget, setNoteTarget] = useState<FinishNoteTarget | null>(null)

  // Fila que se está actualizando actualmente (para mostrar loader individual)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  
  // Checkout Modal
  const [selectedAppt, setSelectedAppt] = useState<any | null>(null)
  const [checkoutWarning, setCheckoutWarning] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  // Cambiar estado de cita
  const handleStatusChange = (appointmentId: string, nextStatus: AppointmentStatus) => {
    setUpdatingId(appointmentId)
    setStatusError(null)
    startTransition(async () => {
      const result = await updateAppointmentStatus(appointmentId, nextStatus)
      if (result.error) {
        setStatusError(`Error al actualizar estado: ${result.error}`)
      } else {
        // Actualizar localmente para feedback inmediato
        setAppointments((prev) =>
          prev.map((app) => (app.id === appointmentId ? { ...app, status: nextStatus } : app))
        )
        // Terminada: ofrecer dejar una nota en el expediente del cliente (opcional)
        if (nextStatus === 'ready_to_pay') {
          const appt = appointments.find((a) => a.id === appointmentId)
          if (appt?.customer_id) {
            setNoteTarget({
              customerId: appt.customer_id,
              customerName: appt.customers?.full_name || appt.customer_name || 'el cliente',
              appointmentId,
            })
          }
        }
      }
      setUpdatingId(null)
    })
  }

  // Abrir Checkout Modal
  const handleOpenCheckout = (appt: any) => {
    if (!activeShiftId) {
      setCheckoutWarning('⚠️ Debes abrir un turno de caja en el gestor antes de realizar cobros.')
      setTimeout(() => setCheckoutWarning(null), 5000)
      return
    }
    setCheckoutWarning(null)
    setSelectedAppt(appt)
  }

  const handleCheckoutSuccess = () => {
    if (selectedAppt) {
      // Marcar como completada en UI
      setAppointments((prev) =>
        prev.map((app) => (app.id === selectedAppt.id ? { ...app, status: 'completed' } : app))
      )
    }
    setSelectedAppt(null)
    window.location.reload() // Recargar para sincronizar el consolidado de caja
  }

  // Agrupar por día (start_time en UTC = hora local del negocio). Sin fecha → al final.
  const todayKey = businessTodayISODate()
  const groupByDay = (list: any[]) => {
    const groups: { key: string; label: string; items: any[] }[] = []
    const noDate: any[] = []
    for (const appt of list) {
      if (!appt.start_time) {
        noDate.push(appt)
        continue
      }
      const key = apptDateKey(appt.start_time)
      let group = groups.find((g) => g.key === key)
      if (!group) {
        group = { key, label: dayLabel(key, todayKey), items: [] }
        groups.push(group)
      }
      group.items.push(appt)
    }
    if (noDate.length > 0) groups.push({ key: 'sin-fecha', label: 'Sin fecha', items: noDate })
    return groups
  }

  // Vista "Próximas": lo que quedó abierto en días anteriores va aparte, no mezclado con lo futuro
  const { unresolved, rest } = separateUnresolved
    ? splitUnresolvedPast(appointments, todayKey)
    : { unresolved: [] as any[], rest: appointments }
  const groups = groupByDay(rest)
  const unresolvedGroups = groupByDay(unresolved)

  // Lista de citas de un día (misma tarjeta para "Sin cerrar" y para el resto)
  const renderGroups = (list: { key: string; label: string; items: any[] }[]) =>
    list.map((group) => (
      <div key={group.key} className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-xinuco-muted mt-2">
          {group.label}
        </h3>
        <ul className={wide ? 'grid grid-cols-1 gap-2 xl:grid-cols-2' : 'flex flex-col gap-2'} aria-label={`Citas: ${group.label}`}>
          {group.items.map((appt) => renderAppointment(appt))}
        </ul>
      </div>
    ))

  const renderAppointment = (appt: any) => {
            const customerName = appt.customers?.full_name || appt.customer_name || 'Cliente sin nombre'
            const customerPhone = appt.customers?.phone || appt.customer_phone
            const serviceName = appt.services?.name || appt.service_name || 'Servicio'
            const servicePrice = appt.services?.price_cop || 0
            const barberName = appt.staff?.full_name || 'Sin asignar'

            const timeStr = appt.start_time ? formatApptTime(appt.start_time) : '—'
            const duration = appt.services?.duration_minutes ?? 30

            const cfg = STATUS_CONFIG[appt.status as AppointmentStatus] || STATUS_CONFIG.scheduled
            const Icon = cfg.Icon
            const isUpdating = updatingId === appt.id
            const cancelReason = typeof appt.cancellation_reason === 'string' ? appt.cancellation_reason.trim() : ''
            const cancelNote =
              appt.cancelled_by === 'customer'
                ? `Cancelada por el cliente${cancelReason ? `: “${cancelReason}”` : ''}`
                : appt.cancelled_by === 'business'
                  ? 'Cancelada por el negocio'
                  : null
            const isActive = appt.status === 'scheduled' || appt.status === 'in_progress' || appt.status === 'ready_to_pay'
            // Atrasada: sigue "programada" y su hora ya pasó → hay que cerrarla (Iniciar / No asistió)
            const overdue = isApptOverdue({ status: appt.status, start_time: appt.start_time, duration_minutes: duration }, nowMs)
            // Quien no es admin no cobra: la cita lista para pagar pasa por caja
            const statusLabel = appt.status === 'ready_to_pay' && !isAdmin ? 'Lista para pagar · pasa por caja' : cfg.label

            return (
              <li key={appt.id} className="flex items-stretch gap-3 animate-fade-in">
                {/* Columna hora */}
                <time
                  dateTime={appt.start_time ?? undefined}
                  className="text-xs font-bold text-xinuco-muted w-16 shrink-0 pt-4 text-right leading-none"
                >
                  {/* "09:00" arriba y "a. m." debajo, sin partirse a la mitad */}
                  <span className="block whitespace-nowrap">{timeStr.split(/\s/)[0]}</span>
                  {/\s/.test(timeStr) && (
                    <span className="block whitespace-nowrap text-[10px] font-medium mt-1">
                      {timeStr.slice(timeStr.search(/\s/) + 1)}
                    </span>
                  )}
                </time>

                {/* Línea de timeline */}
                <div className="flex flex-col items-center shrink-0 pt-3">
                  <div
                    className="w-2.5 h-2.5 rounded-full border-2 shrink-0 transition-colors duration-300"
                    style={{
                      borderColor: overdue ? '#fbbf24' : isActive ? 'var(--primary-color)' : 'var(--border-color)',
                      background: overdue ? '#fbbf24' : isActive ? 'var(--primary-color)' : 'transparent',
                    }}
                  />
                  <div
                    className="w-px flex-1 mt-1"
                    style={{ background: 'var(--border-color)' }}
                  />
                </div>

                {/* Card de la cita */}
                <div
                  id={apptCardId(appt.id)}
                  className={`card flex-1 min-w-0 flex flex-col ${wide ? '' : '2xl:flex-row 2xl:items-center'} justify-between gap-4 p-4 border scroll-mt-24 ${
                    overdue
                      ? 'border-amber-500/40 bg-amber-500/[0.06] hover:bg-amber-500/10'
                      : 'border-zinc-900 bg-zinc-950/40 hover:bg-zinc-950/70'
                  } transition-colors`}
                  style={isActive && !overdue ? { borderColor: 'color-mix(in srgb, var(--primary-color) 25%, transparent)' } : {}}
                >
                  {/* Detalles principales */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: isActive
                          ? 'color-mix(in srgb, var(--primary-color) 12%, transparent)'
                          : 'color-mix(in srgb, var(--border-color) 60%, transparent)',
                      }}
                    >
                      {isUpdating ? (
                        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
                      ) : (
                        <Icon
                          size={16}
                          style={{ color: isActive ? 'var(--primary-color)' : 'var(--muted-color)' }}
                        />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-xinuco-text truncate">
                          {customerName}
                        </p>
                        {customerPhone && (
                          <span className="text-[10px] text-zinc-500 font-medium">
                            ({customerPhone})
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-xinuco-muted mt-0.5">
                        <span className="truncate">{serviceName}</span>
                        <span>•</span>
                        <span className="shrink-0">{duration} min</span>
                        {servicePrice > 0 && (
                          <>
                            <span>•</span>
                            <span className="shrink-0">{COP.format(servicePrice)}</span>
                          </>
                        )}
                        {/* El barbero no necesita ver su propio nombre en cada cita */}
                        {isAdmin && (
                          <>
                            <span>•</span>
                            <span className="truncate">
                              {appt.staff?.full_name ? `con ${barberName}` : barberName}
                            </span>
                          </>
                        )}
                      </div>
                      {appt.status === 'cancelled' && cancelNote && (
                        <p
                          className="text-xs text-xinuco-muted mt-1 line-clamp-2"
                          title={cancelNote}
                        >
                          {cancelNote}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Acciones del Administrador en base al estado actual */}
                  <div className={`grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center shrink-0 pt-2 border-t border-zinc-900/50 ${wide ? '' : '2xl:justify-end 2xl:pt-0 2xl:border-0'}`}>
                    {/* Badge de estado estático */}
                    <span
                      className={`badge col-span-2 md:col-span-1 justify-self-start shrink-0 text-xs font-bold uppercase tracking-wider ${cfg.textClass}`}
                      style={{ background: 'color-mix(in srgb, currentColor 10%, transparent)' }}
                    >
                      {statusLabel}
                    </span>
                    {overdue && (
                      <span
                        className="badge col-span-2 md:col-span-1 justify-self-start shrink-0 text-xs font-bold uppercase tracking-wider text-amber-400"
                        style={{ background: 'color-mix(in srgb, currentColor 14%, transparent)' }}
                      >
                        Atrasada
                      </span>
                    )}

                    {/* Botón de acción interactivo */}
                    {!isUpdating && (
                      <>
                        {appt.status === 'scheduled' && (
                          <button
                            onClick={() => handleStatusChange(appt.id, 'in_progress')}
                            disabled={isPending}
                            className="col-span-2 md:col-span-1 min-h-11 2xl:min-h-0 w-full md:w-auto text-xs px-3.5 py-1.5 rounded-lg bg-[var(--primary-color)] text-black font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-1 shrink-0 shadow-sm"
                          >
                            <Play size={11} fill="black" />
                            Iniciar
                          </button>
                        )}

                        {appt.status === 'scheduled' && (
                          <button
                            onClick={() => {
                              if (window.confirm(`¿Marcar que ${customerName} no asistió?`)) {
                                handleStatusChange(appt.id, 'no_show')
                              }
                            }}
                            disabled={isPending}
                            className={SECONDARY_BTN}
                          >
                            No asistió
                          </button>
                        )}

                        {(appt.status === 'scheduled' || appt.status === 'payment_pending') && (
                          <button
                            onClick={() => {
                              if (window.confirm(`¿Cancelar la cita de ${customerName}?`)) {
                                handleStatusChange(appt.id, 'cancelled')
                              }
                            }}
                            disabled={isPending}
                            className={`${SECONDARY_BTN} hover:!text-red-400 hover:!border-red-500/40`}
                          >
                            Cancelar
                          </button>
                        )}

                        {appt.status === 'in_progress' && (
                          <button
                            onClick={() => handleStatusChange(appt.id, 'ready_to_pay')}
                            disabled={isPending}
                            className="col-span-2 md:col-span-1 min-h-11 2xl:min-h-0 w-full md:w-auto text-xs px-3.5 py-1.5 rounded-lg bg-emerald-500 text-black font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-1 shrink-0 shadow-sm"
                          >
                            <CheckCircle2 size={11} />
                            Terminar cita
                          </button>
                        )}

                        {/* Cobrar solo lo hace el administrador (el cobro también se valida en la BD) */}
                        {appt.status === 'ready_to_pay' && isAdmin && (
                          <button
                            onClick={() => handleOpenCheckout(appt)}
                            disabled={isPending}
                            className="col-span-2 md:col-span-1 min-h-11 2xl:min-h-0 w-full md:w-auto text-xs px-3.5 py-1.5 rounded-lg bg-amber-400 text-black font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-1 shrink-0 shadow-sm"
                          >
                            <ArrowRight size={11} strokeWidth={2.5} />
                            Cobrar
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </li>
            )
  }

  return (
    <div className="space-y-6">
      {/* Advertencia de Caja Cerrada al intentar cobrar */}
      {checkoutWarning && (
        <div className="p-3 bg-amber-950/20 border border-amber-900/30 rounded-xl text-amber-400 text-xs flex gap-2 animate-fade-in shrink-0">
          <span>{checkoutWarning}</span>
        </div>
      )}

      {/* Error al cambiar estado */}
      {statusError && (
        <div className="p-3 bg-amber-950/20 border border-amber-900/30 rounded-xl text-amber-400 text-xs flex gap-2 animate-fade-in shrink-0">
          <span className="flex-1">{statusError}</span>
          <button
            type="button"
            onClick={() => setStatusError(null)}
            aria-label="Cerrar aviso"
            className="shrink-0 font-bold hover:opacity-80"
          >
            ✕
          </button>
        </div>
      )}

      {appointments.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-10 gap-3 text-center bg-zinc-950/50 border border-zinc-900">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)' }}
          >
            <CalendarX size={24} style={{ color: 'var(--primary-color)' }} />
          </div>
          <div>
            <p className="text-sm font-semibold text-xinuco-text">
              {hasFilters ? 'No hay citas con estos filtros' : 'No hay citas próximas'}
            </p>
            <p className="text-xs text-xinuco-muted mt-1">
              {hasFilters ? 'Prueba con otra fecha, staff o estado.' : 'Cuando alguien reserve, aparecerá aquí.'}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Sin cerrar: citas de días anteriores que siguen abiertas */}
          {unresolved.length > 0 && (
            <section aria-label="Citas sin cerrar" className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-amber-400">
                Sin cerrar ({unresolved.length})
              </h3>
              <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>Márcalas como atendidas o &lsquo;No asistió&rsquo;.</span>
              </p>
              {renderGroups(unresolvedGroups)}
            </section>
          )}
          {renderGroups(groups)}
        </>
      )}

      {/* Checkout Modal */}
      {selectedAppt && (
        <CheckoutModal
          appointment={{
            id: selectedAppt.id,
            customer_name: selectedAppt.customers?.full_name || selectedAppt.customer_name,
            customer_id: selectedAppt.customer_id,
            service_name: selectedAppt.services?.name || selectedAppt.service_name,
            service_price: selectedAppt.services?.price_cop || 0,
            staff_id: selectedAppt.staff_id,
          }}
          businessId={businessId}
          activeShiftId={activeShiftId || ''}
          onClose={() => setSelectedAppt(null)}
          onSuccess={handleCheckoutSuccess}
        />
      )}

      {/* ¿Dejar nota del corte? (tras "Terminar cita") */}
      <FinishNoteSheet target={noteTarget} onClose={() => setNoteTarget(null)} />
    </div>
  )
}
