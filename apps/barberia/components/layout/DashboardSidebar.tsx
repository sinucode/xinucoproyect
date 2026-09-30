'use client'

import { useState, useTransition, createContext } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CalendarDays, Scissors, BarChart2, Settings, ChevronRight,
  Users, Store, Percent, Wallet, Receipt, Gift, LayoutGrid, Shield, UserPlus,
  BookUser, Package, BookOpen, ShoppingBag, Archive, Lock, LogOut, Loader2,
  type LucideIcon,
} from 'lucide-react'
import type { Business, BusinessFeatures } from '@xinuco/types'
import { useDateTime } from '@/lib/hooks/useDateTime'
import { useFeatures } from '@/lib/features/context'
import { useIsAdmin, useRole } from '@/lib/features/role-context'
import { roleLabel } from '@/lib/roles'
import { logout } from '@/actions/auth'

export const SidebarContext = createContext<{ isCollapsed: boolean; setIsCollapsed: (val: boolean) => void }>({
  isCollapsed: false,
  setIsCollapsed: () => {}
})

interface NavLink {
  href:      string
  icon:      LucideIcon
  label:     string
  feature:   keyof BusinessFeatures | null  // null = always visible
  adminOnly: boolean
  /** Etiqueta para administradores cuando el mismo enlace lo ven también otros roles. */
  adminLabel?: string
  locked?:   boolean                        // true = feature restringida por plan
}

function buildLinks(slug: string, features: BusinessFeatures): NavLink[] {
  const all: NavLink[] = [
    { href: `/${slug}/dashboard/appointments`, icon: CalendarDays, label: 'Agenda',         feature: null,               adminOnly: false },
    { href: `/${slug}/dashboard/walk-ins`,     icon: UserPlus,     label: 'Fila de espera',   feature: 'walk_ins',         adminOnly: false },
    { href: `/${slug}/dashboard/crm`,          icon: BookUser,     label: 'Clientes',        feature: 'crm',              adminOnly: false },
    { href: `/${slug}/dashboard/services`,     icon: Scissors,     label: 'Servicios',      feature: null,               adminOnly: true },
    { href: `/${slug}/dashboard/staff`,        icon: Users,        label: 'Equipo',          feature: null,               adminOnly: true },
    { href: `/${slug}/dashboard/commissions`,  icon: Percent,      label: 'Comisiones',     feature: 'commissions',      adminOnly: true },
    { href: `/${slug}/dashboard/expenses`,     icon: Receipt,      label: 'Gastos',          feature: 'expenses_pgl',     adminOnly: true },
    // Admin: gestiona los pagos de todo el equipo. Barbero/manicurista: ve solo su cuenta.
    { href: `/${slug}/dashboard/ledger`,       icon: Wallet,       label: 'Mi cuenta',       feature: 'staff_ledger',     adminOnly: false, adminLabel: 'Pagos al equipo' },
    { href: `/${slug}/dashboard/loyalty`,      icon: Gift,         label: 'Lealtad',         feature: 'loyalty',          adminOnly: true },
    { href: `/${slug}/dashboard/workstations`, icon: LayoutGrid,   label: 'Estaciones',      feature: 'workstations',     adminOnly: true },
    { href: `/${slug}/dashboard/retail`,       icon: ShoppingBag,  label: 'Punto de Venta', feature: 'retail_sales',     adminOnly: true },
    { href: `/${slug}/dashboard/inventory`,    icon: Archive,      label: 'Inventario',      feature: 'inventory',        adminOnly: true },
    { href: `/${slug}/dashboard/audit`,        icon: Shield,       label: 'Auditoría',       feature: 'audit_logs',       adminOnly: true },
    { href: `/${slug}/dashboard/fixed-assets`, icon: Package,      label: 'Activos Fijos',  feature: 'fixed_assets',     adminOnly: true },
    { href: `/${slug}/dashboard/accounting`,   icon: BookOpen,     label: 'Contabilidad',   feature: 'advanced_reports', adminOnly: true },
    { href: `/${slug}/dashboard/reports`,      icon: BarChart2,    label: 'Reportes',        feature: null,               adminOnly: true },
    { href: `/${slug}/dashboard/settings`,     icon: Settings,     label: 'Configuración',   feature: null,               adminOnly: true },
  ]

  // Devolver TODOS los links — el UI muestra candado en los restringidos
  return all.map(link => ({
    ...link,
    locked: link.feature !== null && features[link.feature] !== true,
  }))
}

