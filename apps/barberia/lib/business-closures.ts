// lib/business-closures.ts — días cerrados del negocio (festivos que se cierran, vacaciones…).
//
// Puro: validación espejo de la RPC set_business_closure, mensajes de error en español y
// textos para la página pública y el índice de Configuración. Las fechas son 'YYYY-MM-DD'
// (día del negocio, America/Bogota) y se manejan en UTC para no depender de la zona del servidor.

export const MAX_CLOSURE_DAYS = 60
export const MIN_REASON = 2
export const MAX_REASON = 80

export interface ClosureLike {
  date_from: string
  date_to:   string
  reason:    string
  kind?:     'holiday' | 'custom'
}

const DAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isDateKey(v: unknown): v is string {
  return typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
}

/** Días entre dos fechas 'YYYY-MM-DD' (to − from). */
export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000)
}

export function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** '2026-10-12' → 'lun 12 oct'. */
export function shortDateLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`)
  return `${DAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`
}

/** '2026-10-12' → '12 oct' (sin día de la semana). */
export function dayMonthLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`)
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`
}

/** 'lun 12 oct' o, si es un rango, 'lun 12 oct al vie 16 oct'. */
export function closureRangeLabel(from: string, to: string): string {
  return from === to ? shortDateLabel(from) : `${shortDateLabel(from)} al ${shortDateLabel(to)}`
}

// ── Validación (espejo de set_business_closure) ──────────────────────────────

export interface ClosureInput {
  date_from: string
  date_to:   string
  reason:    string
}

/** Devuelve un mensaje en español o null si el cierre es válido. `todayKey` = hoy en Bogotá. */
export function validateClosureInput(input: ClosureInput, todayKey: string): string | null {
  if (!input || !isDateKey(input.date_from) || !isDateKey(input.date_to)) return 'Elige las fechas del cierre.'
  if (input.date_to < input.date_from) return 'La fecha final no puede ser anterior a la inicial.'
  if (daysBetween(input.date_from, input.date_to) > MAX_CLOSURE_DAYS) {
    return `El cierre no puede durar más de ${MAX_CLOSURE_DAYS} días. Si necesitas más, crea otro cierre seguido.`
  }
  if (input.date_from < todayKey) return 'No puedes cerrar días que ya pasaron.'
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (reason.length < MIN_REASON) return 'Escribe el motivo del cierre (por ejemplo: vacaciones).'
  if (reason.length > MAX_REASON) return `El motivo no puede superar ${MAX_REASON} caracteres.`
  return null
}

/** Errores de las RPC → mensaje en español. */
export function closureErrorMessage(message: unknown): string {
  const text = String(message ?? '')
  if (text.includes('forbidden'))       return 'Solo un administrador puede cambiar los días cerrados.'
  if (text.includes('invalid_range'))   return `Las fechas no son válidas. El cierre puede durar hasta ${MAX_CLOSURE_DAYS} días.`
  if (text.includes('past_date'))       return 'No puedes cerrar días que ya pasaron.'
  if (text.includes('invalid_kind'))    return 'Tipo de cierre no válido.'
  if (text.includes('reason_required')) return 'Escribe el motivo del cierre (por ejemplo: vacaciones).'
  if (text.includes('overlaps'))        return 'Esas fechas se cruzan con otro cierre que ya tienes. Quítalo primero o elige otras fechas.'
  if (text.includes('not_found'))       return 'Ese cierre ya no existe. Recarga la página.'
  return 'No se pudo guardar. Intenta de nuevo.'
}

// ── Búsquedas ────────────────────────────────────────────────────────────────

/** El cierre que cubre la fecha (si hay), sin importar el tipo. */
export function closureCoveringDate<T extends ClosureLike>(closures: T[], dateKey: string): T | null {
  return closures.find(c => c.date_from <= dateKey && c.date_to >= dateKey) ?? null
}

/** Avisos "Cerrado el lun 12 oct · Día de la Raza" para los cierres que tocan los próximos `windowDays` días. */
export function closureNotices(
  closures: { from: string; to: string; reason: string }[] | null | undefined,
  todayKey: string,
  windowDays = 14,
  max = 3,
): string[] {
  if (!Array.isArray(closures)) return []
  const limit = addDaysKey(todayKey, windowDays)
  return closures
    .filter(c => isDateKey(c?.from) && isDateKey(c?.to) && c.to >= todayKey && c.from <= limit)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    .slice(0, max)
    .map(c => {
      const reason = String(c.reason ?? '').trim()
      const suffix = reason ? ` · ${reason}` : ''
      if (c.from <= todayKey) {
        return c.from === c.to ? `Hoy estamos cerrados${suffix}` : `Cerrado hasta el ${shortDateLabel(c.to)}${suffix}`
      }
      return c.from === c.to
        ? `Cerrado el ${shortDateLabel(c.from)}${suffix}`
        : `Cerrado del ${shortDateLabel(c.from)} al ${shortDateLabel(c.to)}${suffix}`
    })
}

/** Texto para la alerta tras cerrar días que ya tienen citas. */
export function appointmentsWarning(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null
  return count === 1
    ? 'Ya hay 1 cita ese día: reprográmala en la Agenda.'
    : `Ya hay ${count} citas ese día: reprográmalas en la Agenda.`
}

/** Igual que appointmentsWarning pero para un rango (vacaciones, remodelación). */
export function appointmentsRangeWarning(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null
  return count === 1
    ? 'Ya hay 1 cita en esas fechas: reprográmala en la Agenda.'
    : `Ya hay ${count} citas en esas fechas: reprográmalas en la Agenda.`
}
