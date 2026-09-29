// lib/email/resend.ts — Xinuco RF18: Resend client singleton + base send function
// Run: npm install resend

import { Resend } from 'resend'

// Lazy singleton — se instancia la primera vez que se envía un correo.
// Esto evita que el build falle si RESEND_API_KEY no está definida en el
// entorno de build (solo se necesita en runtime).
let _resend: Resend | null = null

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error('[resend] RESEND_API_KEY no está configurada.')
    _resend = new Resend(key)
  }
  return _resend
}

export interface EmailPayload {
  to:      string
  subject: string
  html:    string
  from?:   string
}

export async function sendEmail(
  payload: EmailPayload,
): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = getResend()
    await resend.emails.send({
      from:    payload.from ?? 'Xinuco <noreply@xinuco.com>',
      to:      payload.to,
      subject: payload.subject,
      html:    payload.html,
    })
    return { success: true }
  } catch (err) {
    console.error('[resend] sendEmail failed:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
