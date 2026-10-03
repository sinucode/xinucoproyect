'use client'

// Detalle de una cita de la línea de tiempo del día: datos del cliente y del servicio, estado y
// acciones (Iniciar / Terminar / No asistió / Cancelar y, solo para el admin, Cobrar).
// Reutiliza el mismo cambio de estado que las tarjetas de la lista (use-appointment-status).

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, CheckCircle2, Loader2, MessageCircle, Phone, Play } from 'lucide-react'
import { ResponsiveSheet } from '@/components/layout/ResponsiveSheet'
import { CheckoutModal } from '@/components/finance/CheckoutModal'
import { apptDateKey, businessTodayISODate, dayLabel, formatApptTime } from '@/lib/agenda-time'
import {
  apptStatusLabel,
  availableApptActions,
  businessWallNowMs,
  isApptOverdue,
} from '@/lib/agenda-status'
import { cleanPhone, isPlaceholderPhone, whatsappUrl } from '@/lib/crm-utils'
import { FinishNoteSheet } from './FinishNoteSheet'
import { useAppointmentStatusChange } from './use-appointment-status'
import type { TimelineAppt } from './staff-day-utils'

interface AppointmentDetailSheetProps {
  /** Cita abierta (null = cerrada). Siempre montado: guarda el aviso de nota y el cobro. */
  appt: TimelineAppt | null
  isAdmin: boolean
  /** Turno de caja abierto (solo el admin cobra) */
  activeShiftId: string | null
  businessId: string
  onClose: () => void
}

const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

const ACTION_BTN = 'min-h-11 w-full inline-flex items-center justify-center gap-1.5 rounded-xl text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'
const SECONDARY_BTN =
  'min-h-11 w-full inline-flex items-center justify-center rounded-xl border border-xinuco-border text-sm font-semibold text-xinuco-muted hover:text-xinuco-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

function statusTone(status: string, overdue: boolean): string {
  if (overdue) return 'text-amber-400'
  if (status === 'ready_to_pay' || status === 'payment_pending') return 'text-amber-400'
  if (status === 'scheduled' || status === 'in_progress') return 'text-[var(--primary-color)]'
  return 'text-xinuco-muted'
}

export function AppointmentDetailSheet({ appt, isAdmin, activeShiftId, businessId, onClose }: AppointmentDetailSheetProps) {
  const router = useRouter()
  const [checkoutAppt, setCheckoutAppt] = useState<TimelineAppt | null>(null)

  // Tras una acción: cerrar la hoja y refrescar la línea de tiempo (el servidor trae el estado nuevo)
  const { isPending, updatingId, error, setError, noteTarget, setNoteTarget, runAction } = useAppointmentStatusChange(() => {
    onClose()
    router.refresh()
  })

  // Cada cita parte sin avisos de la anterior
  const apptId = appt?.id
  useEffect(() => { setError(null) }, [apptId, setError])

  // Estable: ResponsiveSheet reengancha foco y teclado si cambia la identidad de onClose
  const close = useCallback(() => {
    setError(null)
    onClose()
  }, [onClose, setError])

  const handleCheckout = (a: TimelineAppt) => {
    if (!activeShiftId) {
      setError('Debes abrir un turno de caja en el gestor antes de realizar cobros.')
      return
    }
    setCheckoutAppt(a)
    close()
  }

  return (
    <>
      <ResponsiveSheet open={!!appt} onClose={close} title="Detalle de la cita">
        {appt && (
          <SheetBody
            appt={appt}
            isAdmin={isAdmin}
            isPending={isPending}
            isUpdating={updatingId === appt.id}
            error={error}
            onAction={(action) => runAction(action, { id: appt.id, customerId: appt.customer_id, customerName: appt.customer_name })}
            onCheckout={() => handleCheckout(appt)}
          />
        )}
      </ResponsiveSheet>

      {/* ¿Dejar nota del corte? (tras "Terminar cita") */}
      <FinishNoteSheet target={noteTarget} onClose={() => setNoteTarget(null)} />

      {checkoutAppt && (
        <CheckoutModal
          appointment={{
            id: checkoutAppt.id,
            customer_name: checkoutAppt.customer_name,
            customer_id: checkoutAppt.customer_id ?? undefined,
            service_name: checkoutAppt.service_name,
            service_price: checkoutAppt.service_price ?? 0,
            staff_id: checkoutAppt.staff_id ?? null,
          }}
          businessId={businessId}
          activeShiftId={activeShiftId || ''}
          onClose={() => setCheckoutAppt(null)}
          onSuccess={() => {
            setCheckoutAppt(null)
            window.location.reload() // sincroniza el consolidado de caja (igual que la lista)
          }}
        />
      )}
    </>
  )
}

