import type { MetadataRoute } from 'next'

// robots.txt del dominio (la zona barbería sirve todo salvo "/" y "/admin*").
// Se indexan la landing y las páginas públicas de reserva; nunca paneles, logins ni API.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/adminbarberia', '/api/', '/auth/', '/*/dashboard', '/*/login'],
    },
  }
}
