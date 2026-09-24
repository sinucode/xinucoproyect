'use server'

import { createClient } from '@xinuco/supabase/server'
import { redirect }     from 'next/navigation'
import { headers }      from 'next/headers'
import { safeNextUrl }  from '@xinuco/utils'

/**
 * loginWithPassword — Server Action para el login del Admin Global (/admin/login).
 *
 * Solo acepta super_admin. Redirige a /admin tras autenticación exitosa.
 * Para logins de tenants de barbería, ver apps/barberia/actions/auth.ts.
 */
export async function loginWithPassword(formData: FormData) {
  const email        = formData.get('email')        as string
  const password     = formData.get('password')     as string
  // Token generado por hCaptcha en el cliente. Se omite en modo desarrollo.
  const captchaToken = (formData.get('captcha_token') as string | null) || undefined

  if (!email || !password) {
    return { error: 'Por favor ingresa tu correo y contraseña.' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: captchaToken ? { captchaToken } : undefined,
  })

  if (error) {
    console.error('[AUTH ERROR] signInWithPassword (admin global):', error.message)
    return { error: 'Credenciales incorrectas o usuario no encontrado.' }
  }

  const role = data.user?.app_metadata?.role

  if (role !== 'super_admin') {
    await supabase.auth.signOut()
    return { error: 'No estás autorizado para acceder al panel global.' }
  }

  redirect(safeNextUrl(formData.get('next')))
}

/**
 * requestPasswordReset — Envía el correo de recuperación de contraseña
 * del Admin Global. Redirige a /reset-password (esta misma app) tras
 * verificar el link, NO a la landing.
 *
 * Por seguridad (evitar enumeración de usuarios) siempre responde con el
 * mismo mensaje de éxito, exista o no la cuenta.
 */
export async function requestPasswordReset(formData: FormData) {
  const email        = formData.get('email') as string
  const captchaToken = (formData.get('captcha_token') as string | null) || undefined

  if (!email) {
    return { error: 'Ingresa tu correo electrónico.' }
  }

  const supabase     = await createClient()
  const headersList  = await headers()
  const protocol     = headersList.get('x-forwarded-proto') || 'http'
  const host         = headersList.get('host')
  const origin        = host ? `${protocol}://${host}` : process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // El code de recuperación se canjea en /auth/callback (servidor, cookies),
    // no directamente en /reset-password (cliente, sin acceso al code_verifier).
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
    captchaToken,
  })

  if (error) {
    console.error('[AUTH ERROR] resetPasswordForEmail (admin global):', error.message)
    // La verificación de captcha sí debe reportarse: sin esto el usuario cree
    // que el correo va en camino y nunca reintenta.
    if (error.message.toLowerCase().includes('captcha')) {
      return { error: 'Verificación de seguridad inválida. Inténtalo de nuevo.' }
    }
  }

  // Por seguridad (evitar enumeración de usuarios), cualquier otro resultado
  // — exista o no la cuenta — responde con el mismo mensaje genérico.
  return {
    success: 'Si el correo existe, te enviamos un enlace para restablecer tu contraseña.',
  }
}

/**
 * logout — Cierra la sesión y redirige al login del admin global.
 */
export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/admin/login')
}
