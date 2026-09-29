// lib/email/templates.ts — Xinuco RF18: Plantillas HTML de correo electrónico
// Mobile-first, inline CSS only, brand colors: #080808 bg, #C5A059 gold, #F4F4F4 text
// Idioma: Español (Colombia)

import { formatCOP } from '@xinuco/utils'

// ── Utilidades de formato de fecha en español ─────────────────────────────────

const DIAS: readonly string[] = [
  'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado',
]

const MESES: readonly string[] = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/**
 * Formatea una fecha ISO al estilo español colombiano:
 * "Lunes, 26 de mayo de 2025 a las 10:00 AM"
 */
// start_time guarda la hora LOCAL del negocio como UTC (ver lib/agenda-time.ts):
// se lee con getUTC* para no depender de la zona horaria del servidor.
function formatDateSpanish(isoString: string): string {
  const date = new Date(isoString)
  const diaNombre = DIAS[date.getUTCDay()]
  const dia       = date.getUTCDate()
  const mes       = MESES[date.getUTCMonth()]
  const anio      = date.getUTCFullYear()
  const horas     = date.getUTCHours()
  const minutos   = date.getUTCMinutes().toString().padStart(2, '0')
  const periodo   = horas >= 12 ? 'PM' : 'AM'
  const hora12    = horas % 12 === 0 ? 12 : horas % 12

  return `${diaNombre}, ${dia} de ${mes} de ${anio} a las ${hora12}:${minutos} ${periodo}`
}

// Los nombres (cliente, productos) los escribe el cliente al reservar.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Wrapper de layout HTML ────────────────────────────────────────────────────

