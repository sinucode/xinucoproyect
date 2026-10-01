// app/[slug]/dashboard/settings/notifications/page.tsx
// RF18 — Notificaciones por correo: estado, historial y plantillas

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { AdminPageHeader } from '@xinuco/ui'
import { requireSettingsAdmin } from '@/lib/settings-guard'
import { getBusinessBySlug }  from '@/actions/businesses'
import { getNotificationLog } from '@/actions/notifications'
import { NotificationHistory } from '@/components/dashboard/settings/NotificationHistory'
import type { BusinessFeatures } from '@xinuco/types'
import {
  appointmentConfirmationEmail,
  appointmentReminderEmail,
  appointmentCancellationEmail,
} from '@/lib/email/templates'

export const metadata: Metadata = {
  title: 'Notificaciones — Xinuco',
  description: 'Estado, historial y vista previa de las notificaciones por correo electrónico.',
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
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold ${
        ok ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
      }`}
    >
      <span aria-hidden="true">{ok ? '✓' : '✕'}</span> {ok ? labelOn : labelOff}
    </span>
  )
}

function StatusCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-xinuco-border bg-xinuco-surface px-5 py-4">
      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-xinuco-muted">{title}</p>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-xinuco-muted">{children}</h2>
  )
}

function TemplatePreview({ title, html }: { title: string; html: string }) {
  return (
    <div className="mb-8">
      <h3 className="mb-3 text-sm font-semibold text-xinuco-text">{title}</h3>
      <div className="overflow-hidden rounded-xl border border-xinuco-border bg-xinuco-bg">
        <iframe
          srcDoc={html}
          title={title}
          className="block h-[480px] w-full border-0"
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

  // Guardia: solo el administrador de este negocio
  await requireSettingsAdmin(slug)

  const business = await getBusinessBySlug(slug)
  if (!business) notFound()

  const features           = business.features_enabled as unknown as BusinessFeatures
  const emailEnabled       = features?.notifications_email === true
  const resendConfigured   = Boolean(process.env.RESEND_API_KEY)
  const cronSecretPresent  = Boolean(process.env.CRON_SECRET)

  // Cargar historial de notificaciones
  const { data: notifLog } = await getNotificationLog(50)

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
    <div className="flex flex-col gap-10 w-full max-w-4xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex flex-col gap-6">
        <Link
          href={`/${slug}/dashboard/settings`}
          className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-xinuco-muted transition-colors hover:text-xinuco-text"
        >
          <ArrowLeft size={14} />
          Configuración
        </Link>

        <AdminPageHeader
          title="Notificaciones por correo"
          subtitle="Estado de los correos, historial de envíos y vista previa de las plantillas. Los recordatorios salen solos cada día a las 8:00 a. m."
        />
      </div>

      {/* Estado del sistema */}
      <section>
        <SectionTitle>Estado del sistema</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatusCard title="Módulo RF18 — Email">
            <StatusBadge ok={emailEnabled} labelOn="Habilitado" labelOff="Deshabilitado" />
            <p className="mt-2 text-xs leading-normal text-xinuco-muted">
              Feature flag <code className="text-[var(--primary-color)]">notifications_email</code> — solo el Super Admin puede modificarlo.
            </p>
          </StatusCard>

          <StatusCard title="API Key — Resend">
            <StatusBadge ok={resendConfigured} labelOn="Configurado" labelOff="No configurado" />
            <p className="mt-2 text-xs leading-normal text-xinuco-muted">
              Variable <code className="text-[var(--primary-color)]">RESEND_API_KEY</code>{' '}
              {resendConfigured ? 'presente en el servidor.' : 'no definida — los correos no se enviarán.'}
            </p>
          </StatusCard>

          <StatusCard title="Remitente">
            <span className="text-sm font-semibold text-[var(--primary-color)]">noreply@xinuco.com</span>
            <p className="mt-2 text-xs leading-normal text-xinuco-muted">
              Configurable en <code className="text-[var(--primary-color)]">lib/email/resend.ts</code>.
            </p>
          </StatusCard>
        </div>
      </section>

      {/* Historial */}
      <section>
        <SectionTitle>Historial reciente</SectionTitle>
        <NotificationHistory log={notifLog ?? []} />
      </section>

      {/* Disparadores */}
      <section>
        <SectionTitle>Disparadores de notificación</SectionTitle>
        <div className="overflow-hidden rounded-xl border border-xinuco-border bg-xinuco-surface">
          {[
            { evento: 'Nueva reserva',      correo: 'Confirmación',  estado: emailEnabled ? 'Activo' : 'Inactivo' },
            { evento: '24 h antes de cita', correo: 'Recordatorio',  estado: cronSecretPresent && emailEnabled ? 'Activo' : 'Pendiente config' },
            { evento: 'Cita cancelada',     correo: 'Cancelación',   estado: emailEnabled ? 'Activo' : 'Inactivo' },
          ].map(({ evento, correo, estado }, i, arr) => (
            <div
              key={i}
              className={`flex items-center justify-between gap-3 px-5 py-3.5 ${i < arr.length - 1 ? 'border-b border-xinuco-border' : ''}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-xinuco-text">{evento}</p>
                <p className="mt-0.5 text-xs text-xinuco-muted">Plantilla: {correo}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  estado === 'Activo' ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'
                }`}
              >
                {estado}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Previews de plantillas */}
      <section>
        <SectionTitle>Vista previa de plantillas</SectionTitle>
        <p className="-mt-2 mb-6 text-sm text-xinuco-muted">
          Así se ven los correos que reciben tus clientes. Datos de ejemplo.
        </p>
        <TemplatePreview title="1. Confirmación de reserva" html={confirmationHtml} />
        <TemplatePreview title="2. Recordatorio 24 h antes"  html={reminderHtml}     />
        <TemplatePreview title="3. Aviso de cancelación"     html={cancellationHtml} />
      </section>
    </div>
  )
}
