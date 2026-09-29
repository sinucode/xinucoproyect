// app/[slug]/dashboard/settings/notifications/page.tsx
// RF18 — Configuración de Notificaciones por Correo + Panel Cron

import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { getBusinessBySlug }  from '@/actions/businesses'
import type { Profile } from '@xinuco/types'
import { getNotificationLog } from '@/actions/notifications'
import { CronPanel }          from '@/components/dashboard/settings/CronPanel'
import type { BusinessFeatures } from '@xinuco/types'
import {
  appointmentConfirmationEmail,
  appointmentReminderEmail,
  appointmentCancellationEmail,
} from '@/lib/email/templates'

export const metadata: Metadata = {
  title: 'Notificaciones — Xinuco',
  description: 'Estado, cron job y preview de las notificaciones por correo electrónico.',
}

// ── Datos de muestra para el preview ─────────────────────────────────────────
const PREVIEW_DATA = {
  customerName:    'Juan Pérez',
  businessName:    'Barbería Demo',
  serviceName:     'Corte Premium',
  staffName:       'Carlos Rodríguez',
  startTime:       new Date(Date.now() + 86_400_000).toISOString(),
  durationMinutes: 45,
  priceCop:        35_000,
  businessPhone:   '+57 300 123 4567',
}

// ── Badge de estado ───────────────────────────────────────────────────────────
function StatusBadge({ ok, labelOn, labelOff }: { ok: boolean; labelOn: string; labelOff: string }) {
  return ok ? (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '4px 12px', borderRadius: '999px',
      background: 'rgba(34,197,94,0.12)', color: '#22c55e',
      fontSize: '13px', fontWeight: 600,
    }}>
      <span>✓</span> {labelOn}
    </span>
  ) : (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '4px 12px', borderRadius: '999px',
      background: 'rgba(239,68,68,0.12)', color: '#ef4444',
      fontSize: '13px', fontWeight: 600,
    }}>
      <span>✕</span> {labelOff}
    </span>
  )
}

function StatusCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#111111', border: '1px solid #222',
      borderRadius: '8px', padding: '20px 24px',
    }}>
      <p style={{ margin: '0 0 10px 0', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', color: '#666' }}>
        {title}
      </p>
      {children}
    </div>
  )
}

