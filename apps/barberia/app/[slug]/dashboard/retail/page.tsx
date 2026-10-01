import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { FeatureGate } from '@/components/dashboard/FeatureGate'
import { PointOfSale } from '@/components/pos/PointOfSale'
import { ShiftSalesList } from '@/components/pos/ShiftSalesList'
import { getPosCatalog, getShiftSales } from '@/actions/retail'
import type { Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Venta de productos — Xinuco',
  description: 'Venta directa de productos sin cita previa',
}

// ── Página ────────────────────────────────────────────────────────────────────

export default async function RetailPage({
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
  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
    redirect(`/${slug}/dashboard`)
  }

  // 3. Catálogo (productos, equipo, caja, lealtad) y ventas del turno abierto
  const [catalog, shiftSales] = await Promise.all([getPosCatalog(), getShiftSales()])

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
      <header>
        <h1 className="text-2xl font-bold text-xinuco-text">Venta de productos</h1>
        <p className="text-sm text-xinuco-muted mt-1">
          Vende productos sin cita: se descuentan del inventario y suman a la caja.
        </p>
      </header>

      <FeatureGate featureKey="retail_sales" planName="Profesional">
        {'error' in catalog ? (
          <div
            role="alert"
            className="rounded-xl border p-4 text-sm text-red-400"
            style={{ borderColor: 'var(--border-color)' }}
          >
            {catalog.error}
          </div>
        ) : (
          <>
            <PointOfSale slug={slug} catalog={catalog} />
            <ShiftSalesList sales={shiftSales.sales} />
            {shiftSales.error && (
              <p role="alert" className="text-sm text-red-400">{shiftSales.error}</p>
            )}
          </>
        )}
      </FeatureGate>
    </div>
  )
}
