// lib/settings-status.ts — la línea de estado de cada tarjeta del índice de Configuración.
// Puro: recibe los datos ya leídos y devuelve un texto corto en español.

import { hasOperatingHours, summarizeOperatingHours } from '@/lib/business-hours'
import { dayMonthLabel } from '@/lib/business-closures'
import { bookingIntervalLabel, normalizeBookingInterval } from '@/lib/booking-settings'

// ── Datos del negocio ────────────────────────────────────────────────────────

export function profileStatus(biz: {
  address?:  string | null
  whatsapp?: string | null
  phone?:    string | null
}): { text: string; complete: boolean } {
  const missing: string[] = []
  if (!biz.address?.trim()) missing.push('la dirección')
  if (!biz.whatsapp?.trim() && !biz.phone?.trim()) missing.push('un WhatsApp o teléfono')
  if (missing.length === 0) return { text: 'Completo', complete: true }
  return {
    text: missing.length === 1 ? `Falta ${missing[0]}` : `Faltan ${missing.join(' y ')}`,
    complete: false,
  }
}

// ── Horario y días cerrados ──────────────────────────────────────────────────

export function hoursStatus(args: {
  operatingHours: unknown
  closures:       { date_from: string; date_to: string; kind: 'holiday' | 'custom' }[]
  todayKey:       string
}): { text: string; complete: boolean } {
  if (!hasOperatingHours(args.operatingHours)) return { text: 'Falta definir el horario', complete: false }

  const upcoming = args.closures
    .filter(c => c.date_to >= args.todayKey)
    .sort((a, b) => (a.date_from < b.date_from ? -1 : a.date_from > b.date_from ? 1 : 0))

  if (upcoming.length === 0) {
    return { text: summarizeOperatingHours(args.operatingHours) ?? 'Sin cierres próximos', complete: true }
  }

  const holidays = upcoming.filter(c => c.kind === 'holiday').length
  const parts: string[] = []
  if (holidays > 0) parts.push(`Cierras ${holidays} ${holidays === 1 ? 'festivo' : 'festivos'}`)

  const next = upcoming[0]
  parts.push(
    next.date_from <= args.todayKey
      ? `cerrado hasta el ${dayMonthLabel(next.date_to)}`
      : `próximo cierre: ${dayMonthLabel(next.date_from)}`,
  )
  const text = parts.join(' · ')
  return { text: text.charAt(0).toUpperCase() + text.slice(1), complete: true }
}

// ── Reservas en línea ────────────────────────────────────────────────────────

export function bookingStatus(biz: {
  appointment_interval_minutes?: number | null
  booking_products_enabled?:     boolean | null
  booking_max_product_units?:    number | null
}): string {
  const interval = normalizeBookingInterval(biz.appointment_interval_minutes)
  const label = interval === 60 ? 'Cada 1 hora' : `Cada ${bookingIntervalLabel(interval).replace('minutos', 'min')}`
  const products = (biz.booking_products_enabled ?? true) && (biz.booking_max_product_units ?? 2) > 0
  return `${label} · productos apartados: ${products ? 'sí' : 'no'}`
}

// ── Lealtad ──────────────────────────────────────────────────────────────────

export function loyaltyStatus(biz: { enabled: boolean; mode?: string | null }): string {
  if (!biz.enabled) return 'Apagada'
  return biz.mode === 'stamps' ? 'Sellos' : 'Puntos'
}
