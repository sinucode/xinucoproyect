import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { BookingWizard, type BookableProducts } from '@/components/booking/BookingWizard'
import type { Service, Staff } from '@xinuco/types'
import { filterVisibleServices, normalizeAudiences } from '@/lib/service-audience'

interface BookPageProps {
  params: Promise<{ slug: string }>
}

export default async function BookPage({ params }: BookPageProps) {
  const { slug } = await params
  const supabase = await createClient()

  // Fetch de control para inyectar la metadata y asegurar existencia del negocio
  const { data: business } = await supabase
    .rpc('get_public_business', { p_slug: slug })
    .maybeSingle<{ id: string; name: string; online_payments: boolean; service_audiences: string[] | null }>()

  if (!business) {
    notFound()
  }

  // Leer feature flag de MP para booking online
  const mpBookingEnabled = business.online_payments === true

  // Fetch de los servicios y el staff para el BookingWizard
  const [servicesRes, staffRes] = await Promise.all([
    supabase.from('services').select('*').eq('business_id', business.id).eq('is_active', true).order('name'),
    supabase.from('staff').select('id, full_name, specialty_role, is_active').eq('business_id', business.id).eq('is_active', true).order('full_name'),
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
    <main className="w-full min-h-screen pt-safe px-4 md:px-8 max-w-7xl mx-auto flex flex-col py-10 md:py-16">
      
      {/* ────────────────────────────────────────────────────────────────────
          HERO SECTION (Global Branding Entry)
          ──────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center text-center mb-10 md:mb-14 animate-fade-in">
        <h1 
          className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-3"
          style={{ 
            fontFamily: 'var(--font-playfair, serif)',
            color: 'var(--brand-primary)' 
          }}
        >
          {business.name}
        </h1>
        <div 
          className="w-12 h-0.5 rounded-full mb-4 opacity-60 mx-auto"
          style={{ background: 'var(--brand-primary)' }}
        />
        <p className="text-sm md:text-base text-xinuco-muted font-medium tracking-wide opacity-80 uppercase">
          Tu cita, tu momento.
        </p>
      </div>

      <div className="w-full flex-1 flex flex-col">
        <Suspense fallback={<div className="h-96 w-full max-w-xl mx-auto border rounded-2xl animate-pulse" style={{ borderColor: 'var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.02))' }} />}>
          {/* Instanciación del Wizard de Reservas del Cliente */}
          <BookingWizard
            businessId={business.id}
            services={services}
            audiences={audiences}
            staff={staff}
            mpBookingEnabled={mpBookingEnabled}
            bookableProducts={bookableProducts}
            serviceStaff={serviceStaff}
          />
        </Suspense>
      </div>
    </main>
  )
}
