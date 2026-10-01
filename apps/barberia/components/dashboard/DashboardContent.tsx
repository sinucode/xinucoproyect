import { createClient } from '@xinuco/supabase/server'
import { redirect } from 'next/navigation'
import type { MoneyAccountsStatus } from '@xinuco/types'
import { getActiveShiftDetails } from '@/actions/finance'
import { getUpcomingFixedExpenses } from '@/actions/expenses'
import { getMoneyAccountsStatus } from '@/actions/money-accounts'
import { getLowStockItems } from '@/actions/inventory'
import { UpcomingFixedExpensesNotice } from '@/components/dashboard/expenses/UpcomingFixedExpensesNotice'
import { LowStockNotice } from '@/components/dashboard/inventory/LowStockNotice'
import { CashShiftManager } from '@/components/finance/CashShiftManager'
import { MoneyAccountsCard } from '@/components/finance/MoneyAccountsCard'
import { RetailSaleButton } from '@/components/finance/RetailSaleButton'
import { NewAppointmentButton } from '@/components/dashboard/NewAppointmentButton'
import { InteractiveAgenda } from './InteractiveAgenda'
import { businessTodayISODate, addDaysToDateKey, businessHour } from '@/lib/agenda-time'
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
  let moneyStatus: MoneyAccountsStatus | null = null
  if (isAdmin) {
    // 3a. Turno de caja y saldos de cada medio ("Tu plata") en paralelo
    const [shiftDetails, money] = await Promise.all([
      getActiveShiftDetails(businessId),
      getMoneyAccountsStatus(),
    ])
    activeShiftDetails = shiftDetails
    // Si los saldos no cargan, el resto del Inicio sigue funcionando sin la tarjeta
    moneyStatus = money.data ?? null
  }

  // 3b. Gastos fijos que vencen hoy o mañana sin registrar (Solo para administradores)
  const upcomingFixedExpenses = isAdmin ? await getUpcomingFixedExpenses() : []

  // 3c. Productos con stock bajo (Solo para administradores; el aviso se oculta si el plan no incluye Inventario)
  const lowStockItems = isAdmin
    ? ((await getLowStockItems()).data ?? []).map(({ id, name, current_stock }) => ({ id, name, current_stock }))
    : []

  // 4. Citas de HOY filtradas por start_time (no created_at — una cita de hoy pudo
  //    haberse creado hace días).
  //    "Hoy" = fecha actual en America/Bogota (ver lib/agenda-time.ts).
  const todayStr = businessTodayISODate() // 'YYYY-MM-DD'
  const tomorrowStr = addDaysToDateKey(todayStr, 1)

  let query = supabase
    .from('appointments')
    .select('*, customers(full_name, phone), services(name, price_cop, duration_minutes), staff(full_name)')
    .eq('business_id', businessId)
    .not('status', 'in', '("cancelled","no_show")')
    .gte('start_time', `${todayStr}T00:00:00Z`)
    .lt('start_time', `${tomorrowStr}T00:00:00Z`)
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
  const hour = businessHour()
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

      {/* En PC: dinero a la izquierda y agenda a la derecha; en celular/tablet, una sola columna */}
      <div
        className={isAdmin
          ? 'grid grid-cols-1 gap-6 xl:grid-cols-2 2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] xl:items-start'
          : 'grid grid-cols-1 gap-6'}
      >
      {isAdmin && (
      <div className="flex flex-col gap-6 min-w-0">
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

      {/* Tu plata: saldo de cada medio y movimientos del dueño (Solo para Administrador) */}
      {isAdmin && moneyStatus && (
        <section aria-label="Tu plata">
          <MoneyAccountsCard initialStatus={moneyStatus} />
        </section>
      )}

      {/* Aviso: gastos fijos que vencen hoy o mañana (Solo para Administrador) */}
      {isAdmin && upcomingFixedExpenses.length > 0 && (
        <section aria-label="Gastos fijos próximos">
          <UpcomingFixedExpensesNotice items={upcomingFixedExpenses} slug={slug} today={todayStr} />
        </section>
      )}

      {/* Aviso: productos por agotarse (Solo para Administrador, si el módulo Inventario está activo) */}
      {isAdmin && lowStockItems.length > 0 && (
        <section aria-label="Inventario por agotarse">
          <LowStockNotice items={lowStockItems} slug={slug} />
        </section>
      )}

      {/* Acceso Rápido: Venta Retail (Solo para Administrador) */}
      {isAdmin && (
        <section aria-label="Venta Rápida de Productos">
          <RetailSaleButton
            slug={slug}
            activeShiftId={activeShiftDetails?.shift.id ?? null}
          />
        </section>
      )}

      </div>
      )}

      {/* Widget 2 — Agenda del día */}
      <section aria-label="Agenda del día" className="space-y-4 min-w-0">
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
          <div className="flex items-center gap-3">
            <a
              href={`/${slug}/dashboard/appointments`}
              id="link-view-all-appointments"
              className="text-xs text-xinuco-primary hover:underline transition-colors"
            >
              Ver todas →
            </a>
            {/* Abre la reserva pública en otra pestaña */}
            <NewAppointmentButton slug={slug} />
          </div>
        </div>

        {/* Agenda Interactiva Premium */}
        <InteractiveAgenda
          appointments={appointments}
          activeShiftId={activeShiftDetails?.shift.id || null}
          businessId={businessId}
          slug={slug}
          wide={!isAdmin}
        />
      </section>
      </div>
    </>
  )
}
