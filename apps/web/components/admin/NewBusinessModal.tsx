'use client'

import { useRef, useState, useTransition, useEffect } from 'react'
import { X, Loader2, AlertCircle, CheckCircle2, Pipette } from 'lucide-react'
import { createTenant, type ActionResult } from '@/actions/admin'

interface NewBusinessModalProps {
  isOpen:   boolean
  onClose:  () => void
}

/** Convierte un nombre en slug URL-safe */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // quitar tildes
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

/** Input de color con preview visual */
function ColorInput({
  id,
  name,
  label,
  value,
  onChange,
}: {
  id:       string
  name:     string
  label:    string
  value:    string
  onChange: (val: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-xinuco-muted uppercase tracking-wider">
        {label}
      </label>
      <div className="flex items-center gap-2">
        {/* Swatch clicable que abre el color picker */}
        <label
          htmlFor={id}
          className="w-10 h-10 rounded-lg border border-xinuco-border cursor-pointer
                     hover:scale-105 transition-transform shrink-0 relative overflow-hidden"
          style={{ background: value }}
        >
          <span className="sr-only">Seleccionar {label}</span>
          <input
            id={id}
            name={name}
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          />
        </label>
        {/* Hex display editable */}
        <div className="flex items-center gap-1.5 flex-1 input-base !py-2.5 !px-3">
          <Pipette size={13} className="text-xinuco-muted shrink-0" />
          <input
            type="text"
            value={value}
            onChange={(e) => {
              const v = e.target.value
              if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) onChange(v)
            }}
            maxLength={7}
            className="bg-transparent outline-none text-xinuco-text text-sm font-mono flex-1 min-w-0"
            aria-label={`Valor hex de ${label}`}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * NewBusinessModal — Client Component.
 *
 * Modal de creación de nuevo tenant con:
 * - Auto-generación de slug desde el nombre
 * - Color pickers custom para primary_color y bg_color
 * - Preview de branding en tiempo real
 * - Integración con Server Action createTenant via useTransition
 */
export function NewBusinessModal({ isOpen, onClose }: NewBusinessModalProps) {
  const formRef       = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()

  const [name,         setName]         = useState('')
  const [slug,         setSlug]         = useState('')
  const [slugEdited,   setSlugEdited]   = useState(false)
  const [primaryColor, setPrimaryColor] = useState('#C5A059')
  const [bgColor,      setBgColor]      = useState('#080808')
  const [result,       setResult]       = useState<ActionResult | null>(null)

  // Auto-generar slug si el usuario no lo editó manualmente
  useEffect(() => {
    if (!slugEdited) setSlug(toSlug(name))
  }, [name, slugEdited])

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen])

  function handleClose() {
    if (isPending) return
    setName(''); setSlug(''); setSlugEdited(false)
    setPrimaryColor('#C5A059'); setBgColor('#080808')
    setResult(null)
    onClose()
  }

  function handleSubmit(formData: FormData) {
    setResult(null)
    startTransition(async () => {
      const res = await createTenant(formData)
      setResult(res)
      if (res.success) {
        setTimeout(handleClose, 1200)
      }
    })
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden
        onClick={handleClose}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in"
      />

      {/* Panel lateral (slide desde la derecha) */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-xinuco-bg border-l border-xinuco-border
                   flex flex-col shadow-2xl animate-slide-up"
        style={{ animationDuration: '0.25s' }}
      >
        {/* Header del panel */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-xinuco-border shrink-0">
          <div>
            <h2 id="modal-title" className="text-base font-bold text-xinuco-text">
              Nueva Barbería
            </h2>
            <p className="text-xs text-xinuco-muted mt-0.5">Registrar un nuevo tenant en la plataforma</p>
          </div>
          <button
            onClick={handleClose}
            aria-label="Cerrar panel"
            disabled={isPending}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-xinuco-muted
                       hover:text-xinuco-text hover:bg-xinuco-surface transition-all disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Formulario */}
        <form
          ref={formRef}
          action={handleSubmit}
          className="flex flex-col flex-1 overflow-y-auto px-6 py-6 gap-5"
        >
          {/* Nombre */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="biz-name" className="text-xs font-medium text-xinuco-muted uppercase tracking-wider">
              Nombre del negocio <span className="text-red-400">*</span>
            </label>
            <input
              id="biz-name"
              name="name"
              type="text"
              required
              minLength={2}
              maxLength={60}
              placeholder="Ej. Barbería El Rey"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-base"
            />
          </div>

          {/* Slug */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="biz-slug" className="text-xs font-medium text-xinuco-muted uppercase tracking-wider">
              Slug (URL) <span className="text-red-400">*</span>
            </label>
            <div className="flex items-center gap-0">
              <span className="input-base !rounded-r-none !w-auto shrink-0 px-3 text-xinuco-muted border-r-0">
                xinuco.com/
              </span>
              <input
                id="biz-slug"
                name="slug"
                type="text"
                required
                pattern="[a-z0-9-]+"
                title="Solo letras minúsculas, números y guiones"
                placeholder="el-rey"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value)
                  setSlugEdited(true)
                }}
                className="input-base !rounded-l-none flex-1"
              />
            </div>
            <p className="text-xs text-xinuco-muted">
              Solo letras minúsculas, números y guiones. Se genera automáticamente.
            </p>
          </div>

          {/* Divider */}
          <div className="border-t border-xinuco-border" />
          <p className="text-xs font-semibold text-xinuco-text uppercase tracking-wider -mb-2">
            Branding Inicial
          </p>

          {/* Color primario */}
          <ColorInput
            id="biz-primary-color"
            name="primary_color"
            label="Color Primario"
            value={primaryColor}
            onChange={setPrimaryColor}
          />

          {/* Color de fondo */}
          <ColorInput
            id="biz-bg-color"
            name="bg_color"
            label="Color de Fondo"
            value={bgColor}
            onChange={setBgColor}
          />

          {/* Preview de branding */}
          <div className="rounded-xl p-4 border border-xinuco-border" style={{ background: bgColor }}>
            <p className="text-[10px] text-xinuco-muted mb-2 uppercase tracking-wider">Preview</p>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg" style={{ background: primaryColor }} />
              <div>
                <p className="text-sm font-bold" style={{ color: '#F4F4F4' }}>
                  {name || 'Nombre del negocio'}
                </p>
                <p className="text-xs" style={{ color: '#6B6B6B' }}>
                  xinuco.com/{slug || 'slug'}
                </p>
              </div>
            </div>
            <div
              className="mt-3 h-8 rounded-lg flex items-center justify-center text-xs font-semibold"
              style={{ background: primaryColor, color: bgColor }}
            >
              Botón primario
            </div>
          </div>

          {/* Feedback */}
          {result && (
            <div
              role="alert"
              className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm animate-fade-in
                ${result.success
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                  : 'bg-red-500/10 border border-red-500/30 text-red-400'
                }`}
            >
              {result.success
                ? <CheckCircle2 size={15} className="shrink-0" />
                : <AlertCircle  size={15} className="shrink-0" />
              }
              {result.success ? '¡Barbería creada exitosamente!' : result.error}
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Footer de acciones */}
          <div className="flex gap-3 pt-4 border-t border-xinuco-border shrink-0">
            <button
              type="button"
              onClick={handleClose}
              disabled={isPending}
              className="btn-ghost flex-1"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending || !name || !slug}
              id="btn-create-tenant"
              className="btn-primary flex-1"
            >
              {isPending
                ? <><Loader2 size={15} className="animate-spin" /> Creando...</>
                : '+ Crear Barbería'
              }
            </button>
          </div>
        </form>
      </aside>
    </>
  )
}
