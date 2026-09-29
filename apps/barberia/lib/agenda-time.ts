// lib/agenda-time.ts — helpers de fecha/hora para la agenda del negocio.
//
// CONVENCIÓN DE TIEMPO (crítica): el sistema guarda la hora LOCAL de la barbería
// "como si fuera UTC". Es decir, las 10:00 en la barbería se guardan como
// `...T10:00:00Z` (BookingWizard envía `${date}T${time}:00Z` y get_available_slots_v2
// compara en UTC). Por eso:
//  - Todo `start_time` se MUESTRA con `timeZone: 'UTC'` (nunca con la zona del navegador).
//  - "Hoy" para el negocio es la fecha actual en America/Bogota, usada luego como
//    `${YYYY-MM-DD}T00:00:00Z`.

const BUSINESS_TZ = 'America/Bogota'

/** Fecha de hoy en la zona del negocio, formato 'YYYY-MM-DD'. */
export function businessTodayISODate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Suma `days` días a una fecha 'YYYY-MM-DD' y devuelve 'YYYY-MM-DD'. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Hora de la cita, p. ej. "10:30 a. m." (formateada en UTC = hora local del negocio). */
export function formatApptTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  })
}

/** Clave de día 'YYYY-MM-DD' de la cita (en UTC = día local del negocio). */
export function apptDateKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

/** Etiqueta del día: 'Hoy' / 'Mañana' / 'Miércoles 30 sept'. */
export function dayLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return 'Hoy'
  if (dateKey === addDaysToDateKey(todayKey, 1)) return 'Mañana'
  const label = new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  // es-CO → "miércoles, 30 sept" / "miércoles 30 de sept": limpiar y capitalizar
  const clean = label.replace(/,/g, '').replace(/\bde\b\s*/g, '').replace(/\./g, '').replace(/\s+/g, ' ').trim()
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}
