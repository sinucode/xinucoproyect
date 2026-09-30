// lib/audit-retention.ts — Plazo de conservación de la Auditoría (puro, sin I/O).
// Debe coincidir con la validación de la BD (platform_settings: 12, 24, 36, 60, 120).

export const AUDIT_RETENTION_OPTIONS = [12, 24, 36, 60, 120] as const

export const DEFAULT_AUDIT_RETENTION_MONTHS = 36

export function isValidRetention(n: unknown): n is (typeof AUDIT_RETENTION_OPTIONS)[number] {
  return typeof n === 'number'
    && Number.isInteger(n)
    && (AUDIT_RETENTION_OPTIONS as readonly number[]).includes(n)
}

/** 12 → '1 año', 36 → '3 años', 18 → '18 meses'. */
export function retentionLabel(months: number): string {
  if (months > 0 && months % 12 === 0) {
    const years = months / 12
    return years === 1 ? '1 año' : `${years} años`
  }
  return `${months} meses`
}

/** Frase para la pantalla de Auditoría de cada barbería. */
export function retentionNotice(months: number): string {
  return months === 12
    ? 'Se conservan los registros del último año.'
    : `Se conservan los registros de los últimos ${retentionLabel(months)}.`
}
