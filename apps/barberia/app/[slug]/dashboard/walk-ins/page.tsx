import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { getWalkInQueue, getWalkInHistory, getStaffStatusNow, getWalkInSuggestions, closeStaleWalkIns } from '@/actions/walk-ins'
import { isReservedTurn } from '@/lib/walk-in-wait'
import { getActiveShiftDetails } from '@/actions/finance'
import { WalkInQueue } from '@/components/dashboard/walk-ins/WalkInQueue'
import type { BusinessFeatures, Staff, Service } from '@xinuco/types'
import { normalizeAudiences } from '@/lib/service-audience'
import { getSessionUser, getMyProfile, getBusinessBySlug } from '@/lib/session'

export const metadata: Metadata = {
  title: 'Fila de espera — Xinuco',
  description: 'Fila de turnos de clientes sin cita previa',
}

export default async function WalkInsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  // 1. Auth guard
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect(`/${slug}/login`)

  // 2. business_id/rol (perfil) y flags del negocio: independientes entre sí → en paralelo.
  //    Ambos memoizados por petición (el layout ya los cargó, lib/session.ts).
  const [profile, biz] = await Promise.all([
    getMyProfile(supabase),
    getBusinessBySlug(supabase, slug),
  ])

  if (!profile?.business_id) redirect(`/${slug}/login`)
  const businessId = profile.business_id

  // 3. Feature gate
  const features = (biz?.features_enabled ?? {}) as unknown as BusinessFeatures
  if (!features?.walk_ins) redirect(`/${slug}/dashboard`)

  // Rol y profesional ligado: el barbero solo atiende lo suyo (reglas en la BD y las actions)
  const isAdmin = profile.role === 'admin' || profile.role === 'super_admin'

  // 3b-3d. Lecturas independientes en paralelo:
  //   - Turno de caja activo (solo admin, igual que la Agenda) para poder cobrar desde la fila
  //   - Profesional ligado al usuario (solo no-admin)
  //   - Limpieza: turnos que quedaron en espera de un día anterior se cierran ANTES de listar la cola
  //   - Staff activo, servicios y audiencias (no dependen de la limpieza)
  const [shiftDetails, me, , staffRows, serviceRows, audienceRow] = await Promise.all([
    profile.role === 'admin' ? getActiveShiftDetails(businessId) : Promise.resolve(null),
    !isAdmin
      ? supabase
          .from('staff')
          .select('id')
          .eq('user_id', user.id)
          .eq('business_id', businessId)
          .maybeSingle()
      : Promise.resolve(null),
    closeStaleWalkIns(businessId),
    supabase
      .from('staff')
      .select('id, full_name')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('services')
      .select('id, name, price_cop, duration_minutes, audience')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('businesses')
      .select('service_audiences')
      .eq('id', businessId)
      .maybeSingle(),
  ])

  const activeShiftId: string | null = shiftDetails?.shift?.id || null
  const viewerStaffId: string | null = (me?.data as { id?: string } | null)?.id ?? null

  // 4. Con la limpieza hecha: cola activa + historial + estado de barberos en paralelo
  const [queue, history, staffStatus] = await Promise.all([
    getWalkInQueue(businessId),
    getWalkInHistory(businessId, 10),
    getStaffStatusNow(businessId),
  ])

  // 5. Recomendación de barbero para los primeros 10 turnos en espera sin apartar
  const needSuggestions = queue
    .filter((w) => w.status === 'waiting' && !isReservedTurn(w))
    .slice(0, 10)
    .map((w) => w.id)
  const suggestions = needSuggestions.length > 0 ? await getWalkInSuggestions(needSuggestions) : {}

  const staffList    = (staffRows.data ?? []) as Pick<Staff, 'id' | 'full_name'>[]
  const serviceList  = (serviceRows.data ?? []) as Pick<Service, 'id' | 'name' | 'price_cop' | 'duration_minutes' | 'audience'>[]
  const serviceAudiences = normalizeAudiences(
    (audienceRow.data as { service_audiences?: unknown } | null)?.service_audiences,
  )

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
      <WalkInQueue
        initialQueue={queue}
        initialHistory={history}
        initialStaffStatus={staffStatus}
        initialSuggestions={suggestions}
        staffList={staffList}
        serviceList={serviceList}
        serviceAudiences={serviceAudiences}
        businessId={businessId}
        activeShiftId={activeShiftId}
        isAdmin={isAdmin}
        viewerStaffId={viewerStaffId}
        slug={slug}
      />
    </div>
  )
}
