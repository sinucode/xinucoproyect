import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { AdminPageHeader } from '@xinuco/ui'
import { getManagementReport } from '@/actions/reports'
import { ReportsDashboard } from '@/components/dashboard/reports/ReportsDashboard'
import { DEFAULT_PERIOD, isPeriodKey } from '@/lib/report-utils'
import type { ExpenseCategoryRow, Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Reportes — Xinuco',
  description: 'Cómo va el negocio: ganancias, pérdidas y oportunidades',
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params:       Promise<{ slug: string }>
  searchParams: Promise<{ periodo?: string | string[] }>
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

  // 3. Negocio del slug (debe existir)
  const { data: biz } = await supabase
    .from('businesses')
    .select('id')
    .eq('slug', slug)
    .single<{ id: string }>()
  if (!biz) redirect(`/${slug}/login`)

  // 4. Período (Bogotá) + reporte y nombres de categorías de gasto en paralelo
  const rawPeriodo = first(sp.periodo)
  const periodo = isPeriodKey(rawPeriodo) ? rawPeriodo : DEFAULT_PERIOD

  const [result, categoriesRes] = await Promise.all([
    getManagementReport(periodo),
    supabase
      .from('expense_categories')
      .select('slug, name, color, is_hidden')
      .eq('business_id', profile.business_id),
  ])

  const categories = (categoriesRes.data ?? []) as Pick<ExpenseCategoryRow, 'slug' | 'name' | 'color' | 'is_hidden'>[]

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full min-w-0 px-4 sm:px-6 py-6">
      <AdminPageHeader
        title="Reportes"
        subtitle="Cómo va el negocio: ganancias, pérdidas y oportunidades."
      />

      <ReportsDashboard
        slug={slug}
        periodo={periodo}
        report={'error' in result ? null : result.report}
        from={'error' in result ? null : result.from}
        to={'error' in result ? null : result.to}
        error={'error' in result ? result.error : null}
        categories={categories}
      />
    </div>
  )
}