export function DashboardSidebar({
  slug,
  business,
  children
}: {
  slug:      string
  business?: Pick<Business, 'name' | 'branding'> | null
  children:  React.ReactNode
}) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const pathname = usePathname()
  const dateTime = useDateTime()
  const features = useFeatures()
  const isAdmin  = useIsAdmin()
  const role     = useRole()
  const [isPending, startTransition] = useTransition()
  const links    = buildLinks(slug, features)
    .filter((link) => !link.adminOnly || isAdmin)
    // "Mi cuenta" no se ofrece a quien no es admin si el negocio no tiene la función (nada que mostrar con candado)
    .filter((link) => isAdmin || !link.adminLabel || !link.locked)
    .map((link) => (isAdmin && link.adminLabel ? { ...link, label: link.adminLabel } : link))

  return (
    <SidebarContext.Provider value={{ isCollapsed, setIsCollapsed }}>
      <div className="flex min-h-screen bg-xinuco-bg">
      {/* Sidebar Desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 hidden md:flex flex-col transition-all duration-300 ease-in-out border-r border-zinc-850
          ${isCollapsed ? 'w-16' : 'w-64'}`}
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-color)' }}
      >
        <div
          className={`relative flex transition-all duration-300 border-b overflow-hidden
            ${isCollapsed ? 'h-[72px] items-center justify-center' : 'flex-col items-center justify-center py-10 px-4 gap-4'}`}
          style={{ borderColor: 'var(--border-color)' }}
        >
          {/* Botón Collapse (Esquina superior derecha cuando está expandido) */}
          {!isCollapsed && (
            <button
              onClick={() => setIsCollapsed(true)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.05] transition-colors"
              aria-label="Contraer menú"
            >
              <ChevronRight size={18} className="rotate-180 transition-transform duration-300" />
            </button>
          )}

          {isCollapsed ? (
            <button
              onClick={() => setIsCollapsed(false)}
              className="w-11 h-11 rounded-xl flex items-center justify-center border transition-all animate-fade-in shadow-sm hover:scale-105"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
                borderColor: 'color-mix(in srgb, var(--primary-color) 25%, transparent)'
              }}
              title="Expandir menú"
            >
              <Store size={20} style={{ color: 'var(--primary-color)' }} />
            </button>
          ) : (
            <div className="flex flex-col items-center gap-4 animate-fade-in text-center mt-2 w-full">
              {/* Contenedor de Marca Premium */}
              <div className="w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center border shadow-sm"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--primary-color) 25%, transparent)'
                }}
              >
                <Store size={26} style={{ color: 'var(--primary-color)' }} />
              </div>

              <div className="flex flex-col items-center">
                <span className="font-serif font-bold text-base text-xinuco-text tracking-wide whitespace-nowrap">
                  {business?.name || 'XINUCO'}
                </span>

                {/* Rol del usuario logueado */}
                <span
                  className="mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border"
                  style={{
                    color:           'var(--primary-color)',
                    backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
                    borderColor:     'color-mix(in srgb, var(--primary-color) 25%, transparent)',
                  }}
                >
                  {roleLabel(role)}
                </span>

                {/* Reloj en Tiempo Real Independiente */}
                <div className="h-4 flex items-center justify-center mt-1.5">
                  {dateTime ? (
                    <span className="text-xs text-xinuco-muted uppercase tracking-[0.15em] font-medium whitespace-nowrap">
                      {dateTime.toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '')} • {dateTime.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                    </span>
                  ) : (
                    <div className="w-32 h-3 rounded bg-xinuco-surface animate-pulse" />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 py-6 flex flex-col gap-2 px-3 overflow-y-auto">
          {links.map((link) => {
            const isActive = pathname.startsWith(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 rounded-xl transition-all duration-200 group overflow-hidden
                  ${isCollapsed ? 'justify-center py-3' : 'px-3 py-2.5'}
                  ${link.locked
                    ? 'opacity-40 hover:opacity-60'
                    : isActive
                      ? 'bg-xinuco-surface'
                      : 'hover:bg-white/[0.05] text-xinuco-muted hover:text-xinuco-text'
                  }
                `}
                title={isCollapsed ? `${link.label}${link.locked ? ' (Restringido)' : ''}` : undefined}
              >
                <div
                  className={`flex items-center justify-center relative ${isActive && !link.locked ? 'text-[var(--primary-color)]' : ''}`}
                >
                  {isActive && !isCollapsed && !link.locked && (
                    <div className="absolute -left-3 w-1 h-5 rounded-r-full" style={{ backgroundColor: 'var(--primary-color)' }} />
                  )}
                  <link.icon size={20} strokeWidth={isActive && !link.locked ? 2.5 : 1.75} />
                </div>
                {!isCollapsed && (
                  <span className={`flex-1 font-medium text-sm whitespace-nowrap transition-colors ${isActive && !link.locked ? 'text-xinuco-text' : ''}`}>
                    {link.label}
                  </span>
                )}
                {/* Candado para features restringidas */}
                {link.locked && !isCollapsed && (
                  <Lock size={13} className="text-xinuco-muted opacity-60 shrink-0" />
                )}
              </Link>
            )
          })}
        </nav>

        {/* Footer: cerrar sesión */}
        <div className="border-t px-3 py-4" style={{ borderColor: 'var(--border-color)' }}>
          <button
            type="button"
            onClick={() => startTransition(async () => { await logout() })}
            disabled={isPending}
            aria-label="Cerrar sesión"
            title={isCollapsed ? 'Cerrar sesión' : undefined}
            className={`flex items-center gap-3 rounded-xl w-full transition-all duration-200
              ${isCollapsed ? 'justify-center py-3' : 'px-3 py-2.5'}
              text-red-500 hover:bg-red-500/10`}
          >
            {isPending
              ? <Loader2 size={20} className="animate-spin" />
              : <LogOut size={20} strokeWidth={1.75} />}
            {!isCollapsed && (
              <span className="flex-1 text-left font-medium text-sm whitespace-nowrap">
                {isPending ? 'Saliendo...' : 'Cerrar sesión'}
              </span>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Wrapper */}
      <div
        className={`flex-1 min-w-0 flex flex-col transition-all duration-300 ease-in-out md:min-h-screen w-full
          ${isCollapsed ? 'md:ml-16' : 'md:ml-64'}`}
      >
        {children}
      </div>
    </div>
    </SidebarContext.Provider>
  )
}
