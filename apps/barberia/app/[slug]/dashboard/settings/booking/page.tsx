import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { AdminPageHeader } from '@xinuco/ui'
import { requireSettingsAdmin } from '@/lib/settings-guard'
import { BookingSettingsForm } from '@/components/dashboard/settings/BookingSettingsForm'
import { normalizeBookingInterval } from '@/lib/booking-settings'
import type { Business } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Reservas en línea — Xinuco',
  description: 'Horarios que ve el cliente, productos apartados y límites por cita',
}

export default async function BookingSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { supabase, businessId } = await requireSettingsAdmin(slug)

  const { data: biz } = await supabase
    .from('businesses')
    .select(
      'booking_products_enabled, booking_max_product_units, booking_max_open_with_products_per_phone, appointment_interval_minutes',
    )
    .eq('id', businessId)
    .single<Pick<
      Business,
      | 'booking_products_enabled'
      | 'booking_max_product_units'
      | 'booking_max_open_with_products_per_phone'
      | 'appointment_interval_minutes'
    >>()

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Link
        href={`/${slug}/dashboard/settings`}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-xinuco-muted hover:text-xinuco-text transition-colors w-fit"
      >
        <ArrowLeft size={14} />
        Configuración
      </Link>

      <AdminPageHeader
        title="Reservas en línea"
        subtitle="Cada cuánto se ofrecen horarios y si tus clientes pueden apartar productos al reservar."
      />

      <BookingSettingsForm
        initial={{
          appointment_interval_minutes:             normalizeBookingInterval(biz?.appointment_interval_minutes),
          booking_products_enabled:                 biz?.booking_products_enabled ?? true,
          booking_max_product_units:                biz?.booking_max_product_units ?? 2,
          booking_max_open_with_products_per_phone: biz?.booking_max_open_with_products_per_phone ?? 1,
        }}
      />
    </div>
  )
}
