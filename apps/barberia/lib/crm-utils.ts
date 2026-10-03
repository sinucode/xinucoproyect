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

export const CUSTOMER_FILTERS = ['all', 'frequent', 'inactive', 'new', 'birthday', 'mine'] as const
export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number]

export const CUSTOMER_SORTS = ['recent', 'spent', 'name', 'created'] as const
export type CustomerSort = (typeof CUSTOMER_SORTS)[number]

export const CUSTOMER_FILTER_LABELS: Record<CustomerFilter, string> = {
  all:      'Todos',
  frequent: 'Frecuentes',
  inactive: 'No vienen hace +30 días',
  new:      'Nuevos este mes',
  birthday: 'Cumpleaños este mes',
  mine:     'Mis clientes',
}

export const CUSTOMER_SORT_LABELS: Record<CustomerSort, string> = {
  recent:  'Última visita',
  spent:   'Mayor gasto',
  name:    'Nombre',
  created: 'Más recientes',
}

/** 'Mis clientes' solo lo ofrece la pantalla al profesional (barbero / manicurista), no al administrador. */
export function customerFiltersForRole(isAdmin: boolean): CustomerFilter[] {
  return CUSTOMER_FILTERS.filter((f) => !isAdmin || f !== 'mine')
}

/**
 * Une con " · " solo los textos que existen: sin separadores colgando cuando falta el segundo valor
 * (p. ej. 'Cliente desde sept 2025' sin antigüedad → sin " · " al final).
 */
export function joinParts(parts: ReadonlyArray<string | null | undefined | false>, separator = ' · '): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(separator)
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

// ── Resumen de compras del cliente (RPC get_customer_sales_summary) ──────────

export interface SalesSummaryProduct {
  description: string
  quantity:    number
  /** null = el rol no ve montos (barbero/manicurista). */
  total_price: number | null
  created_at:  string
}

export interface SalesSummary {
  /** Los montos son null cuando el usuario no es admin (o el RPC falló): la UI los oculta. */
  total_spent:         number | null
  paid_sales:          number | null
  avg_ticket:          number | null
  paid_by_appointment: Map<string, number> | null
  purchased_products:  SalesSummaryProduct[]
  /** Productos apartados, por id de cita. */
  upcoming_products:   Map<string, { name: string; quantity: number }[]>
}

const toNum = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Normaliza el JSON del RPC get_customer_sales_summary. Solo el admin recibe montos: si
 * `total_spent` viene null (barbero, o respuesta vacía por error) TODO el dinero queda null y
 * la UI no muestra ningún monto; nombres, cantidades y fechas se conservan.
 */
export function parseSalesSummary(raw: unknown): SalesSummary {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const hasMoney = r.total_spent !== null && r.total_spent !== undefined

  const totalSpent = hasMoney ? toNum(r.total_spent) : null
  const paidSales  = hasMoney ? toNum(r.paid_sales) : null

  let paidByAppointment: Map<string, number> | null = null
  if (hasMoney) {
    paidByAppointment = new Map()
    for (const row of Array.isArray(r.paid_by_appointment) ? (r.paid_by_appointment as Record<string, unknown>[]) : []) {
      if (typeof row.appointment_id === 'string') {
        paidByAppointment.set(row.appointment_id, (paidByAppointment.get(row.appointment_id) ?? 0) + toNum(row.amount))
      }
    }
  }

  const purchased: SalesSummaryProduct[] = (Array.isArray(r.purchased_products) ? (r.purchased_products as Record<string, unknown>[]) : [])
    .map((p) => ({
      description: String(p.description ?? ''),
      quantity:    toNum(p.quantity),
      total_price: hasMoney && p.total_price !== null && p.total_price !== undefined ? toNum(p.total_price) : null,
      created_at:  String(p.created_at ?? ''),
    }))

  const upcoming = new Map<string, { name: string; quantity: number }[]>()
  for (const row of Array.isArray(r.upcoming_products) ? (r.upcoming_products as Record<string, unknown>[]) : []) {
    if (typeof row.appointment_id !== 'string') continue
    const list = upcoming.get(row.appointment_id) ?? []
    list.push({ name: String(row.name ?? 'Producto'), quantity: toNum(row.quantity) })
    upcoming.set(row.appointment_id, list)
  }

  return {
    total_spent:         totalSpent,
    paid_sales:          paidSales,
    avg_ticket:          totalSpent !== null && paidSales !== null ? (paidSales > 0 ? Math.round(totalSpent / paidSales) : 0) : null,
    paid_by_appointment: paidByAppointment,
    purchased_products:  purchased,
    upcoming_products:   upcoming,
  }
}
