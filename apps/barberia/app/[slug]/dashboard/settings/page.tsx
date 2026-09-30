import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { Clock, Bell, Palette, Users, CreditCard, ShoppingBag, Gift, ChevronRight, type LucideIcon } from 'lucide-react'
import { detectCurrentPlan, PLAN_BUNDLES } from '@xinuco/billing-catalog'
import type { Business, BusinessFeatures, Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Ajustes — Xinuco',
  description: 'Configuración del negocio',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SettingCard {
  label:       string
  description: string
  href:        string
  icon:        LucideIcon
}

// ── Componentes internos ──────────────────────────────────────────────────────

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    basico:  { bg: 'rgba(161,161,170,0.1)', text: '#a1a1aa', border: 'rgba(161,161,170,0.2)' },
    pro:     { bg: 'rgba(96,165,250,0.1)',  text: '#60a5fa', border: 'rgba(96,165,250,0.2)' },
    premium: { bg: 'rgba(197,160,89,0.1)',  text: '#C5A059', border: 'rgba(197,160,89,0.2)' },
    custom:  { bg: 'rgba(74,222,128,0.1)',  text: '#4ade80', border: 'rgba(74,222,128,0.2)' },
  }
  const c      = colors[plan] ?? colors.custom
  const labels: Record<string, string> = {
    basico:  'Plan Básico',
    pro:     'Plan Pro',
    premium: 'Plan Premium',
    custom:  'Plan Personalizado',
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border"
      style={{ background: c.bg, color: c.text, borderColor: c.border }}
    >
      {labels[plan] ?? plan}
    </span>
  )
}

function NavCard({
  card,
  slug,
}: {
  card: SettingCard
  slug: string
}) {
  const Icon = card.icon
  // Resolve relative href vs absolute
  const href = card.href.startsWith('../')
    ? `/${slug}/dashboard/${card.href.replace('../', '')}`
    : `/${slug}/dashboard/settings/${card.href.replace('./', '')}`

  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-xl px-5 py-4 transition-all duration-150 hover:bg-white/[0.03]"
      style={{
        background:  '#111111',
        border:      '1px solid var(--border-color)',
        borderLeft:  '3px solid var(--primary-color)',
      }}
    >
      <div
        className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl"
        style={{ background: 'rgba(197,160,89,0.1)' }}
      >
        <Icon size={18} style={{ color: 'var(--primary-color)' }} strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-xinuco-text leading-tight">{card.label}</p>
        <p className="text-xs text-xinuco-muted mt-0.5 leading-tight">{card.description}</p>
      </div>
      <ChevronRight
        size={16}
        className="shrink-0 text-xinuco-muted transition-transform duration-150 group-hover:translate-x-0.5"
      />
    </Link>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default async function SettingsPage({
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

  // 2. Obtener perfil y business en paralelo
  const [{ data: profile }, { data: biz }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, role, business_id')
      .eq('id', user.id)
      .single<Pick<Profile, 'full_name' | 'role' | 'business_id'>>(),
    supabase
      .from('businesses')
      .select('id, name, slug, features_enabled, branding')
      .eq('slug', slug)
      .single<Pick<Business, 'id' | 'name' | 'slug' | 'features_enabled' | 'branding'>>(),
  ])

  if (!profile?.business_id || !biz) redirect(`/${slug}/login`)

  // Role guard: solo admin puede acceder
  if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
    redirect(`/${slug}/dashboard`)
  }

  const features    = (biz.features_enabled ?? {}) as unknown as BusinessFeatures
  const currentPlan = detectCurrentPlan(features)
  const planMeta    = PLAN_BUNDLES[currentPlan as keyof typeof PLAN_BUNDLES]
  const bookingUrl  = `https://www.xinuco.com/${slug}/book`

  // 3. Tarjetas de navegación
  const settingCards: SettingCard[] = [
    {
      label:       'Horarios de Atención',
      description: 'Configura los días y horas de operación',
      href:        './availability',
      icon:        Clock,
    },
    {
      label:       'Reservas en línea',
      description: 'Productos apartados y límites por cita',
      href:        './booking',
      icon:        ShoppingBag,
    },
    ...(features.loyalty
      ? [{
          label:       'Lealtad',
          description: 'Puntos o sellos para premiar a tus clientes',
          href:        './loyalty',
          icon:        Gift,
        }]
      : []),
    {
      label:       'Notificaciones',
      description: 'Email y recordatorios automáticos',
      href:        './notifications',
      icon:        Bell,
    },
    {
      label:       'Apariencia y Marca',
      description: 'Colores, logo y nombre del negocio',
      href:        './branding',
      icon:        Palette,
    },
    {
      label:       'Equipo y Servicios',
      description: 'Gestiona barberos y servicios',
      href:        '../staff',
      icon:        Users,
    },
    {
      label:       'Facturación',
      description: 'Plan Xinuco y suscripción MercadoPago',
      href:        './billing',
      icon:        CreditCard,
    },
  ]

  return (
    <div className="flex flex-col gap-8 max-w-4xl mx-auto pb-24">

      {/* ── Header ── */}
      <div
        className="flex flex-col pb-6 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-xinuco-muted mb-1">
          Bienvenido, {profile.full_name?.split(' ')[0] ?? 'Administrador'}
        </p>
        <h1 className="text-2xl font-serif font-bold text-xinuco-text tracking-wide">
          Ajustes del Negocio
        </h1>
        <p className="text-sm text-xinuco-muted mt-1">
          Configura tu barbería y personaliza la experiencia para tus clientes.
        </p>
      </div>

      {/* ── Info del negocio ── */}
      <section aria-label="Información del negocio">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-xinuco-muted mb-4">
          Tu negocio
        </h2>
        <div
          className="rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          style={{
            background: '#111111',
            border:     '1px solid var(--border-color)',
          }}
        >
          <div className="flex flex-col gap-2">
            <p className="text-lg font-bold text-xinuco-text">{biz.name}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-xs font-mono px-2 py-0.5 rounded"
                style={{
                  background: 'rgba(197,160,89,0.08)',
                  color:      'var(--primary-color)',
                  border:     '1px solid rgba(197,160,89,0.2)',
                }}
              >
                {bookingUrl}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <PlanBadge plan={currentPlan} />
            {planMeta && (
              <p className="text-xs text-xinuco-muted hidden sm:block max-w-[200px] text-right leading-tight">
                {planMeta.description}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Secciones de configuración ── */}
      <section aria-label="Secciones de configuración">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-xinuco-muted mb-4">
          Configuración
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {settingCards.map(card => (
            <NavCard key={card.label} card={card} slug={slug} />
          ))}
        </div>
      </section>

    </div>
  )
}
