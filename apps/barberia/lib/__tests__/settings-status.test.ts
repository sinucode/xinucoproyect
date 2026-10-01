import { bookingStatus, hoursStatus, loyaltyStatus, profileStatus, workstationsStatus } from '../settings-status'

const day = (is_open: boolean) => ({ is_open, open_time: '09:00', close_time: '19:00' })
const hours = {
  monday: day(true), tuesday: day(true), wednesday: day(true), thursday: day(true),
  friday: day(true), saturday: day(true), sunday: day(false),
}
const TODAY = '2026-09-30'

describe('profileStatus', () => {
  it('pide la dirección primero', () => {
    expect(profileStatus({ address: null, whatsapp: '3001234567' })).toEqual({ text: 'Falta la dirección', complete: false })
    expect(profileStatus({ address: '  ', whatsapp: '3001234567' }).text).toBe('Falta la dirección')
  })

  it('pide dirección y contacto si faltan ambos', () => {
    expect(profileStatus({}).text).toBe('Faltan la dirección y un WhatsApp o teléfono')
  })

  it('basta el teléfono si no hay WhatsApp', () => {
    expect(profileStatus({ address: 'Calle 1', phone: '6044441234' })).toEqual({ text: 'Completo', complete: true })
  })

  it('completo con dirección y WhatsApp', () => {
    expect(profileStatus({ address: 'Calle 1', whatsapp: '3001234567' }).complete).toBe(true)
  })
})

describe('hoursStatus', () => {
  it('sin horario', () => {
    expect(hoursStatus({ operatingHours: null, closures: [], todayKey: TODAY }))
      .toEqual({ text: 'Falta definir el horario', complete: false })
  })

  it('sin cierres muestra el resumen del horario', () => {
    expect(hoursStatus({ operatingHours: hours, closures: [], todayKey: TODAY }).text)
      .toBe('Lun–Sáb 9:00 a. m.–7:00 p. m.')
  })

  it('cuenta festivos y dice el próximo cierre', () => {
    const closures = [
      { date_from: '2026-11-02', date_to: '2026-11-02', kind: 'holiday' as const },
      { date_from: '2026-10-12', date_to: '2026-10-12', kind: 'holiday' as const },
    ]
    expect(hoursStatus({ operatingHours: hours, closures, todayKey: TODAY }).text)
      .toBe('Cierras 2 festivos · próximo cierre: 12 oct')
  })

  it('un solo festivo en singular y cierres propios sin festivos', () => {
    expect(hoursStatus({
      operatingHours: hours, todayKey: TODAY,
      closures: [{ date_from: '2026-10-12', date_to: '2026-10-12', kind: 'holiday' }],
    }).text).toBe('Cierras 1 festivo · próximo cierre: 12 oct')
    expect(hoursStatus({
      operatingHours: hours, todayKey: TODAY,
      closures: [{ date_from: '2026-12-20', date_to: '2027-01-05', kind: 'custom' }],
    }).text).toBe('Próximo cierre: 20 dic')
  })

  it('cierre en curso', () => {
    expect(hoursStatus({
      operatingHours: hours, todayKey: TODAY,
      closures: [{ date_from: '2026-09-28', date_to: '2026-10-05', kind: 'custom' }],
    }).text).toBe('Cerrado hasta el 5 oct')
  })

  it('ignora cierres ya terminados', () => {
    expect(hoursStatus({
      operatingHours: hours, todayKey: TODAY,
      closures: [{ date_from: '2026-09-01', date_to: '2026-09-10', kind: 'custom' }],
    }).text).toBe('Lun–Sáb 9:00 a. m.–7:00 p. m.')
  })
})

describe('bookingStatus', () => {
  it('intervalo y productos apartados', () => {
    expect(bookingStatus({ appointment_interval_minutes: 30, booking_products_enabled: true, booking_max_product_units: 2 }))
      .toBe('Cada 30 min · productos apartados: sí')
    expect(bookingStatus({ appointment_interval_minutes: 15, booking_products_enabled: false }))
      .toBe('Cada 15 min · productos apartados: no')
    expect(bookingStatus({ appointment_interval_minutes: 60, booking_products_enabled: true, booking_max_product_units: 0 }))
      .toBe('Cada 1 hora · productos apartados: no')
  })

  it('valores vacíos usan los predeterminados', () => {
    expect(bookingStatus({})).toBe('Cada 30 min · productos apartados: sí')
    expect(bookingStatus({ appointment_interval_minutes: 10 })).toBe('Cada 30 min · productos apartados: sí')
  })
})

describe('loyaltyStatus', () => {
  it('puntos, sellos o apagada', () => {
    expect(loyaltyStatus({ enabled: true, mode: 'points' })).toBe('Puntos')
    expect(loyaltyStatus({ enabled: true, mode: 'stamps' })).toBe('Sellos')
    expect(loyaltyStatus({ enabled: false, mode: 'stamps' })).toBe('Apagada')
  })
})

describe('workstationsStatus', () => {
  it('cuenta las estaciones activas', () => {
    expect(workstationsStatus(3)).toBe('3 estaciones activas')
    expect(workstationsStatus(1)).toBe('1 estación activa')
  })
  it('avisa si no hay ninguna', () => {
    expect(workstationsStatus(0)).toBe('Aún no hay estaciones')
    expect(workstationsStatus(null)).toBe('Aún no hay estaciones')
  })
})
