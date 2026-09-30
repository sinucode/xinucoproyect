import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { getCommissionsOverview } from '@/actions/commissions'
import { CommissionManager } from '@/components/dashboard/commissions/CommissionManager'
import { addDaysToDateKey, businessTodayISODate } from '@/lib/agenda-time'
import type { BusinessFeatures, Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Comisiones — Xinuco',
  description: 'Comisiones automáticas para el equipo',
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Toma el primer valor de un searchParam si vino repetido. */
function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** Fecha 'YYYY-MM-DD' real (rechaza 2026-02-31, etc.). */
function validDateKey(v: string | undefined): v is string {
  return !!v && DATE_RE.test(v) && addDaysToDateKey(v, 0) === v
}

export default async function CommissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { slug } = await params
  const sp = await searchParams

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

  // Feature gate: check commissions flag server-side
  const { data: biz } = await supabase
    .from('businesses')
    .select('features_enabled')
    .eq('slug', slug)
    .single<{ features_enabled: unknown }>()
  const features = (biz?.features_enabled ?? {}) as unknown as BusinessFeatures
  if (!features?.commissions) redirect(`/${slug}/dashboard`)

  // 3. Período: por defecto el mes actual (día 1 → hoy, hora del negocio)
  const today = businessTodayISODate()
  const qFrom = firstParam(sp.from)
  const qTo   = firstParam(sp.to)
  const from = validDateKey(qFrom) ? qFrom : `${today.slice(0, 8)}01`
  const to   = validDateKey(qTo)   ? qTo   : today

  // 4. Datos (business_id sale del perfil dentro de la acción)
  const overview = await getCommissionsOverview({ from, to })
  if ('error' in overview) redirect(`/${slug}/dashboard`)

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 pb-24">
      <Suspense fallback={<CommissionsSkeleton />}>
        <CommissionManager overview={overview} slug={slug} />
      </Suspense>
    </div>
  )
}

// ── Skeleton de carga ─────────────────────────────────────────────────────────

function CommissionsSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      {/* Header skeleton */}
      <div
        className="flex items-center justify-between pb-6 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl"
            style={{ background: 'var(--surface-color, #1a1a1a)' }}
          />
          <div className="flex flex-col gap-2">
            <div
              className="h-6 w-48 rounded-md"
              style={{ background: 'var(--surface-color, #1a1a1a)' }}
            />
            <div
              className="h-3 w-64 rounded-md"
              style={{ background: 'var(--surface-color, #1a1a1a)' }}
            />
          </div>
        </div>
        <div
          className="h-10 w-36 rounded-lg"
          style={{ background: 'var(--surface-color, #1a1a1a)' }}
        />
      </div>

      {/* Table skeleton */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--border-color)' }}
      >
        <div
          className="flex gap-4 px-5 py-3.5"
          style={{ background: 'var(--surface-color, rgba(255,255,255,0.03))' }}
        >
          {[32, 40, 24, 24, 16].map((w, i) => (
            <div
              key={i}
              className={`h-3 w-${w} rounded`}
              style={{ background: 'var(--surface-color, #1a1a1a)' }}
            />
          ))}
        </div>

        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-5 py-4"
            style={{ borderTop: '1px solid var(--border-color)' }}
          >
            <div className="flex-1 h-4 rounded" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
            <div className="h-4 w-24 rounded" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
            <div className="h-6 w-12 rounded-full" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
            <div className="h-6 w-6 rounded" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
