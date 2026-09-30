'use client'
// components/dashboard/inventory/SidePanel.tsx — panel lateral compartido del módulo Inventario

import React from 'react'
import { X, Loader2 } from 'lucide-react'

export const panelInputCls =
  'w-full rounded-xl px-3 py-2.5 text-sm border outline-none transition-colors placeholder-zinc-600 disabled:opacity-50'
export const panelInputStyle = {
  backgroundColor: 'var(--bg-color)',
  borderColor:     'var(--border-color)',
  color:           'var(--text-color, #F4F4F4)',
}
export const panelLabelCls = 'text-xs font-semibold text-zinc-500 uppercase tracking-wide'

export function formatCOP(n: number): string {
  return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('es-CO')
}

interface SidePanelProps {
  title:     string
  subtitle?: string
  icon:      React.ReactNode
  onClose:   () => void
  children:  React.ReactNode
  footer?:   React.ReactNode
  /** Si es true el cuerpo no es un <form> (p. ej. el historial). */
  wide?:     boolean
}

/** Panel deslizante a la derecha con fondo oscuro, cabecera, cuerpo con scroll y pie opcional. */
export function SidePanel({ title, subtitle, icon, onClose, children, footer, wide }: SidePanelProps) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-label={title}
        className={`fixed right-0 top-0 h-full z-50 w-full ${wide ? 'max-w-lg' : 'max-w-md'} flex flex-col shadow-2xl`}
        style={{ backgroundColor: 'var(--bg-color)', borderLeft: '1px solid var(--border-color)' }}
      >
        <div
          className="flex items-center justify-between gap-3 px-5 py-4 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'color-mix(in srgb, var(--primary-color) 15%, transparent)' }}
            >
              {icon}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm text-zinc-100 truncate">{title}</p>
              {subtitle && <p className="text-[11px] text-zinc-500 truncate">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {children}

        {footer && (
          <div className="px-5 py-4 border-t flex gap-3" style={{ borderColor: 'var(--border-color)' }}>
            {footer}
          </div>
        )}
      </div>
    </>
  )
}

/** Botones estándar del pie: Cancelar + acción principal. */
export function PanelFooter({
  onCancel,
  onConfirm,
  confirmLabel,
  pending,
  disabled,
  confirmIcon,
}: {
  onCancel:     () => void
  onConfirm:    () => void
  confirmLabel: string
  pending:      boolean
  disabled?:    boolean
  confirmIcon?: React.ReactNode
}) {
  return (
    <>
      <button
        type="button"
        onClick={onCancel}
        className="flex-1 py-2.5 rounded-xl border text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
        style={{ borderColor: 'var(--border-color)' }}
      >
        Cancelar
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending || disabled}
        className="flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
        style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : confirmIcon}
        {confirmLabel}
      </button>
    </>
  )
}
