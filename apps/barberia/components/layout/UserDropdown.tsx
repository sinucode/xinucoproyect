'use client'

import { useState, useTransition } from 'react'
import { LogOut, Loader2 } from 'lucide-react'
import { logout } from '@/actions/auth'
import { roleLabel } from '@/lib/roles'

interface UserDropdownProps {
  initials: string
  userName?: string
  role?: string
}

export function UserDropdown({ initials, userName, role }: UserDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleLogout = () => {
    startTransition(async () => {
      await logout()
    })
  }

  return (
    <div className="relative">
      <button
        id="btn-user-avatar"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={userName ? `Perfil de ${userName}` : 'Perfil'}
        title={userName ?? 'Perfil'}
        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all duration-200 hover:opacity-80 active:scale-95 cursor-pointer"
        style={{
          background: 'color-mix(in srgb, var(--primary-color) 20%, transparent)',
          color:       'var(--primary-color)',
          border:      '1.5px solid color-mix(in srgb, var(--primary-color) 50%, transparent)',
        }}
      >
        {initials}
      </button>

      {isOpen && (
        <>
          {/* Overlay invisible para cerrar al hacer click afuera */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          
          <div 
            className="absolute right-0 mt-2 w-48 bg-xinuco-bg border border-xinuco-border rounded-xl shadow-xl z-50 overflow-hidden animate-slide-up" 
            style={{ borderColor: 'var(--surface-color, #333)' }}
          >
            <div className="px-4 py-3 border-b border-xinuco-border" style={{ borderColor: 'var(--surface-color, #333)' }}>
              <p className="text-sm font-semibold text-xinuco-text truncate">{userName || 'Usuario'}</p>
              {role && (
                <p className="text-xs text-xinuco-muted truncate">{roleLabel(role)}</p>
              )}
            </div>
            
            <div className="p-1.5">
              <button
                onClick={handleLogout}
                disabled={isPending}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 rounded-lg transition-colors text-left font-medium"
              >
                {isPending ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
                <span>{isPending ? 'Saliendo...' : 'Cerrar sesión'}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
