import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { AdminPageHeader } from '@xinuco/ui'
import { requireSettingsAdmin } from '@/lib/settings-guard'
import { BusinessProfileForm } from '@/components/dashboard/settings/BusinessProfileForm'
import type { Business } from '@xinuco/types'

export const metadata: Metadata = {
  title: 'Datos del negocio — Xinuco',
  description: 'Nombre, contacto y datos para facturación',
}

type ProfileRow = Pick<
  Business,
  'name' | 'address' | 'city' | 'whatsapp' | 'phone' | 'instagram' | 'maps_url' | 'tax_id' | 'legal_name'
>

export default async function BusinessProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { supabase, businessId } = await requireSettingsAdmin(slug)

  const { data } = await supabase
    .from('businesses')
    .select('name, address, city, whatsapp, phone, instagram, maps_url, tax_id, legal_name')
    .eq('id', businessId)
    .single<ProfileRow>()

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
        title="Datos del negocio"
        subtitle="Tus clientes ven el nombre, la dirección y los medios de contacto en tu página de reservas."
      />

      <BusinessProfileForm
        initial={{
          name:       data?.name ?? '',
          address:    data?.address ?? '',
          city:       data?.city ?? '',
          whatsapp:   data?.whatsapp ?? '',
          phone:      data?.phone ?? '',
          instagram:  data?.instagram ?? '',
          maps_url:   data?.maps_url ?? '',
          tax_id:     data?.tax_id ?? '',
          legal_name: data?.legal_name ?? '',
        }}
      />
    </div>
  )
}
