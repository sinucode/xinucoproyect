'use client'

import { AvatarSkeleton } from '@xinuco/ui'
import { UserDropdown } from '@/components/layout/UserDropdown'
import { BrandMark, type BrandBusiness } from '@/components/layout/BrandMark'
import { userInitials } from '@/components/layout/userInitials'

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
 * Desktop:  la marca vive en el sidebar; aquí solo queda el menú de usuario (a la derecha).
 */
export function Header({ business, userName, role, isLoading = false }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-xinuco-bg/80 backdrop-blur-md border-b border-xinuco-border">
      <div className="flex h-14 items-center justify-between gap-3 w-full px-4 sm:px-6">

        {/* ── Izquierda: marca (solo móvil; en desktop está en el sidebar) ── */}
        <div className="flex items-center gap-2.5 min-w-0 md:invisible">
          <BrandMark business={business} size={32} />
          <span className="text-sm font-semibold text-xinuco-text truncate">
            {business?.name ?? 'Xinuco'}
          </span>
        </div>

        {/* ── Derecha: avatar / menú de usuario ─────────────── */}
        {isLoading ? (
          <AvatarSkeleton />
        ) : (
          <UserDropdown initials={userInitials(userName)} userName={userName} role={role} />
        )}
      </div>
    </header>
  )
}
