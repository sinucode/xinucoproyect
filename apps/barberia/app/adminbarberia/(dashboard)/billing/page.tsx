import type { Metadata } from 'next'
import { createClient } from '@xinuco/supabase/server'
import { redirect }     from 'next/navigation'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import {
  CreditCard, AlertCircle, TrendingUp, CheckCircle,
  Clock, XCircle, Zap, Crown, Loader,
} from 'lucide-react'
import { PLAN_PRICES_COP } from '@xinuco/billing-catalog'
import { adminLoginUrl, BARBERIA_URL } from '@xinuco/utils'

export const metadata: Metadata = {
  title: 'Facturación SaaS — Xinuco Admin',
  description: 'Estado de suscripciones MercadoPago de los negocios',
}

// ── Mapa visual de estados ────────────────────────────────────────────────────

const SUB_STATUS_MAP: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  authorized: { label: 'Activo',      color: 'text-green-400 bg-green-500/10 border-green-500/20',    icon: CheckCircle },
  pending:    { label: 'Pendiente',   color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',    icon: Loader },
  paused:     { label: 'Pausado',     color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',       icon: Clock },
  cancelled:  { label: 'Cancelado',   color: 'text-red-400 bg-red-500/10 border-red-500/20',          icon: XCircle },
  none:       { label: 'Sin plan',    color: 'text-zinc-500 bg-zinc-900 border-zinc-800',             icon: Zap },
}

const PLAN_ICON_MAP: Record<string, React.ElementType> = {
  esencial:    Zap,
  profesional: CheckCircle,
  elite:       Crown,
}

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

// ── Página ────────────────────────────────────────────────────────────────────

export default async function BillingPage() {
  // Auth guard
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(adminLoginUrl(`${BARBERIA_URL}/adminbarberia`))

  // Usar service role para leer mp_subscriptions (bypass RLS)
  const adminClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  // Fetch en paralelo: negocios + suscripciones
  const [{ data: businesses }, { data: subscriptions }] = await Promise.all([
    adminClient
      .from('businesses')
      .select('id, name, slug, is_active, subscription_status, created_at')
      .order('created_at', { ascending: false }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adminClient as any)
      .from('mp_subscriptions')
      .select('business_id, plan_id, status, amount_cop, mp_subscription_id, next_billing_date') as Promise<{
        data: {
          business_id: string; plan_id: string; status: string
          amount_cop: number; mp_subscription_id: string | null; next_billing_date: string | null
        }[] | null
      }>,
  ])

  const biz  = businesses ?? []
  const subs = (subscriptions as unknown as {
    business_id: string; plan_id: string; status: string
    amount_cop: number; mp_subscription_id: string | null; next_billing_date: string | null
  }[] | null) ?? []

  // Índice subs por business_id
  const subIndex = Object.fromEntries(subs.map(s => [s.business_id, s]))

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const totalActive   = subs.filter(s => s.status === 'authorized').length
  const totalPending  = subs.filter(s => s.status === 'pending').length
  const totalPro      = subs.filter(s => s.plan_id === 'profesional' && s.status === 'authorized').length
  const totalPremium  = subs.filter(s => s.plan_id === 'elite'       && s.status === 'authorized').length

  // MRR estimado
  const mrr = subs
    .filter(s => s.status === 'authorized')
    .reduce((sum, s) => sum + (s.amount_cop ?? 0), 0)

  return (
    <div className="space-y-8">

      {/* ── Encabezado ── */}
      <div>
        <h1 className="text-2xl font-bold text-xinuco-text">Facturación SaaS</h1>
        <p className="text-sm text-xinuco-muted mt-1">
          Suscripciones activas vía MercadoPago PreApproval.
        </p>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Activos',  value: totalActive,  icon: CheckCircle,  color: '#10B981' },
          { label: 'Profesional', value: totalPro,     icon: CheckCircle,  color: '#60a5fa' },
          { label: 'Élite',       value: totalPremium, icon: Crown,        color: '#C5A059' },
          { label: 'Pendientes', value: totalPending, icon: Loader,      color: '#F59E0B' },
          { label: 'MRR',      value: fmtCOP(mrr),  icon: TrendingUp,   color: '#34d399' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-xinuco-surface border border-xinuco-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-xinuco-muted uppercase tracking-wider">{label}</p>
              <Icon size={14} style={{ color }} />
            </div>
            <p className="text-2xl font-bold text-xinuco-text">{value}</p>
          </div>
        ))}
      </div>

      {/* ── Precios de referencia ── */}
      <div className="flex items-center gap-6 px-4 py-3 rounded-xl border border-xinuco-border bg-xinuco-surface/50 text-xs text-xinuco-muted">
        <span className="font-semibold text-xinuco-text">Tarifas mensuales:</span>
        <span>Esencial — <strong className="text-zinc-300">{fmtCOP(PLAN_PRICES_COP.esencial)}</strong></span>
        <span>Profesional — <strong className="text-blue-400">{fmtCOP(PLAN_PRICES_COP.profesional)}</strong></span>
        <span>Élite — <strong className="text-amber-400">{fmtCOP(PLAN_PRICES_COP.elite)}</strong></span>
      </div>

      {/* ── Tabla de suscripciones ── */}
      <div className="rounded-xl border border-xinuco-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-xinuco-border bg-xinuco-surface/50">
          <h2 className="text-sm font-semibold text-xinuco-text">Suscripciones</h2>
          <div className="flex items-center gap-1.5">
            <CreditCard size={14} className="text-xinuco-muted" />
            <span className="text-xs text-xinuco-muted">{biz.length} negocios</span>
          </div>
        </div>

        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-xinuco-border">
              <th className="px-5 py-3 text-[10px] font-medium text-xinuco-muted uppercase tracking-wider">Negocio</th>
              <th className="px-5 py-3 text-[10px] font-medium text-xinuco-muted uppercase tracking-wider">Plan</th>
              <th className="px-5 py-3 text-[10px] font-medium text-xinuco-muted uppercase tracking-wider">Estado</th>
              <th className="px-5 py-3 text-[10px] font-medium text-xinuco-muted uppercase tracking-wider">Próx. cobro</th>
              <th className="px-5 py-3 text-[10px] font-medium text-xinuco-muted uppercase tracking-wider">Preapproval ID</th>
            </tr>
          </thead>
          <tbody>
            {biz.map((b) => {
              const sub       = subIndex[b.id]
              const planId    = sub?.plan_id ?? 'esencial'
              const status    = sub?.status  ?? 'none'
              const statusDef = SUB_STATUS_MAP[status] ?? SUB_STATUS_MAP.none
              const StatusIcon = statusDef.icon
              const PlanIcon   = PLAN_ICON_MAP[planId] ?? Zap

              return (
                <tr key={b.id} className="border-b border-xinuco-border last:border-0 hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-4">
                    <p className="font-medium text-xinuco-text">{b.name}</p>
                    <p className="text-[10px] text-xinuco-muted font-mono">/{b.slug}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className="flex items-center gap-1.5 text-xs text-xinuco-muted capitalize">
                      <PlanIcon size={12} />
                      {planId}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusDef.color}`}>
                      <StatusIcon size={11} />
                      {statusDef.label}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-xs text-xinuco-muted">
                    {sub?.next_billing_date
                      ? new Date(sub.next_billing_date).toLocaleDateString('es-CO')
                      : '—'
                    }
                  </td>
                  <td className="px-5 py-4">
                    {sub?.mp_subscription_id
                      ? <span className="font-mono text-[10px] text-zinc-500">{sub.mp_subscription_id.substring(0, 16)}…</span>
                      : <span className="text-xs text-zinc-600 italic">Sin suscripción</span>
                    }
                  </td>
                </tr>
              )
            })}
            {biz.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-xinuco-muted text-sm">
                  No hay negocios registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Nota de integración ── */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-zinc-800 bg-zinc-900/30">
        <AlertCircle size={16} className="text-zinc-500 shrink-0 mt-0.5" />
        <p className="text-xs text-zinc-500 leading-relaxed">
          Las suscripciones se gestionan vía{' '}
          <strong className="text-zinc-400">MercadoPago PreApproval API</strong>. El estado se
          actualiza automáticamente cuando el webhook{' '}
          <code className="font-mono bg-zinc-800 px-1 rounded">/api/webhooks/mercadopago</code>{' '}
          recibe eventos <code className="font-mono bg-zinc-800 px-1 rounded">preapproval</code>.
          Configura la URL del webhook en el panel de MercadoPago para que apunte a tu dominio de Vercel.
        </p>
      </div>
    </div>
  )
}
