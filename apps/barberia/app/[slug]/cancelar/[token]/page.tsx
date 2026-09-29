import type { Metadata } from 'next'
import { createClient } from '@xinuco/supabase/server'
import { formatApptTime, apptDateKey, businessTodayISODate, businessNowHHMM } from '@/lib/agenda-time'
import { CancelButton } from './CancelButton'

// Nunca cachear ni indexar: la página depende de un token privado.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Cancelar cita',
  robots: { index: false, follow: false },
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface AppointmentByToken {
  status:        string
  start_time:    string
  business_name: string
  slug:          string
  service_name:  string | null
  staff_name:    string | null
  customer_name: string | null
  paid_online:   boolean
  products:      { name: string; quantity: number }[] | null
  can_cancel:    boolean
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-xinuco-border bg-xinuco-surface/40 p-6 text-center">
        {children}
      </div>
    </main>
  )
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <Shell>
      <h1 className="text-xl font-bold text-xinuco-text mb-2">{title}</h1>
      <p className="text-sm text-xinuco-muted leading-relaxed">{text}</p>
    </Shell>
  )
}

function notCancellableReason(a: AppointmentByToken, startedOrPast: boolean): string {
  if (a.status === 'cancelled') return 'Esta cita ya fue cancelada.'
  if (a.paid_online) {
    return `Pagaste esta cita en línea. Para cancelarla y gestionar el reembolso, comunícate con ${a.business_name}.`
  }
  if ((a.status === 'scheduled' || a.status === 'payment_pending') && startedOrPast) {
    return 'Esta cita ya pasó o está en curso; no se puede cancelar desde aquí.'
  }
  return 'Esta cita ya no se puede cancelar.'
}

export default async function CancelAppointmentPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>
}) {
  const { slug, token } = await params

  if (!UUID_RE.test(token)) {
    return <Message title="Enlace inválido" text="Revisa que el enlace del correo esté completo." />
  }

  const notFoundMsg = (
    <Message
      title="Cita no encontrada"
      text="No encontramos esta cita. Es posible que el enlace esté incompleto."
    />
  )

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_appointment_by_token', { p_token: token })
  const appt = data as AppointmentByToken | null

  // Un token de otro negocio se trata igual que uno inexistente (no filtrar datos).
  if (error || !appt || appt.slug !== slug) return notFoundMsg

  const rawDate = new Date(appt.start_time).toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
  // Solo la primera letra en mayúscula ("Jueves, 1 de octubre de 2026"); `capitalize` de CSS ponía "De".
  const date = rawDate.charAt(0).toUpperCase() + rawDate.slice(1)
  const time = formatApptTime(appt.start_time)
  const products = appt.products ?? []

  // start_time = hora local del negocio guardada como UTC → comparar con "ahora" en Bogotá.
  const startKey = apptDateKey(appt.start_time)
  const today    = businessTodayISODate()
  const startedOrPast =
    startKey < today || (startKey === today && appt.start_time.slice(11, 16) <= businessNowHHMM())

  return (
    <Shell>
      <p className="text-xs font-semibold uppercase tracking-wider text-xinuco-muted mb-1">
        {appt.business_name}
      </p>
      <h1 className="text-xl font-bold text-xinuco-text mb-1">
        {appt.can_cancel ? '¿Cancelar tu cita?' : appt.status === 'cancelled' ? 'Cita cancelada' : 'Tu cita'}
      </h1>
      {appt.customer_name && (
        <p className="text-sm text-xinuco-muted mb-5">Hola {appt.customer_name}</p>
      )}

      <dl className="rounded-xl border border-xinuco-border p-4 text-left text-sm space-y-2 mb-5">
        <div className="flex justify-between gap-3">
          <dt className="text-xinuco-muted">Servicio</dt>
          <dd className="font-semibold text-xinuco-text text-right">{appt.service_name ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-xinuco-muted">Profesional</dt>
          <dd className="font-semibold text-xinuco-text text-right">{appt.staff_name ?? 'Cualquier disponible'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-xinuco-muted">Fecha</dt>
          <dd className="font-semibold text-xinuco-text text-right">{date}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-xinuco-muted">Hora</dt>
          <dd className="font-semibold text-right" style={{ color: 'var(--primary-color)' }}>{time}</dd>
        </div>
        {products.length > 0 && (
          <div className="pt-2 border-t border-xinuco-border">
            <dt className="text-xinuco-muted mb-1">Te guardamos</dt>
            <dd>
              <ul className="space-y-1">
                {products.map((p, i) => (
                  <li key={i} className="text-xinuco-text">{p.quantity} × {p.name}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>

      {appt.can_cancel ? (
        <CancelButton token={token} slug={slug} />
      ) : (
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-xinuco-muted leading-relaxed">
            {notCancellableReason(appt, startedOrPast)}
          </p>
          {appt.status === 'cancelled' && (
            <a
              href={`/${slug}/book`}
              className="inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-bold text-white"
              style={{ background: 'var(--primary-color)' }}
            >
              Reservar otra cita
            </a>
          )}
        </div>
      )}
    </Shell>
  )
}
