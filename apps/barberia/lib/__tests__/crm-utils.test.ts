import {
  whatsappUrl,
  displayPhone,
  isPlaceholderPhone,
  validateCustomerInput,
  parseCustomerFilter,
  parseCustomerSort,
  formatBirthday,
  isBirthdayThisMonth,
  relativeVisitLabel,
  businessNowWallISO,
  formatApptDateTime,
} from '../crm-utils'

describe('teléfono', () => {
  it('detecta placeholders de la fila', () => {
    expect(isPlaceholderPhone('fila-1a2b3c4d')).toBe(true)
    expect(isPlaceholderPhone('')).toBe(true)
    expect(isPlaceholderPhone('3001234567')).toBe(false)
    expect(displayPhone('fila-1a2b3c4d')).toBe('Sin teléfono')
    expect(displayPhone('3001234567')).toBe('3001234567')
  })

  it('whatsappUrl', () => {
    expect(whatsappUrl('300 123 4567')).toBe('https://wa.me/573001234567')
    expect(whatsappUrl('+57 300 123 4567')).toBe('https://wa.me/573001234567')
    expect(whatsappUrl('6012345678')).toBe('https://wa.me/6012345678')
    expect(whatsappUrl('+1 415 555 0100')).toBe('https://wa.me/14155550100')
    expect(whatsappUrl('fila-1a2b3c4d')).toBeNull()
    expect(whatsappUrl('')).toBeNull()
    expect(whatsappUrl(null)).toBeNull()
  })
})

describe('validateCustomerInput', () => {
  it('normaliza y acepta datos válidos', () => {
    const r = validateCustomerInput({ full_name: '  Juan   Pérez ', phone: '300-123 4567', email: '', birthday: '' })
    expect(r).toEqual({ value: { full_name: 'Juan Pérez', phone: '3001234567', email: null, birthday: null } })
  })

  it('rechaza nombre, teléfono, correo y cumpleaños inválidos', () => {
    expect('error' in validateCustomerInput({ full_name: 'A', phone: '3001234567' })).toBe(true)
    expect('error' in validateCustomerInput({ full_name: 'Juan', phone: '12345' })).toBe(true)
    expect('error' in validateCustomerInput({ full_name: 'Juan', phone: '300abc4567' })).toBe(true)
    expect('error' in validateCustomerInput({ full_name: 'Juan', phone: '3001234567', email: 'nope' })).toBe(true)
    expect('error' in validateCustomerInput({ full_name: 'Juan', phone: '3001234567', birthday: '2999-01-01' })).toBe(true)
    expect('error' in validateCustomerInput({ full_name: 'Juan', phone: '3001234567', birthday: '2020-02-31' })).toBe(true)
  })

  it('acepta + inicial y cumpleaños pasado', () => {
    const r = validateCustomerInput({ full_name: 'Ana', phone: '+57 300 1234567', birthday: '1990-03-14', email: 'a@b.co' })
    expect(r).toEqual({ value: { full_name: 'Ana', phone: '+573001234567', email: 'a@b.co', birthday: '1990-03-14' } })
  })
})

describe('filtros y orden', () => {
  it('valida valores, con default', () => {
    expect(parseCustomerFilter('inactive')).toBe('inactive')
    expect(parseCustomerFilter('x; drop')).toBe('all')
    expect(parseCustomerSort('spent')).toBe('spent')
    expect(parseCustomerSort(undefined)).toBe('recent')
  })
})

describe('fechas', () => {
  it('formatBirthday / isBirthdayThisMonth', () => {
    expect(formatBirthday('1990-03-14')).toBe('14 de marzo')
    expect(formatBirthday(null)).toBeNull()
    expect(isBirthdayThisMonth('1990-03-14', '2026-03-05')).toBe(true)
    expect(isBirthdayThisMonth('1990-04-14', '2026-03-05')).toBe(false)
  })

  it('relativeVisitLabel usa el día local (start_time como UTC)', () => {
    const today = '2026-09-29'
    expect(relativeVisitLabel('2026-09-29T10:00:00Z', today)).toBe('hoy')
    expect(relativeVisitLabel('2026-09-28T10:00:00Z', today)).toBe('ayer')
    expect(relativeVisitLabel('2026-09-26T10:00:00Z', today)).toBe('hace 3 días')
    expect(relativeVisitLabel('2026-05-01T10:00:00Z', today)).toMatch(/2026/)
  })

  it('businessNowWallISO devuelve la pared de Bogotá como UTC', () => {
    expect(businessNowWallISO(new Date('2026-09-29T15:30:00Z'))).toBe('2026-09-29T10:30:00.000Z')
    expect(businessNowWallISO(new Date('2026-09-30T02:00:00Z'))).toBe('2026-09-29T21:00:00.000Z')
  })

  it('formatApptDateTime', () => {
    expect(formatApptDateTime('2026-10-01T10:00:00Z')).toMatch(/^jue 1 oct 10:00/)
  })
})
