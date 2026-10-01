// lib/booking-settings.ts — opciones de "Reservas en línea" (puro, sin servidor).

/** Cada cuántos minutos se ofrecen horarios al reservar. */
export const BOOKING_INTERVAL_OPTIONS = [15, 20, 30, 60] as const
export type BookingInterval = (typeof BOOKING_INTERVAL_OPTIONS)[number]
export const DEFAULT_BOOKING_INTERVAL: BookingInterval = 30

export function isValidBookingInterval(value: unknown): value is BookingInterval {
  return typeof value === 'number' && (BOOKING_INTERVAL_OPTIONS as readonly number[]).includes(value)
}

/** Valor guardado (puede ser null o un número fuera de la lista) → una opción válida. */
export function normalizeBookingInterval(value: unknown): BookingInterval {
  const n = Number(value)
  return isValidBookingInterval(n) ? n : DEFAULT_BOOKING_INTERVAL
}

export function bookingIntervalLabel(minutes: number): string {
  return minutes === 60 ? '1 hora' : `${minutes} minutos`
}
