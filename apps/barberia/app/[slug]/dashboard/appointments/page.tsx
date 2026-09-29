import { Suspense } from 'react'
import { createClient } from '@xinuco/supabase/server'
import { redirect } from 'next/navigation'
import { InteractiveAgenda } from '@/components/dashboard/InteractiveAgenda'
import { NewAppointmentButton } from '@/components/dashboard/NewAppointmentButton'
import { getActiveShiftDetails } from '@/actions/finance'
import { AgendaFilters } from '@/components/dashboard/agenda/AgendaFilters'
import { StaffDayTimeline } from '@/components/dashboard/agenda/StaffDayTimeline'
import type { BreakRow, TimeOffRow, TimelineAppt } from '@/components/dashboard/agenda/staff-day-utils'
import { businessTodayISODate, addDaysToDateKey, businessNowHHMM } from '@/lib/agenda-time'

interface AppointmentsPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// Filtro de estado → estados de la BD
const STATUS_FILTERS: Record<string, string[]> = {
  active: ['payment_pending', 'scheduled', 'in_progress', 'ready_to_pay'],
  completed: ['completed'],
  cancelled: ['cancelled'],
  no_show: ['no_show'],
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_RE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

const hhmm = (t: string) => t.slice(0, 5)

export default async function AppointmentsPage({ params, searchParams }: AppointmentsPageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  // 1. Auth Guard
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  // 2. Fetch Profile & Business
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', user.id)
    .single()

  const businessId = profile?.business_id ?? ''
  const isAdmin = profile?.role === 'admin'

  // 3. Obtener Turno Activo para permitir el CheckoutModal desde esta página
  let activeShiftId = null
  if (isAdmin) {
    const shiftDetails = await getActiveShiftDetails(businessId)
    activeShiftId = shiftDetails?.shift?.id || null
  }

  // 4. Citas de hoy en adelante (por start_time, en hora local del negocio) +
  //    citas de los últimos 30 días que siguen ABIERTAS (sin cobrar/cerrar), para
  //    que una cita en curso o lista para pagar no desaparezca al cambiar el día.
  //    Ver lib/agenda-time.ts para la convención de tiempo.
  const todayKey    = businessTodayISODate()
  const fromOpenKey = addDaysToDateKey(todayKey, -30)

  // 4a. Si es barbero, obtener su staff.id vinculado al user.id
  //     La relación es: auth.users.id → staff.user_id → staff.id → appointments.staff_id
  //     NO usar barber_id (campo eliminado) ni user.id directo (no es staff.id)
  let linkedStaffId: string | null = null
  if (profile?.role === 'barber') {
    const { data: staffRecord } = await supabase
      .from('staff')
      .select('id')
      .eq('business_id', businessId)
      .eq('user_id', user.id)
      .maybeSingle()

    linkedStaffId = staffRecord?.id ?? null
  }

  // 4b. Filtros (URL): valores inválidos → por defecto
  const rawDate = firstParam(sp.date)
  const dateFilter = isValidDateKey(rawDate) ? rawDate : 'upcoming'
  const rawStatus = firstParam(sp.status)
  const statusFilter = rawStatus in STATUS_FILTERS ? rawStatus : 'all'

  // Staff activo del negocio (opciones del filtro + validación del id recibido)
  const isBarber = profile?.role === 'barber'
  let staffOptions: { id: string; full_name: string }[] = []
  if (!isBarber) {
    const { data: staffRows } = await supabase
      .from('staff')
      .select('id, full_name')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('full_name', { ascending: true })
    staffOptions = (staffRows ?? []) as { id: string; full_name: string }[]
  }
  const rawStaff = firstParam(sp.staff)
  const staffFilter = !isBarber && staffOptions.some((s) => s.id === rawStaff) ? rawStaff : ''

  const hasFilters = dateFilter !== 'upcoming' || statusFilter !== 'all' || staffFilter !== ''

  let query = supabase
    .from('appointments')
    .select('*, customers(full_name, phone), services(name, price_cop, duration_minutes), staff(full_name)')
    .eq('business_id', businessId)
    .order('start_time', { ascending: true })
    .limit(300)

  if (dateFilter === 'upcoming') {
    query = query.or(
      `start_time.gte.${todayKey}T00:00:00Z,` +
      `and(start_time.gte.${fromOpenKey}T00:00:00Z,status.in.(scheduled,in_progress,ready_to_pay,payment_pending))`,
    )
  } else {
    query = query
      .gte('start_time', `${dateFilter}T00:00:00Z`)
      .lt('start_time', `${addDaysToDateKey(dateFilter, 1)}T00:00:00Z`)
  }

  if (statusFilter !== 'all') query = query.in('status', STATUS_FILTERS[statusFilter])
  if (staffFilter) query = query.eq('staff_id', staffFilter)

  // Aplicar filtro de barbero usando staff_id correcto
  if (isBarber) {
    if (linkedStaffId) {
      query = query.eq('staff_id', linkedStaffId)
    } else {
      // Sin staff vinculado → devolver lista vacía por seguridad (no exponer citas ajenas)
      query = query.eq('staff_id', 'no-linked-staff')
    }
  }

  const { data: appointmentsData } = await query
  const appointments = (appointmentsData ?? []) as Record<string, unknown>[]

  // 5. Vista de día del staff: admin/otros con staff elegido; barbero (siempre él mismo) al elegir una fecha
  const timelineStaffId = isBarber ? (dateFilter !== 'upcoming' ? linkedStaffId : null) : staffFilter || null
  const timelineDate = dateFilter === 'upcoming' ? todayKey : dateFilter
  let timeline: {
    staffName: string
    intervalMinutes: number
    schedule: { start: string; end: string } | null
    breaks: BreakRow[]
    timeOff: TimeOffRow[]
    appointments: TimelineAppt[]
  } | null = null

  if (timelineStaffId) {
    const dow = new Date(`${timelineDate}T00:00:00Z`).getUTCDay()
    const dayStart = `${timelineDate}T00:00:00Z`
    const dayEnd = `${addDaysToDateKey(timelineDate, 1)}T00:00:00Z`

    const [staffRes, scheduleRes, breaksRes, timeOffRes, dayApptsRes, bizRes] = await Promise.all([
      supabase.from('staff').select('full_name').eq('id', timelineStaffId).eq('business_id', businessId).maybeSingle(),
      supabase
        .from('staff_schedules')
        .select('start_time, end_time')
        .eq('business_id', businessId)
        .eq('staff_id', timelineStaffId)
        .eq('day_of_week', dow),
      supabase
        .from('staff_breaks')
        .select('id, day_of_week, start_time, end_time, label')
        .eq('business_id', businessId)
        .eq('staff_id', timelineStaffId)
        .order('start_time', { ascending: true }),
      supabase
        .from('staff_time_off')
        .select('id, starts_at, ends_at, kind, reason')
        .eq('business_id', businessId)
        .eq('staff_id', timelineStaffId)
        .gt('ends_at', dayStart)
        .order('starts_at', { ascending: true })
        .limit(30),
      supabase
        .from('appointments')
        .select('id, start_time, status, customers(full_name), services(name, duration_minutes, buffer_time_minutes)')
        .eq('business_id', businessId)
        .eq('staff_id', timelineStaffId)
        .gte('start_time', dayStart)
        .lt('start_time', dayEnd)
        .not('status', 'in', '(cancelled,no_show)')
        .order('start_time', { ascending: true }),
      supabase.from('businesses').select('appointment_interval_minutes').eq('id', businessId).maybeSingle(),
    ])

    const scheduleRows = ((scheduleRes.data ?? []) as { start_time: string; end_time: string }[])
    const schedule = scheduleRows.length
      ? {
          start: hhmm(scheduleRows.map((r) => r.start_time).sort()[0]),
          end: hhmm(scheduleRows.map((r) => r.end_time).sort().slice(-1)[0]),
        }
      : null

    const rawInterval = Number(bizRes.data?.appointment_interval_minutes)
    const intervalMinutes = Number.isInteger(rawInterval) && rawInterval >= 5 && rawInterval <= 120 ? rawInterval : 30

    const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

    timeline = {
      staffName: staffRes.data?.full_name ?? 'Staff',
      intervalMinutes,
      schedule,
      breaks: (breaksRes.data ?? []) as BreakRow[],
      timeOff: (timeOffRes.data ?? []) as TimeOffRow[],
      appointments: ((dayApptsRes.data ?? []) as any[]).map((a) => {
        const customer = one<{ full_name?: string }>(a.customers)
        const service = one<{ name?: string; duration_minutes?: number; buffer_time_minutes?: number }>(a.services)
        return {
          id: a.id as string,
          start_time: a.start_time as string,
          status: a.status as string,
          customer_name: customer?.full_name || 'Cliente sin nombre',
          service_name: service?.name || 'Servicio',
          total_minutes: (service?.duration_minutes ?? 30) + (service?.buffer_time_minutes ?? 0),
        }
      }),
    }
  }

  // Remonta la lista cuando cambian filtros o datos (InteractiveAgenda guarda las citas en estado local)
  const agendaKey =
    `${dateFilter}|${staffFilter}|${statusFilter}|` +
    appointments.map((a) => `${a.id}:${a.status}`).join(',')

  return (
    <div className="bg-xinuco-bg min-h-screen">
      <main className="px-4 py-6 pb-24 space-y-6 max-w-2xl mx-auto">
        <section aria-label="Encabezado de Agenda">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold text-xinuco-text">
              Agenda Completa
            </h1>
            <NewAppointmentButton slug={slug} />
          </div>
        </section>

        <Suspense fallback={null}>
          <AgendaFilters todayKey={todayKey} staffOptions={staffOptions} showStaff={!isBarber} />
        </Suspense>

        {timeline && timelineStaffId && (
          <StaffDayTimeline
            slug={slug}
            isAdmin={isAdmin}
            staffId={timelineStaffId}
            staffName={timeline.staffName}
            dateKey={timelineDate}
            todayKey={todayKey}
            nowHHMM={businessNowHHMM()}
            intervalMinutes={timeline.intervalMinutes}
            schedule={timeline.schedule}
            breaks={timeline.breaks}
            timeOff={timeline.timeOff}
            appointments={timeline.appointments}
          />
        )}

        <section aria-label="Lista Completa de Citas">
          <InteractiveAgenda
            key={agendaKey}
            appointments={appointments}
            activeShiftId={activeShiftId}
            businessId={businessId}
            slug={slug}
            hasFilters={hasFilters}
          />
        </section>
      </main>
    </div>
  )
}
