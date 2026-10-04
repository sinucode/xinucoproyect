// components/dashboard/settings/NotificationHistory.tsx — RF18
// Historial reciente de correos enviados por el negocio (solo lectura, Server Component).
// Lista de tarjetas: no desborda en 375 px.

import { CheckCircle2, XCircle } from 'lucide-react'
import type { NotificationLogRow } from '@/actions/notifications'

const TYPE_LABELS: Record<string, string> = {
  confirmation: 'Confirmación',
  reminder:     'Recordatorio',
  cancellation: 'Cancelación',
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export function NotificationHistory({ log }: { log: NotificationLogRow[] }) {
  if (log.length === 0) {
    return (
      <div
        className="rounded-xl border p-8 text-center text-xinuco-muted text-sm"
        style={{ background: 'var(--card-color, #111111)', borderColor: 'var(--line-color, #222222)' }}
      >
        Aún no se ha enviado ningún correo.
      </div>
    )
  }

  return (
    <ul className="rounded-xl border overflow-hidden divide-y" style={{ borderColor: 'var(--line-color, #222222)', background: 'var(--card-color, #111111)' }}>
      {log.map(entry => {
        const sent = entry.status === 'sent'
        return (
          <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3 min-w-0">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: '#C5A059' }}>
                {TYPE_LABELS[entry.notification_type] ?? entry.notification_type}
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--soft-text, #aaaaaa)' }}>
                {entry.recipient_email ?? 'Sin correo'}
              </p>
              <p className="text-[11px]" style={{ color: 'var(--faint-text, #666666)' }}>{formatWhen(entry.created_at)}</p>
            </div>
            <span
              className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold"
              style={{ color: sent ? 'var(--st-green-2, #22c55e)' : 'var(--st-red, #ef4444)' }}
            >
              {sent ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
              {sent ? 'Enviado' : 'Fallido'}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
