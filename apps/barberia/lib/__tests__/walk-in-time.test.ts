import { formatArrivalRelative, arrivedBeforeToday } from '../walk-in-time'

// Ahora = 2 de octubre de 2026, 3:00 p. m. en Bogotá (UTC-5) = 20:00 UTC
const NOW = new Date('2026-10-02T20:00:00Z')
const at = (iso: string) => formatArrivalRelative(iso, NOW)

describe('formatArrivalRelative', () => {
  it('hace un momento / minutos / horas el mismo día', () => {
    expect(at('2026-10-02T19:59:40Z')).toBe('hace un momento')
    expect(at('2026-10-02T19:55:00Z')).toBe('hace 5 min')
    expect(at('2026-10-02T19:01:00Z')).toBe('hace 59 min')
    expect(at('2026-10-02T18:00:00Z')).toBe('hace 2 h')
    expect(at('2026-10-02T14:30:00Z')).toBe('hace 5 h') // 9:30 a. m. del mismo día
  })

  it('ayer con la hora de llegada', () => {
    // 1 oct 3:10 p. m. Bogotá = 20:10 UTC
    expect(at('2026-10-01T20:10:00Z')).toBe('ayer 3:10 p. m.')
  })

  it('ayer aunque hayan pasado pocas horas (cruzó la medianoche del negocio)', () => {
    const now = new Date('2026-10-02T05:10:00Z') // 12:10 a. m. del 2 en Bogotá
    expect(formatArrivalRelative('2026-10-02T04:50:00Z', now)).toBe('ayer 11:50 p. m.')
  })

  it('días calendario cuando pasó más de un día, nunca minutos', () => {
    expect(at('2026-09-29T20:00:00Z')).toBe('hace 3 días')
    expect(at('2026-09-29T20:00:00Z')).not.toMatch(/min/)
    expect(at('2026-09-02T20:00:00Z')).toBe('hace 30 días')
  })

  it('una fecha futura (reloj desfasado) no sale negativa', () => {
    expect(at('2026-10-02T20:00:30Z')).toBe('hace un momento')
  })
})

describe('arrivedBeforeToday', () => {
  it('compara con la medianoche de hoy en Bogotá', () => {
    expect(arrivedBeforeToday('2026-10-02T05:00:00Z', NOW)).toBe(false) // 12:00 a. m. de hoy
    expect(arrivedBeforeToday('2026-10-02T04:59:00Z', NOW)).toBe(true)  // 11:59 p. m. de ayer
  })
})
