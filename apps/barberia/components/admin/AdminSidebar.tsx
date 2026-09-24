'use client'

import Link        from 'next/link'
import { usePathname } from 'next/navigation'
import { Store, CreditCard, Settings, ChevronRight, Zap, ArrowLeft } from 'lucide-react'
import { WEB_URL } from '@xinuco/utils'

interface NavItem {
  id:    string
  href:  string
  icon:  React.ElementType
  label: string
  badge?: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'nav-admin-tenants',  href: '/adminbarberia',          icon: Store,      label: 'Negocios' },
  { id: 'nav-admin-billing',  href: '/adminbarberia/billing',  icon: CreditCard, label: 'Facturación SaaS' },
  { id: 'nav-admin-settings', href: '/adminbarberia/settings', icon: Settings,   label: 'Configuración' },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 shrink-0 flex flex-col border-r border-xinuco-border bg-xinuco-bg min-h-screen sticky top-0">
      {/* Logo / Marca */}
      <div className="px-5 py-6 border-b border-xinuco-border">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 glow-primary"
            style={{ background: 'var(--primary-color)' }}
          >
            <Zap size={16} color="var(--bg-color)" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-sm font-bold text-xinuco-text leading-none">Xinuco</p>
            <p className="text-[10px] text-xinuco-muted mt-0.5">Admin Console</p>
          </div>
        </div>
      </div>

      {/* Volver al panel global */}
      <div className="px-3 pt-4">
        <a
          href={`${WEB_URL}/admin/verticales`}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-xinuco-muted hover:text-xinuco-text hover:bg-xinuco-surface/50 transition-all duration-200"
        >
          <ArrowLeft size={14} strokeWidth={1.75} />
          Verticales
        </a>
      </div>

      {/* Navegación */}
      <nav role="navigation" aria-label="Navegación administrativa" className="flex-1 px-3 py-4">
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ id, href, icon: Icon, label, badge }) => {
            const isActive = pathname === href || (href !== '/adminbarberia' && pathname.startsWith(href))

            return (
              <li key={id}>
                <Link
                  id={id}
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm
                              font-medium transition-all duration-200 group
                              ${isActive
                                ? 'text-xinuco-primary bg-xinuco-surface'
                                : 'text-xinuco-muted hover:text-xinuco-text hover:bg-xinuco-surface/50'
                              }`}
                  style={isActive ? {
                    borderLeft: '2px solid var(--primary-color)',
                    paddingLeft: '10px',
                  } : {}}
                >
                  <span className="flex items-center gap-3">
                    <Icon size={17} strokeWidth={isActive ? 2.5 : 1.75} />
                    {label}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {badge && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full
                                       bg-xinuco-surface text-xinuco-muted border border-xinuco-border">
                        {badge}
                      </span>
                    )}
                    {isActive && <ChevronRight size={13} className="text-xinuco-primary" />}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer del sidebar */}
      <div className="px-5 py-4 border-t border-xinuco-border">
        <p className="text-[10px] text-xinuco-muted">
          Xinuco SaaS v0.1.0
        </p>
      </div>
    </aside>
  )
}
