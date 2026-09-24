import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * updateSession — Middleware de Supabase con aislamiento Multi-tenant Zero-DB.
 *
 * Estrategia (SENTINEL PATCH 1 — IDOR fix):
 *  - El JWT descifrado localmente (sin consulta a BD) contiene `app_metadata.slug`
 *    inyectado por el RPC `secure_set_user_context` gestionado por The Vault.
 *  - `app_metadata` es de SOLO ESCRITURA para el servidor (no modificable por el cliente).
 *    Usar `user_metadata` en su lugar sería vulnerable a IDOR.
 *  - Se compara el slug de la URL con el slug del JWT para aislar tenants.
 *  - Cero consultas a la base de datos en el hot-path del Edge.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<any>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          // Primero sincronizamos las cookies en el request (necesario para el
          // contexto de Server Components downstream)
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          // Recreamos supabaseResponse para que lleve las cookies actualizadas
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // ── 1. Descifrar JWT localmente (sin round-trip a BD) ────────────────────────
  // IMPORTANT: No escribir lógica entre createServerClient y getUser().
  // Un error aquí puede causar cierres de sesión aleatorios.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const url = request.nextUrl.clone()
  const pathname = url.pathname

  // ── 2. Ignorar rutas estáticas, de API y raíz ────────────────────────────────
  const pathSegments = pathname.split('/').filter(Boolean)

  if (
    pathSegments.length === 0 ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next')
  ) {
    return supabaseResponse
  }

  // ── 3. Extraer slug e inner-route de la URL ──────────────────────────────────
  // Estructura esperada: /[slug]/[innerRoute]/...
  const slug = pathSegments[0]
  const innerRoute = pathSegments[1] ?? ''

  const isProtectedRoute =
    innerRoute === 'dashboard' ||
    innerRoute === 'settings' ||
    innerRoute === 'admin'

  const isLoginRoute = innerRoute === 'login'

  // ── 4. Redirecciones base de sesión ──────────────────────────────────────────
  if (isProtectedRoute && !user) {
    url.pathname = `/${slug}/login`
    return NextResponse.redirect(url)
  }

  if (isLoginRoute && user) {
    if (user.app_metadata?.role === 'super_admin') {
      // Super admin logueado → panel global en apps/web (reescrito via multi-zone).
      url.pathname = '/admin'
    } else {
      url.pathname = `/${slug}/dashboard`
    }
    return NextResponse.redirect(url)
  }

  // ── 5. AISLAMIENTO MULTI-TENANT — ZERO-DB QUERY ──────────────────────────────
  // El slug está inyectado en app_metadata mediante RPC.
  // Se lee directamente del JWT descifrado; no hay consulta a BD.
  if (user && isProtectedRoute) {
    // Si es super_admin, no tiene tenant. Lo mandamos al panel global.
    if (user.app_metadata?.role === 'super_admin') {
      url.pathname = '/admin'
      return NextResponse.redirect(url)
    }

    const userSlug = user.app_metadata?.slug as string | undefined

    if (userSlug !== slug) {
      // Intento de acceso cross-tenant: bloqueamos y redirigimos al tenant correcto.
      console.warn(
        `[EDGE SECURITY] Acceso cross-tenant bloqueado. ` +
          `user_id=${user.id} intentó acceder a /${slug} ` +
          `pero pertenece a /${userSlug ?? 'desconocido'}`,
      )
      url.pathname = `/${userSlug ?? slug}/login`
      return NextResponse.redirect(url)
    }
  }

  // ── 6. Devolver la respuesta con cookies de sesión sincronizadas ─────────────
  // IMPORTANT: Se debe retornar `supabaseResponse` tal como está para mantener
  // las cookies de sesión sincronizadas entre browser y servidor.
  return supabaseResponse
}
