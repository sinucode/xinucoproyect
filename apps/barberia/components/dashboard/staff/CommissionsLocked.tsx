import Link from 'next/link'
import { Percent, Lock } from 'lucide-react'

/** Tratamiento "restringido" de Comisiones cuando el plan del negocio no la incluye. */
export function CommissionsLocked({ slug }: { slug: string }) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-2xl px-6 py-12 text-center"
      style={{ border: '1px dashed var(--border-color)' }}
    >
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)', color: 'var(--primary-color)' }}
      >
        <Percent size={22} aria-hidden="true" />
      </span>
      <h2 className="flex items-center gap-2 text-base font-semibold text-xinuco-text">
        <Lock size={14} aria-hidden="true" /> Comisiones no está incluido en tu plan
      </h2>
      <p className="max-w-md text-sm text-xinuco-muted">
        Con comisiones, cada cobro suma solo a la cuenta de cada profesional según las reglas que definas.
      </p>
      <Link href={`/${slug}/dashboard/settings/billing`} className="btn-primary mt-1 min-h-11">
        Ver planes
      </Link>
    </div>
  )
}
