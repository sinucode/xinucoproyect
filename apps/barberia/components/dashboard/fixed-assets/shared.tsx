'use client'
// components/dashboard/fixed-assets/shared.tsx — piezas pequeñas compartidas de Activos fijos

import React from 'react'
import { Cpu, Sofa, Wrench, Hammer, Car, Package } from 'lucide-react'
import type { FixedAssetCategory } from '@xinuco/types'
import {
  formatCOP,
  panelInputCls,
  panelInputStyle,
} from '../inventory/SidePanel'

export { formatCOP }
export const inputCls = panelInputCls
export const inputStyle: React.CSSProperties = { ...panelInputStyle, colorScheme: 'dark' }

/** Icono de cada categoría. */
export function categoryIcon(category: FixedAssetCategory) {
  switch (category) {
    case 'technology':   return Cpu
    case 'furniture':    return Sofa
    case 'equipment':    return Wrench
    case 'improvements': return Hammer
    case 'vehicle':      return Car
    default:             return Package
  }
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
      {message}
    </p>
  )
}

/** Convierte el texto de un input numérico en entero; NaN si no es un entero válido. */
export function toInt(v: string): number {
  if (v.trim() === '') return NaN
  const n = Number(v)
  return Number.isInteger(n) ? n : NaN
}

/** Campo de dinero en pesos con el valor formateado debajo ("$1.200.000"). */
export function MoneyInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  ariaLabel,
}: {
  value:        string
  onChange:     (v: string) => void
  placeholder?: string
  autoFocus?:   boolean
  ariaLabel?:   string
}) {
  const n = toInt(value)
  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500 pointer-events-none">$</span>
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          aria-label={ariaLabel}
          className={`${inputCls} pl-7 tabular-nums`}
          style={inputStyle}
          placeholder={placeholder ?? '0'}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {Number.isFinite(n) && n > 0 && (
        <span className="text-[11px] text-zinc-500 tabular-nums">{formatCOP(n)}</span>
      )}
    </div>
  )
}

/** Fila de botones para elegir una opción (motivo, medio de pago, método). */
export function ChoiceButtons<T extends string>({
  options,
  value,
  onChange,
  columns,
  disabled,
  ariaLabel,
}: {
  options:   { value: T; label: string; hint?: string }[]
  value:     T
  onChange:  (v: T) => void
  columns?:  2 | 3
  disabled?: (v: T) => boolean
  ariaLabel: string
}) {
  const gridCls = columns === 3 ? 'grid grid-cols-3 gap-2' : columns === 2 ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap gap-2'
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={gridCls}>
      {options.map((o) => {
        const active = value === o.value
        const off = disabled?.(o.value) ?? false
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={off}
            onClick={() => onChange(o.value)}
            className={`rounded-xl border px-3 py-2.5 text-xs sm:text-sm font-semibold text-center leading-tight transition-colors ${
              off ? 'opacity-40 cursor-not-allowed' : ''
            } ${active ? 'text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
            style={{
              borderColor:     active ? 'var(--primary-color)' : 'var(--border-color)',
              backgroundColor: active ? 'color-mix(in srgb, var(--primary-color) 10%, transparent)' : 'transparent',
            }}
          >
            {o.label}
            {o.hint && <span className="block text-[10px] font-normal text-zinc-500 mt-0.5">{o.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
