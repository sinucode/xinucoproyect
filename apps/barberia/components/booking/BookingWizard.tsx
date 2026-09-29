'use client'

import { useReducer, useTransition, useState, useMemo, useEffect } from 'react'
import {
  Check, ChevronLeft, AlertCircle, Loader2,
  Calendar, Clock, Scissors, User, Sparkles, Phone, QrCode, Package, Minus, Plus,
} from 'lucide-react'
import type { Service, ServiceAudience, Staff } from '@xinuco/types'
import { createBooking } from '@/actions/bookings'
import { getAvailableSlotsAction } from '@/actions/staff'
import { businessTodayISODate, addDaysToDateKey, businessNowHHMM } from '@/lib/agenda-time'
import { AUDIENCE_LABELS, servicesForAudience } from '@/lib/service-audience'
import { BookingPaymentStep } from '@/components/booking/BookingPaymentStep'

// ════════════════════════════════════════════════════════════════════════════════
// ESTADO CENTRALIZADO (useReducer)
// ════════════════════════════════════════════════════════════════════════════════

export type BookingStep = 1 | 2 | 3 | 4

interface BookingState {
  currentStep: BookingStep
  serviceId: string | null
  staffId: string | null       // 'any' = cualquier profesional
  date: string | null
  time: string | null
  slots: string[]
  isLoadingSlots: boolean
  userData: { name: string; phone: string; email: string }
  isConfirmed: boolean
}

type BookingAction =
  | { type: 'SET_SERVICE';       payload: string }
  | { type: 'SET_STAFF';         payload: string }
  | { type: 'SET_DATE';          payload: string }
  | { type: 'SET_SLOTS';         payload: string[] }
  | { type: 'SET_LOADING_SLOTS'; payload: boolean }
  | { type: 'SET_TIME';          payload: string }
  | { type: 'SET_USER_NAME';     payload: string }
  | { type: 'SET_USER_PHONE';    payload: string }
  | { type: 'SET_USER_EMAIL';    payload: string }
  | { type: 'GOTO_STEP';         payload: BookingStep }
  | { type: 'RESET_FROM_COLLISION' }
  | { type: 'CONFIRMED' }

const initialState: BookingState = {
  currentStep: 1,
  serviceId: null,
  staffId: null,
  date: null,
  time: null,
  slots: [],
  isLoadingSlots: false,
  userData: { name: '', phone: '', email: '' },
  isConfirmed: false,
}

