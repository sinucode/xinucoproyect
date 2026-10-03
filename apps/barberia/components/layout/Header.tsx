'use client'

import { AvatarSkeleton } from '@xinuco/ui'
import { UserDropdown } from '@/components/layout/UserDropdown'
import { BrandMark, type BrandBusiness } from '@/components/layout/BrandMark'
import { userInitials } from '@/components/layout/userInitials'
import { HeaderClock } from '@/components/layout/HeaderClock'

interface HeaderProps {
  business?: BrandBusiness | null
  userName?: string
  /** Rol del usuario (se muestra en el dropdown) */
  role?:     string
  /** Si true, muestra skeleton del avatar mientras el perfil carga */
  isLoading?: boolean
}

/**
 * Header — sticky, h-14.
 *
 * Móvil:    logo/inicial + nombre del negocio a la izquierda, avatar a la derecha.
 *           La hora (sin fecha ni segundos) va junto al avatar.
 * Desktop:  la marca vive en el sidebar; a la izquierda va el reloj en vivo (America/Bogota)
 *           y a la derecha el menú de usuario.
 */
export function Header({ business, userName, role, isLoading = false }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-xinuco-bg/80 backdrop-blur-md border-b border-xinuco-border">
      <div className="flex h-14 items-center justify-between gap-3 w-full px-4 sm:px-6">

        {/* ── Izquierda: marca (solo móvil; en desktop está en el sidebar) ── */}
        <div className="flex items-center gap-2.5 min-w-0 md:hidden">
          <BrandMark business={business} size={32} />
          <span className="text-sm font-semibold text-xinuco-text truncate">
            {business?.name ?? 'Xinuco'}
          </span>
        </div>

        {/* ── Izquierda (desktop): fecha y hora en vivo ─────── */}
        <div className="hidden md:flex items-center">
          <HeaderClock variant="desktop" />
        </div>

        {/* ── Derecha: hora (móvil) + avatar / menú de usuario ─ */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="md:hidden">
            <HeaderClock variant="mobile" />
          </div>
          {isLoading ? (
            <AvatarSkeleton />
          ) : (
            <UserDropdown initials={userInitials(userName)} userName={userName} role={role} />
          )}
        </div>
      </div>
    </header>
  )
}
