import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { AdminPageHeader } from '@xinuco/ui'
import { getMoneyMovements, getMonthResults } from '@/actions/accounting'
import { AccountingView, type AccountingTab } from '@/components/dashboard/accounting/AccountingView'
import { businessTodayISODate } from '@/lib/agenda-time'
import { currentMonthKey, isMonthKey, monthRange } from '@/lib/accounting-utils'
import { categoryName } from '@/lib/expense-utils'
import type { BusinessFeatures, ExpenseCategoryRow, Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Contabilidad — Xinuco',
  description: 'Cuánto ganó el negocio y por dónde entró y salió la plata',
}

const TABS: AccountingTab[] = ['resultados', 'movimientos', 'contador']

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function AccountingPage({
  params,
  searchParams,
}: {
  params:       Promise<{ slug: string }>
  searchParams: Promise<{ mes?: string | string[]; tab?: string | string[] }>
}) {
  const { slug } = await params
  const sp = await searchParams

  // 1. Auth guard
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  // 2. Perfil: solo admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', user.id)
    .single<Pick<Profile, 'role' | 'business_id'>>()

  if (!profile?.business_id) redirect(`/${slug}/login`)
  if (profile.role !== 'admin' && profile.role !== 'super_admin') redirect(`/${slug}/dashboard`)

  // 3. Feature gate: Contabilidad (advanced_reports) o Gastos (el estado de resultados vive aquí ahora)
  const { data: biz } = await supabase
    .from('businesses')
    .select('features_enabled')
    .eq('slug', slug)
    .single<{ features_enabled: unknown }>()
  const features = (biz?.features_enabled ?? {}) as unknown as BusinessFeatures
  if (!features?.advanced_reports && !features?.expenses_pgl) redirect(`/${slug}/dashboard`)

  // 4. Mes (hora de Bogotá); nunca más allá del mes actual
  const nowKey = currentMonthKey()
  const rawMes = first(sp.mes)
  let mes = isMonthKey(rawMes) ? rawMes : nowKey
  if (mes > nowKey) mes = nowKey

  const rawTab = first(sp.tab)
  const tab: AccountingTab = TABS.includes(rawTab as AccountingTab) ? (rawTab as AccountingTab) : 'resultados'

  const range = monthRange(mes)

  // 5. Carga en paralelo: resultados (con mes anterior), movimientos y nombres de categorías de gasto
  const [results, movements, categoriesRes] = await Promise.all([
    getMonthResults(mes),
    getMoneyMovements(range.from, range.to),
    supabase
      .from('expense_categories')
      .select('slug, name, color, is_hidden')
      .eq('business_id', profile.business_id),
  ])

  // slug → nombre de las categorías que aparecen en el estado de resultados (para el CSV)
  const categories = (categoriesRes.data ?? []) as Pick<ExpenseCategoryRow, 'slug' | 'name' | 'color' | 'is_hidden'>[]
  const slugs = 'error' in results ? [] : results.current.expenses.by_category.map(c => c.category)
  const categoryNames: Record<string, string> = {}
  for (const s of slugs) categoryNames[s] = categoryName(s, categories)

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 pb-24">
      <AdminPageHeader
        title="Contabilidad"
        subtitle="Cuánto ganó el negocio y por dónde entró y salió la plata."
      />

      <AccountingView
        slug={slug}
        mes={mes}
        currentMes={nowKey}
        initialTab={tab}
        today={businessTodayISODate()}
        results={'error' in results ? null : results}
        resultsError={'error' in results ? results.error : null}
        movements={'error' in movements ? null : movements.rows}
        movementsError={'error' in movements ? movements.error : null}
        categoryNames={categoryNames}
      />
    </div>
  )
}
