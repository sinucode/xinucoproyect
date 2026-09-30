'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Loader2, Save, CheckCircle2, AlertCircle, Coins, Stamp, Info } from 'lucide-react'
import { updateLoyaltySettings } from '@/actions/loyalty'
import {
  CASHBACK_WARN_PERCENT,
  cashbackPercent,
  describeRule,
  formatMoney,
  validateLoyaltyConfig,
  type LoyaltyConfig,
  type LoyaltyMode,
} from '@/lib/loyalty-utils'

interface LoyaltySettingsFormProps {
  initial: LoyaltyConfig
  slug:    string
}

export function LoyaltySettingsForm({ initial, slug }: LoyaltySettingsFormProps) {
  const [saved, setSaved]         = useState<LoyaltyConfig>(initial)
  const [mode, setMode]           = useState<LoyaltyMode>(initial.loyalty_mode)
  const [earnPer, setEarnPer]     = useState(String(initial.loyalty_earn_per_cop))
  const [pointValue, setPointValue] = useState(String(initial.loyalty_point_value_cop))
  const [minRedeem, setMinRedeem] = useState(String(initial.loyalty_min_redeem_points))
  const [expiry, setExpiry]       = useState(String(initial.loyalty_expiry_months))
  const [stamps, setStamps]       = useState(String(initial.loyalty_stamps_required))
  const [stampCap, setStampCap]   = useState(String(initial.loyalty_stamp_max_reward_cop))

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
  const cardStyle = { backgroundColor: '#111111', borderColor: 'var(--border-color)' }

  // Configuración en edición (los campos vacíos o inválidos quedan como NaN y no pasan la validación)
  const draft: LoyaltyConfig = {
    loyalty_mode:                 mode,
    loyalty_earn_per_cop:         Number(earnPer),
    loyalty_point_value_cop:      Number(pointValue),
    loyalty_min_redeem_points:    Number(minRedeem),
    loyalty_expiry_months:        Number(expiry),
    loyalty_stamps_required:      Number(stamps),
    loyalty_stamp_max_reward_cop: Number(stampCap),
  }
  const validation = validateLoyaltyConfig(draft)
  const liveError  = 'error' in validation ? validation.error : null

  const pct        = cashbackPercent(draft.loyalty_earn_per_cop, draft.loyalty_point_value_cop)
  const showPoints = Number.isFinite(pct) && draft.loyalty_earn_per_cop > 0 && draft.loyalty_point_value_cop > 0
  const tooGenerous = mode === 'points' && pct > CASHBACK_WARN_PERCENT && pct < 100
  const modeChanged = mode !== saved.loyalty_mode

  function touch() { setStatus('idle') }

  function handleSave() {
    setStatus('idle')
    const parsed = validateLoyaltyConfig(draft)
    if ('error' in parsed) {
      setStatus('error'); setStatusMsg(parsed.error)
      return
    }

    startTransition(async () => {
      const result = await updateLoyaltySettings(parsed.value)
      if (result.error) {
        setStatus('error'); setStatusMsg(result.error)
        return
      }
      if (result.settings) setSaved(result.settings)
      setStatus('success'); setStatusMsg('Configuración de lealtad guardada.')
    })
  }

  const modeCard = (value: LoyaltyMode, title: string, text: string, Icon: typeof Coins) => {
    const active = mode === value
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => { setMode(value); touch() }}
        className="flex flex-col gap-2 text-left rounded-2xl border p-4 transition-all"
        style={{
          backgroundColor: active ? 'color-mix(in srgb, var(--primary-color) 8%, transparent)' : '#111111',
          borderColor:     active ? 'var(--primary-color)' : 'var(--border-color)',
        }}
      >
        <span className="flex items-center gap-2.5">
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)' }}
          >
            <Icon size={17} style={{ color: 'var(--primary-color)' }} />
          </span>
          <span className="text-base font-bold text-xinuco-text">{title}</span>
        </span>
        <span className="text-xs text-xinuco-muted leading-relaxed">{text}</span>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Modo */}
      <div role="radiogroup" aria-label="Tipo de programa" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {modeCard('points', 'Puntos', 'Tus clientes acumulan puntos por lo que gastan y los usan como descuento', Coins)}
        {modeCard('stamps', 'Sellos', 'Cada N visitas, el siguiente servicio es gratis', Stamp)}
      </div>

      {modeChanged && (
        <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 text-amber-400 bg-amber-400/10">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>
            Los {saved.loyalty_mode === 'points' ? 'puntos' : 'sellos'} acumulados en el otro modo se conservan, pero no se
            muestran ni se pueden canjear mientras este modo esté activo.
          </span>
        </div>
      )}

      {/* Campos */}
      <div className="rounded-2xl border p-5 flex flex-col gap-5" style={cardStyle}>
        {mode === 'points' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="earn-per" className={labelCls}>Gana 1 punto por cada $</label>
              <input
                id="earn-per" type="number" inputMode="numeric" min={100} max={1000000} step={100}
                className={inputCls} style={inputStyle}
                value={earnPer} onChange={(e) => { setEarnPer(e.target.value); touch() }}
              />
              <p className="text-[11px] text-zinc-500">Entre $100 y $1.000.000</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="point-value" className={labelCls}>Cada punto vale $</label>
              <input
                id="point-value" type="number" inputMode="numeric" min={1} step={10}
                className={inputCls} style={inputStyle}
                value={pointValue} onChange={(e) => { setPointValue(e.target.value); touch() }}
              />
              <p className="text-[11px] text-zinc-500">Lo que descuenta cada punto al canjear</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="min-redeem" className={labelCls}>Mínimo para canjear (puntos)</label>
              <input
                id="min-redeem" type="number" inputMode="numeric" min={0} step={1}
                className={inputCls} style={inputStyle}
                value={minRedeem} onChange={(e) => { setMinRedeem(e.target.value); touch() }}
              />
              <p className="text-[11px] text-zinc-500">0 = sin mínimo</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="expiry" className={labelCls}>Vencen a los (meses)</label>
              <input
                id="expiry" type="number" inputMode="numeric" min={1} max={60} step={1}
                className={inputCls} style={inputStyle}
                value={expiry} onChange={(e) => { setExpiry(e.target.value); touch() }}
              />
              <p className="text-[11px] text-zinc-500">Entre 1 y 60. Se usan primero los puntos más viejos</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="stamps-required" className={labelCls}>Sellos para un servicio gratis</label>
              <input
                id="stamps-required" type="number" inputMode="numeric" min={2} max={50} step={1}
                className={inputCls} style={inputStyle}
                value={stamps} onChange={(e) => { setStamps(e.target.value); touch() }}
              />
              <p className="text-[11px] text-zinc-500">Entre 2 y 50. Cada visita pagada con un servicio suma 1 sello</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="stamp-cap" className={labelCls}>Tope del servicio gratis ($, 0 = sin tope)</label>
              <input
                id="stamp-cap" type="number" inputMode="numeric" min={0} step={1000}
                className={inputCls} style={inputStyle}
                value={stampCap} onChange={(e) => { setStampCap(e.target.value); touch() }}
              />
              <p className="text-[11px] text-zinc-500">Si el servicio cuesta más, el cliente paga la diferencia</p>
            </div>
          </div>
        )}

        {/* Resumen en vivo */}
        <div
          className="rounded-xl px-4 py-3 flex flex-col gap-1.5"
          style={{ backgroundColor: 'color-mix(in srgb, var(--primary-color) 6%, transparent)' }}
        >
          <p className="text-[11px] font-bold uppercase tracking-wider text-xinuco-muted">Así funciona</p>
          {!liveError ? (
            <p className="text-sm font-semibold text-xinuco-text">{describeRule(draft)}</p>
          ) : (
            <p className="text-sm text-xinuco-muted">Completa los campos para ver la regla.</p>
          )}
          {mode === 'points' && showPoints && !liveError && (
            <p className="text-xs text-xinuco-muted">
              Devuelves el {String(pct).replace('.', ',')}% de lo que gastan.
              {draft.loyalty_min_redeem_points > 0 &&
                ` Desde ${draft.loyalty_min_redeem_points} puntos (${formatMoney(draft.loyalty_min_redeem_points * draft.loyalty_point_value_cop)}).`}
            </p>
          )}
        </div>

        {tooGenerous && !liveError && (
          <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 text-amber-400 bg-amber-400/10">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>
              Estás devolviendo más del {CASHBACK_WARN_PERCENT}% de lo que gastan tus clientes. Revisa que el margen de tu
              negocio lo aguante.
            </span>
          </div>
        )}

        {liveError && (
          <div role="alert" className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 text-red-400 bg-red-400/10">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{liveError}</span>
          </div>
        )}
      </div>

      {status !== 'idle' && !(status === 'error' && statusMsg === liveError) && (
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

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          href={`/${slug}/dashboard/loyalty`}
          className="text-xs font-semibold text-xinuco-muted hover:text-xinuco-text transition-colors"
        >
          Ver el panel de lealtad
        </Link>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !!liveError}
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
