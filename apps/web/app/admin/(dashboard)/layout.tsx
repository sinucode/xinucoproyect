import { ReactNode } from 'react'
import { createClient } from '@xinuco/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { LogOut } from 'lucide-react'
import { logout } from '@/actions/auth'

/**
 * AdminLayout — Panel GLOBAL de todas las verticales (apps/web).
 *
 * Ruta: /admin
 * Auth guard: sesión activa + app_metadata.role === 'super_admin'.
 * Si no autenticado → /admin/login.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()

  // ── Auth guard ──────────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/admin/login')

  // ── Role guard — solo super_admin ─────────────────────────────────────
  const role     = user.app_metadata?.role as string | undefined
  const fullName = (user.user_metadata?.full_name ?? user.email ?? 'Super Admin') as string

  if (role !== 'super_admin') redirect('/admin/login')

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#080808', color: '#F4F4F4' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-40 border-b"
        style={{ backgroundColor: '#0D0D0D', borderColor: 'rgba(197,160,89,0.15)' }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
              style={{
                background: 'color-mix(in srgb, #C5A059 15%, transparent)',
                border:     '1px solid color-mix(in srgb, #C5A059 30%, transparent)',
                color:      '#C5A059',
              }}
            >
              X
            </div>
            <span className="font-semibold tracking-wide text-sm" style={{ color: '#F4F4F4' }}>
              Xinuco{' '}
              <span style={{ color: '#C5A059' }}>Admin Global</span>
            </span>
          </div>

          <nav className="flex items-center gap-1">
            <Link
              href="/admin/verticales"
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
              style={{ color: 'rgba(244,244,244,0.65)' }}
            >
              Verticales
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'rgba(244,244,244,0.35)' }}>
              {fullName}
            </span>
            <form action={logout}>
              <button
                type="submit"
                aria-label="Cerrar sesión"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors text-[rgba(244,244,244,0.65)] hover:bg-white/5 hover:text-[#C5A059]"
              >
                <LogOut size={14} />
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>
    </div>
  )
}
