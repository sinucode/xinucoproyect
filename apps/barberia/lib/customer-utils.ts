// lib/customer-utils.ts — antigüedad del cliente (a partir de customers.created_at).
//
// created_at es un instante REAL (no la "hora local como UTC" de las citas), así
// que se interpreta en la zona del negocio: America/Bogota.

const BUSINESS_TZ = 'America/Bogota'

interface YMD { y: number; m: number; d: number }

function ymdInBusinessTz(ms: number): YMD {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { y: get('year'), m: get('month'), d: get('day') }
}

/** Meses completos transcurridos entre dos fechas civiles (nunca negativo). */
function fullMonthsBetween(from: YMD, to: YMD): number {
  let months = (to.y - from.y) * 12 + (to.m - from.m)
  if (to.d < from.d) months -= 1
  return Math.max(months, 0)
}

/** '1 año y 6 meses' / '2 años' / '3 meses' / '' (menos de un mes). */
export function formatAge(totalMonths: number): string {
  if (totalMonths < 1) return ''
  const years = Math.floor(totalMonths / 12)
  const months = totalMonths % 12
  const yLabel = `${years} ${years === 1 ? 'año' : 'años'}`
  const mLabel = `${months} ${months === 1 ? 'mes' : 'meses'}`
  if (years === 0) return mLabel
  if (months === 0) return yLabel
  return `${yLabel} y ${mLabel}`
}

/** 'mar 2025' (mes corto es-CO sin puntos + año) en la zona del negocio. */
export function shortMonthYear(createdAtIso: string): string {
  const d = new Date(createdAtIso)
  const month = d
    .toLocaleDateString('es-CO', { month: 'short', timeZone: BUSINESS_TZ })
    .replace(/\./g, '')
    .trim()
  const year = d.toLocaleDateString('es-CO', { year: 'numeric', timeZone: BUSINESS_TZ })
  return `${month} ${year}`
}

/** '12 de marzo de 2025' en la zona del negocio. */
export function formatLongDate(createdAtIso: string): string {
  return new Date(createdAtIso).toLocaleDateString('es-CO', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: BUSINESS_TZ,
  })
}

/**
 * Antigüedad del cliente.
 *  - menos de 1 mes  → { label: 'Nuevo este mes', age: '' }
 *  - resto           → { label: 'Cliente desde mar 2025', age: '1 año y 6 meses' }
 */
export function customerSince(
  createdAtIso: string,
  nowMs: number = Date.now(),
): { label: string; age: string } {
  const createdMs = new Date(createdAtIso).getTime()
  if (Number.isNaN(createdMs)) return { label: '', age: '' }
  const months = fullMonthsBetween(ymdInBusinessTz(createdMs), ymdInBusinessTz(nowMs))
  if (months < 1) return { label: 'Nuevo este mes', age: '' }
  return { label: `Cliente desde ${shortMonthYear(createdAtIso)}`, age: formatAge(months) }
}
