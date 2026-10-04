'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Check, AlertCircle, ImageOff, Moon, Sun } from 'lucide-react'
import { updateBusinessBranding } from '@/actions/businesses'
import type { Business, BusinessBranding, BrandConfig, ThemeMode } from '@xinuco/types'
import { THEME_PRESETS, resolveThemeMode, onPrimaryColor } from '@/lib/brand-theme'
import { CopyButton } from '@/components/ui/CopyButton'

// ── Constants ─────────────────────────────────────────────────────────────────

// Solo las fuentes que carga el layout del tenant (app/[slug]/layout.tsx). El valor es la llave
// en minúsculas que guarda brand_config.fontFamily; `css` solo es para la vista previa.
const FONT_OPTIONS = [
  { value: 'inter',    label: 'Inter',            css: 'var(--font-inter), Inter, sans-serif' },
  { value: 'playfair', label: 'Playfair Display', css: 'var(--font-playfair), "Playfair Display", serif' },
  { value: 'oswald',   label: 'Oswald',           css: 'var(--font-oswald), Oswald, sans-serif' },
] as const

/** Lleva cualquier valor guardado ("Playfair Display", "bebas"…) a una llave soportada (fallback: inter). */
function normalizeFontKey(raw?: string | null): string {
  const n = (raw ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  return FONT_OPTIONS.find(o => n.startsWith(o.value))?.value ?? 'inter'
}

const DEFAULT_BRANDING: BusinessBranding = {
  primary_color:   '#C5A059',
  secondary_color: '#1A1A1A',
  bg_color:        '#080808',
  text_color:      '#F4F4F4',
  logo_url:        null,
  font_family:     'inter',
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface BrandingFormProps {
  business: Pick<Business, 'id' | 'name' | 'slug' | 'branding'> & Partial<Pick<Business, 'brand_config'>>
  slug:     string
}

// ── Color Input Row ───────────────────────────────────────────────────────────

function ColorField({
  label,
  value,
  onChange,
  id,
}: {
  label:    string
  value:    string
  onChange: (v: string) => void
  id:       string
}) {
  // Sync text input → color picker, and vice-versa
  function handleTextChange(raw: string) {
    // Allow typing — validate on blur or save
    onChange(raw)
  }

  function handleColorPicker(hex: string) {
    onChange(hex.toUpperCase())
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
        {label}
      </label>
      <div className="flex items-center gap-3">
        {/* Color picker swatch */}
        <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0"
          style={{ border: '2px solid var(--border-color)' }}
        >
          <input
            type="color"
            value={value.match(/^#[0-9A-Fa-f]{6}$/) ? value : '#000000'}
            onChange={e => handleColorPicker(e.target.value)}
            className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
            aria-label={`Color picker: ${label}`}
          />
          <div
            className="w-full h-full"
            style={{ background: value }}
            aria-hidden="true"
          />
        </div>
        {/* Hex text input */}
        <input
          id={id}
          type="text"
          value={value}
          onChange={e => handleTextChange(e.target.value)}
          maxLength={9}
          placeholder="#000000"
          className="input-base flex-1 font-mono text-sm uppercase"
          style={{ letterSpacing: '0.05em' }}
        />
      </div>
    </div>
  )
}

// ── Live Preview ──────────────────────────────────────────────────────────────

function BrandPreview({
  name,
  primary,
  secondary,
  bg,
  textColor,
  font,
}: {
  name:       string
  primary:    string
  secondary:  string
  bg:         string
  textColor:  string
  font:       string
}) {
  const onPrimary = onPrimaryColor(primary)
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--border-color)' }}
    >
      {/* Fake header bar */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ background: primary }}
      >
        <span
          className="text-sm font-bold truncate"
          style={{ fontFamily: font, color: onPrimary }}
        >
          {name || 'Mi Barbería'}
        </span>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded"
          style={{ background: 'rgba(0,0,0,0.2)', color: onPrimary }}
        >
          Reservar
        </span>
      </div>

      {/* Fake body */}
      <div className="px-4 py-4 flex flex-col gap-3" style={{ background: bg }}>
        <p className="text-sm font-semibold" style={{ fontFamily: font, color: textColor }}>
          Bienvenido a {name || 'Mi Barbería'}
        </p>
        <p className="text-xs" style={{ color: textColor, opacity: 0.6 }}>
          Reserva tu cita en línea con nuestros barberos expertos.
        </p>

        {/* Fake service card */}
        <div
          className="rounded-lg px-3 py-3 flex items-center justify-between"
          style={{ background: secondary, border: `1px solid ${primary}40` }}
        >
          <div>
            <p className="text-xs font-semibold" style={{ color: textColor }}>Corte Clásico</p>
            <p className="text-[11px]" style={{ color: textColor, opacity: 0.6 }}>30 min</p>
          </div>
          <span className="text-xs font-bold" style={{ color: primary }}>$ 25.000</span>
        </div>

        {/* Fake CTA button */}
        <button
          type="button"
          className="rounded-lg py-2 text-xs font-bold w-full"
          style={{ background: primary, color: onPrimary, fontFamily: font }}
        >
          Agendar cita
        </button>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════

export function BrandingForm({ business, slug }: BrandingFormProps) {
  const router = useRouter()

  // Lo que se muestra es lo que realmente está en uso: brand_config (fuente única de verdad que aplica
  // el layout) → branding legado → defaults.
  const legacy = (business.branding ?? {}) as unknown as Partial<BusinessBranding>
  const bc     = (business.brand_config ?? {}) as Partial<BrandConfig>
  const stored: Partial<BusinessBranding> = {
    primary_color:   bc.primaryColor   || legacy.primary_color,
    secondary_color: bc.secondaryColor || legacy.secondary_color,
    bg_color:        bc.bgColor        || legacy.bg_color,
    text_color:      bc.textColor      || legacy.text_color,
    font_family:     bc.fontFamily     || legacy.font_family,
  }

  // El nombre se edita en "Datos del negocio"; aquí solo alimenta la vista previa.
  const name = business.name
  const [colors, setColors] = useState<Omit<BusinessBranding, 'logo_url' | 'font_family'>>({
    primary_color:   stored.primary_color   ?? DEFAULT_BRANDING.primary_color,
    secondary_color: stored.secondary_color ?? DEFAULT_BRANDING.secondary_color,
    bg_color:        stored.bg_color        ?? DEFAULT_BRANDING.bg_color,
    text_color:      stored.text_color      ?? DEFAULT_BRANDING.text_color,
  })
  const [font,   setFont]   = useState(normalizeFontKey(stored.font_family ?? DEFAULT_BRANDING.font_family))
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveThemeMode(bc.themeMode))

  const bookingUrl = `https://www.xinuco.com/${slug}/book`

  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [statusMsg, setStatusMsg] = useState('')

  function setColor(key: keyof typeof colors, value: string) {
    setColors(prev => ({ ...prev, [key]: value }))
    setStatus('idle')
  }

  // Elegir modo aplica el preset de fondo/superficie/texto (el color principal no cambia);
  // después se pueden afinar los colores individualmente.
  function chooseThemeMode(mode: ThemeMode) {
    setThemeMode(mode)
    const preset = THEME_PRESETS[mode]
    setColors(prev => ({
      ...prev,
      bg_color:        preset.bgColor,
      secondary_color: preset.secondaryColor,
      text_color:      preset.textColor,
    }))
    setStatus('idle')
  }

  function handleSave() {
    setStatus('idle')

    startTransition(async () => {
      try {
        const brandingPayload: Partial<BusinessBranding> & { theme_mode: ThemeMode } = {
          theme_mode:      themeMode,
          primary_color:   colors.primary_color,
          secondary_color: colors.secondary_color,
          bg_color:        colors.bg_color,
          text_color:      colors.text_color,
          font_family:     font,
        }

        const brandingResult = await updateBusinessBranding(brandingPayload)

        if (brandingResult.error) {
          setStatus('error')
          setStatusMsg(brandingResult.error)
          return
        }

        setStatus('success')
        setStatusMsg('Cambios guardados correctamente.')
        // Re-renderiza la página actual con los nuevos CSS vars del tema
        router.refresh()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error inesperado. Intenta de nuevo.'
        setStatus('error')
        setStatusMsg(msg)
      }
    })
  }

  return (
    <div className="flex flex-col gap-8">

      {/* ── Sección 1: Info del negocio ── */}
      <section aria-label="Información del negocio">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-xinuco-muted mb-4">
          Información del negocio
        </h2>
        <div
          className="rounded-xl p-5 flex flex-col gap-4"
          style={{ background: 'var(--card-color, #111111)', border: '1px solid var(--border-color)' }}
        >
          {/* Nombre — se edita en Datos del negocio */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
              Nombre del negocio
            </span>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-xinuco-text break-words min-w-0">{business.name}</p>
              <Link
                href={`/${slug}/dashboard/settings/business`}
                className="text-xs font-semibold underline underline-offset-2"
                style={{ color: 'var(--primary-color)' }}
              >
                Cambiar en Datos del negocio
              </Link>
            </div>
          </div>

          {/* Slug — read-only */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="biz-slug"
              className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider"
            >
              URL de reservas <span className="normal-case font-normal">(no editable)</span>
            </label>
            <div className="flex items-stretch gap-2">
              <input
                id="biz-slug"
                type="text"
                value={bookingUrl}
                readOnly
                className="input-base font-mono text-sm min-w-0 flex-1 select-all"
                style={{ color: 'var(--primary-color)', opacity: 0.8 }}
              />
              <CopyButton text={bookingUrl} label="Copiar URL de reservas" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Sección 2: Colores ── */}
      <section aria-label="Colores de marca">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-xinuco-muted mb-4">
          Colores de marca
        </h2>
        <div
          className="rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-5"
          style={{ background: 'var(--card-color, #111111)', border: '1px solid var(--border-color)' }}
        >
          {/* Modo claro/oscuro — aplica un preset de fondo/superficie/texto a la página de reservas y al panel */}
          <div className="sm:col-span-2 flex flex-col gap-1.5">
            <span id="theme-mode-label" className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
              Modo claro / oscuro
            </span>
            <div role="radiogroup" aria-labelledby="theme-mode-label" className="grid grid-cols-2 gap-2">
              {([
                { mode: 'dark',  label: 'Oscuro', Icon: Moon },
                { mode: 'light', label: 'Claro',  Icon: Sun },
              ] as const).map(({ mode, label, Icon }) => {
                const active = themeMode === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => chooseThemeMode(mode)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl min-h-11 px-4 text-sm font-semibold transition-colors"
                    style={active
                      ? { background: 'var(--primary-color)', color: onPrimaryColor(colors.primary_color), border: '1px solid var(--primary-color)' }
                      : { background: 'transparent', color: 'var(--muted-color)', border: '1px solid var(--border-color)' }}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-xinuco-muted">
              Se aplica a la página de reservas de tus clientes y al panel del negocio (administrador y barberos).
              En la página de reservas puedes ajustar cada color después.
            </p>
          </div>
          <ColorField
            id="color-primary"
            label="Color principal"
            value={colors.primary_color}
            onChange={v => setColor('primary_color', v)}
          />
          <ColorField
            id="color-secondary"
            label="Color secundario"
            value={colors.secondary_color}
            onChange={v => setColor('secondary_color', v)}
          />
          <ColorField
            id="color-bg"
            label="Color de fondo"
            value={colors.bg_color}
            onChange={v => setColor('bg_color', v)}
          />
          <ColorField
            id="color-text"
            label="Color de texto"
            value={colors.text_color}
            onChange={v => setColor('text_color', v)}
          />
        </div>
      </section>

      {/* ── Sección 3: Tipografía ── */}
      <section aria-label="Tipografía">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-xinuco-muted mb-4">
          Tipografía
        </h2>
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--card-color, #111111)', border: '1px solid var(--border-color)' }}
        >
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="font-select"
              className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider"
            >
              Familia tipográfica
            </label>
            <select
              id="font-select"
              value={font}
              onChange={e => { setFont(e.target.value); setStatus('idle') }}
              className="input-base"
            >
              {FONT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-xinuco-muted mt-1">
              Se aplica al portal de reservas y a los encabezados del negocio.
            </p>
          </div>
        </div>
      </section>

      {/* ── Sección 4: Vista previa ── */}
      <section aria-label="Vista previa de marca">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-xinuco-muted mb-4">
          Vista previa
        </h2>
        <BrandPreview
          name={name}
          primary={colors.primary_color}
          secondary={colors.secondary_color}
          bg={colors.bg_color}
          textColor={colors.text_color}
          font={FONT_OPTIONS.find(o => o.value === font)?.css ?? font}
        />
      </section>

      {/* ── Sección 5: Logo ── */}
      <section
        aria-label="Logo del negocio"
        className="rounded-xl px-5 py-4 flex items-center gap-3"
        style={{
          background: 'var(--card-color, #111111)',
          border:     '1px dashed var(--border-color)',
        }}
      >
        <ImageOff size={18} className="shrink-0 text-xinuco-muted" />
        <div>
          <p className="text-sm font-medium text-xinuco-muted">Logo del negocio</p>
          <p className="text-xs text-xinuco-muted opacity-60 mt-0.5">
            Carga de logo próximamente — requiere configuración de Supabase Storage.
          </p>
        </div>
      </section>

      {/* ── Status message ── */}
      {status !== 'idle' && (
        <div
          role="alert"
          className="flex items-center gap-2.5 px-4 py-3 rounded-lg text-sm animate-fade-in"
          style={
            status === 'success'
              ? { background: 'rgba(74,222,128,0.1)', color: 'var(--st-green, #4ade80)', border: '1px solid rgba(74,222,128,0.2)' }
              : { background: 'rgba(248,113,113,0.1)', color: 'var(--danger-text, #f87171)', border: '1px solid rgba(248,113,113,0.2)' }
          }
        >
          {status === 'success' ? (
            <Check size={15} className="shrink-0" />
          ) : (
            <AlertCircle size={15} className="shrink-0" />
          )}
          {statusMsg}
        </div>
      )}

      {/* ── Save button ── */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="btn-primary flex items-center gap-2 min-w-[140px] justify-center"
        >
          {isPending ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Guardando…
            </>
          ) : (
            <>
              <Check size={15} />
              Guardar cambios
            </>
          )}
        </button>
      </div>

    </div>
  )
}
