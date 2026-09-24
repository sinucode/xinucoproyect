import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { redirect } from 'next/navigation'

/**
 * middleware.ts (apps/web) — Guard del panel de administración global /admin.
 *
 * Responsabilidades:
 *  1. Refrescar la sesión Supabase en cada request.
 *  2. Proteger /admin: exige sesión + role === 'super_admin'.
 *  3. Redirigir a /admin/login si no autenticado.
 */
export async function middleware(request: NextRequest) {
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
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Descifrar JWT localmente (sin round-trip a BD)
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Ignorar rutas estáticas y públicas
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname === '/admin/login' ||
    pathname === '/admin/auth/callback' ||
    pathname === '/admin/reset-password' ||
    pathname === '/'
  ) {
    return supabaseResponse
  }

  // Proteger /admin y sus sub-rutas
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/')

  if (isAdminRoute) {
    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = '/admin/login'
      return NextResponse.redirect(url)
    }

    if (user.app_metadata?.role !== 'super_admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/admin/login'
      return NextResponse.redirect(url)
    }

    // Usuario autenticado como super_admin: redirigir /admin/login a /admin
    if (pathname === '/admin/login') {
      const url = request.nextUrl.clone()
      url.pathname = '/admin'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|web-static).*)'],
}
