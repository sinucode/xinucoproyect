// lib/email/templates.ts — Xinuco RF18: Plantillas HTML de correo electrónico
// Mobile-first, inline CSS only. Tema claro (los modos oscuros de Gmail/Outlook
// invierten fondos oscuros sin control) con la marca de cada barbería: franja
// superior con su color principal y su logo (o su nombre si no tiene logo).
// Idioma: Español (Colombia)

import { formatCOP } from '@xinuco/utils'

// ── Marca del negocio ─────────────────────────────────────────────────────────

export interface EmailBrand {
  name:          string
  logoUrl?:      string | null
  primaryColor?: string | null
  /** URL pública de reservas (botón "Reservar otra cita"). */
  bookingUrl?:   string | null
}

interface Theme {
  name:       string
  logoUrl:    string | null
  primary:    string   // color de marca (validado)
  onPrimary:  string   // texto legible sobre el color de marca
  accentText: string   // color de marca para TEXTO sobre blanco (oscuro si la marca es clara)
  bookingUrl: string | null
}

const DEFAULT_PRIMARY = '#4F46E5'

// Solo #RGB / #RRGGBB: el valor va dentro de atributos style.
function safeHex(color: string | null | undefined): string {
  return color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color.trim()) ? color.trim() : DEFAULT_PRIMARY
}

// Solo https: el valor va en src/href.
function safeHttpsUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

// Texto blanco o casi negro según la luminancia del color de marca (WCAG).
function readableOn(hex: string): string {
  const h = hex.length === 4 ? hex.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : hex
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.45 ? '#111827' : '#FFFFFF'
}

function buildTheme(brand: EmailBrand | undefined, fallbackName: string): Theme {
  const primary   = safeHex(brand?.primaryColor)
  const onPrimary = readableOn(primary)
  return {
    name:       brand?.name || fallbackName,
    logoUrl:    safeHttpsUrl(brand?.logoUrl),
    primary,
    onPrimary,
    // Marca clara (texto oscuro encima) → sobre blanco tampoco se lee: usar texto oscuro.
    accentText: onPrimary === '#FFFFFF' ? primary : '#111827',
    bookingUrl: safeHttpsUrl(brand?.bookingUrl),
  }
}

// Paleta neutra del cuerpo (tema claro)
const C = {
  pageBg:  '#F3F4F6',
  cardBg:  '#FFFFFF',
  border:  '#E5E7EB',
  rowLine: '#F0F1F3',
  text:    '#111827',
  muted:   '#6B7280',
  soft:    '#F9FAFB',
} as const

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

function emailLayout(theme: Theme, contentHtml: string): string {
  const name = escapeHtml(theme.name)
  const header = theme.logoUrl
    ? `<img src="${theme.logoUrl}" alt="${name}" height="48"
           style="display:block;max-height:48px;max-width:200px;height:48px;width:auto;border:0;margin:0 auto 8px auto;">
       <span style="font-size:15px;font-weight:600;color:${theme.onPrimary};">${name}</span>`
    : `<span style="font-size:22px;font-weight:700;letter-spacing:0.5px;color:${theme.onPrimary};">${name}</span>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${name}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.pageBg};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:${C.text};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:${C.pageBg};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
               style="max-width:560px;background-color:${C.cardBg};border:1px solid ${C.border};border-radius:12px;overflow:hidden;">
          <!-- Franja de marca -->
          <tr>
            <td align="center" style="background-color:${theme.primary};padding:24px 16px;">
              ${header}
            </td>
          </tr>
          <!-- Contenido -->
          <tr>
            <td style="padding:32px 28px;">
              ${contentHtml}
            </td>
          </tr>
        </table>
        <!-- Footer -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;">
          <tr>
            <td align="center" style="padding-top:20px;">
              <p style="margin:0;font-size:12px;color:${C.muted};line-height:1.6;">
                Este correo fue enviado automáticamente. No respondas a este mensaje.<br>
                Reservas gestionadas con <strong style="color:${C.text};">Xinuco</strong>
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

// ── Bloques compartidos ───────────────────────────────────────────────────────

function heading(title: string, intro: string): string {
  return `
    <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:${C.text};line-height:1.3;">${title}</h1>
    <p style="margin:0 0 4px 0;font-size:15px;color:${C.muted};line-height:1.6;">${intro}</p>`
}

function appointmentDetailsBlock(rows: { label: string; value: string; highlight?: boolean }[], theme: Theme): string {
  const rowsHtml = rows
    .map(({ label, value, highlight }, i) => {
      const line = i < rows.length - 1 ? `border-bottom:1px solid ${C.rowLine};` : ''
      const valueColor = highlight ? theme.accentText : C.text
      const size = highlight ? '15px' : '14px'
      return `
      <tr>
        <td style="padding:10px 0;${line}color:${C.muted};font-size:13px;width:42%;vertical-align:top;">${label}</td>
        <td style="padding:10px 0;${line}color:${valueColor};font-size:${size};font-weight:600;">${value}</td>
      </tr>`
    })
    .join('')

  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
    style="background-color:${C.soft};border-radius:10px;border:1px solid ${C.border};padding:6px 18px;margin-top:22px;">
    <tbody>${rowsHtml}</tbody>
  </table>`
}

