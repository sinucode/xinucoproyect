import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { getExpensesOverview } from '@/actions/expenses'
import { ExpenseManager } from '@/components/dashboard/expenses/ExpenseManager'
import { businessTodayISODate } from '@/lib/agenda-time'
import { currentMonthKey, isValidMonthKey, shiftMonth } from '@/lib/expense-utils'
import type { BusinessFeatures, Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Gastos — Xinuco',
  description: 'Registro de gastos y estado de resultados (P&G)',
}

// ── Página ────────────────────────────────────────────────────────────────────

export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ month?: string | string[] }>
}) {
  const { slug } = await params
  const { month } = await searchParams

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

  // Feature gate: check expenses_pgl flag server-side
  const { data: biz } = await supabase
    .from('businesses')
    .select('features_enabled')
    .eq('slug', slug)
    .single<{ features_enabled: unknown }>()
  const features = (biz?.features_enabled ?? {}) as unknown as BusinessFeatures
  if (!features?.expenses_pgl) redirect(`/${slug}/dashboard`)

  // 3. Mes consultado (hora del negocio); nunca más allá del mes actual
  const nowKey = currentMonthKey()
  const rawMonth = Array.isArray(month) ? month[0] : month
  let monthKey = isValidMonthKey(rawMonth) ? rawMonth : nowKey
  if (monthKey > nowKey) monthKey = nowKey

  const overview = await getExpensesOverview(monthKey)
  if ('error' in overview) redirect(`/${slug}/dashboard`)

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
      <ExpenseManager
        overview={overview}
        slug={slug}
        today={businessTodayISODate()}
        currentMonthKey={nowKey}
        prevMonthKey={shiftMonth(monthKey, -1)}
        nextMonthKey={monthKey < nowKey ? shiftMonth(monthKey, 1) : null}
      />
    </div>
  )
}
