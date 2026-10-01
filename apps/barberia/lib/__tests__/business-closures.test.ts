import {
  addDaysKey,
  appointmentsRangeWarning,
  appointmentsWarning,
  closureCoveringDate,
  closureErrorMessage,
  closureNotices,
  closureRangeLabel,
  dayMonthLabel,
  daysBetween,
  shortDateLabel,
  validateClosureInput,
} from '../business-closures'

const TODAY = '2026-09-30'

describe('etiquetas de fecha', () => {
  it('shortDateLabel / dayMonthLabel / closureRangeLabel', () => {
    expect(shortDateLabel('2026-10-12')).toBe('lun 12 oct')
    expect(dayMonthLabel('2026-10-12')).toBe('12 oct')
    expect(closureRangeLabel('2026-10-12', '2026-10-12')).toBe('lun 12 oct')
    expect(closureRangeLabel('2026-10-12', '2026-10-16')).toBe('lun 12 oct al vie 16 oct')
  })

  it('daysBetween / addDaysKey', () => {
    expect(daysBetween('2026-09-30', '2026-10-02')).toBe(2)
    expect(addDaysKey('2026-12-30', 3)).toBe('2027-01-02')
  })
})

describe('validateClosureInput', () => {
  const ok = { date_from: '2026-10-12', date_to: '2026-10-14', reason: 'Vacaciones' }

  it('acepta un cierre válido', () => {
    expect(validateClosureInput(ok, TODAY)).toBeNull()
    expect(validateClosureInput({ ...ok, date_from: TODAY, date_to: TODAY }, TODAY)).toBeNull()
  })

  it('rechaza fechas faltantes o con mal formato', () => {
    expect(validateClosureInput({ ...ok, date_from: '' }, TODAY)).toMatch(/fechas/)
    expect(validateClosureInput({ ...ok, date_to: '12/10/2026' }, TODAY)).toMatch(/fechas/)
  })

  it('rechaza rango al revés, pasado y de más de 60 días', () => {
    expect(validateClosureInput({ ...ok, date_to: '2026-10-10' }, TODAY)).toMatch(/anterior/)
    expect(validateClosureInput({ ...ok, date_from: '2026-09-29', date_to: '2026-09-29' }, TODAY)).toMatch(/pasaron/)
    expect(validateClosureInput({ ...ok, date_from: '2026-10-01', date_to: '2026-11-30' }, TODAY)).toBeNull() // 60 días
    expect(validateClosureInput({ ...ok, date_from: '2026-10-01', date_to: '2026-12-01' }, TODAY)).toMatch(/60 días/)
  })

  it('exige motivo de 2 a 80 caracteres', () => {
    expect(validateClosureInput({ ...ok, reason: ' a ' }, TODAY)).toMatch(/motivo/)
    expect(validateClosureInput({ ...ok, reason: 'x'.repeat(81) }, TODAY)).toMatch(/80/)
  })
})

describe('closureErrorMessage', () => {
  it('traduce los errores de la base', () => {
    expect(closureErrorMessage('forbidden')).toMatch(/administrador/)
    expect(closureErrorMessage('invalid_range')).toMatch(/60 días/)
    expect(closureErrorMessage('past_date')).toMatch(/pasaron/)
    expect(closureErrorMessage('reason_required')).toMatch(/motivo/)
    expect(closureErrorMessage('overlaps')).toMatch(/cruzan/)
    expect(closureErrorMessage('not_found')).toMatch(/ya no existe/)
    expect(closureErrorMessage('boom')).toMatch(/No se pudo guardar/)
    expect(closureErrorMessage(null)).toMatch(/No se pudo guardar/)
  })
})

describe('closureCoveringDate', () => {
  const list = [
    { date_from: '2026-10-12', date_to: '2026-10-12', reason: 'Día de la Raza', kind: 'holiday' as const },
    { date_from: '2026-12-20', date_to: '2027-01-05', reason: 'Vacaciones', kind: 'custom' as const },
  ]
  it('encuentra el cierre que cubre la fecha', () => {
    expect(closureCoveringDate(list, '2026-10-12')?.reason).toBe('Día de la Raza')
    expect(closureCoveringDate(list, '2026-12-31')?.reason).toBe('Vacaciones')
    expect(closureCoveringDate(list, '2026-10-13')).toBeNull()
  })
})

describe('closureNotices', () => {
  it('avisa de un cierre dentro de 14 días', () => {
    expect(closureNotices([{ from: '2026-10-12', to: '2026-10-12', reason: 'Día de la Raza' }], '2026-10-05'))
      .toEqual(['Cerrado el lun 12 oct · Día de la Raza'])
  })

  it('ignora cierres lejanos o ya terminados', () => {
    expect(closureNotices([{ from: '2026-10-20', to: '2026-10-20', reason: 'x' }], '2026-09-30')).toEqual([])
    expect(closureNotices([{ from: '2026-09-01', to: '2026-09-10', reason: 'x' }], '2026-09-30')).toEqual([])
  })

  it('rangos y cierres en curso', () => {
    expect(closureNotices([{ from: '2026-10-05', to: '2026-10-09', reason: 'Vacaciones' }], '2026-10-01'))
      .toEqual(['Cerrado del lun 5 oct al vie 9 oct · Vacaciones'])
    expect(closureNotices([{ from: '2026-10-01', to: '2026-10-09', reason: 'Remodelación' }], '2026-10-05'))
      .toEqual(['Cerrado hasta el vie 9 oct · Remodelación'])
    expect(closureNotices([{ from: '2026-10-05', to: '2026-10-05', reason: 'Festivo' }], '2026-10-05'))
      .toEqual(['Hoy estamos cerrados · Festivo'])
  })

  it('entradas nulas o mal formadas → vacío', () => {
    expect(closureNotices(null, TODAY)).toEqual([])
    expect(closureNotices([{ from: 'x', to: 'y', reason: '' }], TODAY)).toEqual([])
  })

  it('limita la cantidad y ordena por fecha', () => {
    const many = ['2026-10-09', '2026-10-06', '2026-10-07', '2026-10-08'].map(d => ({ from: d, to: d, reason: 'r' }))
    const out = closureNotices(many, '2026-10-01')
    expect(out).toHaveLength(3)
    expect(out[0]).toContain('6 oct')
  })
})

describe('avisos de citas', () => {
  it('singular, plural y cero', () => {
    expect(appointmentsWarning(0)).toBeNull()
    expect(appointmentsWarning(1)).toBe('Ya hay 1 cita ese día: reprográmala en la Agenda.')
    expect(appointmentsWarning(3)).toBe('Ya hay 3 citas ese día: reprográmalas en la Agenda.')
    expect(appointmentsRangeWarning(2)).toBe('Ya hay 2 citas en esas fechas: reprográmalas en la Agenda.')
    expect(appointmentsRangeWarning(0)).toBeNull()
  })
})
