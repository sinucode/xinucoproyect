import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { listCustomers } from '@/actions/crm'
import { CustomerCRM } from '@/components/dashboard/crm/CustomerCRM'
import type { BusinessFeatures } from '@xinuco/types'
import { businessTodayISODate } from '@/lib/agenda-time'
import { parseCustomerFilter, parseCustomerSort } from '@/lib/crm-utils'

export const metadata: Metadata = {
  title: 'Clientes — Xinuco',
  description: 'Expediente del cliente — historial, notas y preferencias',
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

export default async function CRMPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams

  // 1. Auth guard
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  // 2. Obtener business_id desde el perfil autenticado
  const { data: profile } = await supabase
    .from('profiles')
    .select('business_id')
    .eq('id', user.id)
    .single()

  if (!profile?.business_id) redirect(`/${slug}/login`)

  // 3. Feature gate: verificar flag crm
  const { data: biz } = await supabase
    .from('businesses')
    .select('features_enabled')
    .eq('slug', slug)
    .single()

  const features = (biz?.features_enabled ?? {}) as unknown as BusinessFeatures
  if (!features?.crm) redirect(`/${slug}/dashboard`)

  // 4. Listado (búsqueda, filtro, orden y página desde la URL) vía RPC list_customers
  const query  = firstParam(sp.q).trim().slice(0, 100)
  const filter = parseCustomerFilter(firstParam(sp.filter))
  const sort   = parseCustomerSort(firstParam(sp.sort))
  const rawPage = parseInt(firstParam(sp.page), 10)
  const page   = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 0

  const list = await listCustomers({ query, filter, sort, page })

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6">
      <Suspense fallback={<CRMSkeleton />}>
        <CustomerCRM
          customers={list.items}
          total={list.total}
          page={list.page}
          query={query}
          filter={filter}
          todayKey={businessTodayISODate()}
          loadError={list.error}
        />
      </Suspense>
    </div>
  )
}

// ── Skeleton de carga ─────────────────────────────────────────────────────────

function CRMSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      {/* Header */}
      <div
        className="flex items-center justify-between pb-6 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl"
            style={{ background: 'var(--surface-color, #1a1a1a)' }}
          />
          <div className="flex flex-col gap-2">
            <div
              className="h-6 w-36 rounded-md"
              style={{ background: 'var(--surface-color, #1a1a1a)' }}
            />
            <div
              className="h-3 w-52 rounded-md"
              style={{ background: 'var(--surface-color, #1a1a1a)' }}
            />
          </div>
        </div>
      </div>

      {/* Search bar */}
      <div
        className="h-11 w-full rounded-xl"
        style={{ background: 'var(--surface-color, #1a1a1a)' }}
      />

      {/* Customer cards */}
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 p-4 rounded-xl"
          style={{ background: 'var(--surface-color, #1a1a1a)' }}
        >
          <div className="w-11 h-11 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-4 w-32 rounded" style={{ background: 'rgba(255,255,255,0.06)' }} />
            <div className="h-3 w-24 rounded" style={{ background: 'rgba(255,255,255,0.04)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}
