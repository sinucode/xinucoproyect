import Link from 'next/link'
import { Lock } from 'lucide-react'

export type StaffTabId = 'profesionales' | 'comisiones'

/**
 * Pestañas de Equipo: Profesionales | Comisiones.
 * Navegan por search param (?tab=comisiones) para que el servidor cargue solo lo necesario.
 * La pestaña Comisiones lleva candado si el plan no la incluye.
 */
export function StaffTabs({
  slug,
  active,
  commissionsLocked,
}: {
  slug: string
  active: StaffTabId
  commissionsLocked: boolean
}) {
  const base = `/${slug}/dashboard/staff`
  const tabs: { id: StaffTabId; label: string; href: string; locked?: boolean }[] = [
    { id: 'profesionales', label: 'Profesionales', href: base },
    { id: 'comisiones',    label: 'Comisiones',    href: `${base}?tab=comisiones`, locked: commissionsLocked },
  ]

  return (
    <nav aria-label="Secciones de Equipo" className="border-b border-xinuco-border">
      <ul className="-mb-px flex gap-1 overflow-x-auto scrollbar-hide">
        {tabs.map((t) => {
          const isActive = t.id === active
          return (
            <li key={t.id} className="shrink-0">
              <Link
                href={t.href}
                scroll={false}
                aria-current={isActive ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center gap-1.5 border-b-2 px-4 text-sm font-medium transition-colors
                  ${isActive
                    ? 'border-[var(--primary-color)] text-xinuco-text'
                    : 'border-transparent text-xinuco-muted hover:text-xinuco-text'}`}
              >
                {t.label}
                {t.locked && <Lock size={13} className="opacity-60" aria-label="Restringido" />}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
