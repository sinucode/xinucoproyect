import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { getTeamOverview } from '@/actions/staff'
import { StaffManager } from '@/components/dashboard/staff/StaffManager'
import { getBusinessBySlug } from '@/actions/businesses'
import { notFound } from 'next/navigation'
import type { Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Equipo — Xinuco',
  description: 'Profesionales, horarios y servicios',
}

export default async function StaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  // Auth guard
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  // Role guard: solo admin puede acceder
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', user.id)
    .single<Pick<Profile, 'role' | 'business_id'>>()

  if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
    redirect(`/${slug}/dashboard`)
  }

  // 1. Obtener negocio
  const business = await getBusinessBySlug(slug)
  if (!business) notFound()

  // 2. Obtener el equipo (profesionales + horarios + servicios + estado ahora)
  const overview = await getTeamOverview()
  if ('error' in overview) redirect(`/${slug}/dashboard`)

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 pb-24">
      <Suspense fallback={<StaffSkeleton />}>
        <StaffManager
          businessId={business.id}
          members={overview.members}
          services={overview.services}
          todayKey={overview.todayKey}
          linkableUsers={overview.linkableUsers}
        />
      </Suspense>
    </div>
  )
}

/**
 * Skeleton de carga elegante para la sección de Equipo.
 * Simula el layout del Header y el Grid de tarjetas.
 */
function StaffSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      {/* Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
          <div className="flex flex-col gap-2">
            <div className="h-7 w-40 rounded-md" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
            <div className="h-4 w-56 rounded-md" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
          </div>
        </div>
        <div className="h-11 w-40 rounded-xl" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
      </div>

      {/* Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mt-6">
        {[...Array(6)].map((_, i) => (
          <div 
            key={i} 
            className="rounded-2xl p-5 flex flex-col gap-5"
            style={{ 
              background: 'var(--surface-color, #1a1a1a)',
              border: '1px solid var(--border-color)'
            }}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3.5">
                {/* Avatar Skeleton */}
                <div className="w-12 h-12 rounded-full" style={{ background: 'var(--bg-color)' }} />
                <div className="flex flex-col gap-2">
                  <div className="h-5 w-32 rounded" style={{ background: 'var(--bg-color)' }} />
                  <div className="h-4 w-20 rounded" style={{ background: 'var(--bg-color)' }} />
                </div>
              </div>
              {/* Switch Skeleton */}
              <div className="w-11 h-6 rounded-full shrink-0" style={{ background: 'var(--bg-color)' }} />
            </div>

            <div className="h-px w-full" style={{ background: 'var(--border-color)' }} />

            {/* Acciones Skeleton */}
            <div className="h-9 w-28 rounded-xl" style={{ background: 'var(--bg-color)' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
