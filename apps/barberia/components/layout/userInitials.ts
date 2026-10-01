/** Iniciales (máx. 2) de un nombre completo; "?" si no hay nombre. */
export function userInitials(userName?: string): string {
  if (!userName) return '?'
  return userName
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'
}
