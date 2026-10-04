'use client'

import { useId, useState, useTransition } from 'react'
import { Loader2, Save, CheckCircle2, AlertCircle, Store, MapPin, Lock } from 'lucide-react'
import { updateBusinessProfile } from '@/actions/businesses'
import {
  BUSINESS_PROFILE_LIMITS as L,
  formatPhoneDisplay,
  isValidInstagram,
  isValidMapsUrl,
  isValidPhoneDigits,
  normalizeInstagram,
  normalizePhoneCO,
  type BusinessProfileInput,
} from '@/lib/business-profile'

const cardStyle = { backgroundColor: 'var(--card-color, #111111)', border: '1px solid var(--border-color)' } as const
const inputStyle = {
  backgroundColor: 'var(--bg-color)',
  borderColor:     'var(--border-color)',
  color:           'var(--text-color, #F4F4F4)',
} as const
const inputCls = 'w-full rounded-xl px-3 py-2.5 text-sm border outline-none transition-colors placeholder-zinc-600 disabled:opacity-50'
const labelCls = 'text-xs font-semibold text-zinc-400 uppercase tracking-wide'

function Field({
  label, hint, error, children,
}: { label: string; hint?: string; error?: string | null; children: (id: string) => React.ReactNode }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label htmlFor={id} className={labelCls}>{label}</label>
      {children(id)}
      {error
        ? <p className="text-[11px] text-red-400">{error}</p>
        : hint && <p className="text-[11px] text-zinc-500 break-words">{hint}</p>}
    </div>
  )
}

function SectionTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)' }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-zinc-100">{title}</h2>
        <p className="text-xs text-zinc-500">{subtitle}</p>
      </div>
    </div>
  )
}

