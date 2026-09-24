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
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://hcaptcha.com https://*.hcaptcha.com",
      "frame-src 'self' https://hcaptcha.com https://*.hcaptcha.com",
      "frame-ancestors 'none'",
    ].join('; '),
  },
]

const nextConfig = {
  // ── ZONA SECUNDARIA (plataforma/web) ─────────────────────────────────────────
  // apps/web sirve / (landing) y /admin (panel global de todas las verticales).
  // assetPrefix permite que sus assets /_next/* no colisionen con los de barbería
  // cuando ambas zonas corren bajo el mismo dominio.
  assetPrefix: process.env.NODE_ENV === 'production' ? '/web-static' : '',

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