function emailLayout(contentHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Xinuco</title>
</head>
<body style="margin:0;padding:0;background-color:#080808;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#F4F4F4;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#080808;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;">
          <!-- Logo / marca -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <span style="font-size:22px;font-weight:700;letter-spacing:3px;color:#C5A059;text-transform:uppercase;">XINUCO</span>
            </td>
          </tr>
          <!-- Contenido -->
          <tr>
            <td style="background-color:#111111;border-radius:8px;border:1px solid #222222;padding:32px 28px;">
              ${contentHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#666666;line-height:1.6;">
                Este correo fue enviado automáticamente. No respondas a este mensaje.<br>
                <span style="color:#C5A059;">noreply@xinuco.com</span>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ── Bloque de detalle de cita (shared) ───────────────────────────────────────

function appointmentDetailsBlock(rows: { label: string; value: string }[]): string {
  const rowsHtml = rows
    .map(
      ({ label, value }) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #1E1E1E;color:#999999;font-size:13px;width:45%;">${label}</td>
        <td style="padding:8px 0;border-bottom:1px solid #1E1E1E;color:#F4F4F4;font-size:13px;font-weight:600;">${value}</td>
      </tr>`,
    )
    .join('')

  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
    style="background-color:#0D0D0D;border-radius:6px;border:1px solid #1E1E1E;padding:4px 16px;margin-top:20px;">
    <tbody>${rowsHtml}</tbody>
  </table>`
}

// ── 1. Correo de confirmación de cita ────────────────────────────────────────

export function appointmentConfirmationEmail(data: {
  customerName:    string
  businessName:    string
  serviceName:     string
  staffName:       string | null
  startTime:       string   // ISO string
  durationMinutes: number
  priceCop:        number
  businessPhone?:  string
  /** Productos apartados al reservar (se pagan en el local). */
  reservedProducts?: { name: string; quantity: number; unitPrice: number }[]
}): string {
  const fechaFormateada = formatDateSpanish(data.startTime)
  const precio          = formatCOP(data.priceCop)
  const products        = data.reservedProducts ?? []
  const productsTotal   = products.reduce((sum, p) => sum + p.quantity * p.unitPrice, 0)

  const detailRows: { label: string; value: string }[] = [
    { label: 'Servicio',     value: escapeHtml(data.serviceName) },
    { label: 'Profesional',  value: data.staffName ? escapeHtml(data.staffName) : 'Cualquier disponible' },
    { label: 'Fecha y hora', value: fechaFormateada },
    { label: 'Duración',     value: `${data.durationMinutes} minutos` },
    { label: 'Precio',       value: precio },
  ]

  for (const p of products) {
    detailRows.push({
      label: 'Producto apartado',
      value: `${p.quantity} × ${escapeHtml(p.name)} · ${formatCOP(p.quantity * p.unitPrice)}`,
    })
  }
  if (products.length > 0) {
    detailRows.push({ label: 'Total a pagar en el local', value: formatCOP(data.priceCop + productsTotal) })
  }

  if (data.businessPhone) {
    detailRows.push({ label: 'Teléfono', value: data.businessPhone })
  }

  const productsNote = products.length > 0
    ? `Te guardamos los productos apartados hasta el día de tu cita; los pagas en el local.<br/>`
    : ''

  const content = `
    <h1 style="margin:0 0 4px 0;font-size:22px;font-weight:700;color:#F4F4F4;line-height:1.3;">
      ¡Tu cita está confirmada!
    </h1>
    <p style="margin:0 0 20px 0;font-size:14px;color:#999999;">
      Hola <strong style="color:#F4F4F4;">${escapeHtml(data.customerName)}</strong>, tu cita en
      <strong style="color:#C5A059;">${escapeHtml(data.businessName)}</strong> ha sido registrada exitosamente.
    </p>

    ${appointmentDetailsBlock(detailRows)}

    <div style="margin-top:24px;padding:16px;background-color:#0A0A0A;border-left:3px solid #C5A059;border-radius:4px;">
      <p style="margin:0;font-size:13px;color:#999999;line-height:1.6;">
        ${productsNote}Si necesitas reagendar o cancelar tu cita, comunícate con nosotros con anticipación.
        ¡Te esperamos!
      </p>
    </div>`

  return emailLayout(content)
}

// ── 2. Correo de recordatorio de cita ────────────────────────────────────────

export function appointmentReminderEmail(data: {
  customerName:  string
  businessName:  string
  serviceName:   string
  staffName:     string | null
  startTime:     string
  businessPhone?: string
  reservedProducts?: { name: string; quantity: number; unitPrice: number }[]
}): string {
  const fechaFormateada = formatDateSpanish(data.startTime)

  const detailRows: { label: string; value: string }[] = [
    { label: 'Servicio',     value: escapeHtml(data.serviceName) },
    { label: 'Profesional',  value: data.staffName ? escapeHtml(data.staffName) : 'Cualquier disponible' },
    { label: 'Fecha y hora', value: fechaFormateada },
  ]

  for (const p of data.reservedProducts ?? []) {
    detailRows.push({
      label: 'Te guardamos',
      value: `${p.quantity} × ${escapeHtml(p.name)} · ${formatCOP(p.quantity * p.unitPrice)}`,
    })
  }

  if (data.businessPhone) {
    detailRows.push({ label: 'Teléfono', value: data.businessPhone })
  }

  const content = `
    <h1 style="margin:0 0 4px 0;font-size:22px;font-weight:700;color:#F4F4F4;line-height:1.3;">
      Recordatorio de tu cita
    </h1>
    <p style="margin:0 0 20px 0;font-size:14px;color:#999999;">
      Hola <strong style="color:#F4F4F4;">${escapeHtml(data.customerName)}</strong>, te recordamos que mañana
      tienes una cita en <strong style="color:#C5A059;">${escapeHtml(data.businessName)}</strong>.
    </p>

    ${appointmentDetailsBlock(detailRows)}

    <div style="margin-top:24px;padding:16px;background-color:#0A0A0A;border-left:3px solid #C5A059;border-radius:4px;">
      <p style="margin:0;font-size:13px;color:#999999;line-height:1.6;">
        Si no puedes asistir, por favor avísanos lo antes posible para liberar el espacio.
        ¡Te esperamos!
      </p>
    </div>`

  return emailLayout(content)
}

// ── 3. Correo de cancelación de cita ─────────────────────────────────────────

export function appointmentCancellationEmail(data: {
  customerName: string
  businessName: string
  serviceName:  string
  startTime:    string
  reason?:      string
}): string {
  const fechaFormateada = formatDateSpanish(data.startTime)

  const detailRows: { label: string; value: string }[] = [
    { label: 'Servicio',     value: escapeHtml(data.serviceName) },
    { label: 'Fecha y hora', value: fechaFormateada },
  ]

  if (data.reason) {
    detailRows.push({ label: 'Motivo', value: data.reason })
  }

  const content = `
    <h1 style="margin:0 0 4px 0;font-size:22px;font-weight:700;color:#F4F4F4;line-height:1.3;">
      Tu cita ha sido cancelada
    </h1>
    <p style="margin:0 0 20px 0;font-size:14px;color:#999999;">
      Hola <strong style="color:#F4F4F4;">${escapeHtml(data.customerName)}</strong>, te informamos que tu cita
      en <strong style="color:#C5A059;">${escapeHtml(data.businessName)}</strong> ha sido cancelada.
    </p>

    ${appointmentDetailsBlock(detailRows)}

    <div style="margin-top:24px;padding:16px;background-color:#0A0A0A;border-left:3px solid #C5A059;border-radius:4px;">
      <p style="margin:0;font-size:13px;color:#999999;line-height:1.6;">
        Si deseas reagendar, visita nuestro portal de reservas o contáctanos directamente.
        Lamentamos los inconvenientes.
      </p>
    </div>`

  return emailLayout(content)
}