function TemplatePreview({ title, html }: { title: string; html: string }) {
  return (
    <div style={{ marginBottom: '32px' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: '#C5A059' }}>
        {title}
      </h3>
      <div style={{ border: '1px solid #222', borderRadius: '8px', overflow: 'hidden', background: '#080808' }}>
        <iframe
          srcDoc={html}
          title={title}
          style={{ width: '100%', height: '480px', border: 'none', display: 'block' }}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────
export default async function NotificationsSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // Auth guard
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  // Role guard: solo admin puede acceder
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id')
    .eq('id', user.id)
    .single<Pick<Profile, 'role' | 'business_id'>>()

  if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
    redirect(`/${slug}/dashboard`)
  }

  const business = await getBusinessBySlug(slug)
  if (!business) notFound()

  const features           = business.features_enabled as unknown as BusinessFeatures
  const emailEnabled       = features?.notifications_email === true
  const resendConfigured   = Boolean(process.env.RESEND_API_KEY)
  const cronSecretPresent  = Boolean(process.env.CRON_SECRET)

  // Cargar historial de notificaciones
  const { data: notifLog } = await getNotificationLog(business.id, 50)

  // Generar previews en el servidor
  const confirmationHtml = appointmentConfirmationEmail(PREVIEW_DATA)
  const reminderHtml     = appointmentReminderEmail(PREVIEW_DATA)
  const cancellationHtml = appointmentCancellationEmail({
    customerName: PREVIEW_DATA.customerName,
    businessName: PREVIEW_DATA.businessName,
    serviceName:  PREVIEW_DATA.serviceName,
    startTime:    PREVIEW_DATA.startTime,
  })

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto', color: '#F4F4F4' }}>

      {/* Header */}
      <div style={{ paddingBottom: '24px', borderBottom: '1px solid #222', marginBottom: '32px' }}>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: 700, letterSpacing: '-0.5px' }}>
          Notificaciones por Correo
        </h1>
        <p style={{ margin: 0, fontSize: '14px', color: '#999', maxWidth: '600px', lineHeight: '1.6' }}>
          Estado del módulo RF18 — cron job de recordatorios, historial de envíos y preview de plantillas.
        </p>
      </div>

      {/* Estado del sistema */}
      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600, color: '#C5A059', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Estado del Sistema
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
          <StatusCard title="Módulo RF18 — Email">
            <StatusBadge ok={emailEnabled} labelOn="Habilitado" labelOff="Deshabilitado" />
            <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#666', lineHeight: '1.5' }}>
              Feature flag <code style={{ color: '#C5A059' }}>notifications_email</code> — solo el Super Admin puede modificarlo.
            </p>
          </StatusCard>

          <StatusCard title="API Key — Resend">
            <StatusBadge ok={resendConfigured} labelOn="Configurado" labelOff="No configurado" />
            <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#666', lineHeight: '1.5' }}>
              Variable <code style={{ color: '#C5A059' }}>RESEND_API_KEY</code>{' '}
              {resendConfigured ? 'presente en el servidor.' : 'no definida — los correos no se enviarán.'}
            </p>
          </StatusCard>

          <StatusCard title="Remitente">
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#C5A059' }}>
              noreply@xinuco.com
            </span>
            <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#666', lineHeight: '1.5' }}>
              Configurable en <code style={{ color: '#C5A059' }}>lib/email/resend.ts</code>.
            </p>
          </StatusCard>
        </div>
      </section>

      {/* ── Cron Job Panel (Client Component) ─────────────────────────────── */}
      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600, color: '#C5A059', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Cron Job & Historial
        </h2>
        <CronPanel
          businessId={business.id}
          cronSecret={cronSecretPresent}
          initialLog={notifLog ?? []}
        />
      </section>

      {/* Disparadores */}
      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600, color: '#C5A059', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Disparadores de Notificación
        </h2>
        <div style={{ background: '#111', border: '1px solid #222', borderRadius: '8px', overflow: 'hidden' }}>
          {[
            { evento: 'Nueva reserva',      correo: 'Confirmación',  estado: emailEnabled ? 'Activo' : 'Inactivo' },
            { evento: '24 h antes de cita', correo: 'Recordatorio',  estado: cronSecretPresent && emailEnabled ? 'Activo' : 'Pendiente config' },
            { evento: 'Cita cancelada',     correo: 'Cancelación',   estado: emailEnabled ? 'Activo' : 'Inactivo' },
          ].map(({ evento, correo, estado }, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 20px',
              borderBottom: i < 2 ? '1px solid #1a1a1a' : 'none',
            }}>
              <div>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#F4F4F4' }}>{evento}</p>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#666' }}>Plantilla: {correo}</p>
              </div>
              <span style={{
                fontSize: '12px', fontWeight: 600, padding: '3px 10px', borderRadius: '999px',
                background: estado === 'Activo' ? 'rgba(34,197,94,0.12)' : 'rgba(255,170,0,0.10)',
                color:      estado === 'Activo' ? '#22c55e'               : '#C5A059',
              }}>
                {estado}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Previews de plantillas */}
      <section>
        <h2 style={{ margin: '0 0 20px 0', fontSize: '16px', fontWeight: 600, color: '#C5A059', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Preview de Plantillas
        </h2>
        <p style={{ margin: '-12px 0 24px 0', fontSize: '13px', color: '#666' }}>
          Así se ven los correos que reciben tus clientes. Datos de ejemplo.
        </p>
        <TemplatePreview title="1. Confirmación de Reserva" html={confirmationHtml} />
        <TemplatePreview title="2. Recordatorio 24 h Antes"  html={reminderHtml}     />
        <TemplatePreview title="3. Aviso de Cancelación"     html={cancellationHtml} />
      </section>

    </div>
  )
}
