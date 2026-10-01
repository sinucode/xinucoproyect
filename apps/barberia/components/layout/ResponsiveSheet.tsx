'use client'

import { createPortal } from 'react-dom'

/** Dentro del contenedor del negocio (hereda colores y tipografía de la marca); si no, el body. */
function portalTarget(): Element {
  return document.querySelector('[data-tenant-theme]') ?? document.body
}

import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { BottomSheet } from '@/components/layout/BottomSheet'

const DESKTOP_QUERY = '(min-width: 768px)'

function subscribe(cb: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** true en pantallas de escritorio (≥ 768px, el mismo corte `md` del resto de la app). */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  )
}

interface ResponsiveSheetProps {
  open:     boolean
  onClose:  () => void
  title:    string
  /** Línea pequeña bajo el título (solo escritorio). */
  subtitle?: string
  children: ReactNode
}

/**
 * Móvil: hoja inferior (BottomSheet). Escritorio: diálogo centrado.
 * Los hijos se montan UNA sola vez (nunca se duplican entre las dos presentaciones).
 */
export function ResponsiveSheet({ open, onClose, title, subtitle, children }: ResponsiveSheetProps) {
  const isDesktop = useIsDesktop()
  if (!open) return null
  if (!isDesktop) {
    return <BottomSheet open={open} onClose={onClose} title={title}>{children}</BottomSheet>
  }
  return <DesktopDialog onClose={onClose} title={title} subtitle={subtitle}>{children}</DesktopDialog>
}

function DesktopDialog({
  onClose, title, subtitle, children,
}: { onClose: () => void; title: string; subtitle?: string; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const firstPath = useRef(pathname)

  const close = useCallback(() => onClose(), [onClose])

  useEffect(() => {
    if (pathname !== firstPath.current) { firstPath.current = pathname; close() }
  }, [pathname, close])

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [close])

  if (typeof document === 'undefined') return null
  return createPortal((
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={close} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-2xl border outline-none animate-fade-in"
        style={{ backgroundColor: 'var(--bg-color)', borderColor: 'var(--border-color)' }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b px-5 py-3" style={{ borderColor: 'var(--border-color)' }}>
          <div className="min-w-0 pt-1">
            <h2 className="text-base font-semibold text-xinuco-text">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-xinuco-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Cerrar"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-xinuco-muted hover:text-xinuco-text"
          >
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
      </div>
    </div>
  ), portalTarget())
}