function noteBlock(html: string, theme: Theme): string {
  return `
    <div style="margin-top:22px;padding:14px 16px;background-color:${C.soft};border-left:4px solid ${theme.primary};border-radius:6px;">
      <p style="margin:0;font-size:13px;color:${C.muted};line-height:1.6;">${html}</p>
    </div>`
}

function buttonBlock(label: string, href: string, theme: Theme): string {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px auto 0 auto;">
      <tr>
        <td align="center" style="border-radius:8px;background-color:${theme.primary};">
          <a href="${href}" target="_blank"
             style="display:inline-block;padding:12px 26px;font-size:14px;font-weight:700;color:${theme.onPrimary};text-decoration:none;border-radius:8px;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`
}

function productRows(
  products: { name: string; quantity: number; unitPrice: number }[],
  label: string,
): { label: string; value: string }[] {
  return products.map((p) => ({
    label,
    value: `${p.quantity} × ${escapeHtml(p.name)} · ${formatCOP(p.quantity * p.unitPrice)}`,
  }))
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
  brand?:          EmailBrand
}): string {
  const theme         = buildTheme(data.brand, data.businessName)
  const products      = data.reservedProducts ?? []
  const productsTotal = products.reduce((sum, p) => sum + p.quantity * p.unitPrice, 0)

  const detailRows: { label: string; value: string; highlight?: boolean }[] = [
    { label: 'Servicio',     value: escapeHtml(data.serviceName) },
    { label: 'Profesional',  value: data.staffName ? escapeHtml(data.staffName) : 'Cualquier disponible' },
    { label: 'Fecha y hora', value: formatDateSpanish(data.startTime) },
    { label: 'Duración',     value: `${data.durationMinutes} minutos` },
    { label: 'Precio',       value: formatCOP(data.priceCop) },
    ...productRows(products, 'Producto apartado'),
  ]
  if (products.length > 0) {
    detailRows.push({ label: 'Total a pagar en el local', value: formatCOP(data.priceCop + productsTotal), highlight: true })
  }
  if (data.businessPhone) {
    detailRows.push({ label: 'Teléfono', value: escapeHtml(data.businessPhone) })
  }

  const productsNote = products.length > 0
    ? 'Te guardamos los productos apartados hasta el día de tu cita; los pagas en el local.<br>'
    : ''

  const content = `
    ${heading(
      '¡Tu cita está confirmada!',
      `Hola <strong style="color:${C.text};">${escapeHtml(data.customerName)}</strong>, tu cita en
       <strong style="color:${theme.accentText};">${escapeHtml(theme.name)}</strong> quedó registrada.`,
    )}
    ${appointmentDetailsBlock(detailRows, theme)}
    ${noteBlock(`${productsNote}Si necesitas reagendar o cancelar tu cita, avísanos con anticipación. ¡Te esperamos!`, theme)}`

  return emailLayout(theme, content)
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
  brand?:        EmailBrand
}): string {
  const theme = buildTheme(data.brand, data.businessName)

  const detailRows: { label: string; value: string; highlight?: boolean }[] = [
    { label: 'Servicio',     value: escapeHtml(data.serviceName) },
    { label: 'Profesional',  value: data.staffName ? escapeHtml(data.staffName) : 'Cualquier disponible' },
    { label: 'Fecha y hora', value: formatDateSpanish(data.startTime), highlight: true },
    ...productRows(data.reservedProducts ?? [], 'Te guardamos'),
  ]
  if (data.businessPhone) {
    detailRows.push({ label: 'Teléfono', value: escapeHtml(data.businessPhone) })
  }

  const content = `
    ${heading(
      'Recordatorio de tu cita',
      `Hola <strong style="color:${C.text};">${escapeHtml(data.customerName)}</strong>, te recordamos que mañana
       tienes una cita en <strong style="color:${theme.accentText};">${escapeHtml(theme.name)}</strong>.`,
    )}
    ${appointmentDetailsBlock(detailRows, theme)}
    ${noteBlock('Si no puedes asistir, avísanos lo antes posible para liberar el espacio. ¡Te esperamos!', theme)}`

  return emailLayout(theme, content)
}

// ── 3. Correo de cancelación de cita ─────────────────────────────────────────

export function appointmentCancellationEmail(data: {
  customerName: string
  businessName: string
  serviceName:  string
  startTime:    string
  reason?:      string
  brand?:       EmailBrand
}): string {
  const theme = buildTheme(data.brand, data.businessName)

  const detailRows: { label: string; value: string }[] = [
    { label: 'Servicio',     value: escapeHtml(data.serviceName) },
    { label: 'Fecha y hora', value: formatDateSpanish(data.startTime) },
  ]
  if (data.reason) {
    detailRows.push({ label: 'Motivo', value: escapeHtml(data.reason) })
  }

  const content = `
    ${heading(
      'Tu cita fue cancelada',
      `Hola <strong style="color:${C.text};">${escapeHtml(data.customerName)}</strong>, te informamos que tu cita
       en <strong style="color:${theme.accentText};">${escapeHtml(theme.name)}</strong> fue cancelada.`,
    )}
    ${appointmentDetailsBlock(detailRows, theme)}
    ${noteBlock('Si fue un error o quieres otro horario, puedes reservar de nuevo cuando quieras. Lamentamos los inconvenientes.', theme)}
    ${theme.bookingUrl ? buttonBlock('Reservar otra cita', theme.bookingUrl, theme) : ''}`

  return emailLayout(theme, content)
}
