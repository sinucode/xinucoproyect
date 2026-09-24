import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@xinuco/supabase/middleware'

const BOT_AGENTS_REGEX = /googlebot|twitterbot|facebookexternalhit|baiduspider|bingbot|embedly|linkedinbot|quora link preview|whatsapp/i

// 🛡️ LISTA DE PALABRAS RESERVADAS (Foso de Seguridad Anti-Phishing)
// Ningún tenant puede registrar estos slugs.
const RESERVED_SLUGS = ['admin', 'api', 'support', 'billing', 'xinuco', 'dashboard', 'settings']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // /admin* se sirve desde apps/web vía rewrite — dejar pasar sin tocar sesión.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return NextResponse.next()
  }

  const pathParts = pathname.split('/').filter(Boolean)

  // Solo ejecutar si hay segmentos y no son archivos estáticos o rutas core del sistema
  if (
    pathParts.length > 0 &&
    !pathname.startsWith('/_next') &&
    !pathname.startsWith('/api') &&
    !pathname.startsWith('/adminbarberia') &&
    !pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|json)$/)
  ) {
    const slug = pathParts[0].toLowerCase()

    // 🚨 1. CONTROL DE PALABRAS RESERVADAS
    if (RESERVED_SLUGS.includes(slug)) {
      if (slug === 'admin') {
        // /admin se sirve desde apps/web vía rewrite — no redirigir aquí,
        // dejar que el rewrite configurado en next.config.mjs lo maneje.
        // (Solo llegaríamos aquí si el rewrite no está configurado.)
        return NextResponse.redirect(new URL('/adminbarberia/login', request.url))
      }
      // Cualquier otra palabra reservada → raíz global
      return NextResponse.redirect(new URL('/', request.url))
    }

    // ⚡ 2. CERO FRICCIÓN Y FOSO DE BOTS (Solo si estamos en la raíz exacta del tenant: /[slug])
    if (pathParts.length === 1) {
      const userAgent = request.headers.get('user-agent') || ''

      if (BOT_AGENTS_REGEX.test(userAgent)) {
        return new NextResponse(
          `<!DOCTYPE html>
          <html lang="es">
          <head>
            <meta charset="UTF-8">
            <title>Xinuco Platform - ${slug}</title>
            <meta name="robots" content="index, follow">
          </head>
          <body style="background:#080808; color:#fff; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
            <div style="text-align:center;">
              <h1>Xinuco Platform</h1>
              <p>Redirigiendo a la vitrina de reservas...</p>
            </div>
          </body>
          </html>`,
          { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=3600' } }
        )
      }

      // Redirección directa para humanos hacia el wizard de reservas
      return NextResponse.redirect(new URL(`/${slug}/book`, request.url))
    }
  }

  // 🛡️ Mantener la actualización de sesión activa para el resto de las rutas del backoffice
  return await updateSession(request)
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|web-static).*)'],
}
