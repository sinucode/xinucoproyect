import { NextResponse } from 'next/server'
import { createClient } from '@xinuco/supabase/server'

/**
 * /auth/callback — Canje de código PKCE del lado del servidor.
 *
 * El `code_verifier` de PKCE se guarda en cookies cuando resetPasswordForEmail
 * (o cualquier otro flujo de auth) se dispara desde una Server Action. Solo un
 * cliente de Supabase con acceso a esas MISMAS cookies puede canjear el code —
 * el cliente de navegador (localStorage) nunca las ve. Por eso el intercambio
 * ocurre aquí, no en la página cliente.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/reset-password'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.error('[AUTH CALLBACK] exchangeCodeForSession (admin global):', error.message)
  }

  return NextResponse.redirect(`${origin}${next}?error=invalid_link`)
}
