import { isApptOverdue, isUnresolvedPast, splitUnresolvedPast } from '../agenda-status'

// "Ahora" del negocio: 2026-10-02 14:00 (hora local como UTC)
const NOW = Date.parse('2026-10-02T14:00:00Z')

describe('isApptOverdue', () => {
  it('programada cuya hora (inicio + duración) ya pasó → atrasada', () => {
    expect(isApptOverdue({ status: 'scheduled', start_time: '2026-10-02T12:00:00Z', duration_minutes: 30 }, NOW)).toBe(true)
  })

  it('programada que aún está dentro de su espacio → no atrasada', () => {
    expect(isApptOverdue({ status: 'scheduled', start_time: '2026-10-02T13:45:00Z', duration_minutes: 30 }, NOW)).toBe(false)
  })

  it('justo en el minuto en que termina su espacio cuenta como atrasada', () => {
    expect(isApptOverdue({ status: 'scheduled', start_time: '2026-10-02T13:30:00Z', duration_minutes: 30 }, NOW)).toBe(true)
  })

  it('futura → no atrasada', () => {
    expect(isApptOverdue({ status: 'scheduled', start_time: '2026-10-02T15:00:00Z', duration_minutes: 30 }, NOW)).toBe(false)
  })

  it('solo las "programadas": en curso, lista para pagar, completada, etc. nunca', () => {
    for (const status of ['in_progress', 'ready_to_pay', 'completed', 'cancelled', 'no_show', 'payment_pending']) {
      expect(isApptOverdue({ status, start_time: '2026-10-02T09:00:00Z', duration_minutes: 30 }, NOW)).toBe(false)
    }
  })

  it('sin duración usa 30 min; sin fecha o fecha inválida no es atrasada', () => {
    expect(isApptOverdue({ status: 'scheduled', start_time: '2026-10-02T13:20:00Z' }, NOW)).toBe(true)
    expect(isApptOverdue({ status: 'scheduled', start_time: '2026-10-02T13:45:00Z', duration_minutes: null }, NOW)).toBe(false)
    expect(isApptOverdue({ status: 'scheduled', start_time: null }, NOW)).toBe(false)
    expect(isApptOverdue({ status: 'scheduled', start_time: 'no-es-fecha' }, NOW)).toBe(false)
  })

  it('una cita larga sigue en su espacio aunque haya empezado hace rato', () => {
    expect(isApptOverdue({ status: 'scheduled', start_time: '2026-10-02T12:30:00Z', duration_minutes: 120 }, NOW)).toBe(false)
  })
})

describe('splitUnresolvedPast ("Sin cerrar")', () => {
  const TODAY = '2026-10-02'
  const a = (id: string, status: string, start: string | null) => ({ id, status, start_time: start })

  it('separa las abiertas de días anteriores y conserva el orden', () => {
    const list = [
      a('1', 'scheduled', '2026-09-30T10:00:00Z'),
      a('2', 'completed', '2026-09-30T11:00:00Z'),
      a('3', 'in_progress', '2026-10-01T09:00:00Z'),
      a('4', 'ready_to_pay', '2026-10-01T10:00:00Z'),
      a('5', 'scheduled', '2026-10-02T08:00:00Z'), // hoy: no es "sin cerrar" (será "atrasada")
      a('6', 'scheduled', '2026-10-03T08:00:00Z'),
    ]
    const { unresolved, rest } = splitUnresolvedPast(list, TODAY)
    expect(unresolved.map((x) => x.id)).toEqual(['1', '3', '4'])
    expect(rest.map((x) => x.id)).toEqual(['2', '5', '6'])
  })

  it('canceladas, no asistió y pago pendiente de días pasados no entran al bloque', () => {
    const list = [
      a('1', 'cancelled', '2026-09-29T10:00:00Z'),
      a('2', 'no_show', '2026-09-29T11:00:00Z'),
      a('3', 'payment_pending', '2026-09-29T12:00:00Z'),
    ]
    expect(splitUnresolvedPast(list, TODAY).unresolved).toEqual([])
  })

  it('sin fecha nunca es "sin cerrar"', () => {
    expect(isUnresolvedPast(a('x', 'scheduled', null), TODAY)).toBe(false)
  })

  it('lista vacía', () => {
    expect(splitUnresolvedPast([], TODAY)).toEqual({ unresolved: [], rest: [] })
  })
})
