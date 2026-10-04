'use client'

import { useState, useEffect, useTransition, createContext } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronsLeft, ChevronsRight, Lock, LogOut, Loader2 } from 'lucide-react'
import { useFeatures } from '@/lib/features/context'
import { useIsAdmin, useRole } from '@/lib/features/role-context'
import { roleLabel } from '@/lib/roles'
import { logout } from '@/actions/auth'
import { isNavActive, toNavRole, visibleNav, type VisibleNavItem } from '@/lib/navigation'
import { BrandMark, type BrandBusiness } from '@/components/layout/BrandMark'
import { userInitials } from '@/components/layout/userInitials'

export const SidebarContext = createContext<{ isCollapsed: boolean; setIsCollapsed: (val: boolean) => void }>({
  isCollapsed: false,
  setIsCollapsed: () => {}
})

const STORAGE_KEY = 'xinuco.sidebar.collapsed'

export function DashboardSidebar({
  slug,
  business,
  userName,
  children
}: {
  slug:      string
  business?: BrandBusiness | null
  userName?: string
  children:  React.ReactNode
}) {
  // Preferencia del usuario (solo aplica desde lg). Entre 768 y 1023px el menú siempre va compacto.
  const [isCollapsed, setIsCollapsedState] = useState(false)
  const pathname = usePathname()
  const features = useFeatures()
  const isAdmin  = useIsAdmin()
  const role     = useRole()
  const [isPending, startTransition] = useTransition()
  const { groups, footer } = visibleNav(toNavRole(isAdmin), features)

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') setIsCollapsedState(true)
    } catch { /* localStorage no disponible: se usa el valor por defecto */ }
  }, [])

  const setIsCollapsed = (val: boolean) => {
    setIsCollapsedState(val)
    try { localStorage.setItem(STORAGE_KEY, val ? '1' : '0') } catch { /* sin persistencia */ }
  }

  // Clases que dependen de si el menú está expandido (solo lg y sin colapsar) o compacto.
  // Compacto = icono centrado; expandido = icono + texto alineados a la izquierda.
  const itemLayout  = isCollapsed ? 'justify-center px-0' : 'justify-center px-0 lg:justify-start lg:px-3'
  const showExpanded = isCollapsed ? 'hidden' : 'hidden lg:inline'
  const showExpandedBlock = isCollapsed ? 'hidden' : 'hidden lg:block'

  const renderItem = (item: VisibleNavItem) => {
    const href = item.href(slug)
    const active = isNavActive(pathname, href) && !item.locked
    const tooltip = `${item.label}${item.locked ? ' (Restringido)' : ''}`
    return (
      <li key={item.id}>
        <Link
          href={href}
          title={tooltip}
          aria-label={tooltip}
          aria-current={active ? 'page' : undefined}
          className={`relative flex items-center gap-3 rounded-xl min-h-10 py-2 transition-colors duration-150 ${itemLayout}
            ${item.locked
              ? 'text-xinuco-muted opacity-50 hover:opacity-70'
              : active
                ? 'bg-[color-mix(in_srgb,var(--primary-color)_10%,transparent)] text-xinuco-text'
                : 'text-xinuco-muted hover:text-xinuco-text hover:bg-fg/[0.05]'
            }`}
        >
          {active && (
            <span
              aria-hidden="true"
              className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
              style={{ backgroundColor: 'var(--primary-color)' }}
            />
          )}
          <item.icon
            size={20}
            strokeWidth={1.75}
            className="shrink-0"
            style={active ? { color: 'var(--primary-color)' } : undefined}
          />
          <span className={`flex-1 text-sm font-medium truncate ${showExpanded}`}>{item.label}</span>
          {item.locked && <Lock size={13} className={`shrink-0 opacity-60 ${showExpanded}`} aria-hidden="true" />}
        </Link>
      </li>
    )
  }

  return (
    <SidebarContext.Provider value={{ isCollapsed, setIsCollapsed }}>
      <div className="flex min-h-dvh bg-xinuco-bg">
      {/* Sidebar Desktop: compacto en md (768–1023), expandido en lg salvo que el usuario lo contraiga */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden md:flex flex-col border-r transition-[width] duration-200 ease-out w-16
          ${isCollapsed ? '' : 'lg:w-60'}`}
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-color)' }}
      >
        {/* Marca */}
        <div
          className={`h-16 shrink-0 flex items-center gap-3 border-b justify-center px-0 ${isCollapsed ? '' : 'lg:justify-start lg:px-4'}`}
          style={{ borderColor: 'var(--border-color)' }}
        >
          <BrandMark business={business} size={36} />
          <span className={`font-semibold text-sm text-xinuco-text truncate ${showExpanded}`}>
            {business?.name || 'Xinuco'}
          </span>
        </div>

        {/* Navegación */}
        <nav aria-label="Menú principal" className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3">
          {groups.map((group, gi) => (
            <div key={group.id}>
              {group.label ? (
                <>
                  <p className={`px-3 pt-5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-xinuco-muted ${showExpandedBlock}`}>
                    {group.label}
                  </p>
                  {/* Compacto: el encabezado se vuelve un divisor fino */}
                  <div
                    aria-hidden="true"
                    className={`mx-2 my-3 border-t ${isCollapsed ? (gi === 0 ? 'hidden' : 'block') : (gi === 0 ? 'hidden' : 'block lg:hidden')}`}
                    style={{ borderColor: 'var(--border-color)' }}
                  />
                </>
              ) : (
                <div className="pt-3" />
              )}
              <ul className="flex flex-col gap-0.5">
                {group.items.map(renderItem)}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer fijo: Configuración, usuario + salir, contraer */}
        <div className="shrink-0 border-t px-2 py-2 flex flex-col gap-1" style={{ borderColor: 'var(--border-color)' }}>
          {footer.length > 0 && (
            <ul>{footer.map(renderItem)}</ul>
          )}

          <div className={`flex items-center gap-2 py-1 ${isCollapsed ? 'flex-col' : 'flex-col lg:flex-row lg:px-2'}`}>
            <span
              aria-hidden="true"
              title={userName ?? undefined}
              className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: 'color-mix(in srgb, var(--primary-color) 20%, transparent)',
                color:       'var(--primary-color)',
                border:      '1.5px solid color-mix(in srgb, var(--primary-color) 50%, transparent)',
              }}
            >
              {userInitials(userName)}
            </span>
            <div className={`min-w-0 flex-1 leading-tight ${showExpandedBlock}`}>
              <p className="text-sm font-medium text-xinuco-text truncate">{userName || 'Usuario'}</p>
              <p className="text-xs text-xinuco-muted truncate">{roleLabel(role)}</p>
            </div>
            <button
              type="button"
              onClick={() => startTransition(async () => { await logout() })}
              disabled={isPending}
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
              className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-xinuco-muted hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              {isPending
                ? <Loader2 size={18} className="animate-spin" />
                : <LogOut size={18} strokeWidth={1.75} />}
            </button>
          </div>

          {/* Contraer / expandir (solo lg; en md el menú ya es compacto) */}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            aria-label={isCollapsed ? 'Expandir menú' : 'Contraer menú'}
            title={isCollapsed ? 'Expandir menú' : 'Contraer menú'}
            className={`hidden lg:flex items-center gap-3 rounded-xl min-h-10 py-2 text-xinuco-muted hover:text-xinuco-text hover:bg-fg/[0.05] transition-colors ${isCollapsed ? 'justify-center px-0' : 'px-3'}`}
          >
            {isCollapsed ? <ChevronsRight size={20} strokeWidth={1.75} /> : <ChevronsLeft size={20} strokeWidth={1.75} />}
            {!isCollapsed && <span className="text-sm font-medium">Contraer menú</span>}
          </button>
        </div>
      </aside>

      {/* Contenido: el margen debe coincidir con el ancho del sidebar */}
      <div
        className={`flex-1 min-w-0 flex flex-col md:min-h-dvh w-full md:ml-16 transition-[margin] duration-200 ease-out
          ${isCollapsed ? '' : 'lg:ml-60'}`}
      >
        {children}
      </div>
    </div>
    </SidebarContext.Provider>
  )
}
