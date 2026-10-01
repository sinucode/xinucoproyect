'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'

interface BottomSheetProps {
  open:     boolean
  onClose:  () => void
  /** Nombre accesible del diálogo (también se muestra como título). */
  title:    string
  children: ReactNode
}

/**
 * Hoja inferior para móvil (z-50, por encima de header y barra inferior).
 * - Cierra con Escape, toque en el fondo o cambio de ruta.
 * - Trampa de foco básica (Tab cicla dentro) y devuelve el foco al abrirla.
 * - aria-modal + bloqueo del scroll del fondo.
 */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const firstPath = useRef(pathname)

  // Cerrar al cambiar de ruta
  useEffect(() => {
    if (pathname !== firstPath.current) {
      firstPath.current = pathname
      if (open) onClose()
    }
  }, [pathname, open, onClose])

  // Foco, scroll del fondo y teclado
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    ;(focusables()[0] ?? panel)?.focus()

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) { e.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !panel?.contains(active))) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && (active === last || !panel?.contains(active))) {
        e.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  // Portal al body: un padre con filtros/transform (p. ej. backdrop-blur) no debe encerrar la hoja
  if (typeof document === 'undefined') return null
  return createPortal((
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Fondo: un toque cierra */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border-t outline-none animate-slide-up"
        style={{ backgroundColor: 'var(--bg-color)', borderColor: 'var(--border-color)' }}
      >
        <div className="flex shrink-0 items-center justify-between pl-5 pr-2 pt-2">
          <div className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-xinuco-border" aria-hidden="true" />
          <h2 className="pt-3 text-base font-semibold text-xinuco-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="mt-1 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-xinuco-muted hover:text-xinuco-text"
          >
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  ), document.body)
}
