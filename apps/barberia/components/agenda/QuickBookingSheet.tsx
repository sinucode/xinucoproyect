'use client'

// Reserva interna: el equipo agenda una cita sin abrir la reserva pública.
// Pasos en una sola hoja: cliente → servicio (los que hace el profesional) → fecha y hora
// (horarios libres reales, los mismos de la reserva en línea) → nota opcional → Agendar.
// Móvil = hoja inferior; escritorio = diálogo (ResponsiveSheet).
// Exportado para abrirlo desde otras pantallas (p. ej. el expediente de Clientes con `customer`).

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Loader2, Search, UserPlus, X } from 'lucide-react'
import { ResponsiveSheet } from '@/components/layout/ResponsiveSheet'
import { createCustomer } from '@/actions/crm'
import {
  createStaffAppointment,
  getQuickBookingContext,
  getQuickBookingOptions,
  searchQuickBookingCustomers,
  type BookingCustomer,
  type BookingService,
  type BookingStaff,
} from '@/actions/staff-booking'
import { businessTodayISODate, dayLabel } from '@/lib/agenda-time'
import { MAX_BOOKING_NOTES } from '@/lib/staff-booking'

export interface QuickBookingSheetProps {
  slug: string
  open: boolean
  onClose: () => void
  /** 'YYYY-MM-DD' (por defecto hoy) */
  initialDate?: string
  /** 'HH:MM': se preselecciona si sigue libre */
  initialTime?: string
  /** Profesional (solo lo respeta el admin; el barbero siempre agenda para sí mismo) */
  staffId?: string
  /** Cliente ya elegido (p. ej. desde su expediente) */
  customer?: { id: string; full_name: string; phone: string }
}

const LABEL = 'text-xs font-semibold uppercase tracking-wider text-xinuco-muted'
const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

export function QuickBookingSheet(props: QuickBookingSheetProps) {
  const { open, onClose } = props
  // El formulario se monta de nuevo cada vez que se abre (estado limpio)
  return (
    <ResponsiveSheet
      open={open}
      onClose={onClose}
      title="Nueva cita"
      subtitle="Agenda sin salir del panel"
    >
      <QuickBookingBody {...props} />
    </ResponsiveSheet>
  )
}

type CtxState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; isAdmin: boolean; staff: BookingStaff[] }

