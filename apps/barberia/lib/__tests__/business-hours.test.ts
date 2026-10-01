import {
  formatHour12,
  hasOperatingHours,
  NO_OPEN_DAY_ERROR,
  operatingHoursToRows,
  operatingHoursToState,
  operatingHoursToStaffRows,
  stateToOperatingHours,
  summarizeOperatingHours,
  validateOperatingHours,
} from '../business-hours'

const day = (is_open: boolean, open_time = '09:00', close_time = '19:00') => ({ is_open, open_time, close_time })
const week = (overrides: Record<string, ReturnType<typeof day>> = {}) => ({
  monday: day(true), tuesday: day(true), wednesday: day(true), thursday: day(true),
  friday: day(true), saturday: day(true), sunday: day(false),
  ...overrides,
})

describe('operatingHoursToRows', () => {
  it('convierte solo los días abiertos al formato de Equipo (0 = domingo)', () => {
    const rows = operatingHoursToRows(week({ sunday: day(true, '10:00', '14:00') }))!
    expect(rows).toHaveLength(7)
    expect(rows.find(r => r.day_of_week === 1)).toEqual({ day_of_week: 1, start_time: '09:00', end_time: '19:00' })
    expect(rows.find(r => r.day_of_week === 0)).toEqual({ day_of_week: 0, start_time: '10:00', end_time: '14:00' })
  })

  it('omite días cerrados o mal formados', () => {
    const rows = operatingHoursToRows(week({ saturday: day(false), tuesday: { is_open: true } as never }))!
    expect(rows.map(r => r.day_of_week).sort()).toEqual([1, 3, 4, 5])
  })

  it('null, vacío o con otra forma → null (horario no definido)', () => {
    expect(operatingHoursToRows(null)).toBeNull()
    expect(operatingHoursToRows(undefined)).toBeNull()
    expect(operatingHoursToRows({})).toBeNull()
    expect(operatingHoursToRows([])).toBeNull()
    expect(operatingHoursToRows('x')).toBeNull()
  })
})

describe('hasOperatingHours / operatingHoursToStaffRows', () => {
  it('requiere al menos un día abierto', () => {
    expect(hasOperatingHours(week())).toBe(true)
    expect(hasOperatingHours(null)).toBe(false)
    expect(hasOperatingHours({ monday: day(false) })).toBe(false)
    expect(operatingHoursToStaffRows(null)).toBeNull()
    expect(operatingHoursToStaffRows(week())).toHaveLength(6)
  })
})

describe('operatingHoursToState / stateToOperatingHours', () => {
  it('sin horario arranca Lun–Sáb 9:00–19:00', () => {
    const state = operatingHoursToState(null)
    expect(state[1]).toEqual({ isWorking: true, start_time: '09:00', end_time: '19:00' })
    expect(state[6].isWorking).toBe(true)
    expect(state[0].isWorking).toBe(false)
  })

  it('ida y vuelta conserva el horario', () => {
    const original = week({ saturday: day(true, '09:00', '14:00'), sunday: day(false) })
    const back = stateToOperatingHours(operatingHoursToState(original))
    expect(back.saturday).toEqual(day(true, '09:00', '14:00'))
    expect(back.monday.is_open).toBe(true)
    expect(back.sunday.is_open).toBe(false)
    expect(Object.keys(back)).toHaveLength(7)
  })
})

describe('validateOperatingHours', () => {
  it('acepta un horario válido', () => {
    const r = validateOperatingHours(week())
    expect(r.ok).toBe(true)
  })

  it('rechaza formas inválidas', () => {
    expect(validateOperatingHours(null).ok).toBe(false)
    expect(validateOperatingHours({ monday: day(true) }).ok).toBe(false)
    expect(validateOperatingHours({ ...week(), monday: { is_open: 'yes', open_time: '09:00', close_time: '19:00' } }).ok).toBe(false)
  })

  it('exige al menos un día abierto', () => {
    const closed = week({
      monday: day(false), tuesday: day(false), wednesday: day(false), thursday: day(false),
      friday: day(false), saturday: day(false), sunday: day(false),
    })
    expect(validateOperatingHours(closed)).toEqual({ ok: false, error: NO_OPEN_DAY_ERROR })
  })

  it('rechaza salida antes de la entrada o horas inválidas en días abiertos', () => {
    expect(validateOperatingHours(week({ monday: day(true, '19:00', '09:00') })).ok).toBe(false)
    expect(validateOperatingHours(week({ monday: day(true, '25:00', '26:00') })).ok).toBe(false)
  })

  it('no valida las horas de los días cerrados', () => {
    expect(validateOperatingHours(week({ sunday: day(false, '19:00', '09:00') })).ok).toBe(true)
  })
})

describe('formatHour12 / summarizeOperatingHours', () => {
  it('formatea en 12 horas', () => {
    expect(formatHour12('09:00')).toBe('9:00 a. m.')
    expect(formatHour12('19:30')).toBe('7:30 p. m.')
    expect(formatHour12('12:00')).toBe('12:00 p. m.')
    expect(formatHour12('00:15')).toBe('12:15 a. m.')
  })

  it('resume el horario agrupando días', () => {
    expect(summarizeOperatingHours(week())).toBe('Lun–Sáb 9:00 a. m.–7:00 p. m.')
    expect(summarizeOperatingHours(week({ sunday: day(true, '10:00', '14:00') })))
      .toBe('Lun–Sáb 9:00 a. m.–7:00 p. m. · Dom 10:00 a. m.–2:00 p. m.')
  })

  it('sin horario → null', () => {
    expect(summarizeOperatingHours(null)).toBeNull()
    expect(summarizeOperatingHours({})).toBeNull()
  })
})
