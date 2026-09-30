import {
  SPECIALTY_OPTIONS,
  STAFF_STATUS_LABELS,
  WEEK_DAYS,
  applyQuickSchedule,
  formatHour,
  maskEmail,
  mostCommonSchedule,
  normalizeStaffEmail,
  normalizeStaffPhone,
  scheduleRowsToState,
  specialtyLabel,
  stateToScheduleRows,
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

describe('scheduleRowsToState / stateToScheduleRows', () => {
  it('devuelve los 7 días; los que no tienen filas descansan', () => {
    const state = scheduleRowsToState([row(1, '09:00:00', '18:00:00')])
    expect(Object.keys(state)).toHaveLength(7)
    expect(state[1]).toEqual({ isWorking: true, start_time: '09:00', end_time: '18:00' })
    expect(state[0].isWorking).toBe(false)
    expect(state[3]).toEqual({ isWorking: false, start_time: '09:00', end_time: '19:00' })
  })

  it('con varias filas un día usa la entrada más temprana y la salida más tardía', () => {
    const state = scheduleRowsToState([row(2, '13:00', '19:00'), row(2, '09:00', '12:00')])
    expect(state[2]).toEqual({ isWorking: true, start_time: '09:00', end_time: '19:00' })
  })

  it('acepta null/undefined como sin horario', () => {
    expect(stateToScheduleRows(scheduleRowsToState(null))).toEqual([])
    expect(stateToScheduleRows(scheduleRowsToState(undefined))).toEqual([])
  })

  it('stateToScheduleRows: solo días que trabaja, lunes primero', () => {
    const state = scheduleRowsToState([row(0, '10:00', '14:00'), row(6), row(1)])
    expect(stateToScheduleRows(state)).toEqual([row(1), row(6), row(0, '10:00', '14:00')])
  })

  it('ida y vuelta conserva el horario', () => {
    const rows = [row(1), row(2, '10:00', '17:00'), row(0, '10:00', '14:00')]
    expect(stateToScheduleRows(scheduleRowsToState(rows))).toEqual([row(1), row(2, '10:00', '17:00'), row(0, '10:00', '14:00')])
  })

  it('WEEK_DAYS va de lunes a domingo', () => {
    expect(WEEK_DAYS.map(d => d.index)).toEqual([1, 2, 3, 4, 5, 6, 0])
  })
})

describe('applyQuickSchedule', () => {
  it('los días elegidos trabajan con esas horas y los demás descansan', () => {
    const start = scheduleRowsToState([row(0, '10:00', '14:00'), row(3, '08:00', '12:00')])
    const next = applyQuickSchedule(start, [1, 2, 3, 4, 5], '09:00', '19:00')
    expect(stateToScheduleRows(next)).toEqual([1, 2, 3, 4, 5].map(d => row(d, '09:00', '19:00')))
    expect(next[0].isWorking).toBe(false)
    expect(next[6].isWorking).toBe(false)
  })

  it('no muta el estado original', () => {
    const start = scheduleRowsToState([row(0, '10:00', '14:00')])
    const snapshot = JSON.parse(JSON.stringify(start))
    applyQuickSchedule(start, [1], '09:00', '19:00')
    expect(start).toEqual(snapshot)
  })

  it('sin días elegidos deja todo en descanso', () => {
    const next = applyQuickSchedule(scheduleRowsToState([row(1)]), [], '09:00', '19:00')
    expect(stateToScheduleRows(next)).toEqual([])
  })

  it('el resultado valida y se resume como Lun–Sáb', () => {
    const next = applyQuickSchedule(scheduleRowsToState([]), [1, 2, 3, 4, 5, 6], '09:00', '19:00')
    const rows = stateToScheduleRows(next)
    expect(validateWeeklySchedule(rows)).toBeNull()
    expect(summarizeSchedule(rows)).toBe('Lun–Sáb 9:00–19:00')
  })
})

describe('mostCommonSchedule', () => {
  const weekdays = (start: string, end: string) => [1, 2, 3, 4, 5].map(d => row(d, start, end))

  it('elige el horario más repetido entre activos', () => {
    const members = [
      { is_active: true, schedules: weekdays('09:00', '18:00') },
      { is_active: true, schedules: weekdays('10:00', '20:00') },
      { is_active: true, schedules: weekdays('10:00:00', '20:00:00') },
    ]
    expect(mostCommonSchedule(members)).toEqual(members[1].schedules)
  })

  it('ignora inactivos y quienes no tienen horario', () => {
    const members = [
      { is_active: false, schedules: weekdays('08:00', '12:00') },
      { is_active: false, schedules: weekdays('08:00', '12:00') },
      { is_active: true, schedules: [] },
      { is_active: true, schedules: weekdays('09:00', '18:00') },
    ]
    expect(mostCommonSchedule(members)).toEqual(members[3].schedules)
  })

  it('devuelve null si nadie tiene horario', () => {
    expect(mostCommonSchedule([])).toBeNull()
    expect(mostCommonSchedule([{ is_active: true, schedules: [] }])).toBeNull()
  })
})

describe('contacto del profesional', () => {
  it('normalizeStaffEmail: vacío es null, recorta y valida el formato', () => {
    expect(normalizeStaffEmail(undefined)).toEqual({ value: null })
    expect(normalizeStaffEmail(null)).toEqual({ value: null })
    expect(normalizeStaffEmail('   ')).toEqual({ value: null })
    expect(normalizeStaffEmail(' carlos@gmail.com ')).toEqual({ value: 'carlos@gmail.com' })
    expect('error' in normalizeStaffEmail('carlos@gmail')).toBe(true)
    expect('error' in normalizeStaffEmail('car los@gmail.com')).toBe(true)
    expect('error' in normalizeStaffEmail(`${'a'.repeat(250)}@x.com`)).toBe(true)
    expect('error' in normalizeStaffEmail(123)).toBe(true)
  })

  it('normalizeStaffPhone: quita separadores, conserva el + inicial y valida los dígitos', () => {
    expect(normalizeStaffPhone('')).toEqual({ value: null })
    expect(normalizeStaffPhone(' 300 123-4567 ')).toEqual({ value: '3001234567' })
    expect(normalizeStaffPhone('+57 (300) 123 4567')).toEqual({ value: '+573001234567' })
    expect('error' in normalizeStaffPhone('12345')).toBe(true)
    expect('error' in normalizeStaffPhone('300abc4567')).toBe(true)
    expect('error' in normalizeStaffPhone('3001234567890123')).toBe(true)
    expect('error' in normalizeStaffPhone('30+0123456')).toBe(true)
  })

  it('maskEmail nunca muestra el correo completo', () => {
    expect(maskEmail('carlos@gmail.com')).toBe('c***s@gmail.com')
    expect(maskEmail('ab@x.co')).toBe('a***@x.co')
    expect(maskEmail('a@x.co')).toBe('a***@x.co')
    expect(maskEmail('sin-arroba')).toBe('***')
  })
})
