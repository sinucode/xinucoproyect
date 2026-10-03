import {
  filterFutureSlots,
  isDateKey,
  isHHMM,
  isUuid,
  mapStaffBookingError,
  pickSlotTime,
  sanitizeCustomerSearch,
} from '../staff-booking'

describe('mapStaffBookingError', () => {
  it('traduce los códigos esperados de la RPC', () => {
    expect(mapStaffBookingError('slot_taken')).toMatch(/ya fue tomado/i)
    expect(mapStaffBookingError('outside_schedule')).toMatch(/fuera del horario/i)
    expect(mapStaffBookingError('service_not_offered')).toMatch(/no hace este servicio/i)
    expect(mapStaffBookingError('in_the_past')).toMatch(/ya pasó/i)
    expect(mapStaffBookingError('slot_unavailable')).toMatch(/no está disponible/i)
  })

  it('reconoce el código dentro de un mensaje de Postgres', () => {
    expect(mapStaffBookingError('forbidden')).toMatch(/no tienes permiso/i)
    expect(mapStaffBookingError('Error: forbidden (P0001)')).toMatch(/no tienes permiso/i)
  })

  it('códigos desconocidos o vacíos → mensaje genérico (sin filtrar texto técnico)', () => {
    expect(mapStaffBookingError('boom: syntax error at ...')).toBe('No se pudo agendar la cita. Intenta de nuevo.')
    expect(mapStaffBookingError(undefined)).toBe('No se pudo agendar la cita. Intenta de nuevo.')
    expect(mapStaffBookingError('')).toBe('No se pudo agendar la cita. Intenta de nuevo.')
  })
})

describe('validadores', () => {
  it('isDateKey / isHHMM / isUuid', () => {
    expect(isDateKey('2026-10-02')).toBe(true)
    expect(isDateKey('2026-02-30')).toBe(false)
    expect(isDateKey('02/10/2026')).toBe(false)
    expect(isHHMM('09:30')).toBe(true)
    expect(isHHMM('24:00')).toBe(false)
    expect(isHHMM('9:30')).toBe(false)
    expect(isUuid('3f2b8c1e-9a4d-4e7b-8c1d-2a3b4c5d6e7f')).toBe(true)
    expect(isUuid('no-staff')).toBe(false)
    expect(isUuid(undefined)).toBe(false)
  })
})

describe('filterFutureSlots', () => {
  const slots = ['09:00', '09:30', '10:00', '10:30']
  it('hoy: solo horarios posteriores a la hora actual', () => {
    expect(filterFutureSlots(slots, '2026-10-02', '2026-10-02', '09:30')).toEqual(['10:00', '10:30'])
    expect(filterFutureSlots(slots, '2026-10-02', '2026-10-02', '11:00')).toEqual([])
  })
  it('otro día: todos', () => {
    expect(filterFutureSlots(slots, '2026-10-03', '2026-10-02', '23:00')).toEqual(slots)
  })
})

describe('sanitizeCustomerSearch', () => {
  it('quita caracteres que romperían el filtro or() de PostgREST', () => {
    expect(sanitizeCustomerSearch('Ana,phone.eq.1)')).toBe('Ana phone.eq.1')
    expect(sanitizeCustomerSearch('  a%b_c  ')).toBe('a b c')
    expect(sanitizeCustomerSearch('x'.repeat(100))).toHaveLength(60)
  })
})

describe('pickSlotTime', () => {
  const slots = ['09:00', '10:00', '10:30']
  it('preselecciona la hora preferida si está libre', () => {
    expect(pickSlotTime(slots, '10:00', '')).toBe('10:00')
  })
  it('sin horarios cargados (aún sin servicio) no selecciona nada', () => {
    expect(pickSlotTime([], '10:00', '')).toBe('')
  })
  it('conserva la preferida al cambiar de servicio si sigue libre', () => {
    expect(pickSlotTime(slots, '10:00', '')).toBe('10:00')
    expect(pickSlotTime(['10:00'], '10:00', '')).toBe('10:00')
  })
  it('si la preferida ya no está libre, conserva la elegida si sigue libre o limpia', () => {
    expect(pickSlotTime(slots, '11:00', '09:00')).toBe('09:00')
    expect(pickSlotTime(slots, '11:00', '12:00')).toBe('')
    expect(pickSlotTime(slots, undefined, '')).toBe('')
  })
})
