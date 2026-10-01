import { createClient } from '@xinuco/supabase/server'
import { redirect } from 'next/navigation'
import { AdminPageHeader } from '@xinuco/ui'
import { getAuditActors, getAuditAlerts, getAuditLogs, getAuditRetentionMonths } from '@/actions/audit'
import { AuditLogViewer } from '@/components/dashboard/audit/AuditLogViewer'
import { businessTodayISODate } from '@/lib/agenda-time'
import { retentionNotice } from '@/lib/audit-retention'
import type { BusinessFeatures } from '@xinuco/types'

interface AuditPageProps {
  params: Promise<{ slug: string }>
}

export default async function AuditPage({ params }: AuditPageProps) {
  const { slug } = await params
  const supabase = await createClient()

  // ── Auth Guard ──────────────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  // ── Verificar rol: solo admin puede acceder a auditoría ─────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    redirect(`/${slug}/dashboard`)
  }

  // Feature gate: check audit_logs flag server-side
  const { data: biz } = await supabase
    .from('businesses')
    .select('features_enabled')
    .eq('slug', slug)
    .single()
  const featureFlags = (biz?.features_enabled ?? {}) as unknown as BusinessFeatures
  if (!featureFlags?.audit_logs) redirect(`/${slug}/dashboard`)

  // ── Primera página, alertas de la semana y personas para el filtro ──────────
  const [logs, alerts, actors, retentionMonths] = await Promise.all([
    getAuditLogs({}),
    getAuditAlerts(),
    getAuditActors(),
    getAuditRetentionMonths(),
  ])

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
      <AdminPageHeader
        title="Auditoría"
        subtitle="Quién hizo qué y cuándo: dinero, caja, inventario, citas y configuración. Solo lo ve el administrador."
      />

      <p className="-mt-3 text-xs text-xinuco-muted">{retentionNotice(retentionMonths)}</p>

      <AuditLogViewer
        initialLogs={'error' in logs ? [] : logs.logs}
        initialHasMore={'error' in logs ? false : logs.hasMore}
        initialError={'error' in logs ? logs.error : null}
        alerts={'error' in alerts ? null : alerts}
        actors={'error' in actors ? null : actors}
        today={businessTodayISODate()}
      />
    </div>
  )
}
