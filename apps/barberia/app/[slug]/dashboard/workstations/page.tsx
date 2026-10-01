import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@xinuco/supabase/server'
import { getWorkstationsOverview } from '@/actions/workstations'
import { WorkstationManager } from '@/components/dashboard/workstations/WorkstationManager'
import type { BusinessFeatures, Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Estaciones — Xinuco',
  description: 'Espacios compartidos del negocio: lavacabezas, sillón de tinte, silla de niños',
}

export default async function WorkstationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  // 1. Auth guard — redirige si no hay sesión activa
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
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

  // Feature gate: check workstations flag server-side
  const { data: biz } = await supabase
    .from('businesses')
    .select('features_enabled')
    .eq('slug', slug)
    .single<{ features_enabled: unknown }>()
  const features = (biz?.features_enabled ?? {}) as unknown as BusinessFeatures
  if (!features?.workstations) redirect(`/${slug}/dashboard`)

  // 3. Estaciones + servicios que las necesitan (business_id sale del perfil)
  const overview = await getWorkstationsOverview()
  if ('error' in overview) redirect(`/${slug}/dashboard`)

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6">
      <Link
        href={`/${slug}/dashboard/settings`}
        className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-xinuco-muted transition-colors hover:text-xinuco-text"
      >
        <ArrowLeft size={14} />
        Configuración
      </Link>
      <Suspense fallback={<WorkstationsSkeleton />}>
        <WorkstationManager overview={overview} />
      </Suspense>
    </div>
  )
}

/** Skeleton de carga elegante para la sección de estaciones */
function WorkstationsSkeleton() {
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

      {/* Cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-2">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="rounded-xl p-5 flex flex-col gap-3"
            style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.03))' }}
          >
            <div className="flex items-center justify-between">
              <div className="h-5 w-32 rounded" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
              <div className="h-6 w-11 rounded-full" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
            </div>
            <div className="h-3 w-48 rounded" style={{ background: 'var(--surface-color, #1a1a1a)', opacity: 0.6 }} />
            <div className="h-3 w-28 rounded" style={{ background: 'var(--surface-color, #1a1a1a)', opacity: 0.6 }} />
          </div>
        ))}
      </div>
    </div>
  )
}
