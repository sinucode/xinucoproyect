import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { getTeamOverview } from '@/actions/staff'
import { getCommissionsOverview } from '@/actions/commissions'
import { StaffManager } from '@/components/dashboard/staff/StaffManager'
import { StaffTabs } from '@/components/dashboard/staff/StaffTabs'
import { CommissionsLocked } from '@/components/dashboard/staff/CommissionsLocked'
import { CommissionManager } from '@/components/dashboard/commissions/CommissionManager'
import { businessTodayISODate } from '@/lib/agenda-time'
import { getBusinessBySlug } from '@/actions/businesses'
import { notFound } from 'next/navigation'
import { operatingHoursToStaffRows } from '@/lib/business-hours'
import type { BusinessFeatures, Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Equipo — Xinuco',
  description: 'Profesionales, horarios y servicios',
}

export default async function StaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { slug } = await params
  const sp = await searchParams
  const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab
  const tab: 'profesionales' | 'comisiones' = rawTab === 'comisiones' ? 'comisiones' : 'profesionales'

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

  // Features efectivas (con el override de trial, igual que el sidebar)
  const { data: biz } = await supabase
    .from('businesses')
    .select('features_enabled, trial_expires_at')
    .eq('id', business.id)
    .maybeSingle<{ features_enabled: unknown; trial_expires_at: string | null }>()
  const trialActive = !!biz?.trial_expires_at && new Date(biz.trial_expires_at) > new Date()
  const features = (biz?.features_enabled ?? {}) as unknown as BusinessFeatures
  const commissionsEnabled = trialActive || features?.commissions === true

  const wrapper = 'flex flex-col gap-6 max-w-[1600px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6'

  // ── Pestaña Comisiones ──────────────────────────────────────────────────────
  if (tab === 'comisiones') {
    if (!commissionsEnabled) {
      return (
        <div className={wrapper}>
          <StaffTabs slug={slug} active="comisiones" commissionsLocked />
          <CommissionsLocked slug={slug} />
        </div>
      )
    }

    // El resumen "ganado" ya no se muestra aquí; se pide el mes actual solo por contrato de la acción.
    const today = businessTodayISODate()
    const overview = await getCommissionsOverview({ from: `${today.slice(0, 8)}01`, to: today })
    if ('error' in overview) redirect(`/${slug}/dashboard`)

    return (
      <div className={wrapper}>
        <StaffTabs slug={slug} active="comisiones" commissionsLocked={false} />
        <Suspense fallback={<StaffSkeleton />}>
          <CommissionManager overview={overview} slug={slug} />
        </Suspense>
      </div>
    )
  }

  // ── Pestaña Profesionales ───────────────────────────────────────────────────
  // Horario del negocio (para "Copiar horario del negocio" al crear un profesional)
  const { data: hoursRow } = await supabase
    .from('businesses')
    .select('operating_hours')
    .eq('id', business.id)
    .maybeSingle<{ operating_hours: unknown }>()
  const businessSchedule = operatingHoursToStaffRows(hoursRow?.operating_hours)

  // El equipo (profesionales + horarios + servicios + estado ahora)
  const overview = await getTeamOverview()
  if ('error' in overview) redirect(`/${slug}/dashboard`)

  return (
    <div className={wrapper}>
      <StaffTabs slug={slug} active="profesionales" commissionsLocked={!commissionsEnabled} />
      <Suspense fallback={<StaffSkeleton />}>
        <StaffManager
          businessId={business.id}
          members={overview.members}
          services={overview.services}
          todayKey={overview.todayKey}
          linkableUsers={overview.linkableUsers}
          businessSchedule={businessSchedule}
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl" style={{ background: 'var(--skeleton-color, #1a1a1a)' }} />
          <div className="flex flex-col gap-2">
            <div className="h-7 w-40 rounded-md" style={{ background: 'var(--skeleton-color, #1a1a1a)' }} />
            <div className="h-4 w-56 rounded-md" style={{ background: 'var(--skeleton-color, #1a1a1a)' }} />
          </div>
        </div>
        <div className="h-11 w-40 rounded-xl" style={{ background: 'var(--skeleton-color, #1a1a1a)' }} />
      </div>

      {/* Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mt-6">
        {[...Array(6)].map((_, i) => (
          <div 
            key={i} 
            className="rounded-2xl p-5 flex flex-col gap-5"
            style={{ 
              background: 'var(--skeleton-color, #1a1a1a)',
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
