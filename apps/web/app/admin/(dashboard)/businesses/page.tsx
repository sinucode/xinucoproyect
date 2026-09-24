import { createClient } from '@xinuco/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { detectCurrentPlan, PLAN_BUNDLES, FEATURE_CATALOG } from '@xinuco/billing-catalog'
import type { BusinessFeatures, Business } from '@xinuco/types'

/**
 * super-admin/businesses/page.tsx — Server Component
 * Lists all businesses with plan detection badge and feature count.
 */
export default async function SuperAdminBusinessesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/admin/login')

  if (user.app_metadata?.role !== 'super_admin') redirect('/admin/login')

  const { data: businesses, error } = await supabase
    .from('businesses')
    .select('id, name, slug, is_active, features_enabled, created_at')
    .order('name')
    .returns<Business[]>()

  if (error) {
    return (
      <div className="text-sm" style={{ color: '#ff6b6b' }}>
        Error cargando negocios: {error.message}
      </div>
    )
  }

  const totalFeatures = Object.keys(FEATURE_CATALOG).length

  const PLAN_COLORS: Record<string, string> = {
    basico:  'rgba(161,161,170,0.15)',
    pro:     'rgba(59,130,246,0.15)',
    premium: 'rgba(197,160,89,0.15)',
    custom:  'rgba(168,85,247,0.15)',
  }
  const PLAN_TEXT: Record<string, string> = {
    basico:  '#a1a1aa',
    pro:     '#93c5fd',
    premium: '#C5A059',
    custom:  '#d8b4fe',
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: '#F4F4F4' }}>Negocios</h1>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(244,244,244,0.45)' }}>
            {businesses?.length ?? 0} tenants registrados
          </p>
        </div>
      </div>

      {/* Table */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: '1px solid rgba(197,160,89,0.12)', background: 'rgba(255,255,255,0.02)' }}
      >
        {/* Header */}
        <div
          className="grid grid-cols-[1fr_120px_80px_100px_60px] gap-4 px-5 py-3 text-xs font-semibold uppercase tracking-wider"
          style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(244,244,244,0.40)', borderBottom: '1px solid rgba(197,160,89,0.10)' }}
        >
          <span>Negocio</span>
          <span>Plan</span>
          <span>Features</span>
          <span>Estado</span>
          <span />
        </div>

        {/* Rows */}
        {(businesses ?? []).map((biz) => {
          const features    = (biz.features_enabled ?? {}) as unknown as BusinessFeatures
          const plan        = detectCurrentPlan(features)
          const planLabel   = plan === 'custom' ? 'Personalizado' : PLAN_BUNDLES[plan].label
          const enabledCount = Object.values(features).filter(Boolean).length

          return (
            <div
              key={biz.id}
              className="grid grid-cols-[1fr_120px_80px_100px_60px] gap-4 px-5 py-4 items-center transition-colors hover:bg-white/[0.025]"
              style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
            >
              {/* Name + slug */}
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="font-medium text-sm truncate" style={{ color: '#F4F4F4' }}>
                  {biz.name}
                </span>
                <span className="text-xs" style={{ color: 'rgba(244,244,244,0.35)' }}>
                  /{biz.slug}
                </span>
              </div>

              {/* Plan badge */}
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold w-fit"
                style={{ background: PLAN_COLORS[plan], color: PLAN_TEXT[plan] }}
              >
                {planLabel}
              </span>

              {/* Feature count */}
              <span className="text-sm tabular-nums" style={{ color: 'rgba(244,244,244,0.60)' }}>
                {enabledCount} / {totalFeatures}
              </span>

              {/* Status */}
              <span
                className="inline-flex items-center gap-1.5 text-xs font-medium"
                style={{ color: biz.is_active ? '#4ade80' : 'rgba(244,244,244,0.35)' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: biz.is_active ? '#4ade80' : 'rgba(244,244,244,0.25)' }}
                />
                {biz.is_active ? 'Activo' : 'Inactivo'}
              </span>

              {/* Action */}
              <Link
                href={`/admin/businesses/${biz.id}`}
                className="text-xs font-medium transition-colors text-right"
                style={{ color: '#C5A059' }}
              >
                Gestionar
              </Link>
            </div>
          )
        })}

        {(!businesses || businesses.length === 0) && (
          <div
            className="px-5 py-12 text-center text-sm"
            style={{ color: 'rgba(244,244,244,0.35)' }}
          >
            No hay negocios registrados.
          </div>
        )}
      </div>
    </div>
  )
}
