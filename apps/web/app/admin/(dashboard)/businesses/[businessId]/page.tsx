import { createClient } from '@xinuco/supabase/server'
import { redirect } from 'next/navigation'
import { BusinessFeatureManager } from '@/components/super-admin/BusinessFeatureManager'
import { TrialManager } from '@/components/super-admin/TrialManager'
import type { BusinessFeatures } from '@xinuco/types'

interface PageProps {
  params: Promise<{ businessId: string }>
}

/**
 * super-admin/businesses/[businessId]/page.tsx — Server Component
 * Shows the feature matrix for a specific business.
 * Renders <BusinessFeatureManager> client component.
 */
export default async function BusinessFeaturePage({ params }: PageProps) {
  const { businessId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/admin/login')

  if (user.app_metadata?.role !== 'super_admin') redirect('/admin/login')

  const { data: biz, error } = await supabase
    .from('businesses')
    .select('id, name, slug, features_enabled, trial_expires_at')
    .eq('id', businessId)
    .single()

  if (error || !biz) redirect('/admin/businesses')

  const features        = (biz.features_enabled ?? {}) as unknown as BusinessFeatures
  const trialExpiresAt  = (biz as Record<string, unknown>).trial_expires_at as string | null ?? null

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(244,244,244,0.45)' }}>
        <a href="/admin/businesses" style={{ color: '#C5A059' }}>Negocios</a>
        <span>/</span>
        <span>{biz.name}</span>
      </div>

      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#F4F4F4' }}>{biz.name}</h1>
        <p className="text-sm mt-0.5" style={{ color: 'rgba(244,244,244,0.45)' }}>/{biz.slug}</p>
      </div>

      {/* Tab nav */}
      <div
        className="flex gap-1 border-b pb-4"
        style={{ borderColor: 'rgba(197,160,89,0.12)' }}
      >
        <a
          href={`/admin/businesses/${businessId}`}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'rgba(197,160,89,0.1)', color: '#C5A059' }}
        >
          Features
        </a>
        <a
          href={`/admin/businesses/${businessId}/users`}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ color: 'rgba(244,244,244,0.45)' }}
        >
          Usuarios
        </a>
      </div>

      {/* Trial Manager */}
      <TrialManager
        businessId={biz.id}
        businessName={biz.name}
        trialExpiresAt={trialExpiresAt}
      />

      {/* Feature manager (client component) */}
      <BusinessFeatureManager
        businessId={biz.id}
        businessName={biz.name}
        initialFeatures={features}
      />
    </div>
  )
}