function wizardReducer(state: BookingState, action: BookingAction): BookingState {
  switch (action.type) {
    case 'SET_SERVICE':
      return { ...state, serviceId: action.payload, currentStep: 2, time: null, date: null, slots: [] }
    case 'SET_STAFF':
      return { ...state, staffId: action.payload, currentStep: 3, time: null, date: null, slots: [] }
    case 'SET_DATE':
      return { ...state, date: action.payload, time: null }
    case 'SET_SLOTS':
      return { ...state, slots: action.payload, isLoadingSlots: false }
    case 'SET_LOADING_SLOTS':
      return { ...state, isLoadingSlots: action.payload }
    case 'SET_TIME':
      return { ...state, time: action.payload, currentStep: 4 }
    case 'SET_USER_NAME':
      return { ...state, userData: { ...state.userData, name: action.payload } }
    case 'SET_USER_PHONE':
      return { ...state, userData: { ...state.userData, phone: action.payload } }
    case 'SET_USER_EMAIL':
      return { ...state, userData: { ...state.userData, email: action.payload } }
    case 'GOTO_STEP':
      return { ...state, currentStep: action.payload }
    case 'RESET_FROM_COLLISION':
      return { ...state, time: null, currentStep: 3, slots: [] }
    case 'CONFIRMED':
      return { ...state, isConfirmed: true }
    default:
      return state
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ════════════════════════════════════════════════════════════════════════════════

/** Formatea precio a COP visual — 15000 → "$ 15.000" */
function formatCOP(price: number): string {
  return '$ ' + price.toLocaleString('es-CO')
}

/** Genera un arreglo de N fechas a partir de un desfase de días */
function getUpcomingDates(count: number, offsetDays: number = 0): { dateStr: string; dayName: string; dayNum: number; monthName: string; isToday: boolean }[] {
  // Fechas en la zona del negocio (no UTC): de noche en Colombia, toISOString()
  // ya es el día siguiente y la cita quedaba reservada un día después.
  const today = businessTodayISODate()
  const dates = []
  for (let i = 0; i < count; i++) {
    const dateStr = addDaysToDateKey(today, offsetDays + i)
    const d = new Date(`${dateStr}T00:00:00Z`)
    dates.push({
      dateStr,
      dayName: d.toLocaleDateString('es-CO', { weekday: 'short', timeZone: 'UTC' }),
      dayNum: d.getUTCDate(),
      monthName: d.toLocaleDateString('es-CO', { month: 'short', timeZone: 'UTC' }),
      isToday: offsetDays === 0 && i === 0,
    })
  }
  return dates
}

// ════════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL — BookingWizard
// ════════════════════════════════════════════════════════════════════════════════

/** Producto que el cliente puede apartar al reservar (RPC get_bookable_products). */
export interface BookableProduct {
  id:          string
  name:        string
  description: string | null
  unit_price:  number
  available:   number
}

export interface BookableProducts {
  enabled:   boolean
  max_units: number
  items:     BookableProduct[]
}

interface BookingWizardProps {
  businessId:       string
  services:         Service[]
  staff:            Staff[]
  mpBookingEnabled?: boolean
  bookableProducts?: BookableProducts
  /** servicio → barberos que lo hacen (get_public_service_staff). Sin entrada = todos. */
  serviceStaff?:    Record<string, string[]>
  /** Públicos que atiende el negocio. Con más de uno, el cliente elige para quién es la cita. */
  audiences?:       ServiceAudience[]
}

export function BookingWizard({ businessId, services, staff, mpBookingEnabled = false, bookableProducts, serviceStaff, audiences = ['men'] }: BookingWizardProps) {
  const [state, dispatch] = useReducer(wizardReducer, initialState)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [weekOffset, setWeekOffset] = useState(0)
  // 'form' = mostrar formulario normal | 'mp_payment' = mostrar paso de pago MP
  const [paymentStep, setPaymentStep] = useState<'form' | 'mp_payment'>('form')
  // Productos apartados: item_id → cantidad (0 = no apartar)
  const [productQty, setProductQty] = useState<Record<string, number>>({})
  // Público elegido (solo si el negocio atiende más de uno)
  const [audience, setAudience] = useState<ServiceAudience | null>(null)
  const multiAudience = audiences.length > 1

  useEffect(() => {
    // Breve timeout para mostrar el esqueleto (Zero-Flicker UX effect)
    const t = setTimeout(() => setIsMounted(true), 300)
    return () => clearTimeout(t)
  }, [])

  const upcomingDates = useMemo(() => getUpcomingDates(7, weekOffset * 7), [weekOffset])

  // ── Resolver nombres para los resúmenes ──────────────────────────────────
  const selectedService = services.find(s => s.id === state.serviceId)
  const visibleServices = multiAudience
    ? (audience ? servicesForAudience(services, audience) : [])
    : services
  const step1Summary = selectedService
    ? (multiAudience && audience ? `${AUDIENCE_LABELS[audience].singular} · ${selectedService.name}` : selectedService.name)
    : undefined
  const selectedStaff = state.staffId === 'any'
    ? null
    : staff.find(s => s.id === state.staffId)

  // ── Productos apartables ─────────────────────────────────────────────────
  const productsEnabled = !!bookableProducts?.enabled && (bookableProducts?.items.length ?? 0) > 0
  const maxUnits = bookableProducts?.max_units ?? 0
  const productItems = productsEnabled ? bookableProducts!.items : []
  const totalUnits = productItems.reduce((sum, p) => sum + (productQty[p.id] ?? 0), 0)
  const selectedProducts = productItems
    .filter((p) => (productQty[p.id] ?? 0) > 0)
    .map((p) => ({ item_id: p.id, name: p.name, unit_price: p.unit_price, quantity: productQty[p.id] }))
  const productsTotal = selectedProducts.reduce((sum, p) => sum + p.unit_price * p.quantity, 0)

  const changeProductQty = (item: BookableProduct, delta: number) => {
    setProductQty((prev) => {
      const current = prev[item.id] ?? 0
      const next = current + delta
      if (next < 0 || next > item.available) return prev
      if (delta > 0 && totalUnits + delta > maxUnits) return prev
      return { ...prev, [item.id]: next }
    })
  }

  // ── Cargar slots al elegir fecha ─────────────────────────────────────────
  const handleDateSelect = async (selectedDate: string) => {
    dispatch({ type: 'SET_DATE', payload: selectedDate })
    if (!state.serviceId) return

    dispatch({ type: 'SET_LOADING_SLOTS', payload: true })
    try {
      // Duración total = servicio + buffer de limpieza (buffer_time_minutes)
      // El RPC usa este valor para bloquear el hueco completo e impedir citas encimadas
      const duration = (selectedService?.duration_minutes || 30)
                     + (selectedService?.buffer_time_minutes || 0)

      const finalStaffId = state.staffId === 'any' ? null : state.staffId

      // Con serviceId se usa get_available_slots_v2 (soporta "cualquiera" y buffer)
      const res = await getAvailableSlotsAction(businessId, finalStaffId, selectedDate, duration, state.serviceId)
      
      let finalSlots = res.slots || []
      
      // Filtrar horas pasadas si la cita es para HOY (hora del negocio)
      if (selectedDate === businessTodayISODate()) {
        const nowHHMM = businessNowHHMM()
        finalSlots = finalSlots.filter((slot: string) => slot >= nowHHMM)
      }

      dispatch({ type: 'SET_SLOTS', payload: finalSlots })
    } catch {
      dispatch({ type: 'SET_SLOTS', payload: [] })
    }
  }

  // ── Confirmar la reserva ─────────────────────────────────────────────────
  const handleConfirm = () => {
    if (!state.serviceId || !state.date || !state.time) return
    if (!state.userData.name.trim() || !state.userData.phone.trim()) return

    setError(null)

    startTransition(async () => {
      try {
        const res = await createBooking({
          business_id: businessId,
          staff_id: state.staffId,
          service_id: state.serviceId as string,
          start_time: `${state.date}T${state.time}:00Z`,
          full_name: state.userData.name,
          phone: state.userData.phone,
          email: (state.userData.email || '').trim() ? state.userData.email : null,
          products: selectedProducts.map(({ item_id, quantity }) => ({ item_id, quantity })),
        })

        if (res.error) {
          if (res.error === 'collision') {
            setError('¡Uy! Alguien se te adelantó. Este horario acaba de ser ocupado.')
            dispatch({ type: 'RESET_FROM_COLLISION' })
            if (state.date) handleDateSelect(state.date)
          } else {
            setError(res.message || 'Ocurrió un error al agendar tu cita.')
          }
          return
        }

        dispatch({ type: 'CONFIRMED' })
      } catch {
        setError('Error inesperado de red. Intenta de nuevo.')
      }
    })
  }

  // ── Iniciar flujo de pago online con MP ──────────────────────────────────
  function handlePayWithMP() {
    if (!state.userData.name.trim() || !state.userData.phone.trim()) return
    setError(null)
    setPaymentStep('mp_payment')
  }

  // ── Pantalla de confirmación exitosa ──────────────────────────────────────
  if (state.isConfirmed) {
    return (
      <div className="max-w-md mx-auto flex flex-col items-center text-center py-16 px-4 animate-fade-in">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mb-6 shadow-lg"
          style={{ background: 'var(--primary-color)' }}
        >
          <Check size={36} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold text-xinuco-text mb-2">¡Cita Confirmada!</h2>
        <p className="text-sm text-xinuco-muted leading-relaxed">
          Tu cita con <strong className="text-xinuco-text">{selectedStaff?.full_name || 'tu profesional'}</strong> para{' '}
          <strong className="text-xinuco-text">{selectedService?.name}</strong> el{' '}
          <strong className="text-xinuco-text">{state.date}</strong> a las{' '}
          <strong style={{ color: 'var(--primary-color)' }}>{state.time}</strong> ha sido agendada con éxito.
        </p>
        {selectedProducts.length > 0 && (
          <div className="mt-5 w-full max-w-sm rounded-2xl border border-xinuco-border bg-xinuco-surface/40 p-4 text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-xinuco-muted mb-2">Te guardamos</p>
            <ul className="space-y-1.5">
              {selectedProducts.map((p) => (
                <li key={p.item_id} className="flex justify-between gap-3 text-sm">
                  <span className="text-xinuco-text">{p.quantity} × {p.name}</span>
                  <span className="text-xinuco-muted tabular-nums">{formatCOP(p.unit_price * p.quantity)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t border-xinuco-border flex justify-between text-sm">
              <span className="text-xinuco-muted">Total a pagar en el local</span>
              <strong className="tabular-nums" style={{ color: 'var(--primary-color)' }}>
                {formatCOP((selectedService?.price_cop ?? 0) + productsTotal)}
              </strong>
            </div>
            <p className="text-[11px] text-xinuco-muted mt-2">Los productos quedan apartados hasta el día de tu cita.</p>
          </div>
        )}
        <p className="text-xs text-xinuco-muted mt-4 opacity-60">Te contactaremos por WhatsApp si hay algún cambio.</p>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3 max-w-xl mx-auto w-full">
      {/* Error de colisión */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-3 animate-fade-in">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────
          PASO 1: ¿Qué te harás?
          ──────────────────────────────────────────────────────────────────── */}
      <StepAccordion
        step={1}
        currentStep={state.currentStep}
        title="¿Qué te harás?"
        icon={<Scissors size={14} />}
        summary={step1Summary}
        onGoBack={() => dispatch({ type: 'GOTO_STEP', payload: 1 })}
      >
        <div className="flex flex-col gap-3 px-1 pb-2">
          {isMounted && multiAudience && services.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-xinuco-text">¿Para quién es la cita?</p>
              <div className="flex flex-wrap gap-2">
                {audiences.map(a => {
                  const selected = audience === a
                  return (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setAudience(a)}
                      className="px-4 py-2 rounded-xl text-sm font-semibold border transition-all duration-200 active:scale-95"
                      style={selected ? {
                        background: 'var(--primary-color)',
                        color: 'var(--bg-color)',
                        borderColor: 'var(--primary-color)',
                      } : {
                        background: 'var(--surface-color, rgba(255,255,255,0.03))',
                        color: 'var(--text-color, inherit)',
                        borderColor: 'var(--border-color)',
                      }}
                    >
                      {AUDIENCE_LABELS[a].singular}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {!isMounted ? (
            // Skeleton de carga parpadeante (Premium Minimalist)
            <>
              {[1, 2, 3].map((i) => (
                <div 
                  key={i} 
                  className="w-full rounded-2xl border animate-pulse flex flex-col p-4 gap-3"
                  style={{
                    background: 'var(--surface-color, rgba(255,255,255,0.02))',
                    borderColor: 'var(--border-color)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-white/5 shrink-0" />
                    <div className="flex flex-col gap-2 flex-1">
                      <div className="h-4 w-3/4 bg-white/10 rounded" />
                      <div className="h-3 w-1/2 bg-white/5 rounded" />
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-white/5">
                    <div className="h-4 w-1/4 bg-white/10 rounded" />
                    <div className="h-8 w-24 bg-white/10 rounded-lg" />
                  </div>
                </div>
              ))}
            </>
          ) : services.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-xinuco-muted gap-2 border rounded-2xl" style={{ borderColor: 'var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.02))' }}>
              <Scissors size={28} className="opacity-40" />
              <p className="text-sm font-medium">No hay servicios disponibles</p>
              <p className="text-xs opacity-60">Pronto agregaremos nuestro catálogo.</p>
            </div>
          ) : multiAudience && !audience ? (
            <p className="text-xs text-xinuco-muted opacity-70 px-1">
              Elige para quién es la cita para ver los servicios.
            </p>
          ) : visibleServices.length === 0 ? (
            <p className="text-sm text-xinuco-muted px-1">
              No hay servicios para {audience ? AUDIENCE_LABELS[audience].plural : 'este público'} por ahora.
            </p>
          ) : (
            visibleServices.map(svc => (
              <div
                key={svc.id}
                className="flex flex-col p-4 rounded-2xl border transition-all duration-300 hover:scale-[1.01] group"
                style={{
                  background: 'var(--surface-color, rgba(255,255,255,0.03))',
                  borderColor: 'var(--border-color)',
                }}
              >
                {/* Cabecera del Servicio */}
                <div className="flex items-start gap-4">
                  {/* Imagen (Placeholder elegante) */}
                  <div 
                    className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0 border"
                    style={{ 
                      background: 'color-mix(in srgb, var(--primary-color) 10%, transparent)',
                      borderColor: 'color-mix(in srgb, var(--primary-color) 20%, transparent)',
                    }}
                  >
                    <Sparkles size={20} style={{ color: 'var(--primary-color)' }} />
                  </div>
                  
                  {/* Detalles */}
                  <div className="flex flex-col flex-1 min-w-0 pt-0.5">
                    <h3 className="text-base font-semibold text-xinuco-text group-hover:text-[var(--primary-color)] transition-colors truncate">
                      {svc.name}
                    </h3>
                    <p className="text-xs text-xinuco-muted mt-1 line-clamp-2 leading-relaxed opacity-80">
                      {svc.description || 'Servicio profesional premium.'}
                    </p>
                  </div>
                </div>

                {/* Footer del Servicio (Duración, Precio y Botón) */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t" style={{ borderColor: 'color-mix(in srgb, var(--border-color) 50%, transparent)' }}>
                  <div className="flex flex-col">
                    <span className="text-xs text-xinuco-muted flex items-center gap-1.5 font-medium">
                      <Clock size={12} />
                      {svc.duration_minutes} min
                    </span>
                    <span className="text-lg font-bold tabular-nums mt-0.5" style={{ color: 'var(--primary-color)' }}>
                      {formatCOP(svc.price_cop)}
                    </span>
                  </div>

                  <button
                    onClick={() => dispatch({ type: 'SET_SERVICE', payload: svc.id })}
                    className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 active:scale-95 flex items-center gap-2"
                    style={{
                      background: 'var(--primary-color)',
                      color: 'var(--bg-color)',
                      boxShadow: '0 4px 15px color-mix(in srgb, var(--primary-color) 25%, transparent)',
                    }}
                  >
                    Seleccionar
                    <ChevronLeft size={14} className="rotate-180" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </StepAccordion>

      {/* ────────────────────────────────────────────────────────────────────
          PASO 2: ¿Con quién?
          ──────────────────────────────────────────────────────────────────── */}
      <StepAccordion
        step={2}
        currentStep={state.currentStep}
        title="¿Con quién?"
        icon={<User size={14} />}
        summary={state.staffId === 'any' ? 'Cualquier profesional' : selectedStaff?.full_name}
        onGoBack={() => dispatch({ type: 'GOTO_STEP', payload: 2 })}
      >
        <div className="grid grid-cols-2 gap-3 px-1 pb-2">
          {/* Tarjeta "Cualquiera" */}
          <button
            onClick={() => dispatch({ type: 'SET_STAFF', payload: 'any' })}
            className="flex flex-col items-center justify-center gap-2.5 p-5 rounded-2xl border transition-all duration-200 active:scale-[0.97]"
            style={{
              background: 'var(--surface-color, rgba(255,255,255,0.03))',
              borderColor: 'var(--border-color)',
            }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)' }}
            >
              <Sparkles size={20} style={{ color: 'var(--primary-color)' }} />
            </div>
            <span className="text-sm font-semibold text-xinuco-text">Cualquiera</span>
            <span className="text-[10px] text-xinuco-muted -mt-1">Máx. disponibilidad</span>
          </button>

          {/* Tarjetas del Staff (solo quienes hacen el servicio elegido) */}
          {staff
            .filter(st => {
              const allowed = state.serviceId ? serviceStaff?.[state.serviceId] : undefined
              return !allowed || allowed.includes(st.id)
            })
            .map(st => {
            const initials = st.full_name
              .split(' ')
              .map(n => n[0])
              .join('')
              .substring(0, 2)
              .toUpperCase()

            return (
              <button
                key={st.id}
                onClick={() => dispatch({ type: 'SET_STAFF', payload: st.id })}
                className="flex flex-col items-center justify-center gap-2.5 p-5 rounded-2xl border transition-all duration-200 active:scale-[0.97]"
                style={{
                  background: 'var(--surface-color, rgba(255,255,255,0.03))',
                  borderColor: 'var(--border-color)',
                }}
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm tracking-widest"
                  style={{
                    background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
                    color: 'var(--primary-color)',
                  }}
                >
                  {initials}
                </div>
                <span className="text-sm font-semibold text-xinuco-text line-clamp-1">{st.full_name}</span>
                <span className="text-[10px] text-xinuco-muted capitalize -mt-1">{st.specialty_role}</span>
              </button>
            )
          })}
        </div>
      </StepAccordion>

      {/* ────────────────────────────────────────────────────────────────────
          PASO 3: Fecha y Hora
          ──────────────────────────────────────────────────────────────────── */}
      <StepAccordion
        step={3}
        currentStep={state.currentStep}
        title="¿Cuándo?"
        icon={<Calendar size={14} />}
        summary={state.date && state.time ? `${state.date} · ${state.time}` : undefined}
        onGoBack={() => dispatch({ type: 'GOTO_STEP', payload: 3 })}
      >
        <div className="flex flex-col gap-5 px-1 pb-2">
          {/* Controles de Navegación Semanal */}
          <div className="flex justify-between items-center px-1">
            <button 
              onClick={() => setWeekOffset(w => Math.max(0, w - 1))}
              disabled={weekOffset === 0}
              className="p-1.5 rounded-lg border transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
              style={{ borderColor: 'var(--border-color)', color: 'var(--xinuco-text)', background: 'var(--surface-color, rgba(255,255,255,0.02))' }}
              title="Semana anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-[10px] font-bold uppercase tracking-widest text-xinuco-muted">
              {weekOffset === 0 ? 'Esta Semana' : weekOffset === 1 ? 'Próxima Semana' : `En ${weekOffset} Semanas`}
            </span>
            <button 
              onClick={() => setWeekOffset(w => w + 1)}
              disabled={weekOffset >= 4} // Máx 4 semanas a futuro
              className="p-1.5 rounded-lg border transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
              style={{ borderColor: 'var(--border-color)', color: 'var(--xinuco-text)', background: 'var(--surface-color, rgba(255,255,255,0.02))' }}
              title="Siguiente semana"
            >
              <ChevronLeft size={16} className="rotate-180" />
            </button>
          </div>

          {/* Selector Horizontal de Fechas */}
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
            {upcomingDates.map(d => {
              const isSelected = state.date === d.dateStr
              return (
                <button
                  key={d.dateStr}
                  onClick={() => handleDateSelect(d.dateStr)}
                  className="flex flex-col items-center justify-center min-w-[64px] py-3 px-2 rounded-2xl border transition-all duration-200 shrink-0 active:scale-[0.95]"
                  style={{
                    background: isSelected ? 'var(--primary-color)' : 'var(--surface-color, rgba(255,255,255,0.03))',
                    borderColor: isSelected ? 'var(--primary-color)' : 'var(--border-color)',
                    color: isSelected ? 'var(--bg-color)' : undefined,
                  }}
                >
                  <span className={`text-[10px] uppercase font-bold ${isSelected ? '' : 'text-xinuco-muted'}`}>
                    {d.isToday ? 'Hoy' : d.dayName}
                  </span>
                  <span className={`text-xl font-bold leading-tight mt-0.5 ${isSelected ? '' : 'text-xinuco-text'}`}>
                    {d.dayNum}
                  </span>
                  <span className={`text-[9px] uppercase ${isSelected ? 'opacity-70' : 'text-xinuco-muted'}`}>
                    {d.monthName}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Cuadrícula de Horas (Slots) */}
          <div className="min-h-[120px]">
            {!state.date ? (
              <div className="flex flex-col items-center justify-center py-10 text-xinuco-muted gap-2 opacity-40">
                <Calendar size={28} />
                <p className="text-xs font-medium">Selecciona un día para ver horarios</p>
              </div>
            ) : state.isLoadingSlots ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Loader2 size={24} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
                <p className="text-xs text-xinuco-muted font-medium">Buscando disponibilidad…</p>
              </div>
            ) : state.slots.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-xinuco-muted gap-2">
                <Clock size={24} className="opacity-40" />
                <p className="text-sm font-medium">Sin horarios disponibles</p>
                <p className="text-xs opacity-60">Intenta con otro día o profesional.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {state.slots.map(slot => (
                  <button
                    key={slot}
                    onClick={() => dispatch({ type: 'SET_TIME', payload: slot })}
                    className="py-2.5 rounded-xl border text-sm font-semibold transition-all duration-200 active:scale-[0.95]"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--primary-color) 40%, transparent)',
                      color: 'var(--primary-color)',
                    }}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </StepAccordion>

      {/* ────────────────────────────────────────────────────────────────────
          PASO 4: Tus Datos (+ Pago si MP está habilitado)
          ──────────────────────────────────────────────────────────────────── */}
      <StepAccordion
        step={4}
        currentStep={state.currentStep}
        title="Tus Datos"
        icon={<Phone size={14} />}
        onGoBack={() => { setPaymentStep('form'); dispatch({ type: 'GOTO_STEP', payload: 4 }) }}
      >
        {/* ── Sub-paso: pago online con MercadoPago ─────────────────────── */}
        {paymentStep === 'mp_payment' && state.serviceId && state.date && state.time ? (
          <div className="px-1 pb-2 animate-fade-in">
            <BookingPaymentStep
              businessId={businessId}
              serviceId={state.serviceId}
              serviceName={selectedService?.name ?? ''}
              servicePriceCop={selectedService?.price_cop ?? 0}
              staffId={state.staffId === 'any' ? null : state.staffId}
              startTime={`${state.date}T${state.time}:00`}
              userData={state.userData}
              products={selectedProducts}
              onPaymentApproved={() => dispatch({ type: 'CONFIRMED' })}
              onBack={() => setPaymentStep('form')}
            />
          </div>
        ) : (
          /* ── Sub-paso: formulario de datos ─────────────────────────────── */
          <div className="flex flex-col gap-4 px-1 pb-2">
            {/* Resumen de la cita */}
            <div
              className="flex flex-col gap-2 p-4 rounded-2xl text-xs"
              style={{
                background: 'color-mix(in srgb, var(--primary-color) 6%, transparent)',
                border: '1px solid color-mix(in srgb, var(--primary-color) 15%, transparent)',
              }}
            >
              <div className="flex justify-between">
                <span className="text-xinuco-muted">Servicio</span>
                <span className="font-semibold text-xinuco-text">{selectedService?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xinuco-muted">Profesional</span>
                <span className="font-semibold text-xinuco-text">{selectedStaff?.full_name || 'Cualquiera'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xinuco-muted">Fecha</span>
                <span className="font-semibold text-xinuco-text">{state.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xinuco-muted">Hora</span>
                <span className="font-semibold" style={{ color: 'var(--primary-color)' }}>{state.time}</span>
              </div>
              {selectedProducts.map((p) => (
                <div key={p.item_id} className="flex justify-between">
                  <span className="text-xinuco-muted">Producto apartado</span>
                  <span className="font-semibold text-xinuco-text">
                    {p.quantity} × {p.name} · {formatCOP(p.unit_price * p.quantity)}
                  </span>
                </div>
              ))}
              {selectedService && (
                <div className="flex justify-between pt-1 mt-1" style={{ borderTop: '1px solid color-mix(in srgb, var(--primary-color) 15%, transparent)' }}>
                  <span className="text-xinuco-muted">Total</span>
                  <span className="font-bold" style={{ color: 'var(--primary-color)' }}>{formatCOP(selectedService.price_cop + productsTotal)}</span>
                </div>
              )}
            </div>

            {/* ── Productos apartados (opcional) ───────────────────────── */}
            {productsEnabled && (
              <div
                className="flex flex-col gap-3 p-4 rounded-2xl border"
                style={{
                  background: 'var(--surface-color, rgba(255,255,255,0.03))',
                  borderColor: 'var(--border-color)',
                }}
              >
                <div className="flex items-start gap-2.5">
                  <Package size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--primary-color)' }} />
                  <div className="flex flex-col">
                    <h3 className="text-sm font-semibold text-xinuco-text">¿Quieres apartar algún producto?</h3>
                    <p className="text-xs text-xinuco-muted mt-0.5">
                      Lo pagas en el local. Máximo {maxUnits} {maxUnits === 1 ? 'unidad' : 'unidades'} por cita.
                    </p>
                  </div>
                </div>

                <ul className="flex flex-col gap-2">
                  {productItems.map((item) => {
                    const qty = productQty[item.id] ?? 0
                    const canAdd = qty < item.available && totalUnits < maxUnits
                    return (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-3 py-2 border-t first:border-t-0"
                        style={{ borderColor: 'color-mix(in srgb, var(--border-color) 50%, transparent)' }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-xinuco-text truncate">{item.name}</p>
                          <p className="text-xs text-xinuco-muted flex items-center gap-2">
                            <span className="tabular-nums">{formatCOP(item.unit_price)}</span>
                            {/* available viene topado al máximo por cita: "pocas" solo si hay menos que ese tope */}
                            {item.available < maxUnits && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                Quedan pocas
                              </span>
                            )}
                          </p>
                        </div>
                        <div
                          className="flex items-center gap-1 rounded-xl border shrink-0"
                          style={{ borderColor: 'var(--border-color)' }}
                        >
                          <button
                            type="button"
                            onClick={() => changeProductQty(item, -1)}
                            disabled={qty <= 0}
                            aria-label={`Quitar una unidad de ${item.name}`}
                            className="p-2 text-xinuco-muted hover:text-xinuco-text disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Minus size={14} />
                          </button>
                          <span className="min-w-[1.5rem] text-center text-sm font-bold tabular-nums text-xinuco-text">{qty}</span>
                          <button
                            type="button"
                            onClick={() => changeProductQty(item, 1)}
                            disabled={!canAdd}
                            aria-label={`Agregar una unidad de ${item.name}`}
                            className="p-2 text-xinuco-muted hover:text-xinuco-text disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {/* Formulario */}
            <div className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Tu nombre completo"
                value={state.userData.name}
                onChange={(e) => dispatch({ type: 'SET_USER_NAME', payload: e.target.value })}
                className="input-base !py-4 !text-base"
                autoComplete="name"
              />
              <input
                type="tel"
                placeholder="WhatsApp (ej: 300 123 4567)"
                value={state.userData.phone}
                onChange={(e) => dispatch({ type: 'SET_USER_PHONE', payload: e.target.value })}
                className="input-base !py-4 !text-base"
                inputMode="tel"
                autoComplete="tel"
              />
              <input
                type="email"
                placeholder="Correo electrónico (Opcional)"
                value={state.userData.email || ''}
                onChange={(e) => dispatch({ type: 'SET_USER_EMAIL', payload: e.target.value })}
                className="input-base !py-4 !text-base"
                autoComplete="email"
              />
            </div>

            {/* ── CTAs de pago ──────────────────────────────────────────── */}
            {mpBookingEnabled ? (
              /* Dos opciones: pagar online o reservar y pagar en local */
              <div className="flex flex-col gap-2.5 mt-2">
                {/* Pagar ahora con MercadoPago */}
                <button
                  onClick={handlePayWithMP}
                  disabled={!state.userData.name.trim() || !state.userData.phone.trim()}
                  className="w-full py-4 rounded-2xl font-bold text-base flex justify-center items-center gap-2.5 transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: 'var(--primary-color)',
                    color: 'var(--bg-color, #080808)',
                    boxShadow: '0 0 30px color-mix(in srgb, var(--primary-color) 30%, transparent)',
                  }}
                >
                  <QrCode size={20} />
                  Pagar con MercadoPago
                </button>

                {/* Reservar y pagar en local */}
                <button
                  onClick={handleConfirm}
                  disabled={isPending || !state.userData.name.trim() || !state.userData.phone.trim()}
                  className="w-full py-3.5 rounded-2xl font-semibold text-sm flex justify-center items-center gap-2 transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--xinuco-text)' }}
                >
                  {isPending ? (
                    <><Loader2 size={16} className="animate-spin" /> Reservando…</>
                  ) : (
                    'Reservar y pagar en local'
                  )}
                </button>
              </div>
            ) : (
              /* Solo opción de pagar en local (MP desactivado) */
              <button
                onClick={handleConfirm}
                disabled={isPending || !state.userData.name.trim() || !state.userData.phone.trim()}
                className="w-full py-4 rounded-2xl font-bold text-lg flex justify-center items-center gap-2.5 transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed mt-2"
                style={{
                  background: 'var(--primary-color)',
                  color: 'var(--bg-color)',
                  boxShadow: '0 0 30px color-mix(in srgb, var(--primary-color) 30%, transparent)',
                }}
              >
                {isPending ? (
                  <><Loader2 size={20} className="animate-spin" /> Reservando…</>
                ) : (
                  'Confirmar Reserva'
                )}
              </button>
            )}
          </div>
        )}
      </StepAccordion>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP ACCORDION — Componente reutilizable para cada paso
// ════════════════════════════════════════════════════════════════════════════════

function StepAccordion({
  step,
  currentStep,
  title,
  icon,
  summary,
  onGoBack,
  children,
}: {
  step: BookingStep
  currentStep: BookingStep
  title: string
  icon: React.ReactNode
  summary?: string
  onGoBack: () => void
  children: React.ReactNode
}) {
  const isCompleted = currentStep > step
  const isActive = currentStep === step
  const isLocked = currentStep < step

  if (isLocked) return null

  return (
    <div className="animate-fade-in">
      {/* Header del paso */}
      <button
        type="button"
        className="flex items-center justify-between w-full px-4 py-3.5 rounded-2xl transition-all duration-200"
        style={{
          background: isActive
            ? 'color-mix(in srgb, var(--primary-color) 8%, transparent)'
            : 'transparent',
          border: isActive
            ? '1px solid color-mix(in srgb, var(--primary-color) 25%, transparent)'
            : '1px solid transparent',
        }}
        onClick={() => isCompleted && onGoBack()}
        disabled={!isCompleted}
      >
        <div className="flex items-center gap-3">
          {/* Indicador numérico */}
          <div
            className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-colors"
            style={{
              background: isCompleted
                ? '#22c55e'
                : isActive
                  ? 'var(--primary-color)'
                  : 'var(--surface-color, #1a1a1a)',
              color: isCompleted || isActive ? 'white' : 'var(--muted-color)',
            }}
          >
            {isCompleted ? <Check size={14} /> : icon}
          </div>

          <div className="flex flex-col text-left">
            <span className={`text-sm font-semibold ${isActive ? 'text-xinuco-text' : 'text-xinuco-muted'}`}>
              {title}
            </span>
            {isCompleted && summary && (
              <span className="text-xs font-medium" style={{ color: 'var(--primary-color)' }}>
                {summary}
              </span>
            )}
          </div>
        </div>

        {isCompleted && (
          <span className="text-[10px] text-xinuco-muted uppercase tracking-wider font-semibold">
            Cambiar
          </span>
        )}
      </button>

      {/* Contenido del paso */}
      {isActive && (
        <div className="mt-2 animate-slide-up">
          {children}
        </div>
      )}
    </div>
  )
}
