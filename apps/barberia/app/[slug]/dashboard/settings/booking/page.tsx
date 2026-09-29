import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { BookingSettingsForm } from '@/components/dashboard/settings/BookingSettingsForm'
import type { Business, Profile } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Reservas en línea — Xinuco',
  description: 'Productos apartados y límites por cita',
}

export default async function BookingSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // 1. Auth guard
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  // 2. Obtener perfil y negocio en paralelo
  const [{ data: profile }, { data: biz }] = await Promise.all([
    supabase
      .from('profiles')
      .select('role, business_id')
      .eq('id', user.id)
      .single<Pick<Profile, 'role' | 'business_id'>>(),
    supabase
      .from('businesses')
      .select(
        'id, booking_products_enabled, booking_max_product_units, booking_max_open_with_products_per_phone',
      )
      .eq('slug', slug)
      .single<Pick<
        Business,
        'id' | 'booking_products_enabled' | 'booking_max_product_units' | 'booking_max_open_with_products_per_phone'
      >>(),
  ])

  if (!profile?.business_id || !biz) redirect(`/${slug}/login`)

  // Role guard: solo admin puede acceder
  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
    redirect(`/${slug}/dashboard`)
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto pb-24">
      <div className="flex flex-col pb-6 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <h1 className="text-2xl font-serif font-bold text-xinuco-text tracking-wide">Reservas en línea</h1>
        <p className="text-sm text-xinuco-muted mt-1">
          Define si tus clientes pueden apartar productos al reservar y cuántos por cita.
        </p>
      </div>

      <BookingSettingsForm
        businessId={biz.id}
        initial={{
          booking_products_enabled:                 biz.booking_products_enabled ?? true,
          booking_max_product_units:                biz.booking_max_product_units ?? 2,
          booking_max_open_with_products_per_phone: biz.booking_max_open_with_products_per_phone ?? 1,
        }}
      />
    </div>
  )
}
