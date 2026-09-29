import { createClient } from '@xinuco/supabase/server'
import { redirect } from 'next/navigation'
import { getActiveShiftDetails } from '@/actions/finance'
import { CashShiftManager } from '@/components/finance/CashShiftManager'
import { RetailSaleButton } from '@/components/finance/RetailSaleButton'
import { InteractiveAgenda } from './InteractiveAgenda'
import { roleLabel } from '@/lib/roles'

interface DashboardContentProps {
  slug: string
}

/**
 * DashboardContent — Server Component async que obtiene datos reales.
 * Se usa dentro de un <Suspense> en dashboard/page.tsx para mostrar
 * los Skeletons mientras este componente resuelve sus promesas.
 */
export async function DashboardContent({ slug }: DashboardContentProps) {
  const supabase = await createClient()

  // 1. Sesión activa
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  // 2. Perfil del usuario
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role, business_id')
    .eq('id', user.id)
    .returns<{ id: string, full_name: string | null, role: string, business_id: string | null }[]>()
    .single()

  const businessId = profile?.business_id ?? ''
  const isAdmin = profile?.role === 'admin'

  // 3. Consultar Turno de Caja Activo (Solo para administradores)
  let activeShiftDetails = null
  if (isAdmin) {
    activeShiftDetails = await getActiveShiftDetails(businessId)
  }

  // 4. Citas de HOY filtradas por start_time (no created_at — una cita de hoy pudo
  //    haberse creado hace días).
  const todayStr = new Date().toISOString().split('T')[0] // 'YYYY-MM-DD'

  let query = supabase
    .from('appointments')
    .select('*, customers(full_name, phone), services(name, price_cop)')
    .eq('business_id', businessId)
    .not('status', 'in', '("cancelled","no_show")')
    .gte('start_time', `${todayStr}T00:00:00+00:00`)
    .lte('start_time', `${todayStr}T23:59:59+00:00`)
    .order('start_time', { ascending: true })

  // Si es barbero, filtrar solo sus propias citas via staff.user_id
  // barber_id no existe en el schema — se usa staff_id (FK a tabla staff)
  if (profile?.role === 'barber') {
    const { data: linkedStaff } = await supabase
      .from('staff')
      .select('id')
      .eq('business_id', businessId)
      .eq('user_id', user.id)
      .returns<{ id: string }[]>()
      .maybeSingle()

    // Si no tiene staff vinculado, retornar 0 citas (seguridad: nunca mostrar todo)
    const staffId = linkedStaff?.id ?? 'no-linked-staff'
    query = query.eq('staff_id', staffId)
  }

  const { data: todayAppointments } = await query
  const appointments = (todayAppointments ?? []) as Record<string, unknown>[]

  // 5. Validar integridad de cierre: hay citas En Curso?
  const hasInProgressAppointments = appointments.some((a) => a.status === 'in_progress')

  // 6. Saludo por hora del día
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? 'Equipo'

  return (
    <>
      {/* Saludo */}
      <section aria-label="Saludo">
        <p className="text-xs text-xinuco-muted uppercase tracking-widest mb-1">
          {roleLabel(profile?.role)}
        </p>
        <h1 className="text-2xl font-bold text-xinuco-text">
          {greeting}, {firstName} 👋
        </h1>
      </section>

      {/* Gestión de Turno de Caja (Solo para Administrador) */}
      {isAdmin && (
        <section aria-label="Gestor de Turnos de Caja">
          <CashShiftManager
            initialShiftDetails={activeShiftDetails}
            businessId={businessId}
            hasInProgressAppointments={hasInProgressAppointments}
          />
        </section>
      )}

      {/* Acceso Rápido: Venta Retail (Solo para Administrador) */}
      {isAdmin && (
        <section aria-label="Venta Rápida de Productos">
          <RetailSaleButton
            businessId={businessId}
            activeShiftId={activeShiftDetails?.shift.id ?? null}
          />
        </section>
      )}

      {/* Widget 2 — Agenda del día */}
      <section aria-label="Agenda del día" className="space-y-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-xinuco-text">
            Agenda del día
            {appointments.length > 0 && (
              <span
                className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full"
                style={{
                  background: 'color-mix(in srgb, var(--primary-color) 15%, transparent)',
                  color: 'var(--primary-color)',
                }}
              >
                {appointments.length}
              </span>
            )}
          </h2>
          <a
            href={`/${slug}/dashboard/appointments`}
            id="link-view-all-appointments"
            className="text-xs text-xinuco-primary hover:underline transition-colors"
          >
            Ver todas →
          </a>
        </div>

        {/* Agenda Interactiva Premium */}
        <InteractiveAgenda
          appointments={appointments}
          activeShiftId={activeShiftDetails?.shift.id || null}
          businessId={businessId}
          slug={slug}
        />
      </section>
    </>
  )
}
