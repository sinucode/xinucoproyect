import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { getWalkInQueue, getWalkInHistory, getStaffStatusNow, getWalkInSuggestions } from '@/actions/walk-ins'
import { isReservedTurn } from '@/lib/walk-in-wait'
import { getActiveShiftDetails } from '@/actions/finance'
import { WalkInQueue } from '@/components/dashboard/walk-ins/WalkInQueue'
import type { BusinessFeatures, Staff, Service } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Fila de espera — Xinuco',
  description: 'Fila de turnos de clientes sin cita previa',
}

export default async function WalkInsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  // 1. Auth guard
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  // 2. Obtener business_id
  const { data: profile } = await supabase
    .from('profiles')
    .select('business_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.business_id) redirect(`/${slug}/login`)

  // 3. Feature gate
  const { data: biz } = await supabase
    .from('businesses')
    .select('features_enabled')
    .eq('slug', slug)
    .single()

  const features = (biz?.features_enabled ?? {}) as unknown as BusinessFeatures
  if (!features?.walk_ins) redirect(`/${slug}/dashboard`)

  // 3b. Turno de caja activo (solo admin, igual que la Agenda) para poder cobrar desde la fila
  let activeShiftId: string | null = null
  if (profile.role === 'admin') {
    const shiftDetails = await getActiveShiftDetails(profile.business_id)
    activeShiftId = shiftDetails?.shift?.id || null
  }

  // 4. Carga paralela: cola activa + historial + estado de barberos + staff + servicios
  const [queue, history, staffStatus, staffRows, serviceRows] = await Promise.all([
    getWalkInQueue(profile.business_id),
    getWalkInHistory(profile.business_id, 10),
    getStaffStatusNow(profile.business_id),
    supabase
      .from('staff')
      .select('id, full_name')
      .eq('business_id', profile.business_id)
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('services')
      .select('id, name, price_cop, duration_minutes')
      .eq('business_id', profile.business_id)
      .eq('is_active', true)
      .order('name'),
  ])

  // 5. Recomendación de barbero para los primeros 10 turnos en espera sin apartar
  const needSuggestions = queue
    .filter((w) => w.status === 'waiting' && !isReservedTurn(w))
    .slice(0, 10)
    .map((w) => w.id)
  const suggestions = needSuggestions.length > 0 ? await getWalkInSuggestions(needSuggestions) : {}

  const staffList    = (staffRows.data ?? []) as Pick<Staff, 'id' | 'full_name'>[]
  const serviceList  = (serviceRows.data ?? []) as Pick<Service, 'id' | 'name' | 'price_cop' | 'duration_minutes'>[]

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto pb-24 px-4 sm:px-6">
      <WalkInQueue
        initialQueue={queue}
        initialHistory={history}
        initialStaffStatus={staffStatus}
        initialSuggestions={suggestions}
        staffList={staffList}
        serviceList={serviceList}
        businessId={profile.business_id}
        activeShiftId={activeShiftId}
        slug={slug}
      />
    </div>
  )
}
