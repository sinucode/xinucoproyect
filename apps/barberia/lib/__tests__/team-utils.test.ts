import {
  SPECIALTY_OPTIONS,
  STAFF_STATUS_LABELS,
  formatHour,
  specialtyLabel,
  summarizeSchedule,
  validateWeeklySchedule,
} from '../team-utils'

const row = (day_of_week: number, start_time = '09:00', end_time = '19:00') => ({ day_of_week, start_time, end_time })

describe('SPECIALTY_OPTIONS / STAFF_STATUS_LABELS', () => {
  it('expone los cargos y estados esperados', () => {
    expect([...SPECIALTY_OPTIONS]).toEqual(['Barbero', 'Estilista', 'Manicurista', 'Colorista'])
    expect(STAFF_STATUS_LABELS).toEqual({
      free: 'Libre',
      busy: 'Atendiendo',
      break: 'En descanso',
      time_off: 'De permiso',
      off: 'Fuera de horario',
    })
  })
})

describe('specialtyLabel', () => {
  it('traduce alias sin importar mayúsculas ni espacios', () => {
    expect(specialtyLabel('barber')).toBe('Barbero')
    expect(specialtyLabel('  BARBERO ')).toBe('Barbero')
    expect(specialtyLabel('Stylist')).toBe('Estilista')
    expect(specialtyLabel('estilista')).toBe('Estilista')
    expect(specialtyLabel('manicurist')).toBe('Manicurista')
    expect(specialtyLabel('Manicurista')).toBe('Manicurista')
    expect(specialtyLabel('colorist')).toBe('Colorista')
    expect(specialtyLabel('COLORISTA')).toBe('Colorista')
  })
  it('deja otros cargos tal cual (recortados)', () => {
    expect(specialtyLabel('  Master Barber ')).toBe('Master Barber')
  })
  it('vacío → Profesional', () => {
    expect(specialtyLabel('')).toBe('Profesional')
    expect(specialtyLabel('   ')).toBe('Profesional')
    expect(specialtyLabel(null)).toBe('Profesional')
    expect(specialtyLabel(undefined)).toBe('Profesional')
  })
})

describe('formatHour', () => {
  it('quita ceros a la izquierda y segundos', () => {
    expect(formatHour('09:00')).toBe('9:00')
    expect(formatHour('09:00:00')).toBe('9:00')
    expect(formatHour('19:30')).toBe('19:30')
    expect(formatHour('00:05:00')).toBe('0:05')
  })
})

describe('summarizeSchedule', () => {
  it('vacío → Sin horario', () => {
    expect(summarizeSchedule([])).toBe('Sin horario')
  })
  it('agrupa días consecutivos con las mismas horas', () => {
    expect(summarizeSchedule([1, 2, 3, 4, 5, 6].map(d => row(d)))).toBe('Lun–Sáb 9:00–19:00')
  })
  it('un día suelto y grupos separados por " · "', () => {
    const rows = [...[1, 2, 3, 4, 5, 6].map(d => row(d)), row(0, '10:00:00', '14:00:00')]
    expect(summarizeSchedule(rows)).toBe('Lun–Sáb 9:00–19:00 · Dom 10:00–14:00')
  })
  it('el domingo (0) va al final y se agrupa con el sábado si coincide', () => {
    expect(summarizeSchedule([row(0), row(6), row(5)])).toBe('Vie–Dom 9:00–19:00')
  })
  it('no agrupa días no consecutivos aunque tengan las mismas horas', () => {
    expect(summarizeSchedule([row(1), row(3)])).toBe('Lun 9:00–19:00 · Mié 9:00–19:00')
  })
  it('cambio de horas parte el grupo', () => {
    expect(summarizeSchedule([row(1), row(2), row(3, '10:00', '18:00')])).toBe('Lun–Mar 9:00–19:00 · Mié 10:00–18:00')
  })
  it('con varias filas por día usa la primera entrada y la última salida', () => {
    expect(summarizeSchedule([row(1, '13:00', '19:00'), row(1, '09:00', '12:00')])).toBe('Lun 9:00–19:00')
  })
  it('un solo día', () => {
    expect(summarizeSchedule([row(0, '10:00', '14:00')])).toBe('Dom 10:00–14:00')
  })
})

describe('validateWeeklySchedule', () => {
  it('acepta un horario válido y vacío', () => {
    expect(validateWeeklySchedule([])).toBeNull()
    expect(validateWeeklySchedule([row(1), row(2, '09:00:00', '18:30:00')])).toBeNull()
  })
  it('rechaza días fuera de rango', () => {
    expect(validateWeeklySchedule([row(7)])).toMatch(/inválido/)
    expect(validateWeeklySchedule([row(-1)])).toMatch(/inválido/)
    expect(validateWeeklySchedule([row(1.5)])).toMatch(/inválido/)
  })
  it('rechaza días duplicados', () => {
    expect(validateWeeklySchedule([row(2), row(2)])).toBe('Martes: el día está repetido.')
  })
  it('rechaza horas mal formadas', () => {
    expect(validateWeeklySchedule([row(3, '9:00', '18:00')])).toBe('Miércoles: la hora no es válida.')
    expect(validateWeeklySchedule([row(3, '09:00', '24:00')])).toBe('Miércoles: la hora no es válida.')
    expect(validateWeeklySchedule([row(3, '09:60', '18:00')])).toBe('Miércoles: la hora no es válida.')
  })
  it('exige salida posterior a la entrada', () => {
    expect(validateWeeklySchedule([row(1, '18:00', '09:00')])).toBe(
      'Lunes: la hora de salida debe ser posterior a la de entrada.',
    )
    expect(validateWeeklySchedule([row(0, '10:00', '10:00:30')])).toBe(
      'Domingo: la hora de salida debe ser posterior a la de entrada.',
    )
  })
})
