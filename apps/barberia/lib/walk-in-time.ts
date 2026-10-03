// lib/walk-in-time.ts — hora de llegada legible para la Fila de espera.
// walk_ins.arrived_at es un instante real; el "día" es el del negocio (America/Bogota).

const BUSINESS_TZ = 'America/Bogota'

const dayKey = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)

const dayNumber = (d: Date): number => {
  const [y, m, day] = dayKey(d).split('-').map(Number)
  return Date.UTC(y, m - 1, day) / 86_400_000
}

/** Hora del instante en la zona del negocio, p. ej. "3:10 p. m." */
export function formatBusinessClock(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: BUSINESS_TZ })
    .replace(/[  ]/g, ' ')
}

/**
 * Llegada en lenguaje natural:
 *  mismo día  → "hace un momento" · "hace 5 min" · "hace 2 h"
 *  ayer       → "ayer 3:10 p. m."
 *  antes      → "hace 3 días"
 * Nunca "4883 min": pasadas las 24 h se habla de días calendario del negocio.
 */
export function formatArrivalRelative(iso: string, now: Date = new Date()): string {
  const arrived = new Date(iso)
  const days = dayNumber(now) - dayNumber(arrived)

  if (days <= 0) {
    const minutes = Math.max(0, Math.floor((now.getTime() - arrived.getTime()) / 60_000))
    if (minutes < 1)  return 'hace un momento'
    if (minutes < 60) return `hace ${minutes} min`
    return `hace ${Math.floor(minutes / 60)} h`
  }
  if (days === 1) return `ayer ${formatBusinessClock(iso)}`
  return `hace ${days} días`
}

/** ¿Llegó antes de la medianoche de hoy del negocio? (turno de un día anterior) */
export function arrivedBeforeToday(iso: string, now: Date = new Date()): boolean {
  return dayNumber(now) - dayNumber(new Date(iso)) > 0
}