function SheetBody({
  appt, isAdmin, isPending, isUpdating, error, onAction, onCheckout,
}: {
  appt: TimelineAppt
  isAdmin: boolean
  isPending: boolean
  isUpdating: boolean
  error: string | null
  onAction: (action: 'start' | 'finish' | 'no_show' | 'cancel') => void
  onCheckout: () => void
}) {
  const minutes = appt.duration_minutes ?? appt.total_minutes
  const startMs = Date.parse(appt.start_time)
  const endIso = Number.isNaN(startMs) ? appt.start_time : new Date(startMs + minutes * 60_000).toISOString()
  const dateText = dayLabel(apptDateKey(appt.start_time), businessTodayISODate())

  const overdue = isApptOverdue(
    { status: appt.status, start_time: appt.start_time, duration_minutes: minutes },
    businessWallNowMs(),
  )
  const actions = availableApptActions(appt.status, isAdmin)

  const hasPhone = !isPlaceholderPhone(appt.customer_phone)
  const wa = hasPhone ? whatsappUrl(appt.customer_phone) : null
  const price = appt.service_price ?? 0
  const products = appt.products_count ?? 0
  const notes = appt.notes?.trim()

  return (
    <div className="flex flex-col gap-4 pt-1">
      {/* Cliente y estado */}
      <div className="space-y-2">
        <h3 className="text-xl font-bold text-xinuco-text break-words">{appt.customer_name}</h3>
        <div className="flex flex-wrap gap-2">
          <span
            className={`badge text-xs font-bold uppercase tracking-wider ${statusTone(appt.status, overdue)}`}
            style={{ background: 'color-mix(in srgb, currentColor 10%, transparent)' }}
          >
            {apptStatusLabel(appt.status, isAdmin)}
          </span>
          {overdue && (
            <span
              className="badge text-xs font-bold uppercase tracking-wider text-amber-400"
              style={{ background: 'color-mix(in srgb, currentColor 14%, transparent)' }}
            >
              Atrasada
            </span>
          )}
        </div>
      </div>

      {/* Teléfono */}
      {hasPhone && (
        <div className="space-y-2">
          <p className="text-sm text-xinuco-muted">{appt.customer_phone}</p>
          <div className="grid grid-cols-2 gap-2">
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-11 inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-sm font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              >
                <MessageCircle size={16} aria-hidden="true" />
                WhatsApp
              </a>
            ) : (
              <span aria-hidden="true" />
            )}
            <a
              href={`tel:${cleanPhone(appt.customer_phone as string)}`}
              className="min-h-11 inline-flex items-center justify-center gap-1.5 rounded-xl border border-xinuco-border text-sm font-semibold text-xinuco-text hover:border-[var(--primary-color)] transition-colors"
            >
              <Phone size={16} aria-hidden="true" />
              Llamar
            </a>
          </div>
        </div>
      )}

      {/* Servicio, horario y precio */}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-xl border border-xinuco-border p-3 text-sm">
        <dt className="text-xinuco-muted">Servicio</dt>
        <dd className="text-right font-medium text-xinuco-text">{appt.service_name}</dd>
        <dt className="text-xinuco-muted">Fecha</dt>
        <dd className="text-right font-medium text-xinuco-text">{dateText}</dd>
        <dt className="text-xinuco-muted">Hora</dt>
        <dd className="text-right font-medium text-xinuco-text">{formatApptTime(appt.start_time)} – {formatApptTime(endIso)}</dd>
        <dt className="text-xinuco-muted">Duración</dt>
        <dd className="text-right font-medium text-xinuco-text">{minutes} min</dd>
        {price > 0 && (
          <>
            <dt className="text-xinuco-muted">Precio</dt>
            <dd className="text-right font-semibold text-xinuco-text">{COP.format(price)}</dd>
          </>
        )}
      </dl>

      {notes && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-xinuco-muted">Notas</p>
          <p className="whitespace-pre-wrap break-words rounded-xl border border-xinuco-border p-3 text-sm text-xinuco-text">{notes}</p>
        </div>
      )}

      {products > 0 && (
        <p className="text-sm text-xinuco-muted">
          {products} {products === 1 ? 'producto apartado' : 'productos apartados'}
        </p>
      )}

      {error && (
        <p className="rounded-xl border border-amber-900/30 bg-amber-950/20 p-3 text-xs text-amber-400" role="alert">
          {error}
        </p>
      )}

      {/* Acciones (mismas reglas que la tarjeta de la lista) */}
      {actions.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {actions.includes('start') && (
            <button
              type="button"
              onClick={() => onAction('start')}
              disabled={isPending}
              className={`${ACTION_BTN} col-span-2 bg-[var(--primary-color)] text-black`}
            >
              {isUpdating ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Play size={14} fill="black" aria-hidden="true" />}
              Iniciar
            </button>
          )}
          {actions.includes('finish') && (
            <button
              type="button"
              onClick={() => onAction('finish')}
              disabled={isPending}
              className={`${ACTION_BTN} col-span-2 bg-emerald-500 text-black`}
            >
              {isUpdating ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
              Terminar cita
            </button>
          )}
          {actions.includes('checkout') && (
            <button
              type="button"
              onClick={onCheckout}
              disabled={isPending}
              className={`${ACTION_BTN} col-span-2 bg-amber-400 text-black`}
            >
              <ArrowRight size={16} strokeWidth={2.5} aria-hidden="true" />
              Cobrar
            </button>
          )}
          {actions.includes('no_show') && (
            <button type="button" onClick={() => onAction('no_show')} disabled={isPending} className={SECONDARY_BTN}>
              No asistió
            </button>
          )}
          {actions.includes('cancel') && (
            <button
              type="button"
              onClick={() => onAction('cancel')}
              disabled={isPending}
              className={`${SECONDARY_BTN} hover:!text-red-400 hover:!border-red-500/40 ${actions.includes('no_show') ? '' : 'col-span-2'}`}
            >
              Cancelar cita
            </button>
          )}
        </div>
      )}
    </div>
  )
}
