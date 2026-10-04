import type { Metadata } from 'next'
import Link from 'next/link'
import { Store, CalendarClock, Bell, Palette, Users, CreditCard, ShoppingBag, Gift, LayoutGrid, Wallet, ChevronRight, type LucideIcon } from 'lucide-react'
import { detectCurrentPlan, PLAN_BUNDLES } from '@xinuco/billing-catalog'
import type { Business, BusinessFeatures } from '@xinuco/types'
import { requireSettingsAdmin } from '@/lib/settings-guard'
import { businessTodayISODate } from '@/lib/agenda-time'
import { bookingStatus, hoursStatus, loyaltyStatus, paymentMethodsStatus, profileStatus, workstationsStatus } from '@/lib/settings-status'
import { CopyButton } from '@/components/ui/CopyButton'

export const metadata: Metadata = {
  title: 'Configuración — Xinuco',
  description: 'Configuración del negocio',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SettingCard {
  label:       string
  description: string
  href:        string
  icon:        LucideIcon
  /** Línea de estado en vivo (p. ej. "Falta la dirección"). */
  status?:     string
  /** true = algo por completar: el estado se resalta. */
  attention?:  boolean
}

interface SettingGroup {
  title: string
  cards: SettingCard[]
}

// ── Componentes internos ──────────────────────────────────────────────────────

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    basico:  { bg: 'rgba(161,161,170,0.1)', text: 'rgb(var(--zinc-400))', border: 'rgba(161,161,170,0.2)' },
    pro:     { bg: 'rgba(96,165,250,0.1)',  text: 'var(--st-blue, #60a5fa)', border: 'rgba(96,165,250,0.2)' },
    premium: { bg: 'rgba(197,160,89,0.1)',  text: '#C5A059', border: 'rgba(197,160,89,0.2)' },
    custom:  { bg: 'rgba(74,222,128,0.1)',  text: 'var(--st-green, #4ade80)', border: 'rgba(74,222,128,0.2)' },
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
      className="group flex items-center gap-4 rounded-xl px-5 py-4 transition-all duration-150 hover:bg-fg/[0.03]"
      style={{
        background:  'var(--card-color, #111111)',
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
        {card.status && (
          <p
            className="text-xs font-medium mt-1.5 leading-tight break-words"
            style={{ color: card.attention ? 'var(--st-amber-2, #f59e0b)' : 'var(--primary-color)' }}
          >
            {card.status}
          </p>
        )}
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

  // 1. Guardia: solo el administrador de ESTE negocio
  const { supabase, businessId, fullName } = await requireSettingsAdmin(slug)

  const todayKey = businessTodayISODate()

  // 2. Negocio y cierres próximos en paralelo
  type BizRow = Pick<
    Business,
    | 'id' | 'name' | 'slug' | 'features_enabled'
    | 'address' | 'whatsapp' | 'phone' | 'operating_hours'
    | 'appointment_interval_minutes' | 'booking_products_enabled' | 'booking_max_product_units'
  > & { loyalty_mode?: string | null }

  const [{ data: biz }, { data: closuresRaw }, workstationsRes, { data: accountsRaw }] = await Promise.all([
    supabase
      .from('businesses')
      .select(
        'id, name, slug, features_enabled, address, whatsapp, phone, operating_hours, ' +
        'appointment_interval_minutes, booking_products_enabled, booking_max_product_units, loyalty_mode',
      )
      .eq('id', businessId)
      .single<BizRow>(),
    (supabase as any)
      .from('business_closures')
      .select('date_from, date_to, kind')
      .eq('business_id', businessId)
      .gte('date_to', todayKey)
      .order('date_from', { ascending: true }),
    // Conteo barato de estaciones activas (solo cabeceras, sin filas)
    supabase
      .from('workstations')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('is_active', true),
    // Medios de pago (para la línea de estado de la tarjeta)
    (supabase as any)
      .from('money_accounts')
      .select('name, is_active')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  if (!biz) return null

  const closures = (closuresRaw ?? []) as { date_from: string; date_to: string; kind: 'holiday' | 'custom' }[]

  const features    = (biz.features_enabled ?? {}) as unknown as BusinessFeatures
  const currentPlan = detectCurrentPlan(features)
  const planMeta    = PLAN_BUNDLES[currentPlan as keyof typeof PLAN_BUNDLES]
  const bookingUrl  = `https://www.xinuco.com/${slug}/book`

  // 3. Grupos de tarjetas, con su estado en vivo
  const profile = profileStatus(biz)
  const hours   = hoursStatus({ operatingHours: biz.operating_hours, closures, todayKey })

  const groups: SettingGroup[] = [
    {
      title: 'Tu negocio',
      cards: [
        {
          label:       'Datos del negocio',
          description: 'Nombre, dirección, contacto y datos para facturación',
          href:        './business',
          icon:        Store,
          status:      profile.text,
          attention:   !profile.complete,
        },
        {
          label:       'Medios de pago',
          description: 'Efectivo, bancos y billeteras con los que cobras y pagas',
          href:        './payment-methods',
          icon:        Wallet,
          status:      paymentMethodsStatus(accountsRaw as { name: string; is_active: boolean }[] | null),
        },
        {
          label:       'Apariencia y marca',
          description: 'Colores y tipografía de tu página de reservas',
          href:        './branding',
          icon:        Palette,
        },
      ],
    },
    {
      title: 'Agenda y reservas',
      cards: [
        {
          label:       'Horario y días cerrados',
          description: 'Horario del negocio, festivos y vacaciones',
          href:        './availability',
          icon:        CalendarClock,
          status:      hours.text,
          attention:   !hours.complete,
        },
        {
          label:       'Reservas en línea',
          description: 'Intervalo entre horarios y productos apartados',
          href:        './booking',
          icon:        ShoppingBag,
          status:      bookingStatus(biz),
        },
        ...(features.workstations
          ? [{
              label:       'Estaciones y espacios',
              description: 'Lavacabezas, sillón de tinte y otros espacios compartidos',
              href:        '../workstations',
              icon:        LayoutGrid,
              status:      workstationsStatus(workstationsRes.count),
            }]
          : []),
        {
          label:       'Notificaciones',
          description: 'Correos de confirmación y recordatorios',
          href:        './notifications',
          icon:        Bell,
          status:      features.notifications_email ? 'Correos activos' : 'Correos apagados',
          attention:   !features.notifications_email,
        },
      ],
    },
    ...(features.loyalty
      ? [{
          title: 'Clientes',
          cards: [{
            label:       'Lealtad',
            description: 'Puntos o sellos para premiar a tus clientes',
            href:        './loyalty',
            icon:        Gift,
            status:      loyaltyStatus({ enabled: true, mode: biz.loyalty_mode }),
          }],
        }]
      : []),
    {
      title: 'Equipo',
      cards: [
        {
          label:       'Equipo y servicios',
          description: 'Profesionales, horarios individuales y servicios',
          href:        '../staff',
          icon:        Users,
        },
      ],
    },
    {
      title: 'Plan',
      cards: [
        {
          label:       'Facturación',
          description: 'Plan Xinuco y suscripción MercadoPago',
          href:        './billing',
          icon:        CreditCard,
        },
      ],
    },
  ]

  return (
    <div className="flex flex-col gap-8 w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">

      {/* ── Header ── */}
      <div className="flex flex-col">
        <p className="text-xs font-semibold uppercase tracking-wider text-xinuco-muted mb-1">
          Bienvenido, {fullName?.split(' ')[0] ?? 'Administrador'}
        </p>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-xinuco-text">
          Configuración del negocio
        </h1>
        <p className="text-sm text-xinuco-muted mt-1">
          Configura tu barbería y personaliza la experiencia para tus clientes.
        </p>
      </div>

      {/* ── Info del negocio ── */}
      <section aria-label="Información del negocio">
        <div
          className="rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          style={{
            background: 'var(--card-color, #111111)',
            border:     '1px solid var(--border-color)',
          }}
        >
          <div className="flex flex-col gap-2 min-w-0">
            <p className="text-lg font-bold text-xinuco-text break-words">{biz.name}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-xs font-mono px-2 py-1 rounded break-all"
                style={{
                  background: 'color-mix(in srgb, var(--primary-color) 8%, transparent)',
                  color:      'var(--primary-color)',
                  border:     '1px solid color-mix(in srgb, var(--primary-color) 20%, transparent)',
                }}
              >
                {bookingUrl}
              </span>
              <CopyButton text={bookingUrl} label="Copiar el link de reservas" />
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

      {/* ── Grupos de configuración ── */}
      {groups.map(group => (
        <section key={group.title} aria-label={group.title}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-xinuco-muted mb-4">
            {group.title}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {group.cards.map(card => (
              <NavCard key={card.label} card={card} slug={slug} />
            ))}
          </div>
        </section>
      ))}

    </div>
  )
}
