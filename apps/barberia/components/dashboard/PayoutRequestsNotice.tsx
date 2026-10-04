// PayoutRequestsNotice — aviso del Inicio del administrador: solicitudes de pago o anticipo
// pendientes de los profesionales. Autocontenido (sin estado ni datos propios): quien lo monta
// pasa el conteo (getPendingPayoutRequestsCount de actions/ledger). Con 0 no pinta nada.

import Link from 'next/link'
import { BellRing, ChevronRight } from 'lucide-react'

export function PayoutRequestsNotice({ slug, count }: { slug: string; count: number }) {
  if (!Number.isFinite(count) || count <= 0) return null

  return (
    <Link
      href={`/${slug}/dashboard/ledger`}
      className="flex items-center gap-3 rounded-2xl border px-4 py-3 min-h-12 transition-colors hover:bg-fg/[0.04]"
      style={{
        borderColor: 'color-mix(in srgb, var(--primary-color) 35%, transparent)',
        background: 'color-mix(in srgb, var(--primary-color) 6%, transparent)',
      }}
    >
      <BellRing size={18} className="shrink-0" style={{ color: 'var(--primary-color)' }} aria-hidden="true" />
      <span className="flex-1 min-w-0 text-sm text-xinuco-text">
        {count === 1
          ? '1 solicitud de pago pendiente'
          : `${count} solicitudes de pago pendientes`}
      </span>
      <span
        className="inline-flex items-center gap-0.5 text-xs font-semibold shrink-0"
        style={{ color: 'var(--primary-color)' }}
      >
        Revisar
        <ChevronRight size={14} aria-hidden="true" />
      </span>
    </Link>
  )
}
