import { createClient } from '@xinuco/supabase/server'
import { redirect }      from 'next/navigation'
import { AdminSidebar }  from '@/components/admin/AdminSidebar'
import { adminLoginUrl, BARBERIA_URL } from '@xinuco/utils'

interface AdminLayoutProps {
  children: React.ReactNode
}

/**
 * AdminLayout — Layout global del panel de administración SaaS.
 *
 * Sidebar lateral fijo + área de contenido.
 * [SEC H-1] Doble guarda: sesión activa + rol super_admin en app_metadata.
 * app_metadata solo es escribible desde el servidor (service role) — no
 * puede ser manipulado por el cliente.
 */
export default async function AdminLayout({ children }: AdminLayoutProps) {
  const supabase = await createClient()

  // ── Guard de sesión ───────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(adminLoginUrl(`${BARBERIA_URL}/adminbarberia`))

  // ── [SEC H-1] Guard de rol: solo super_admin puede acceder ───────────────
  // Se lee de app_metadata (solo modificable por service role en servidor).
  // Cualquier otro rol — incluyendo admin de tenant — es redirigido a login.
  if (user.app_metadata?.role !== 'super_admin') {
    redirect(adminLoginUrl(`${BARBERIA_URL}/adminbarberia`))
  }

  return (
    <div className="flex min-h-screen bg-xinuco-bg">
      {/* Sidebar */}
      <AdminSidebar />

      {/* Área principal */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between
                           px-8 py-4 border-b border-xinuco-border bg-xinuco-bg/90 backdrop-blur-md">
          <div>
            <h1 className="text-sm font-semibold text-xinuco-text">Panel de Administración</h1>
            <p className="text-xs text-xinuco-muted">Gestión global de Xinuco SaaS</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Indicador de entorno */}
            <span className="badge text-amber-400 bg-amber-500/10 border border-amber-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-soft" />
              Desarrollo
            </span>
          </div>
        </header>

        {/* Contenido de la página */}
        <main className="flex-1 px-8 py-8">
          {children}
        </main>
      </div>
    </div>
  )
}
