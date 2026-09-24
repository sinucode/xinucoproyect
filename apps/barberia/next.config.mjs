/** @type {import('next').NextConfig} */

// ── [SEC M-6] Security Headers ────────────────────────────────────────────────
const securityHeaders = [
  { key: 'X-Frame-Options',           value: 'DENY' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://hcaptcha.com https://*.hcaptcha.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://hcaptcha.com https://*.hcaptcha.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://*.supabase.co https://api.qrserver.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mercadopago.com https://hcaptcha.com https://*.hcaptcha.com",
      "frame-src 'self' https://hcaptcha.com https://*.hcaptcha.com",
      "frame-ancestors 'none'",
    ].join('; '),
  },
]

const nextConfig = {
  // ── ZONA RAÍZ del dominio xinuco.com ─────────────────────────────────────────
  // apps/barberia sirve /adminbarberia y /[slug].
  // Reescribe / y /admin/* hacia la zona web (apps/web, puerto 3000 en dev).
  // En producción, WEB_ZONE_URL apunta al deployment de apps/web en Vercel.
  async rewrites() {
    const webZone = process.env.WEB_ZONE_URL || 'http://localhost:3000'
    return [
      // Landing (raíz exacta)
      {
        source: '/',
        destination: `${webZone}/`,
      },
      // Panel admin global y sus sub-rutas
      {
        source: '/admin',
        destination: `${webZone}/admin`,
      },
      {
        source: '/admin/:path*',
        destination: `${webZone}/admin/:path*`,
      },
      // Assets de la zona web
      {
        source: '/web-static/:path*',
        destination: `${webZone}/web-static/:path*`,
      },
    ]
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.supabase.co' }],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
