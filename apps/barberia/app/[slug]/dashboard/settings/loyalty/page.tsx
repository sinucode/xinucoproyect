import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@xinuco/supabase/server'
import { LoyaltySettingsForm } from '@/components/dashboard/settings/LoyaltySettingsForm'
import type { LoyaltyConfig } from '@/lib/loyalty-utils'
import type { BusinessFeatures, Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Lealtad — Xinuco',
  description: 'Puntos o sellos para premiar a tus clientes',
}

const num = (v: unknown, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export default async function LoyaltySettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // 1. Auth guard
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  // 2. Perfil y negocio en paralelo
  const [{ data: profile }, { data: biz }] = await Promise.all([
    supabase
      .from('profiles')
      .select('role, business_id')
      .eq('id', user.id)
      .single<Pick<Profile, 'role' | 'business_id'>>(),
    supabase
      .from('businesses')
      .select(
        'id, features_enabled, loyalty_mode, loyalty_earn_per_cop, loyalty_point_value_cop, ' +
        'loyalty_min_redeem_points, loyalty_expiry_months, loyalty_stamps_required, loyalty_stamp_max_reward_cop',
      )
      .eq('slug', slug)
      .single<Record<string, unknown>>(),
  ])

  if (!profile?.business_id || !biz || biz.id !== profile.business_id) redirect(`/${slug}/login`)

  // Role guard: solo admin puede acceder
  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
    redirect(`/${slug}/dashboard`)
  }

  // Feature gate: la lealtad debe estar activa en el plan
  const features = (biz.features_enabled ?? {}) as unknown as BusinessFeatures
  if (!features?.loyalty) redirect(`/${slug}/dashboard/settings`)

  const initial: LoyaltyConfig = {
    loyalty_mode:                 biz.loyalty_mode === 'stamps' ? 'stamps' : 'points',
    loyalty_earn_per_cop:         num(biz.loyalty_earn_per_cop, 1000),
    loyalty_point_value_cop:      num(biz.loyalty_point_value_cop, 50),
    loyalty_min_redeem_points:    num(biz.loyalty_min_redeem_points, 0),
    loyalty_expiry_months:        num(biz.loyalty_expiry_months, 12),
    loyalty_stamps_required:      num(biz.loyalty_stamps_required, 10),
    loyalty_stamp_max_reward_cop: num(biz.loyalty_stamp_max_reward_cop, 0),
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Link
        href={`/${slug}/dashboard/settings`}
        className="flex items-center gap-2 text-sm text-xinuco-muted hover:text-xinuco-text transition-colors self-start"
      >
        <ArrowLeft size={16} />
        Configuración
      </Link>

      <div className="flex flex-col">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-xinuco-text">Lealtad</h1>
        <p className="text-sm text-xinuco-muted mt-1">
          Elige cómo premias a tus clientes. Se gana solo al pagar y se canjea en el cobro.
        </p>
      </div>

      <LoyaltySettingsForm initial={initial} slug={slug} />
    </div>
  )
}
