import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@xinuco/supabase/server'

/**
 * /admin/auth/callback — Establece la sesión en el servidor (cookies) y redirige a `next`.
 *
 * - `token_hash` + `type` (correo de recuperación): se verifica con verifyOtp.
 *   No depende del navegador que pidió el correo — funciona si se abre en otro
 *   dispositivo. Requiere que la plantilla "Reset Password" de Supabase envíe
 *   `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery`.
 * - `code` (PKCE, OAuth): solo funciona en el mismo navegador que inició el
 *   flujo, porque el code_verifier vive en sus cookies.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const { searchParams } = url
  // Vía el rewrite de barbería, request.url trae el host del deployment de web;
  // redirigir ahí sacaría al usuario del dominio público (y de su cookie de sesión).
  const forwardedHost  = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https'
  const origin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : url.origin
  const tokenHash = searchParams.get('token_hash')
  const type      = searchParams.get('type') as EmailOtpType | null
  const code      = searchParams.get('code')
  const next      = searchParams.get('next') ?? '/admin/reset-password'
  const target    = next.startsWith('/') && !next.startsWith('//') ? next : '/admin/reset-password'

  const supabase = await createClient()

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) return NextResponse.redirect(`${origin}${target}`)
    console.error('[AUTH CALLBACK] verifyOtp (admin global):', error.message)
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${target}`)
    console.error('[AUTH CALLBACK] exchangeCodeForSession (admin global):', error.message)
  }

  return NextResponse.redirect(`${origin}${target}?error=invalid_link`)
}
