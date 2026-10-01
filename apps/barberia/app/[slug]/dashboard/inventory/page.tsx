import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { getInventoryItems, getLowStockItems, getInventoryReservations } from '@/actions/inventory'
import { getActiveShift } from '@/actions/finance'
import { InventoryManager } from '@/components/dashboard/inventory/InventoryManager'
import { FeatureGate } from '@/components/dashboard/FeatureGate'
import type { Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Inventario — Xinuco',
  description: 'Gestión de stock de productos del negocio',
}

// ── Página ────────────────────────────────────────────────────────────────────

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

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

  const businessId = profile.business_id

  // 3. Cargar ítems, alertas de stock bajo, apartados y turno de caja (para pagar compras con efectivo)
  const [itemsResult, lowStockResult, reservationsResult, openShift] = await Promise.all([
    getInventoryItems(businessId),
    getLowStockItems(),
    getInventoryReservations(businessId),
    getActiveShift(businessId),
  ])

  const items        = itemsResult.data    ?? []
  const lowStockItems = lowStockResult.data ?? []
  const reservations  = reservationsResult.data ?? []

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto w-full px-4 sm:px-6 py-6">
      <Suspense fallback={<InventorySkeleton />}>
        <FeatureGate featureKey="inventory" planName="Élite">
          <InventoryManager
            items={items}
            lowStockItems={lowStockItems}
            reservations={reservations}
            hasOpenShift={!!openShift}
          />
        </FeatureGate>
      </Suspense>
    </div>
  )
}

// ── Skeleton de carga ─────────────────────────────────────────────────────────

function InventorySkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      {/* Header skeleton */}
      <div
        className="flex items-center justify-between pb-6 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
          <div className="flex flex-col gap-2">
            <div className="h-6 w-36 rounded-md" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
            <div className="h-3 w-56 rounded-md" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
          </div>
        </div>
        <div className="h-10 w-36 rounded-lg" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
      </div>

      {/* Summary chips skeleton */}
      <div className="flex gap-3 flex-wrap">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 w-40 rounded-xl" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
        ))}
      </div>

      {/* Search bar skeleton */}
      <div className="h-10 w-full rounded-xl" style={{ background: 'var(--surface-color, #1a1a1a)' }} />

      {/* Item rows skeleton */}
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-xl" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
        ))}
      </div>
    </div>
  )
}
