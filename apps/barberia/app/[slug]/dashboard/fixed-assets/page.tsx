import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { getFixedAssets, getAssetPortfolioSummary } from '@/actions/fixed-assets'
import { getActiveShift } from '@/actions/finance'
import { FixedAssetsManager } from '@/components/dashboard/fixed-assets/FixedAssetsManager'
import { FeatureGate } from '@/components/dashboard/FeatureGate'
import type { Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Activos fijos — Xinuco',
  description: 'Los equipos del negocio: cuánto valen hoy y cuánto se desgastan cada mes',
}

// ── Página ────────────────────────────────────────────────────────────────────

export default async function FixedAssetsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // 1. Auth guard
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  // 2. Obtener perfil: business_id + role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', user.id)
    .single<Pick<Profile, 'role' | 'business_id'>>()

  if (!profile?.business_id) redirect(`/${slug}/login`)

  // Role guard: solo admin puede acceder
  if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
    redirect(`/${slug}/dashboard`)
  }

  // 3. Cargar equipos en uso, dados de baja, resumen y turno de caja (para pagar/recibir con efectivo).
  //    El negocio sale del perfil dentro de las acciones; aquí solo se usa para el turno.
  const [activeResult, disposedResult, summaryResult, openShift] = await Promise.all([
    getFixedAssets({ status: 'active' }),
    getFixedAssets({ status: 'disposed' }),
    getAssetPortfolioSummary(),
    getActiveShift(profile.business_id),
  ])

  const loadError = activeResult.error ?? disposedResult.error ?? null

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 pb-24">
      <Suspense fallback={<FixedAssetsSkeleton />}>
        <FeatureGate featureKey="fixed_assets" planName="Élite">
          <FixedAssetsManager
            assets={activeResult.data ?? []}
            disposed={disposedResult.data ?? []}
            summary={summaryResult.data ?? null}
            hasOpenShift={!!openShift}
            loadError={loadError}
          />
        </FeatureGate>
      </Suspense>
    </div>
  )
}

// ── Skeleton de carga ─────────────────────────────────────────────────────────

function FixedAssetsSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      {/* Header skeleton */}
      <div
        className="flex items-center justify-between pb-6 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
          <div className="flex flex-col gap-2">
            <div className="h-6 w-40 rounded-md" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
            <div className="h-3 w-64 rounded-md" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
          </div>
        </div>
        <div className="h-10 w-36 rounded-lg" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
      </div>

      {/* Summary cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-xl" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
        ))}
      </div>

      {/* Asset cards skeleton */}
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 rounded-xl" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
        ))}
      </div>
    </div>
  )
}
