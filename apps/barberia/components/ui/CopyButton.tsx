'use client'

// CopyButton — copia un texto al portapapeles y confirma con "¡Copiada!" durante 2 s.
// Usa la API del portapapeles y, si no está disponible (contexto no seguro o permiso negado),
// un textarea temporal con execCommand('copy').

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

interface CopyButtonProps {
  text: string
  /** Nombre accesible, p. ej. "Copiar URL de reservas" */
  label: string
  /** Texto visible (por defecto "Copiar") */
  children?: string
  className?: string
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const el = document.createElement('textarea')
      el.value = text
      el.setAttribute('readonly', '')
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      const ok = document.execCommand('copy')
      el.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function CopyButton({ text, label, children = 'Copiar', className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (await copyText(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copiado' : label}
      className={`shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 min-h-11 min-w-11 text-xs font-bold transition-colors ${className}`}
      style={{
        background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
        color:      'var(--primary-color)',
        border:     '1px solid color-mix(in srgb, var(--primary-color) 35%, transparent)',
      }}
    >
      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      <span aria-live="polite">{copied ? '¡Copiada!' : children}</span>
    </button>
  )
}
