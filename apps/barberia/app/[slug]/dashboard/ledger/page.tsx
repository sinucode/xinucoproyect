import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { getMyAccount, getStaffAccount, getTeamPaymentsOverview } from '@/actions/ledger'
import { MyAccount, NotLinkedCard } from '@/components/dashboard/ledger/MyAccount'
import { TeamPayments } from '@/components/dashboard/ledger/TeamPayments'
import type { AccountViewFilters } from '@/components/dashboard/ledger/AccountParts'
import { businessTodayISODate } from '@/lib/agenda-time'
import { isLedgerEntryType, isRealDateKey } from '@/lib/team-payments'
import type { BusinessFeatures, Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Pagos al equipo — Xinuco',
  description: 'Comisiones, propinas, anticipos y pagos de cada profesional',
}

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<SearchParams>
}) {
  const { slug } = await params
  const sp = await searchParams

  // 1. Auth guard — mismo patrón que commissions/page.tsx
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  // 2. Perfil: business_id + role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', user.id)
    .single<Pick<Profile, 'role' | 'business_id'>>()

  if (!profile?.business_id) redirect(`/${slug}/login`)

  // Feature gate: staff_ledger, del lado del servidor
  const { data: biz } = await supabase
    .from('businesses')
    .select('features_enabled')
    .eq('slug', slug)
    .single<{ features_enabled: unknown }>()
  const features = (biz?.features_enabled ?? {}) as unknown as BusinessFeatures
  if (!features?.staff_ledger) redirect(`/${slug}/dashboard`)

  // 3. Filtros del historial (URL). Lo inválido se ignora.
  const rawType = first(sp.type)
  const rawFrom = first(sp.from)
  const rawTo = first(sp.to)
  const rawPage = Number(first(sp.page))
  const filters: AccountViewFilters = {
    type: rawType && isLedgerEntryType(rawType) ? rawType : 'all',
    from: isRealDateKey(rawFrom) ? rawFrom : '',
    to:   isRealDateKey(rawTo) ? rawTo : '',
  }
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1
  const accountFilters = {
    type: filters.type,
    from: filters.from || undefined,
    to:   filters.to || undefined,
    page,
  }

  const isAdmin = profile.role === 'admin' || profile.role === 'super_admin'
  const wrapper = 'flex flex-col gap-6 max-w-[1600px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6'

  // ── Profesional (barbero / manicurista): solo su propia cuenta, en solo lectura ──
  if (!isAdmin) {
    const mine = await getMyAccount(accountFilters)
    return (
      <div className={wrapper}>
        {'error' in mine ? (
          <p role="alert" className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">
            {mine.error}
          </p>
        ) : 'notLinked' in mine ? (
          <NotLinkedCard />
        ) : (
          <MyAccount account={mine} filters={filters} />
        )}
      </div>
    )
  }

  // ── Administrador: resumen del equipo + cuenta del profesional elegido ──
  const overview = await getTeamPaymentsOverview()
  if ('error' in overview) redirect(`/${slug}/dashboard`)

  const requested = first(sp.staff)
  const selected = overview.members.find(m => m.staff.id === requested) ?? overview.members[0] ?? null

  let account = null
  let accountError: string | null = null
  if (selected) {
    const res = await getStaffAccount(selected.staff.id, accountFilters)
    if ('error' in res) accountError = res.error
    else account = res
  }

  return (
    <div className={wrapper}>
      <TeamPayments
        slug={slug}
        overview={overview}
        selectedId={selected?.staff.id ?? null}
        account={account}
        accountError={accountError}
        filters={filters}
        today={businessTodayISODate()}
      />
    </div>
  )
}
