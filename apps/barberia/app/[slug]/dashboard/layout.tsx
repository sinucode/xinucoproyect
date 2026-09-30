import { ReactNode } from 'react'
import { createClient } from '@xinuco/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { BottomNav } from '@/components/layout/BottomNav'
import { DashboardSidebar } from '@/components/layout/DashboardSidebar'
import { FeaturesProvider } from '@/lib/features/context'
import { RoleProvider } from '@/lib/features/role-context'
import { TrialBanner } from '@/components/dashboard/TrialBanner'
import type { Business, BusinessFeatures, UserRole, Profile } from '@xinuco/types'

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
      .select('id, name, branding, features_enabled, trial_expires_at')
      .eq('slug', slug)
      .single<Pick<Business, 'id' | 'name' | 'branding' | 'features_enabled' | 'trial_expires_at'>>(),
  ])

  const features        = (business?.features_enabled ?? {}) as unknown as BusinessFeatures
  const trialExpiresAt  = business?.trial_expires_at ?? null

  return (
    <RoleProvider role={(profile?.role ?? 'barber') as UserRole}>
      <FeaturesProvider features={features} trialExpiresAt={trialExpiresAt}>
        <DashboardSidebar slug={slug} business={business}>
          <div className="flex flex-col min-h-screen">
            {/* Header en desktop y mobile */}
            <Header
              business={business}
              userName={profile?.full_name ?? undefined}
              role={profile?.role ?? undefined}
            />

            {/* Banner de trial activo — visible solo para admins */}
            <TrialBanner slug={slug} />

            {/* Área de contenido principal */}
            <div className="flex-1 min-w-0 w-full pb-safe-bottom">
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
  )
}

