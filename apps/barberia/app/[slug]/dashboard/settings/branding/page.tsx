import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { BrandingForm } from '@/components/dashboard/settings/BrandingForm'
import type { Business, Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Apariencia y Marca — Xinuco',
  description: 'Personaliza los colores y la fuente de tu negocio',
}

export default async function BrandingPage({
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
      .select('role, business_id')
      .eq('id', user.id)
      .single<Pick<Profile, 'role' | 'business_id'>>(),
    supabase
      .from('businesses')
      .select('id, name, slug, branding')
      .eq('slug', slug)
      .single<Pick<Business, 'id' | 'name' | 'slug' | 'branding'>>(),
  ])

  if (!profile?.business_id || !biz) redirect(`/${slug}/login`)

  // Security: ensure the authenticated user belongs to the requested business
  if (profile.business_id !== biz.id) redirect(`/${slug}/login`)

  // Role guard: solo admin puede acceder
  if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
    redirect(`/${slug}/dashboard`)
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-xinuco-text">
          Apariencia y marca
        </h1>
        <p className="text-sm text-xinuco-muted mt-1">
          Personaliza los colores y la tipografía de tu negocio. Los cambios se aplican al portal de reservas de tus clientes.
        </p>
      </div>

      <BrandingForm business={biz} slug={slug} />
    </div>
  )
}
