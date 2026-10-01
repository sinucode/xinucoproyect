import { createClient } from '@xinuco/supabase/server'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { Service, Staff } from '@xinuco/types'
import { filterVisibleServices, normalizeAudiences } from '@/lib/service-audience'
import { BookingWizard, type BookableProducts } from '@/components/booking/BookingWizard'
import { BusinessContactBlock, type PublicContactData } from '@/components/booking/BusinessContactBlock'

// Fila devuelta por la RPC pública get_public_business (solo campos seguros)
interface PublicBusinessRow extends PublicContactData {
  id:        string
  name:      string
  is_active: boolean
  branding:  any
  service_audiences: string[] | null
}

interface PublicBookingPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PublicBookingPageProps): Promise<Metadata> {
  const { slug } = await params
  const supabase = await createClient()

  const { data: business } = await supabase
    .rpc('get_public_business', { p_slug: slug })
    .maybeSingle<PublicBusinessRow>()

  if (!business) return { title: 'Xinuco' }

  return {
    title: `Reserva en ${business.name} — Xinuco`,
    description: `Agenda tu cita en ${business.name} de forma rápida y sencilla.`,
  }
}

export default async function PublicBookingPage({ params }: PublicBookingPageProps) {
  const { slug } = await params
  const supabase = await createClient()

  // 1. Obtener la información del negocio
  const { data: business, error: bizError } = await supabase
    .rpc('get_public_business', { p_slug: slug })
    .maybeSingle<PublicBusinessRow>()

  if (bizError || !business || !business.is_active) {
    notFound()
  }

  // 2. Obtener servicios y staff activo (solo lo necesario para el cliente)
  const [servicesRes, staffRes] = await Promise.all([
    supabase
      .from('services')
      .select('*')
      .eq('business_id', business.id)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('staff')
      .select('id, full_name, specialty_role, is_active')
      .eq('business_id', business.id)
      .eq('is_active', true)
      .order('full_name'),
  ])

  // 3. Productos que el cliente puede apartar al reservar (error → deshabilitado)
  // Barberos que hacen cada servicio (error → sin filtro: se muestran todos)
  const { data: serviceStaffData } = await supabase.rpc('get_public_service_staff', { p_business_id: business.id })
  const serviceStaff = (serviceStaffData ?? undefined) as Record<string, string[]> | undefined

  const { data: productsData, error: productsError } = await supabase.rpc('get_bookable_products', {
    p_business_id: business.id,
  })
  const bookableProducts: BookableProducts =
    !productsError && productsData && (productsData as BookableProducts).enabled
      ? (productsData as BookableProducts)
      : { enabled: false, max_units: 0, items: [] }

  // Públicos activos: los servicios de públicos desactivados no se ofrecen
  const audiences = normalizeAudiences(business.service_audiences)
  const services = filterVisibleServices((servicesRes.data ?? []) as Service[], audiences)
  const staff = (staffRes.data ?? []) as Staff[]

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-color)' }}>
      {/* ════════════════════════════════════════════════════════════════════
          HEADER PREMIUM — El Escaparate del Tenant
          ════════════════════════════════════════════════════════════════════ */}
      <header className="relative pt-safe">
        {/* Gradient ambient glow */}
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 80% 50% at 50% 0%, color-mix(in srgb, var(--primary-color) 20%, transparent), transparent)',
          }}
        />

        <div className="relative z-10 flex flex-col items-center text-center pt-14 pb-10 px-6">
          {/* Logo o Iniciales */}
          {business.branding?.logo_url ? (
            <img
              src={business.branding.logo_url}
              alt={`Logo de ${business.name}`}
              className="w-20 h-20 rounded-2xl object-cover mb-5 shadow-xl ring-2 ring-white/10"
            />
          ) : (
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-bold mb-5 shadow-xl"
              style={{ background: 'var(--primary-color)', color: 'var(--bg-color)' }}
            >
              {business.name.substring(0, 2).toUpperCase()}
            </div>
          )}

          {/* Nombre del negocio — tipografía serif premium */}
          <h1
            className="text-3xl font-bold tracking-tight text-xinuco-text"
            style={{ fontFamily: "'Outfit', var(--font-family)" }}
          >
            {business.name}
          </h1>
          <p className="text-sm text-xinuco-muted mt-2 max-w-xs leading-relaxed">
            Reserva tu cita en segundos.
            <br />
            <span className="text-xs opacity-70">Elige servicio, profesional y horario.</span>
          </p>

          {/* Divider con glow */}
          <div
            className="mt-6 w-12 h-0.5 rounded-full opacity-60"
            style={{ background: 'var(--primary-color)' }}
          />
        </div>
      </header>

      {/* ════════════════════════════════════════════════════════════════════
          BOOKING WIZARD — El Motor Visual
          ════════════════════════════════════════════════════════════════════ */}
      <main className="px-4 pb-32">
        <BusinessContactBlock data={business} />
        <BookingWizard
          businessId={business.id}
          services={services}
          audiences={audiences}
          staff={staff}
          bookableProducts={bookableProducts}
          serviceStaff={serviceStaff}
        />
      </main>
    </div>
  )
}
