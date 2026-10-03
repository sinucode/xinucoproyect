import { ReactNode } from 'react'
import { createClient } from '@xinuco/supabase/server'
import { redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { THEME_PRESETS, MUTED_COLORS } from '@/lib/brand-theme'
import { Header } from '@/components/layout/Header'
import { BottomNav } from '@/components/layout/BottomNav'
import { DashboardSidebar } from '@/components/layout/DashboardSidebar'
import { FeaturesProvider } from '@/lib/features/context'
import { RoleProvider } from '@/lib/features/role-context'
import { TrialBanner } from '@/components/dashboard/TrialBanner'
import type { Business, BusinessFeatures, UserRole, Profile } from '@xinuco/types'

// El dashboard (admin y barberos) es SIEMPRE oscuro: ignora fondo/superficie/texto del negocio y
// conserva color principal y tipografía (heredados del layout del tenant). El modo claro/oscuro
// elegido en Apariencia solo aplica a la página de reservas.
const DASHBOARD_THEME_VARS = {
  '--bg-color':        THEME_PRESETS.dark.bgColor,
  '--secondary-color': THEME_PRESETS.dark.secondaryColor,
  '--text-color':      THEME_PRESETS.dark.textColor,
  '--border-color':    `${THEME_PRESETS.dark.secondaryColor}CC`,
  '--muted-color':     MUTED_COLORS.dark,
  colorScheme:         'dark',
  backgroundColor:     THEME_PRESETS.dark.bgColor,
  color:               THEME_PRESETS.dark.textColor,
} as CSSProperties

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  // Seguridad: Obtener usuario
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  // Fetch para el Header, Sidebar, FeaturesProvider y Trial
  const [{ data: profile }, { data: business }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, role')
      .eq('id', user.id)
      .single<Pick<Profile, 'full_name' | 'role'>>(),
    supabase
      .from('businesses')
      .select('id, name, branding, brand_config, features_enabled, trial_expires_at')
      .eq('slug', slug)
      .single<Pick<Business, 'id' | 'name' | 'branding' | 'brand_config' | 'features_enabled' | 'trial_expires_at'>>(),
  ])

  const features        = (business?.features_enabled ?? {}) as unknown as BusinessFeatures
  const trialExpiresAt  = business?.trial_expires_at ?? null

  return (
    // Contenedor interno de tema: los sheets (portal) toman el [data-tenant-theme] MÁS interno
    <div data-tenant-theme="" data-dashboard-theme="" className="flex flex-col flex-1" style={DASHBOARD_THEME_VARS}>
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
          </div>
        </DashboardSidebar>
      </FeaturesProvider>
    </RoleProvider>
    </div>
  )
}

