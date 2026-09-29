import { customerSince, formatAge, formatLongDate } from '../customer-utils'

// Fechas en hora de Bogotá (UTC-5): las 12:00 locales = 17:00Z.
const at = (iso: string) => new Date(iso).getTime()

describe('customerSince', () => {
  const created = '2025-03-12T17:00:00Z'

  it('menos de un mes → "Nuevo este mes" sin antigüedad', () => {
    expect(customerSince(created, at('2025-04-01T17:00:00Z'))).toEqual({ label: 'Nuevo este mes', age: '' })
    expect(customerSince(created, at('2025-03-12T18:00:00Z'))).toEqual({ label: 'Nuevo este mes', age: '' })
  })

  it('solo meses (singular y plural)', () => {
    expect(customerSince(created, at('2025-04-12T17:00:00Z'))).toEqual({ label: 'Cliente desde mar 2025', age: '1 mes' })
    expect(customerSince(created, at('2025-06-20T17:00:00Z'))).toEqual({ label: 'Cliente desde mar 2025', age: '3 meses' })
  })

  it('solo años (singular y plural)', () => {
    expect(customerSince(created, at('2026-03-12T17:00:00Z')).age).toBe('1 año')
    expect(customerSince(created, at('2027-03-30T17:00:00Z')).age).toBe('2 años')
  })

  it('años y meses', () => {
    expect(customerSince(created, at('2026-09-12T17:00:00Z'))).toEqual({
      label: 'Cliente desde mar 2025',
      age: '1 año y 6 meses',
    })
    expect(customerSince(created, at('2027-04-15T17:00:00Z')).age).toBe('2 años y 1 mes')
  })

  it('no cuenta un mes incompleto', () => {
    expect(customerSince(created, at('2025-05-11T17:00:00Z')).age).toBe('1 mes')
  })

  it('usa la zona de Bogotá para el día del mes (00:30 UTC del 1 sigue siendo el 31 anterior)', () => {
    // 2025-04-01T02:00Z = 2025-03-31 21:00 en Bogotá
    expect(customerSince('2025-04-01T02:00:00Z', at('2025-04-30T17:00:00Z'))).toEqual({ label: 'Nuevo este mes', age: '' })
    expect(customerSince('2025-04-01T02:00:00Z', at('2025-05-01T17:00:00Z')).age).toBe('1 mes')
  })

  it('fecha inválida → vacío', () => {
    expect(customerSince('nope')).toEqual({ label: '', age: '' })
  })
})

describe('formatAge / formatLongDate', () => {
  it('formatAge', () => {
    expect(formatAge(0)).toBe('')
    expect(formatAge(12)).toBe('1 año')
    expect(formatAge(13)).toBe('1 año y 1 mes')
    expect(formatAge(25)).toBe('2 años y 1 mes')
  })

  it('formatLongDate', () => {
    expect(formatLongDate('2025-03-12T17:00:00Z')).toBe('12 de marzo de 2025')
  })
})
