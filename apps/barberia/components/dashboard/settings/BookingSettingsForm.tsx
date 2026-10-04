'use client'

import { useState, useTransition } from 'react'
import { Loader2, Save, CheckCircle2, AlertCircle, ShoppingBag, Clock } from 'lucide-react'
import { updateBookingSettings, type BookingSettingsInput } from '@/actions/businesses'
import { BOOKING_INTERVAL_OPTIONS, bookingIntervalLabel } from '@/lib/booking-settings'

interface BookingSettingsFormProps {
  initial: BookingSettingsInput
}

const MAX_LIMIT = 50

function clampInt(raw: string): number {
  const n = Math.floor(Number(raw))
  if (Number.isNaN(n)) return 0
  return Math.min(MAX_LIMIT, Math.max(0, n))
}

export function BookingSettingsForm({ initial }: BookingSettingsFormProps) {
  const [interval, setIntervalMinutes] = useState(initial.appointment_interval_minutes)
  const [enabled,  setEnabled]  = useState(initial.booking_products_enabled)
  const [maxUnits, setMaxUnits] = useState(String(initial.booking_max_product_units))
  const [maxOpen,  setMaxOpen]  = useState(String(initial.booking_max_open_with_products_per_phone))

  const [isPending, startTransition] = useTransition()
  const [status, setStatus]       = useState<'idle' | 'success' | 'error'>('idle')
  const [statusMsg, setStatusMsg] = useState('')

  const inputCls = 'w-full rounded-xl px-3 py-2.5 text-sm border outline-none transition-colors placeholder-zinc-600'
  const inputStyle = {
    backgroundColor: 'var(--bg-color)',
    borderColor:     'var(--border-color)',
    color:           'var(--text-color, #F4F4F4)',
  }
  const labelCls = 'text-xs font-semibold text-zinc-400 uppercase tracking-wide'

  function handleSave() {
    setStatus('idle')

    const units = Number(maxUnits)
    const open  = Number(maxOpen)
    if (!Number.isInteger(units) || units < 0 || units > MAX_LIMIT) {
      setStatus('error'); setStatusMsg(`El máximo de unidades debe ser un entero entre 0 y ${MAX_LIMIT}.`)
      return
    }
    if (!Number.isInteger(open) || open < 0 || open > MAX_LIMIT) {
      setStatus('error'); setStatusMsg(`El máximo de citas abiertas debe ser un entero entre 0 y ${MAX_LIMIT}.`)
      return
    }

    startTransition(async () => {
      const result = await updateBookingSettings({
        appointment_interval_minutes:             interval,
        booking_products_enabled:                 enabled,
        booking_max_product_units:                units,
        booking_max_open_with_products_per_phone: open,
      })
      if (result.error) {
        setStatus('error'); setStatusMsg(result.error)
      } else {
        setStatus('success'); setStatusMsg('Configuración guardada.')
      }
    })
  }

  return (
    <div
      className="rounded-2xl border p-5 flex flex-col gap-6"
      style={{ backgroundColor: 'var(--card-color, #111111)', borderColor: 'var(--border-color)' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)' }}
        >
          <Clock size={17} style={{ color: 'var(--primary-color)' }} />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100">Intervalo entre horarios</h2>
          <p className="text-xs text-zinc-500">
            Cada cuánto se ofrece un horario al reservar (9:00, 9:30, 10:00…).
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="booking-interval" className={labelCls}>Horarios cada</label>
        <select
          id="booking-interval"
          value={interval}
          onChange={(e) => { setIntervalMinutes(Number(e.target.value)); setStatus('idle') }}
          className={inputCls}
          style={inputStyle}
        >
          {BOOKING_INTERVAL_OPTIONS.map((m) => (
            <option key={m} value={m}>{bookingIntervalLabel(m)}</option>
          ))}
        </select>
        <p className="text-[11px] text-zinc-500">
          Un intervalo corto ofrece más horarios; uno largo deja las citas más ordenadas.
        </p>
      </div>

      <div className="h-px w-full" style={{ backgroundColor: 'var(--border-color)' }} />

      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)' }}
        >
          <ShoppingBag size={17} style={{ color: 'var(--primary-color)' }} />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100">Productos apartados</h2>
          <p className="text-xs text-zinc-500">
            El cliente aparta al reservar y paga en el local. El stock solo baja al cobrar.
          </p>
        </div>
      </div>

      {/* Toggle */}
      <label className="flex items-center justify-between gap-4 cursor-pointer">
        <span className="text-sm font-medium text-zinc-200">
          Permitir apartar productos al reservar en línea
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(e) => { setEnabled(e.target.checked); setStatus('idle') }}
          className="h-5 w-5 rounded accent-[var(--primary-color)]"
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="max-units" className={labelCls}>Máximo de unidades por cita</label>
          <input
            id="max-units"
            type="number"
            min={0}
            max={MAX_LIMIT}
            step={1}
            className={inputCls}
            style={inputStyle}
            value={maxUnits}
            onChange={(e) => { setMaxUnits(e.target.value); setStatus('idle') }}
            onBlur={() => setMaxUnits(String(clampInt(maxUnits)))}
          />
          <p className="text-[11px] text-zinc-500">0 desactiva la función</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="max-open" className={labelCls}>
            Máximo de citas abiertas con productos por cliente (teléfono)
          </label>
          <input
            id="max-open"
            type="number"
            min={0}
            max={MAX_LIMIT}
            step={1}
            className={inputCls}
            style={inputStyle}
            value={maxOpen}
            onChange={(e) => { setMaxOpen(e.target.value); setStatus('idle') }}
            onBlur={() => setMaxOpen(String(clampInt(maxOpen)))}
          />
          <p className="text-[11px] text-zinc-500">0 = sin límite</p>
        </div>
      </div>

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
          Guardar cambios
        </button>
      </div>
    </div>
  )
}
