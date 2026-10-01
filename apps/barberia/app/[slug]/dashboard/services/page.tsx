import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { getServicesOverview } from '@/actions/services'
import { ServiceManager } from '@/components/dashboard/services/ServiceManager'
import { Loader2 } from 'lucide-react'
import type { Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Servicios — Xinuco',
  description: 'Gestión de servicios y precios',
}

export default async function ServicesPage({ params }: { params: Promise<{ slug: string }> }) {
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

  // Servicios + barberos + estaciones + métricas del mes (business_id sale del perfil)
  const overview = await getServicesOverview()
  if ('error' in overview) redirect(`/${slug}/dashboard`)

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
      <Suspense fallback={<ServicesSkeleton />}>
        <ServiceManager overview={overview} />
      </Suspense>
    </div>
  )
}

/** Skeleton de carga elegante para la sección de servicios */
function ServicesSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between pb-6 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
          <div className="flex flex-col gap-2">
            <div className="h-6 w-48 rounded-md" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
            <div className="h-3 w-64 rounded-md" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
          </div>
        </div>
        <div className="h-10 w-36 rounded-lg" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
      </div>

      {/* Table skeleton */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
        {/* Header row */}
        <div className="flex gap-4 px-5 py-3.5" style={{ background: 'var(--surface-color, rgba(255,255,255,0.03))' }}>
          <div className="h-3 w-24 rounded" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
          <div className="h-3 w-20 rounded hidden sm:block" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
          <div className="h-3 w-16 rounded" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
          <div className="h-3 w-16 rounded hidden sm:block" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
        </div>

        {/* Data rows */}
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-5 py-4"
            style={{ borderTop: '1px solid var(--border-color)' }}
          >
            <div className="flex flex-col gap-1.5 flex-1">
              <div className="h-4 w-32 rounded" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
              <div className="h-3 w-48 rounded" style={{ background: 'var(--surface-color, #1a1a1a)', opacity: 0.5 }} />
            </div>
            <div className="h-4 w-14 rounded hidden sm:block" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
            <div className="h-4 w-20 rounded" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
            <div className="h-6 w-11 rounded-full hidden sm:block" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
            <div className="h-6 w-6 rounded" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
