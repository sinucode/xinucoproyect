import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { AdminPageHeader } from '@xinuco/ui'
import { requireSettingsAdmin } from '@/lib/settings-guard'
import { businessTodayISODate } from '@/lib/agenda-time'
import { AvailabilityClient } from '@/components/dashboard/settings/AvailabilityClient'
import type { ClosureRow } from '@/components/dashboard/settings/ClosuresShared'
import type { OperatingHours } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Horario y días cerrados — Xinuco',
  description: 'Horario del negocio, festivos y cierres por vacaciones o remodelación.',
}

export default async function AvailabilityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { supabase, businessId } = await requireSettingsAdmin(slug)

  const todayKey = businessTodayISODate()

  const [{ data: biz }, { data: closures }] = await Promise.all([
    supabase
      .from('businesses')
      .select('operating_hours')
      .eq('id', businessId)
      .single<{ operating_hours: OperatingHours | null }>(),
    // Cierres que aún no terminan (la tabla es de solo lectura para el negocio; escribe la RPC)
    (supabase as any)
      .from('business_closures')
      .select('id, date_from, date_to, kind, reason')
      .eq('business_id', businessId)
      .gte('date_to', todayKey)
      .order('date_from', { ascending: true }),
  ])

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto pb-24">
      <Link
        href={`/${slug}/dashboard/settings`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-xinuco-muted hover:text-xinuco-text transition-colors w-fit"
      >
        <ArrowLeft size={14} />
        Ajustes
      </Link>

      <AdminPageHeader
        title="Horario y días cerrados"
        subtitle="Cuándo atiende tu negocio y qué días no abres."
      />

      <AvailabilityClient
        slug={slug}
        todayKey={todayKey}
        initialOperatingHours={biz?.operating_hours ?? null}
        initialClosures={(closures ?? []) as ClosureRow[]}
      />
    </div>
  )
}
