/**
 * zones.ts — URLs entre zonas (apps/web y apps/barberia) para el login único del super_admin.
 */

export const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL ?? ''
export const BARBERIA_URL = process.env.NEXT_PUBLIC_BARBERIA_URL ?? ''

/** adminLoginUrl — URL del login único del super_admin, con `next` opcional. */
export function adminLoginUrl(next?: string): string {
  const base = `${WEB_URL}/admin/login`
  return next ? `${base}?next=${encodeURIComponent(next)}` : base
}

function safeOrigin(url: string): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** safeNextUrl — evita open redirect: solo rutas relativas o el origen de WEB_URL/BARBERIA_URL. */
export function safeNextUrl(next: unknown, fallback = '/admin'): string {
  if (typeof next !== 'string' || next.length === 0) return fallback

  if (next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) {
    return next
  }

  const allowedOrigins = [safeOrigin(WEB_URL), safeOrigin(BARBERIA_URL)].filter(
    (origin): origin is string => origin !== null,
  )

  try {
    const parsed = new URL(next)
    if (allowedOrigins.includes(parsed.origin)) return next
  } catch {
    // no es una URL absoluta válida
  }

  return fallback
}
