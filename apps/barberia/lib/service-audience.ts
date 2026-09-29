import type { ServiceAudience, ServiceAudienceOrAll } from '@xinuco/types'

// Servicios por público (Caballeros / Damas / Niños). 'all' = unisex.
// Un servicio es visible (reservas públicas, walk-ins) si su público está activo
// en el negocio o si es 'all'. Desactivar un público oculta sus servicios, no los borra.

export const AUDIENCE_ORDER: ServiceAudience[] = ['men', 'women', 'kids']

export const AUDIENCE_LABELS: Record<ServiceAudienceOrAll, { singular: string; plural: string }> = {
  men:   { singular: 'Caballero', plural: 'Caballeros' },
  women: { singular: 'Dama',      plural: 'Damas' },
  kids:  { singular: 'Niño',      plural: 'Niños' },
  all:   { singular: 'Todos',     plural: 'Todos (unisex)' },
}

function isAudience(v: unknown): v is ServiceAudience {
  return typeof v === 'string' && (AUDIENCE_ORDER as string[]).includes(v)
}

/** Valores válidos, sin duplicados y en orden canónico. Vacío/inválido → ['men']. */
export function normalizeAudiences(raw: unknown): ServiceAudience[] {
  if (!Array.isArray(raw)) return ['men']
  const set = new Set(raw.filter(isAudience))
  const result = AUDIENCE_ORDER.filter(a => set.has(a))
  return result.length > 0 ? result : ['men']
}

/** Público del servicio; si falta o es inválido → 'men'. */
export function serviceAudienceOf(svc: { audience?: string | null }): ServiceAudienceOrAll {
  const a = svc.audience
  return a === 'all' || isAudience(a) ? a : 'men'
}

/** ¿Se muestra el servicio con los públicos activos dados? */
export function isServiceVisible(svc: { audience?: string | null }, active: ServiceAudience[]): boolean {
  const a = serviceAudienceOf(svc)
  return a === 'all' || active.includes(a)
}

export function filterVisibleServices<T extends { audience?: string | null }>(
  services: T[],
  active: ServiceAudience[],
): T[] {
  return services.filter(s => isServiceVisible(s, active))
}

/** Servicios de un público concreto (incluye los unisex). */
export function servicesForAudience<T extends { audience?: string | null }>(
  services: T[],
  audience: ServiceAudience,
): T[] {
  return services.filter(s => {
    const a = serviceAudienceOf(s)
    return a === 'all' || a === audience
  })
}

/**
 * Agrupa los servicios visibles para un <select>. Con un solo público activo devuelve
 * un único grupo sin etiqueta (lista plana, como antes).
 */
export function groupServicesForSelect<T extends { audience?: string | null }>(
  services: T[],
  active: ServiceAudience[],
): { key: ServiceAudienceOrAll; label: string; items: T[] }[] {
  const visible = filterVisibleServices(services, active)
  if (active.length <= 1) return [{ key: 'all', label: '', items: visible }]

  const order: ServiceAudienceOrAll[] = [...AUDIENCE_ORDER, 'all']
  return order
    .map(key => ({
      key,
      label: AUDIENCE_LABELS[key].plural,
      items: visible.filter(s => serviceAudienceOf(s) === key),
    }))
    .filter(g => g.items.length > 0)
}
