import { ReactNode } from 'react'
import { createClient } from '@xinuco/supabase/server'
import { redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { THEME_PRESETS, MUTED_COLORS, resolveThemeMode } from '@/lib/brand-theme'
import { Header } from '@/components/layout/Header'
import { BottomNav } from '@/components/layout/BottomNav'
import { DashboardSidebar } from '@/components/layout/DashboardSidebar'
import { FeaturesProvider } from '@/lib/features/context'
import { RoleProvider } from '@/lib/features/role-context'
import { TrialBanner } from '@/components/dashboard/TrialBanner'
import { RealtimeRefresher } from '@/components/realtime/RealtimeRefresher'
import { getSessionUser, getMyProfile, getBusinessBySlug } from '@/lib/session'
import type { BusinessFeatures, UserRole, ThemeMode } from '@xinuco/types'

// El dashboard (admin y barberos) sigue el modo claro/oscuro elegido en Apariencia (brand_config.themeMode).
// Ignora fondo/superficie/texto personalizados del negocio y conserva color principal y tipografía
// (heredados del layout del tenant). Oscuro = valores históricos; claro = neutros claros fijos.
// Los neutros zinc / velos fg se invierten por CSS (globals.css, [data-dashboard-theme][data-theme-mode="light"]).
const DASHBOARD_LIGHT = {
  bgColor:        '#F7F7F8',
  secondaryColor: '#FFFFFF',
  textColor:      '#111111',
  borderColor:    'rgba(0,0,0,0.10)',
} as const

function dashboardThemeVars(mode: ThemeMode): CSSProperties {
  if (mode === 'light') {
    return {
      '--bg-color':        DASHBOARD_LIGHT.bgColor,
      '--secondary-color': DASHBOARD_LIGHT.secondaryColor,
      '--text-color':      DASHBOARD_LIGHT.textColor,
      '--border-color':    DASHBOARD_LIGHT.borderColor,
      '--muted-color':     MUTED_COLORS.light,
      colorScheme:         'light',
      backgroundColor:     DASHBOARD_LIGHT.bgColor,
      color:               DASHBOARD_LIGHT.textColor,
    } as CSSProperties
  }
  return {
    '--bg-color':        THEME_PRESETS.dark.bgColor,
    '--secondary-color': THEME_PRESETS.dark.secondaryColor,
    '--text-color':      THEME_PRESETS.dark.textColor,
    '--border-color':    `${THEME_PRESETS.dark.secondaryColor}CC`,
    '--muted-color':     MUTED_COLORS.dark,
    colorScheme:         'dark',
    backgroundColor:     THEME_PRESETS.dark.bgColor,
    color:               THEME_PRESETS.dark.textColor,
  } as CSSProperties
}

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  // Sesión, perfil y negocio en paralelo (el negocio no depende del usuario). Memoizados por petición:
  // la página y las actions que se renderizan después reutilizan estos mismos resultados (lib/session.ts).
  const [user, profile, business] = await Promise.all([
    getSessionUser(supabase),
    getMyProfile(supabase),
    getBusinessBySlug(supabase, slug),
  ])

  // Seguridad: sin sesión no se renderiza nada del dashboard
  if (!user) redirect(`/${slug}/login`)

  const features        = (business?.features_enabled ?? {}) as unknown as BusinessFeatures
  const trialExpiresAt  = business?.trial_expires_at ?? null
  // Modo claro/oscuro del negocio (brand_config.themeMode; por defecto oscuro)
  const themeMode       = resolveThemeMode((business?.brand_config as { themeMode?: unknown } | null)?.themeMode)

  return (
    // Contenedor interno de tema: los sheets (portal) toman el [data-tenant-theme] MÁS interno
    <div data-tenant-theme="" data-dashboard-theme="" data-theme-mode={themeMode} className="flex flex-col flex-1" style={dashboardThemeVars(themeMode)}>
    <RoleProvider role={(profile?.role ?? 'barber') as UserRole}>
      <FeaturesProvider features={features} trialExpiresAt={trialExpiresAt}>
        <DashboardSidebar slug={slug} business={business} userName={profile?.full_name ?? undefined}>
          <div className="flex flex-col min-h-dvh">
            {/* Header en desktop y mobile */}
            <Header
              business={business}
              userName={profile?.full_name ?? undefined}
              role={profile?.role ?? undefined}
            />

            {/* Banner de trial activo — visible solo para admins */}
            <TrialBanner slug={slug} />

            {/* Área de contenido principal */}
            <div className="flex-1 min-w-0 w-full pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-8">
              {children}
            </div>

            {/* Bottom Nav solo para mobile */}
            <div className="md:hidden">
              <BottomNav slug={slug} />
            </div>

            {/* Actualización en vivo (Supabase Realtime) para admin y barberos */}
            {business?.id && <RealtimeRefresher businessId={business.id} />}
          </div>
        </DashboardSidebar>
      </FeaturesProvider>
    </RoleProvider>
    </div>
  )
}

