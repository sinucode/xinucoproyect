'use client'

import { useContext } from 'react'
import Image from 'next/image'
import { Scissors } from 'lucide-react'
import type { Business } from '@xinuco/types'
import { AvatarSkeleton } from '@xinuco/ui'
import { UserDropdown } from '@/components/layout/UserDropdown'
import { SidebarContext } from '@/components/layout/DashboardSidebar'
import { useDateTime } from '@/lib/hooks/useDateTime'

interface HeaderProps {
  business?: Pick<Business, 'name' | 'branding'> | null
  userName?: string
  /** Rol del usuario (se muestra en el dropdown) */
  role?:     string
  /** Si true, muestra skeleton del avatar mientras el perfil carga */
  isLoading?: boolean
}

/**
 * Header Premium — Server Component.
 *
 * Izquierda: fecha de hoy con formato elegante (ej. "Jueves, 24 Oct")
 * Centro:    nombre del negocio con logo/fallback
 * Derecha:   avatar con iniciales del usuario logueado (o Skeleton)
 *
 * Sticky top-0, backdrop-blur, bg-xinuco-bg/80
 */
export function Header({ business, userName, role, isLoading = false }: HeaderProps) {
  const { isCollapsed } = useContext(SidebarContext)
  const dateTime = useDateTime()

  // ── Iniciales del usuario ─────────────────────────────────────
  const initials = userName
    ? userName
        .trim()
        .split(/\s+/)
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '?'

  return (
    <header className="sticky top-0 z-40 bg-xinuco-bg/80 backdrop-blur-md border-b border-xinuco-border">
      <div className="flex items-center justify-between px-4 py-3 max-w-2xl mx-auto gap-3">

        {/* ── Izquierda: Info dinámica según isCollapsed ──────── */}
        <div className="flex flex-col min-w-0 transition-opacity duration-300">
          {isCollapsed ? (
            <div className="flex items-center gap-2 animate-fade-in whitespace-nowrap overflow-hidden">
              <span className="font-serif font-bold text-sm text-xinuco-text tracking-wide truncate">
                {business?.name ?? 'XINUCO'}
              </span>
              <span className="text-xinuco-muted text-xs mx-1 opacity-50">•</span>
              {dateTime ? (
                <span className="text-xs text-xinuco-muted uppercase tracking-widest font-medium">
                  {dateTime.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }).replace('.', '')} 
                  <span className="mx-2 opacity-50">•</span> 
                  {dateTime.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </span>
              ) : (
                <div className="w-32 h-3 rounded bg-xinuco-surface animate-pulse" />
              )}
            </div>
          ) : (
            <div className="h-8 animate-fade-in" /> /* Espacio limpio y ejecutivo cuando expandido */
          )}
        </div>

        {/* ── Derecha: avatar ───────────────────────────────── */}
        {isLoading ? (
          <AvatarSkeleton />
        ) : (
          <UserDropdown initials={initials} userName={userName} role={role} />
        )}
      </div>
    </header>
  )
}
