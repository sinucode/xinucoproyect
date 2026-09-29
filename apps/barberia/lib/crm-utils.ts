// lib/crm-utils.ts — helpers puros del módulo Clientes (sin 'use server' para
// poder compartirlos entre Server Actions y componentes de cliente).
//
// CONVENCIÓN DE TIEMPO: appointments.start_time (y last_visit / next_appointment)
// = hora LOCAL del negocio guardada como UTC → se formatea con timeZone 'UTC'
// (ver lib/agenda-time.ts). Los created_at son instantes reales → 'America/Bogota'.

import { addDaysToDateKey, apptDateKey, businessTodayISODate, formatApptTime } from '@/lib/agenda-time'

const BUSINESS_TZ = 'America/Bogota'

// ── Lista: filtros y orden ────────────────────────────────────────────────────

export const CUSTOMERS_PAGE_SIZE = 30

export const CUSTOMER_FILTERS = ['all', 'frequent', 'inactive', 'new', 'birthday'] as const
export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number]

export const CUSTOMER_SORTS = ['recent', 'spent', 'name', 'created'] as const
export type CustomerSort = (typeof CUSTOMER_SORTS)[number]

export const CUSTOMER_FILTER_LABELS: Record<CustomerFilter, string> = {
  all:      'Todos',
  frequent: 'Frecuentes',
  inactive: 'No vienen hace +30 días',
  new:      'Nuevos este mes',
  birthday: 'Cumpleaños este mes',
}

export const CUSTOMER_SORT_LABELS: Record<CustomerSort, string> = {
  recent:  'Última visita',
  spent:   'Mayor gasto',
  name:    'Nombre',
  created: 'Más recientes',
}

export function parseCustomerFilter(value: unknown): CustomerFilter {
  return (CUSTOMER_FILTERS as readonly string[]).includes(value as string) ? (value as CustomerFilter) : 'all'
}

export function parseCustomerSort(value: unknown): CustomerSort {
  return (CUSTOMER_SORTS as readonly string[]).includes(value as string) ? (value as CustomerSort) : 'recent'
}

// ── Teléfono ──────────────────────────────────────────────────────────────────

/** Los clientes de la fila de espera sin teléfono se guardan con 'fila-xxxxxxxx'. */
export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  return !phone || /^fila-/i.test(phone.trim())
}

/** Teléfono para mostrar: 'Sin teléfono' si es placeholder o vacío. */
export function displayPhone(phone: string | null | undefined): string {
  return isPlaceholderPhone(phone) ? 'Sin teléfono' : (phone as string)
}

/** Quita espacios, guiones, puntos y paréntesis (conserva el '+' inicial). */
export function cleanPhone(raw: string): string {
  return raw.replace(/[\s\-.()]/g, '')
}

/**
 * Enlace de WhatsApp o null si el teléfono no sirve.
 * Celular colombiano (10 dígitos que empieza en 3) → prefijo 57; otro → tal cual.
 */
export function whatsappUrl(phone: string | null | undefined): string | null {
  if (isPlaceholderPhone(phone)) return null
  const digits = (phone as string).replace(/\D/g, '')
  if (digits.length < 7) return null
  if (digits.length === 10 && digits.startsWith('3')) return `https://wa.me/57${digits}`
  return `https://wa.me/${digits}`
}

// ── Validación de formulario ──────────────────────────────────────────────────

export interface CustomerInput {
  full_name: string
  phone:     string
  email?:    string | null
  birthday?: string | null
}

export interface ValidCustomer {
  full_name: string
  phone:     string
  email:     string | null
  birthday:  string | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/

export function validateCustomerInput(
  input: CustomerInput,
): { error: string } | { value: ValidCustomer } {
  const full_name = (input.full_name ?? '').trim().replace(/\s+/g, ' ')
  if (full_name.length < 2 || full_name.length > 120) {
    return { error: 'El nombre debe tener entre 2 y 120 caracteres.' }
  }

  const phone = cleanPhone((input.phone ?? '').trim())
  const phoneDigits = phone.replace(/^\+/, '')
  if (!/^\d{7,20}$/.test(phoneDigits)) {
    return { error: 'El teléfono debe tener entre 7 y 20 dígitos.' }
  }

  const emailRaw = (input.email ?? '').trim()
  if (emailRaw && (emailRaw.length > 254 || !EMAIL_RE.test(emailRaw))) {
    return { error: 'El correo no es válido.' }
  }

  const birthdayRaw = (input.birthday ?? '').trim()
  if (birthdayRaw) {
    if (!DATE_RE.test(birthdayRaw)) return { error: 'La fecha de cumpleaños no es válida.' }
    const d = new Date(`${birthdayRaw}T00:00:00Z`)
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== birthdayRaw || d.getUTCFullYear() < 1900) {
      return { error: 'La fecha de cumpleaños no es válida.' }
    }
    if (birthdayRaw > businessTodayISODate()) {
      return { error: 'El cumpleaños no puede estar en el futuro.' }
    }
  }

  return {
    value: {
      full_name,
      phone,
      email:    emailRaw || null,
      birthday: birthdayRaw || null,
    },
  }
}

// ── Fechas ────────────────────────────────────────────────────────────────────

/** "Ahora" del negocio como pared-local-en-UTC ('YYYY-MM-DDTHH:MM:00.000Z'), comparable con start_time. */
export function businessNowWallISO(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00.000Z`
}

/** 'jue 1 oct' a partir de un instante start_time (hora local como UTC). */
export function shortApptDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(/[.,]/g, '')
    .replace(/\bde\b\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 'jue 1 oct 10:00 a. m.' a partir de un start_time. */
export function formatApptDateTime(iso: string): string {
  return `${shortApptDate(iso)} ${formatApptTime(iso)}`
}

/** '14 oct 2025' a partir de un start_time (hora local como UTC). */
export function formatApptDay(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

/** '14 oct 2025' a partir de un created_at (instante real, zona del negocio). */
export function formatInstantDay(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: BUSINESS_TZ,
  })
}

/** Etiqueta relativa de la última visita: 'hoy' / 'ayer' / 'hace 3 días' / fecha. */
export function relativeVisitLabel(lastVisit: string, todayKey: string = businessTodayISODate()): string {
  const key = apptDateKey(lastVisit)
  if (key === todayKey) return 'hoy'
  if (key === addDaysToDateKey(todayKey, -1)) return 'ayer'
  const days = Math.round(
    (new Date(`${todayKey}T00:00:00Z`).getTime() - new Date(`${key}T00:00:00Z`).getTime()) / 86_400_000,
  )
  if (days > 0 && days <= 30) return `hace ${days} días`
  return formatApptDay(lastVisit)
}

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** '14 de marzo' a partir de 'YYYY-MM-DD' (sin año, sin corrimiento de zona). */
export function formatBirthday(birthday: string | null | undefined): string | null {
  if (!birthday || !DATE_RE.test(birthday)) return null
  const month = Number(birthday.slice(5, 7))
  const day = Number(birthday.slice(8, 10))
  if (!MONTHS_ES[month - 1]) return null
  return `${day} de ${MONTHS_ES[month - 1]}`
}

/** ¿El cumpleaños cae en el mes actual del negocio? */
export function isBirthdayThisMonth(birthday: string | null | undefined, todayKey: string = businessTodayISODate()): boolean {
  if (!birthday || !DATE_RE.test(birthday)) return false
  return birthday.slice(5, 7) === todayKey.slice(5, 7)
}

/** Iniciales para el avatar. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
