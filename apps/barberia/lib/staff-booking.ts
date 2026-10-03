// lib/staff-booking.ts — piezas puras de la reserva interna (equipo): errores y validaciones.
// (Los Server Actions no pueden exportar helpers síncronos: viven aquí.)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const MAX_BOOKING_NOTES = 500

/** Mensajes en español para los códigos de error de la RPC `create_staff_appointment`. */
const ERROR_MESSAGES: Record<string, string> = {
  invalid_start:        'La fecha u hora no es válida.',
  notes_too_long:       `La nota no puede superar ${MAX_BOOKING_NOTES} caracteres.`,
  in_the_past:          'Ese horario ya pasó. Elige uno más adelante.',
  staff_not_found:      'No se encontró al profesional o está inactivo.',
  customer_not_found:   'No se encontró al cliente.',
  service_not_found:    'No se encontró el servicio o está inactivo.',
  service_not_offered:  'Ese profesional no hace este servicio.',
  outside_schedule:     'Ese horario queda fuera del horario del profesional.',
  slot_taken:           'Ese horario ya fue tomado. Elige otro.',
  slot_unavailable:     'Ese horario ya no está disponible (pausa, permiso o estación ocupada). Elige otro.',
  forbidden:            'No tienes permiso para agendar esta cita.',
}

const GENERIC_ERROR = 'No se pudo agendar la cita. Intenta de nuevo.'

/** Código de error de la RPC (o mensaje de Postgres) → texto para el usuario. */
export function mapStaffBookingError(codeOrMessage: string | null | undefined): string {
  const raw = (codeOrMessage ?? '').trim()
  if (!raw) return GENERIC_ERROR
  if (ERROR_MESSAGES[raw]) return ERROR_MESSAGES[raw]
  // Los RAISE EXCEPTION de Postgres llegan como mensaje: buscar el código dentro del texto
  for (const code of Object.keys(ERROR_MESSAGES)) {
    if (raw.includes(code)) return ERROR_MESSAGES[code]
  }
  return GENERIC_ERROR
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

export function isDateKey(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export function isHHMM(v: unknown): v is string {
  return typeof v === 'string' && TIME_RE.test(v)
}

/** Deja solo los horarios futuros cuando el día es hoy (HH:MM > ahora); otros días, todos. */
export function filterFutureSlots(slots: string[], dateKey: string, todayKey: string, nowHHMM: string): string[] {
  if (dateKey !== todayKey) return slots
  return slots.filter((s) => s > nowHHMM)
}

/** Limpia el texto de búsqueda para usarlo en un filtro `or(...ilike...)` de PostgREST. */
export function sanitizeCustomerSearch(q: string): string {
  return (q ?? '').replace(/[,()%*_\\"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}

/**
 * Hora a dejar seleccionada cuando cargan los horarios libres: la preferida (la de la franja desde
 * la que se abrió la hoja) si sigue libre; si no, la ya elegida si sigue libre; si no, ninguna.
 */
export function pickSlotTime(slots: string[], preferred: string | undefined, current: string): string {
  if (preferred && slots.includes(preferred)) return preferred
  return slots.includes(current) ? current : ''
}
