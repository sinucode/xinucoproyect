import {
  businessDayInstants,
  computeDaySummary,
  formatMinutesUntil,
  summarizeQueue,
  sumEarned,
  type SummaryAppt,
} from '../day-summary'

const NOW = Date.parse('2026-10-02T14:00:00Z') // 2:00 p. m. local del negocio
const appt = (id: string, status: string, hhmm: string, minutes = 30, name = 'Ana'): SummaryAppt => ({
  id,
  status,
  start_time: `2026-10-02T${hhmm}:00Z`,
  customer_name: name,
  service_name: 'Corte',
  duration_minutes: minutes,
})

describe('computeDaySummary', () => {
  it('cuenta total, atendidas y pendientes (ignora canceladas y no asistió)', () => {
    const s = computeDaySummary(
      [
        appt('1', 'completed', '09:00'),
        appt('2', 'ready_to_pay', '10:00'),
        appt('3', 'in_progress', '13:30'),
        appt('4', 'scheduled', '15:00'),
        appt('5', 'scheduled', '16:00'),
        appt('6', 'cancelled', '11:00'),
        appt('7', 'no_show', '12:00'),
      ],
      NOW,
    )
    expect(s.total).toBe(5)
    expect(s.attended).toBe(2)
    expect(s.pending).toBe(3)
  })

  it('la próxima cita es la programada más cercana que aún no pasó, con minutos de espera', () => {
    const s = computeDaySummary([appt('a', 'scheduled', '16:00', 30, 'Luis'), appt('b', 'scheduled', '14:25', 30, 'Ana')], NOW)
    expect(s.next?.appt.id).toBe('b')
    expect(s.next?.minutesUntil).toBe(25)
  })

  it('una cita que ya está en su hora (sin iniciar) cuenta como "ahora"', () => {
    const s = computeDaySummary([appt('a', 'scheduled', '13:50', 30)], NOW)
    expect(s.next?.appt.id).toBe('a')
    expect(s.next?.minutesUntil).toBe(0)
  })

  it('las atrasadas (su espacio ya terminó) no son la próxima', () => {
    const s = computeDaySummary([appt('a', 'scheduled', '12:00', 30), appt('b', 'scheduled', '17:00')], NOW)
    expect(s.next?.appt.id).toBe('b')
  })

  it('sin más citas → next null', () => {
    expect(computeDaySummary([appt('a', 'completed', '09:00'), appt('b', 'in_progress', '13:30')], NOW).next).toBeNull()
    expect(computeDaySummary([], NOW)).toEqual({ total: 0, attended: 0, pending: 0, next: null })
  })
})

describe('formatMinutesUntil', () => {
  it('formatea ahora / minutos / horas', () => {
    expect(formatMinutesUntil(0)).toBe('ahora')
    expect(formatMinutesUntil(-5)).toBe('ahora')
    expect(formatMinutesUntil(25)).toBe('en 25 min')
    expect(formatMinutesUntil(80)).toBe('en 1 h 20 min')
    expect(formatMinutesUntil(120)).toBe('en 2 h')
  })
})

describe('businessDayInstants', () => {
  it('delimita el día en America/Bogota (UTC-5) con instantes reales', () => {
    const { from, to } = businessDayInstants('2026-10-02')
    expect(from).toBe('2026-10-02T00:00:00-05:00')
    expect(to).toBe('2026-10-03T00:00:00-05:00')
    // 9:30 p. m. en Bogotá (02:30Z del día siguiente) sigue siendo "hoy"
    const late = Date.parse('2026-10-03T02:30:00Z')
    expect(late >= Date.parse(from) && late < Date.parse(to)).toBe(true)
    // 12:30 a. m. del día siguiente en Bogotá ya no
    expect(Date.parse('2026-10-03T05:30:00Z') < Date.parse(to)).toBe(false)
  })

  it('cruza fin de mes y de año', () => {
    expect(businessDayInstants('2026-12-31').to).toBe('2027-01-01T00:00:00-05:00')
    expect(businessDayInstants('2026-09-30').to).toBe('2026-10-01T00:00:00-05:00')
  })
})

describe('sumEarned', () => {
  it('suma solo comisión y propina', () => {
    expect(
      sumEarned([
        { entry_type: 'commission', amount: 12000 },
        { entry_type: 'tip', amount: 3000 },
        { entry_type: 'advance', amount: 50000 },
        { entry_type: 'bonus', amount: 9000 },
        { entry_type: 'deduction', amount: 1000 },
        { entry_type: 'commission', amount: 8000 },
      ]),
    ).toBe(23000)
  })

  it('vacío y montos nulos → 0', () => {
    expect(sumEarned([])).toBe(0)
    expect(sumEarned([{ entry_type: 'tip', amount: null }])).toBe(0)
  })
})

describe('summarizeQueue', () => {
  it('cuenta los que esperan y los que son del barbero', () => {
    const q = summarizeQueue(
      [
        { status: 'waiting', staff_id: 'me' },
        { status: 'waiting', staff_id: null },
        { status: 'waiting', staff_id: 'otro' },
        { status: 'in_progress', staff_id: 'me' },
        { status: 'completed', staff_id: 'me' },
      ],
      'me',
    )
    expect(q).toEqual({ waiting: 3, mine: 1 })
  })

  it('fila vacía', () => {
    expect(summarizeQueue([], 'me')).toEqual({ waiting: 0, mine: 0 })
  })
})
