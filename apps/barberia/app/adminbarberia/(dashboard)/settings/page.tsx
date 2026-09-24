import type { Metadata } from 'next'
import { createClient } from '@xinuco/supabase/server'
import { redirect }     from 'next/navigation'
import {
  Settings2, Server, Globe, Shield, Zap, Info,
  GitBranch, Clock,
} from 'lucide-react'
import { adminLoginUrl, BARBERIA_URL } from '@xinuco/utils'

export const metadata: Metadata = {
  title: 'Configuración — Xinuco Admin',
  description: 'Ajustes globales de la plataforma Xinuco SaaS',
}

interface EnvVarRowProps {
  label:       string
  value:       string
  sensitive?:  boolean
  status?:     'ok' | 'warn' | 'missing'
}

function EnvVarRow({ label, value, sensitive = false, status = 'ok' }: EnvVarRowProps) {
  const statusColor =
    status === 'ok'      ? 'text-green-400'  :
    status === 'warn'    ? 'text-amber-400'   :
    /* missing */          'text-red-400'

  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-xinuco-border last:border-0">
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full shrink-0 ${
          status === 'ok' ? 'bg-green-400' : status === 'warn' ? 'bg-amber-400' : 'bg-red-400'
        }`} />
        <span className="text-xs font-mono text-xinuco-muted">{label}</span>
      </div>
      <span className={`text-xs font-mono ${statusColor}`}>
        {sensitive ? '••••••••••••' : value}
      </span>
    </div>
  )
}

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(adminLoginUrl(`${BARBERIA_URL}/adminbarberia`))

  // Estadísticas globales
  const { count: totalBiz } = await supabase
    .from('businesses')
    .select('*', { count: 'exact', head: true })

  const { count: activeBiz } = await supabase
    .from('businesses')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  const now  = new Date()
  const date = now.toLocaleDateString('es-CO', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  // Variables de entorno (solo indicar presencia, no exponer valores)
  const envVars: EnvVarRowProps[] = [
    {
      label:    'NEXT_PUBLIC_SUPABASE_URL',
      value:    process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Configurada ✓' : 'Faltante',
      status:   process.env.NEXT_PUBLIC_SUPABASE_URL ? 'ok' : 'missing',
    },
    {
      label:    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      value:    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'Configurada ✓' : 'Faltante',
      sensitive: true,
      status:   process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'ok' : 'missing',
    },
    {
      label:    'SUPABASE_SERVICE_ROLE_KEY',
      value:    process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Configurada ✓' : 'Faltante',
      sensitive: true,
      status:   process.env.SUPABASE_SERVICE_ROLE_KEY ? 'ok' : 'missing',
    },
    {
      label:    'RESEND_API_KEY',
      value:    process.env.RESEND_API_KEY ? 'Configurada ✓' : 'No configurada',
      sensitive: true,
      status:   process.env.RESEND_API_KEY ? 'ok' : 'warn',
    },
    {
      label:    'STRIPE_SECRET_KEY',
      value:    process.env.STRIPE_SECRET_KEY ? 'Configurada ✓' : 'Pendiente de integración',
      sensitive: true,
      status:   process.env.STRIPE_SECRET_KEY ? 'ok' : 'warn',
    },
  ]

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold text-xinuco-text">Configuración Global</h1>
        <p className="text-sm text-xinuco-muted mt-1">
          Ajustes de plataforma, variables de entorno y estado del sistema.
        </p>
      </div>

      {/* KPIs del sistema */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Negocios',  value: String(totalBiz ?? 0),      icon: Globe,    color: 'var(--primary-color)' },
          { label: 'Activos',         value: String(activeBiz ?? 0),     icon: Zap,      color: '#10B981' },
          { label: 'Versión',         value: '0.1.0',                    icon: GitBranch,color: '#8B5CF6' },
          { label: 'Entorno',         value: 'Development',              icon: Server,   color: '#F59E0B' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-xinuco-surface border border-xinuco-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] text-xinuco-muted uppercase tracking-wider">{label}</p>
              <Icon size={15} style={{ color }} />
            </div>
            <p className="text-xl font-bold text-xinuco-text">{value}</p>
          </div>
        ))}
      </div>

      {/* Estado del servidor */}
      <div className="rounded-xl border border-xinuco-border overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-xinuco-border bg-xinuco-surface/50">
          <Settings2 size={15} className="text-xinuco-muted" />
          <h2 className="text-sm font-semibold text-xinuco-text">Variables de Entorno</h2>
        </div>
        <div className="px-5">
          {envVars.map((ev) => <EnvVarRow key={ev.label} {...ev} />)}
        </div>
        <div className="px-5 py-3 border-t border-xinuco-border bg-xinuco-surface/30 flex items-center gap-2">
          <Info size={12} className="text-xinuco-muted" />
          <p className="text-[10px] text-xinuco-muted">
            Los valores sensibles se enmascaran. Edítalos directamente en <code className="font-mono bg-xinuco-surface px-1 rounded">.env.local</code>.
          </p>
        </div>
      </div>

      {/* Info del sistema */}
      <div className="rounded-xl border border-xinuco-border overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-xinuco-border bg-xinuco-surface/50">
          <Server size={15} className="text-xinuco-muted" />
          <h2 className="text-sm font-semibold text-xinuco-text">Información del Sistema</h2>
        </div>
        <div className="px-5">
          {[
            { label: 'Next.js',       value: '16.2.5' },
            { label: 'Framework',     value: 'App Router + Turbopack' },
            { label: 'Base de datos', value: 'Supabase (PostgreSQL 15)' },
            { label: 'Auth',          value: 'Supabase Auth (JWT + PKCE)' },
            { label: 'Deploy',        value: 'Local / Vercel' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between gap-4 py-3 border-b border-xinuco-border last:border-0">
              <span className="text-xs text-xinuco-muted">{label}</span>
              <span className="text-xs font-mono text-xinuco-text">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Última lectura */}
      <div className="flex items-center gap-2 text-xs text-xinuco-muted">
        <Clock size={12} />
        <span>Datos capturados: {date}</span>
      </div>
    </div>
  )
}
