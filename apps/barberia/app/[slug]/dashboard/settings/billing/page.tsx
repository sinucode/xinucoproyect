// app/[slug]/dashboard/settings/billing/page.tsx
// ══════════════════════════════════════════════════════════════════════════════
// Página de facturación SaaS del negocio.
//
// Muestra:
//  - Plan actual detectado de features_enabled
//  - Estado de suscripción de mp_subscriptions
//  - Tarjetas de planes para subir/bajar de plan
//  - Opción de cancelación
//
// Rutas de vuelta de MercadoPago:
//  ?result=subscription  → regresó tras autorizar la suscripción
// ══════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next'
import { redirect }  from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { detectCurrentPlan, PLAN_BUNDLES } from '@xinuco/billing-catalog'
import { SaaSBillingPanel }  from '@/components/dashboard/settings/SaaSBillingPanel'
import { CreditCard, ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import type { Business, BusinessFeatures, Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Facturación — Xinuco',
  description: 'Gestiona tu plan y suscripción de Xinuco',
}

export default async function BillingSettingsPage({
  params,
  searchParams,
}: {
  params:       Promise<{ slug: string }>
  searchParams: Promise<{ result?: string }>
}) {
  const { slug }   = await params
  const { result } = await searchParams

  const supabase = await createClient()

  // ── Auth guard ───────────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  // ── Obtener datos del negocio y perfil ───────────────────────────────────
  const [{ data: profile }, { data: biz }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, role, business_id')
      .eq('id', user.id)
      .single<Pick<Profile, 'full_name' | 'role' | 'business_id'>>(),
    supabase
      .from('businesses')
      .select('id, name, subscription_status, features_enabled')
      .eq('slug', slug)
      .single<Pick<Business, 'id' | 'name' | 'subscription_status' | 'features_enabled'>>(),
  ])

  if (!profile?.business_id || !biz) redirect(`/${slug}/login`)

  // Role guard: solo admin puede acceder
  if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
    redirect(`/${slug}/dashboard`)
  }

  // ── Detectar plan actual ─────────────────────────────────────────────────
  const features    = (biz.features_enabled ?? {}) as unknown as BusinessFeatures
  const currentPlan = detectCurrentPlan(features)

  // ── Obtener estado de suscripción MP ─────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: mpSub } = await (supabase as any)
    .from('mp_subscriptions')
    .select('plan_id, status, amount_cop, next_billing_date')
    .eq('business_id', biz.id)
    .maybeSingle() as {
      data: {
        plan_id: string; status: string
        amount_cop: number; next_billing_date: string | null
      } | null
    }

  const subscriptionStatus = mpSub?.status ?? null

  return (
    <div className="flex flex-col gap-8 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

      {/* ── Header ── */}
      <div className="flex flex-col gap-2">
        <Link
          href={`/${slug}/dashboard/settings`}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors w-fit"
        >
          <ChevronLeft size={13} />
          Volver a Configuración
        </Link>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 flex items-center justify-center rounded-xl"
            style={{ background: 'rgba(197,160,89,0.1)' }}
          >
            <CreditCard size={18} style={{ color: 'var(--primary-color)' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-xinuco-text">Facturación</h1>
            <p className="text-xs text-zinc-500">Gestiona tu plan de Xinuco</p>
          </div>
        </div>
      </div>

      {/* ── Info de próxima factura ── */}
      {mpSub?.next_billing_date && subscriptionStatus === 'authorized' && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-800 bg-zinc-900/40 text-xs">
          <span className="text-zinc-400">Próximo cobro</span>
          <span className="font-semibold text-zinc-200">
            {new Date(mpSub.next_billing_date).toLocaleDateString('es-CO', {
              year: 'numeric', month: 'long', day: 'numeric',
            })}
          </span>
        </div>
      )}

      {/* ── Panel de facturación ── */}
      <SaaSBillingPanel
        businessId={biz.id}
        slug={slug}
        payerEmail={user.email ?? ''}
        currentPlan={currentPlan}
        subscriptionStatus={subscriptionStatus}
        resultParam={result}
      />
    </div>
  )
}