function QuickBookingBody({
  slug, onClose, initialDate, initialTime, staffId: staffIdProp, customer: customerProp,
}: QuickBookingSheetProps) {
  const todayKey = businessTodayISODate()
  const startDate = initialDate && initialDate >= todayKey ? initialDate : todayKey

  const [ctx, setCtx] = useState<CtxState>({ status: 'loading' })
  const [staffId, setStaffId] = useState('')

  // Cliente
  const [customer, setCustomer] = useState<BookingCustomer | null>(customerProp ?? null)
  const [mode, setMode] = useState<'search' | 'create'>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BookingCustomer[]>([])
  const [searching, setSearching] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')

  // Servicio, fecha y hora
  const [date, setDate] = useState(startDate)
  const [services, setServices] = useState<BookingService[]>([])
  const [serviceId, setServiceId] = useState('')
  const [slots, setSlots] = useState<string[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [time, setTime] = useState('')
  const [notes, setNotes] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<{ date: string; time: string } | null>(null)

  // Hora que vino prellenada: se aplica solo en la primera carga de horarios
  const pendingTime = useRef<string | undefined>(initialTime)

  // 1. Quién puede agendar y para quién
  useEffect(() => {
    let cancelled = false
    void getQuickBookingContext().then((res) => {
      if (cancelled) return
      if ('error' in res) return setCtx({ status: 'error', message: res.error })
      setCtx({ status: 'ready', isAdmin: res.isAdmin, staff: res.staff })
      const preferred = staffIdProp && res.staff.some((s) => s.id === staffIdProp) ? staffIdProp : null
      setStaffId(preferred ?? res.selfStaffId ?? res.staff[0]?.id ?? '')
    })
    return () => { cancelled = true }
  }, [staffIdProp])

  // 2. Servicios del profesional + horarios libres del día (se recalcula al cambiar profesional, fecha o servicio)
  const optionsRequest = useRef(0)
  useEffect(() => {
    if (ctx.status !== 'ready' || !staffId) return
    const id = ++optionsRequest.current
    setLoadingOptions(true)
    void getQuickBookingOptions(date, staffId, serviceId || null).then((res) => {
      if (id !== optionsRequest.current) return // llegó una respuesta más nueva
      setLoadingOptions(false)
      if ('error' in res) {
        setError(res.error)
        setSlots([])
        return
      }
      setError(null)
      setServices(res.services)
      if (serviceId && !res.services.some((s) => s.id === serviceId)) {
        setServiceId('')
        setSlots([])
        return
      }
      if (!serviceId && res.services.length === 1) setServiceId(res.services[0].id)
      setSlots(res.slots)
      setTime((prev) => {
        if (pendingTime.current && res.slots.includes(pendingTime.current)) {
          const t = pendingTime.current
          pendingTime.current = undefined
          return t
        }
        return res.slots.includes(prev) ? prev : ''
      })
    })
  }, [ctx.status, staffId, date, serviceId])

  // 3. Búsqueda de clientes (con pausa de 250 ms al escribir)
  const searchRequest = useRef(0)
  useEffect(() => {
    if (customer || mode !== 'search') return
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    const id = ++searchRequest.current
    setSearching(true)
    const t = setTimeout(() => {
      void searchQuickBookingCustomers(q).then((res) => {
        if (id !== searchRequest.current) return
        setSearching(false)
        setResults('error' in res ? [] : res.customers)
      })
    }, 250)
    return () => clearTimeout(t)
  }, [query, customer, mode])

  const phoneDigits = newPhone.replace(/\D/g, '')
  const newCustomerOk = mode === 'create' && newName.trim().length >= 2 && phoneDigits.length >= 7
  const customerOk = !!customer || newCustomerOk
  const canSubmit = customerOk && !!serviceId && !!time && !!staffId && !submitting

  function startCreate() {
    const q = query.trim()
    if (q && !newName && !newPhone) {
      if (/^[\d\s+()-]+$/.test(q)) setNewPhone(q)
      else setNewName(q)
    }
    setMode('create')
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setSubmitting(true)
    try {
      let chosen = customer
      if (!chosen) {
        const created = await createCustomer({ full_name: newName, phone: newPhone })
        if (created.error || !created.customerId) {
          setError(created.error ?? 'No se pudo crear el cliente.')
          return
        }
        // Si la cita falla después, el cliente ya existe: no crearlo otra vez al reintentar
        chosen = { id: created.customerId, full_name: newName.trim(), phone: newPhone.trim() }
        setCustomer(chosen)
      }

      const res = await createStaffAppointment({
        staffId,
        customerId: chosen.id,
        serviceId,
        date,
        time,
        notes,
      })
      if ('error' in res) {
        setError(res.error)
        // El horario pudo ocuparse: refrescar los libres
        void getQuickBookingOptions(date, staffId, serviceId).then((r) => {
          if (!('error' in r)) {
            setSlots(r.slots)
            setTime((prev) => (r.slots.includes(prev) ? prev : ''))
          }
        })
        return
      }
      setDone({ date, time })
    } catch {
      setError('Error inesperado. Intenta de nuevo.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Listo ──────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center" role="status">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: 'color-mix(in srgb, var(--primary-color) 15%, transparent)', color: 'var(--primary-color)' }}
        >
          <CheckCircle2 size={28} aria-hidden="true" />
        </span>
        <div>
          <p className="text-base font-bold text-xinuco-text">Cita agendada</p>
          <p className="mt-1 text-sm text-xinuco-muted">
            {customer?.full_name} · {dayLabel(done.date, todayKey)} a las {done.time}
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2">
          <Link
            href={`/${slug}/dashboard/appointments?date=${done.date}`}
            onClick={onClose}
            className="flex min-h-11 items-center justify-center rounded-xl border border-xinuco-border px-3 text-sm font-semibold text-xinuco-text"
          >
            Ver en la agenda
          </Link>
          <button type="button" onClick={onClose} className="btn-primary min-h-11">
            Listo
          </button>
        </div>
      </div>
    )
  }

  if (ctx.status === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-xinuco-muted">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Cargando…
      </div>
    )
  }
  if (ctx.status === 'error') {
    return (
      <div className="space-y-3 py-4">
        <p className="rounded-xl border border-amber-900/30 bg-amber-950/20 p-3 text-sm text-amber-400" role="alert">
          {ctx.message}
        </p>
        <button type="button" onClick={onClose} className="min-h-11 w-full rounded-xl border border-xinuco-border text-sm font-semibold text-xinuco-text">
          Cerrar
        </button>
      </div>
    )
  }

  const noServices = !loadingOptions && services.length === 0

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 pt-1">
      {/* Profesional (solo admin) */}
      {ctx.isAdmin && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="qb-staff" className={LABEL}>Profesional *</label>
          <select
            id="qb-staff"
            value={staffId}
            onChange={(e) => { setStaffId(e.target.value); setServiceId(''); setTime(''); pendingTime.current = undefined }}
            className="input-base min-h-11"
          >
            {ctx.staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
      )}

      {/* Cliente */}
      <div className="flex flex-col gap-2">
        <span className={LABEL}>Cliente *</span>
        {customer ? (
          <div className="flex items-center gap-3 rounded-xl border border-xinuco-border bg-xinuco-surface px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-xinuco-text">{customer.full_name}</p>
              <p className="text-xs text-xinuco-muted">{customer.phone}</p>
            </div>
            <button
              type="button"
              onClick={() => { setCustomer(null); setMode('search'); setQuery('') }}
              className="min-h-11 shrink-0 rounded-lg px-3 text-xs font-semibold text-xinuco-muted hover:text-xinuco-text"
            >
              Cambiar
            </button>
          </div>
        ) : (
          <>
            <div role="tablist" aria-label="Cliente" className="grid grid-cols-2 gap-2">
              {([
                { value: 'search', label: 'Buscar cliente', Icon: Search },
                { value: 'create', label: 'Cliente nuevo', Icon: UserPlus },
              ] as const).map(({ value, label, Icon }) => {
                const selected = mode === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => (value === 'create' ? startCreate() : setMode('search'))}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors"
                    style={selected ? {
                      borderColor: 'var(--primary-color)',
                      background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
                      color: 'var(--primary-color)',
                    } : { borderColor: 'var(--border-color)', color: 'var(--muted-color)' }}
                  >
                    <Icon size={14} aria-hidden="true" /> {label}
                  </button>
                )
              })}
            </div>

            {mode === 'search' ? (
              <div className="flex flex-col gap-2">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Nombre o celular"
                  aria-label="Buscar cliente por nombre o celular"
                  autoComplete="off"
                  className="input-base min-h-11"
                />
                {searching && (
                  <p className="flex items-center gap-2 text-xs text-xinuco-muted">
                    <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Buscando…
                  </p>
                )}
                {results.length > 0 && (
                  <ul className="flex flex-col gap-1.5" aria-label="Resultados">
                    {results.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => { setCustomer(c); setError(null) }}
                          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-xinuco-border bg-xinuco-surface px-3 py-2 text-left active:bg-white/[0.06]"
                        >
                          <span className="truncate text-sm font-medium text-xinuco-text">{c.full_name}</span>
                          <span className="shrink-0 text-xs text-xinuco-muted">{c.phone}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <p className="text-xs text-xinuco-muted">
                    Sin resultados.{' '}
                    <button type="button" onClick={startCreate} className="font-semibold text-xinuco-primary underline">
                      Crear cliente nuevo
                    </button>
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nombre completo"
                  aria-label="Nombre del cliente"
                  maxLength={120}
                  autoComplete="off"
                  className="input-base min-h-11"
                />
                <input
                  type="tel"
                  inputMode="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="Celular"
                  aria-label="Celular del cliente"
                  maxLength={20}
                  autoComplete="off"
                  className="input-base min-h-11"
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Servicio */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="qb-service" className={LABEL}>Servicio *</label>
        <select
          id="qb-service"
          value={serviceId}
          onChange={(e) => { setServiceId(e.target.value); setTime(''); pendingTime.current = undefined }}
          disabled={noServices}
          className="input-base min-h-11"
        >
          <option value="">{noServices ? 'Este profesional no tiene servicios' : 'Elige un servicio'}</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.duration_minutes} min{s.price_cop > 0 ? ` · ${COP.format(s.price_cop)}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Fecha */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="qb-date" className={LABEL}>Fecha *</label>
        <input
          id="qb-date"
          type="date"
          value={date}
          min={todayKey}
          onChange={(e) => {
            if (!e.target.value) return
            setDate(e.target.value)
            setTime('')
            pendingTime.current = undefined
          }}
          className="input-base min-h-11"
        />
      </div>

      {/* Hora */}
      <div className="flex flex-col gap-2">
        <span id="qb-time-label" className={LABEL}>Hora *</span>
        {!serviceId ? (
          <p className="text-xs text-xinuco-muted">Elige un servicio para ver los horarios libres.</p>
        ) : loadingOptions && slots.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-xinuco-muted">
            <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Buscando horarios…
          </p>
        ) : slots.length === 0 ? (
          <p className="rounded-xl border border-xinuco-border bg-xinuco-surface px-3 py-3 text-xs text-xinuco-muted">
            No hay horarios libres este día. Prueba con otra fecha.
          </p>
        ) : (
          <div role="radiogroup" aria-labelledby="qb-time-label" className="grid grid-cols-4 gap-2">
            {slots.map((s) => {
              const selected = s === time
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => { setTime(s); pendingTime.current = undefined }}
                  className="min-h-11 rounded-xl border text-sm font-semibold tabular-nums transition-colors"
                  style={selected ? {
                    borderColor: 'var(--primary-color)',
                    background: 'var(--primary-color)',
                    color: '#000',
                  } : { borderColor: 'var(--border-color)', color: 'var(--text-color)' }}
                >
                  {s}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Nota */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="qb-notes" className={LABEL}>Nota (opcional)</label>
        <textarea
          id="qb-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={MAX_BOOKING_NOTES}
          rows={2}
          placeholder="Ej: viene con su hijo"
          className="input-base min-h-11 resize-none"
        />
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-900/30 bg-amber-950/20 p-3 text-xs text-amber-400" role="alert">
          <X size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-xl border border-xinuco-border text-sm font-semibold text-xinuco-muted hover:text-xinuco-text"
        >
          Cancelar
        </button>
        <button type="submit" disabled={!canSubmit} className="btn-primary min-h-11 disabled:opacity-50">
          {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : 'Agendar'}
        </button>
      </div>
    </form>
  )
}
