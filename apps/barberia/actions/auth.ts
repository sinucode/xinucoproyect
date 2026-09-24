'use server'

import { createClient }            from '@xinuco/supabase/server'
import { redirect }                from 'next/navigation'
import { headers }                 from 'next/headers'
import type { Profile, Business }  from '@xinuco/types'
import { adminLoginUrl, WEB_URL }  from '@xinuco/utils'

/**
 * signUp — Server Action para registro de nuevos usuarios.
 *
 * Inyecta en raw_user_meta_data:
 *  - full_name:   nombre visible del usuario.
 *  - business_id: UUID del negocio al que pertenece.
 *  - slug:        slug del negocio (clave para el aislamiento Zero-DB en el Edge).
 *
 * El campo `slug` es crítico: el middleware lo lee directamente del JWT
 * descifrado para aislar tenants sin consultar la base de datos.
 */
export async function signUp(formData: FormData) {
  const email       = formData.get('email')       as string
  const password    = formData.get('password')    as string
  const fullName    = formData.get('full_name')   as string
  const businessId  = formData.get('business_id') as string
  const slug        = formData.get('slug')        as string

  if (!email || !password || !fullName || !businessId || !slug) {
    return { error: 'Todos los campos son obligatorios.' }
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name:   fullName,   // Nombre mostrado en la UI
        business_id: businessId, // UUID del tenant en la tabla businesses
        slug,                    // ← CLAVE ZERO-DB: inyectado en raw_user_meta_data
                                 //   El middleware lo extrae del JWT sin tocar BD
      },
    },
  })

  if (error) {
    return { error: error.message }
  }

  // Redirige al login del tenant recién registrado
  redirect(`/${slug}/login`)
}

/**
 * loginWithPassword — Server Action para inicio de sesión clásico.
 *
 * Tras autenticarse exitosamente, verifica el rol. Si es super_admin,
 * redirige al panel global. Si es tenant regular, inyecta el slug
 * mediante RPC para aislar el contexto Zero-DB.
 */
export async function loginWithPassword(formData: FormData) {
  const email         = formData.get('email')         as string
  const password      = formData.get('password')      as string
  const slug          = formData.get('slug')          as string
  // Token generado por hCaptcha en el cliente. Se omite en modo desarrollo.
  const captchaToken  = (formData.get('captcha_token') as string | null) || undefined

  if (!email || !password || !slug) {
    return { error: 'Por favor ingresa tu correo y contraseña.' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: captchaToken ? { captchaToken } : undefined,
  })

  if (error) {
    console.error('[AUTH ERROR] signInWithPassword:', error.message)
    return { error: 'Credenciales incorrectas o usuario no encontrado.' }
  }

  // ── Enrutamiento Inteligente ──────────────────────────────────────────────────
  const role = data.user?.app_metadata?.role

  // 1. Si es Llave Maestra (Super Admin), va al panel GLOBAL en apps/web.
  if (role === 'super_admin') {
    redirect(`${WEB_URL}/admin`)
  }

  // 2. Si es un usuario regular, inyectamos su contexto de negocio (Zero-DB lookup)
  const { error: rpcError } = await supabase.rpc('secure_set_user_context', {
    business_slug: slug
  })

  if (rpcError) {
    console.error('[AUTH ERROR] secure_set_user_context:', rpcError)
    // Si no tiene permisos sobre ese negocio, destruimos sesión
    await supabase.auth.signOut()
    return { error: 'No estás autorizado para acceder a esta barbería.' }
  }
  
  // Refrescar sesión para actualizar el JWT local con los nuevos app_metadata
  await supabase.auth.refreshSession()

  redirect(`/${slug}/dashboard`)
}

/**
 * logout — Cierra la sesión y redirige al login correspondiente.
 * - Super Admin → /admin/login (apps/web)
 * - Usuario de tenant → /[slug]/login
 */
export async function logout() {
  const supabase = await createClient()

  // Detectar contexto del usuario ANTES de destruir la sesión
  const { data: { user } } = await supabase.auth.getUser()
  const role = user?.app_metadata?.role
  const slug = user?.app_metadata?.slug || user?.user_metadata?.slug

  await supabase.auth.signOut()

  // Redirigir al login correcto según el contexto
  if (role === 'super_admin') {
    redirect(adminLoginUrl())
  } else if (slug) {
    redirect(`/${slug}/login`)
  } else {
    redirect(adminLoginUrl())
  }
}

/**
 * signInWithGoogle — Inicia el flujo de OAuth con Google.
 * 
 * Se pasa el slug de la barbería actual para que la ruta de callback
 * sepa a dónde redirigir en caso de error o si es un usuario nuevo.
 */
export async function signInWithGoogle(slug: string) {
  const supabase = await createClient()
  const headersList = await headers()

  // Determinamos la URL base dinámicamente y de forma segura
  const protocol = headersList.get('x-forwarded-proto') || 'http'
  const host     = headersList.get('host')
  const origin   = host ? `${protocol}://${host}` : process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  // El redirectTo apunta al callback y pasamos el slug como parámetro
  const redirectUrl = `${origin}/auth/callback?slug=${slug}`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl,
    },
  })

  if (error) {
    return { error: error.message }
  }

  // Redirigimos al usuario a la pantalla de consentimiento de Google
  if (data.url) {
    redirect(data.url)
  }
}
