'use client'

// PayoutRequestUpdates — aviso del Inicio del profesional: su solicitud de pago o anticipo fue
// pagada o rechazada (últimos 7 días). Se puede descartar; el descarte es por id de solicitud y vive
// en localStorage (toda lectura/escritura va en try/catch: sin storage el aviso igual se ve).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, XCircle, X } from 'lucide-react'
import { payoutUpdateMessage, type PayoutUpdateView } from '@/lib/payout-requests'

const STORAGE_KEY = 'xinuco:payout-updates-dismissed'

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function writeDismissed(ids: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(-50)))
  } catch {
    // sin storage: el descarte dura solo mientras la página siga abierta
  }
}

export function PayoutRequestUpdates({ slug, updates }: { slug: string; updates: PayoutUpdateView[] }) {
  // Hasta montar no se sabe qué descartó: no pintar evita el parpadeo de avisos ya cerrados
  const [dismissed, setDismissed] = useState<string[] | null>(null)

  useEffect(() => { setDismissed(readDismissed()) }, [])

  if (dismissed === null) return null
  const visible = updates.filter(u => !dismissed.includes(u.id))
  if (visible.length === 0) return null

  function dismiss(id: string) {
    const next = [...dismissed!, id]
    setDismissed(next)
    writeDismissed(next)
  }

  return (
    <div className="flex flex-col gap-2">
      {visible.map(u => {
        const paid = u.status === 'paid'
        const Icon = paid ? CheckCircle2 : XCircle
        const color = paid ? '#4ade80' : '#f87171'
        return (
          <div
            key={u.id}
            role="status"
            className="flex items-center gap-3 rounded-2xl border pl-4 pr-1 py-1 min-h-12"
            style={{
              borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
              background: `color-mix(in srgb, ${color} 7%, transparent)`,
            }}
          >
            <Icon size={18} className="shrink-0" style={{ color }} aria-hidden="true" />
            <div className="flex-1 min-w-0 py-2">
              <p className="text-sm text-xinuco-text break-words">{payoutUpdateMessage(u)}</p>
              <Link
                href={`/${slug}/dashboard/ledger`}
                className="text-xs font-semibold underline underline-offset-2"
                style={{ color: 'var(--primary-color)' }}
              >
                Ver en Mi cuenta
              </Link>
            </div>
            <button
              type="button"
              onClick={() => dismiss(u.id)}
              aria-label="Descartar aviso"
              className="shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-xl text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.06] transition-colors"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