export function BusinessProfileForm({ initial }: { initial: BusinessProfileInput }) {
  const [form, setForm] = useState<BusinessProfileInput>(initial)
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [statusMsg, setStatusMsg] = useState('')

  const set = (key: keyof BusinessProfileInput) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [key]: e.target.value }))
    setStatus('idle')
  }

  // Avisos en vivo (el servidor vuelve a validar todo)
  const wa = normalizePhoneCO(form.whatsapp)
  const ph = normalizePhoneCO(form.phone)
  const ig = normalizeInstagram(form.instagram)
  const waError = wa && !isValidPhoneDigits(wa) ? 'Debe tener entre 7 y 15 dígitos.' : null
  const phError = ph && !isValidPhoneDigits(ph) ? 'Debe tener entre 7 y 15 dígitos.' : null
  const igError = ig && !isValidInstagram(ig) ? 'Escribe solo tu usuario, por ejemplo @mibarberia.' : null
  const mapsError = form.maps_url.trim() && !isValidMapsUrl(form.maps_url.trim())
    ? 'Debe empezar por https:// (copia el enlace desde Google Maps).'
    : null
  const nameError = !form.name.trim() ? 'El nombre no puede estar vacío.' : null
  const hasError = Boolean(waError || phError || igError || mapsError || nameError)

  function handleSave() {
    if (hasError) {
      setStatus('error'); setStatusMsg('Revisa los campos marcados en rojo.')
      return
    }
    setStatus('idle')
    startTransition(async () => {
      const result = await updateBusinessProfile(form)
      if (result.error) {
        setStatus('error'); setStatusMsg(result.error)
      } else {
        setStatus('success'); setStatusMsg('Datos guardados.')
      }
    })
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── Tu negocio y contacto (público) ─────────────────────────────── */}
      <section className="rounded-2xl p-5 flex flex-col gap-5" style={cardStyle} aria-label="Datos públicos">
        <SectionTitle
          icon={<Store size={17} style={{ color: 'var(--primary-color)' }} />}
          title="Lo que ven tus clientes"
          subtitle="Se muestra en tu página de reservas y en los correos de confirmación."
        />

        <Field label="Nombre del negocio" error={nameError}>
          {id => (
            <input id={id} type="text" value={form.name} onChange={set('name')} maxLength={L.name}
              placeholder="Ej: Barbería El Patrón" className={inputCls} style={inputStyle} />
          )}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Dirección" hint="Calle, número y barrio.">
            {id => (
              <input id={id} type="text" value={form.address} onChange={set('address')} maxLength={L.address}
                placeholder="Ej: Calle 10 # 5-20, El Poblado" className={inputCls} style={inputStyle} />
            )}
          </Field>
          <Field label="Ciudad">
            {id => (
              <input id={id} type="text" value={form.city} onChange={set('city')} maxLength={L.city}
                placeholder="Ej: Medellín" className={inputCls} style={inputStyle} />
            )}
          </Field>
        </div>

        <Field
          label="Enlace de Google Maps"
          error={mapsError}
          hint="Abre tu negocio en Google Maps, toca Compartir y pega aquí el enlace. Aparece como “Cómo llegar”."
        >
          {id => (
            <input id={id} type="url" inputMode="url" value={form.maps_url} onChange={set('maps_url')}
              maxLength={L.mapsUrl} placeholder="https://maps.app.goo.gl/…" className={inputCls} style={inputStyle} />
          )}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="WhatsApp"
            error={waError}
            hint={wa && !waError ? `Se guardará como ${formatPhoneDisplay(wa)}. Tus clientes te escriben con un toque.` : 'Con o sin +57. Tus clientes te escriben con un toque.'}
          >
            {id => (
              <input id={id} type="tel" inputMode="tel" value={form.whatsapp} onChange={set('whatsapp')}
                maxLength={24} placeholder="Ej: 300 123 4567" className={inputCls} style={inputStyle} />
            )}
          </Field>
          <Field label="Teléfono fijo u otro" error={phError} hint="Opcional.">
            {id => (
              <input id={id} type="tel" inputMode="tel" value={form.phone} onChange={set('phone')}
                maxLength={24} placeholder="Ej: 604 444 1234" className={inputCls} style={inputStyle} />
            )}
          </Field>
        </div>

        <Field
          label="Instagram"
          error={igError}
          hint={ig && !igError ? `Se mostrará como instagram.com/${ig}` : 'Tu usuario (@mibarberia) o el enlace de tu perfil.'}
        >
          {id => (
            <input id={id} type="text" value={form.instagram} onChange={set('instagram')} maxLength={120}
              autoCapitalize="none" autoCorrect="off" placeholder="@mibarberia" className={inputCls} style={inputStyle} />
          )}
        </Field>
      </section>

      {/* ── Privado ───────────────────────────────────────────────────────── */}
      <section className="rounded-2xl p-5 flex flex-col gap-5" style={cardStyle} aria-label="Datos privados">
        <SectionTitle
          icon={<Lock size={17} style={{ color: 'var(--primary-color)' }} />}
          title="Para facturación y tu contador (privado)"
          subtitle="Estos datos nunca se muestran a tus clientes."
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="NIT o cédula" hint="Ej: 900.123.456-7">
            {id => (
              <input id={id} type="text" value={form.tax_id} onChange={set('tax_id')} maxLength={L.taxId}
                placeholder="900.123.456-7" className={inputCls} style={inputStyle} />
            )}
          </Field>
          <Field label="Razón social" hint="El nombre legal, si es distinto al del negocio.">
            {id => (
              <input id={id} type="text" value={form.legal_name} onChange={set('legal_name')} maxLength={L.legalName}
                placeholder="Ej: El Patrón S.A.S." className={inputCls} style={inputStyle} />
            )}
          </Field>
        </div>
      </section>

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

      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500 min-w-0">
          <MapPin size={12} className="shrink-0" />
          <span>Lo que dejes vacío no se muestra.</span>
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl transition-all disabled:opacity-50 shrink-0"
          style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
        >
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Guardar
        </button>
      </div>
    </div>
  )
}
