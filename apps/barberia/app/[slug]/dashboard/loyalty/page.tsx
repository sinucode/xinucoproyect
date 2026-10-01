import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { getLoyaltyOverview } from '@/actions/loyalty'
import { LoyaltyDashboard } from '@/components/dashboard/loyalty/LoyaltyDashboard'
import type { BusinessFeatures, Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Lealtad — Xinuco',
  description: 'Puntos o sellos para premiar a tus clientes',
}

export default async function LoyaltyPage({
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

  // Feature gate: check loyalty flag server-side
  const { data: biz } = await supabase
    .from('businesses')
    .select('features_enabled')
    .eq('slug', slug)
    .single<{ features_enabled: unknown }>()
  const features = (biz?.features_enabled ?? {}) as unknown as BusinessFeatures
  if (!features?.loyalty) redirect(`/${slug}/dashboard`)

  // 3. Configuración + resumen + movimientos (el negocio sale del perfil)
  const overview = await getLoyaltyOverview()

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6">
      {'error' in overview ? (
        <p role="alert" className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">
          {overview.error}
        </p>
      ) : (
        <LoyaltyDashboard slug={slug} overview={overview} isAdmin />
      )}
    </div>
  )
}
