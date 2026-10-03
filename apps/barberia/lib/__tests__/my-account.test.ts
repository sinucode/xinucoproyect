import {
  activeQuickRange,
  dayHeaderLabel,
  dayTotals,
  groupEntriesByDay,
  lastPayout,
  lastPayoutLabel,
  monthStartKey,
  periodEarnings,
  previousMonthRange,
  quickRange,
  signedMoney,
  weekStartKey,
  type AccountEntryLike,
} from '../my-account'

// 2026-10-02 es viernes; el 1 de octubre fue jueves.
const TODAY = '2026-10-02'

/** Instante real a partir de una hora local de Colombia (UTC−5 fijo). */
const bogota = (date: string, hhmm: string) => `${date}T${hhmm}:00-05:00`

const entry = (
  entry_type: AccountEntryLike['entry_type'],
  amount: number,
  created_at: string,
): AccountEntryLike => ({ entry_type, amount, created_at })

describe('períodos', () => {
  it('semana: lunes de la semana de cualquier día', () => {
    expect(weekStartKey('2026-10-02')).toBe('2026-09-28') // viernes → lunes
    expect(weekStartKey('2026-09-28')).toBe('2026-09-28') // lunes
    expect(weekStartKey('2026-10-04')).toBe('2026-09-28') // domingo cuenta en la semana que termina
    expect(weekStartKey('2026-10-05')).toBe('2026-10-05')
  })

  it('mes y mes pasado', () => {
    expect(monthStartKey('2026-10-02')).toBe('2026-10-01')
    expect(previousMonthRange('2026-10-02')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(previousMonthRange('2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(previousMonthRange('2027-01-10')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })

  it('rangos rápidos y chip activo', () => {
    expect(quickRange('today', TODAY)).toEqual({ from: TODAY, to: TODAY })
    expect(quickRange('week', TODAY)).toEqual({ from: '2026-09-28', to: TODAY })
    expect(quickRange('month', TODAY)).toEqual({ from: '2026-10-01', to: TODAY })
    expect(quickRange('lastMonth', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' })

    expect(activeQuickRange('2026-10-01', TODAY, TODAY)).toBe('month')
    expect(activeQuickRange('2026-09-01', '2026-09-30', TODAY)).toBe('lastMonth')
    expect(activeQuickRange('2026-09-15', TODAY, TODAY)).toBeNull()
    expect(activeQuickRange('', '', TODAY)).toBeNull()
  })
})

describe('periodEarnings', () => {
  const entries: AccountEntryLike[] = [
    entry('commission', 10000, bogota('2026-10-02', '09:30')), // hoy
    entry('tip', 2000, bogota('2026-10-02', '10:00')),         // hoy
    entry('commission', 8000, bogota('2026-10-01', '16:00')),  // jueves: semana y mes
    entry('commission', 5000, bogota('2026-09-29', '11:00')),  // martes: semana, no mes
    entry('commission', 7000, bogota('2026-09-20', '11:00')),  // mes pasado
    entry('bonus', 50000, bogota('2026-10-02', '08:00')),      // bonos no cuentan
    entry('advance', 30000, bogota('2026-10-02', '08:30')),    // anticipos no cuentan
    entry('payment', 99000, bogota('2026-10-02', '08:45')),    // pagos no cuentan
  ]

  it('suma comisiones + propinas por período', () => {
    expect(periodEarnings(entries, TODAY)).toEqual({ today: 12000, week: 25000, month: 20000 })
  })

  it('usa el día local de Colombia, no el UTC', () => {
    // 2026-10-03T03:00Z = 2 oct 22:00 en Bogotá → cuenta como hoy
    const lateNight = [entry('commission', 4000, '2026-10-03T03:00:00Z')]
    expect(periodEarnings(lateNight, TODAY).today).toBe(4000)
    // 2026-10-02T04:00Z = 1 oct 23:00 en Bogotá → NO es hoy (es ayer)
    const justBefore = [entry('commission', 4000, '2026-10-02T04:00:00Z')]
    expect(periodEarnings(justBefore, TODAY)).toEqual({ today: 0, week: 4000, month: 4000 })
  })

  it('sin movimientos todo es 0', () => {
    expect(periodEarnings([], TODAY)).toEqual({ today: 0, week: 0, month: 0 })
  })
})

describe('último pago', () => {
  it('toma el pago más reciente (ignora anticipos)', () => {
    const entries = [
      entry('payment', 700000, bogota('2026-08-30', '17:00')),
      entry('payment', 850000, bogota('2026-09-15', '17:00')),
      entry('advance', 100000, bogota('2026-09-20', '17:00')),
    ]
    const last = lastPayout(entries)
    expect(last).toMatchObject({ dateKey: '2026-09-15', amount: 850000 })
    expect(lastPayoutLabel(last)).toBe('Último pago: 15 sept · $850.000')
  })

  it('sin pagos', () => {
    expect(lastPayout([entry('commission', 1000, bogota('2026-09-15', '10:00'))])).toBeNull()
    expect(lastPayoutLabel(null)).toBe('Aún no te han pagado')
  })
})

describe('historial por día', () => {
  const entries = [
    entry('commission', 15800, bogota('2026-10-01', '18:00')),
    entry('tip', 10000, bogota('2026-10-01', '12:00')),
    entry('commission', 6000, bogota('2026-09-30', '20:00')),
    entry('advance', 20000, bogota('2026-09-30', '09:00')),
    entry('payment', 850000, bogota('2026-09-15', '17:00')),
  ]

  it('total neto con signo por día', () => {
    expect(dayTotals(entries)).toEqual({
      '2026-10-01': 25800,
      '2026-09-30': -14000,
      '2026-09-15': -850000,
    })
  })

  it('respeta tipo y rango (los mismos filtros del historial)', () => {
    expect(dayTotals(entries, { type: 'commission' })).toEqual({
      '2026-10-01': 15800, '2026-09-30': 6000,
    })
    expect(dayTotals(entries, { from: '2026-09-30', to: '2026-09-30' })).toEqual({ '2026-09-30': -14000 })
  })

  it('agrupa por día local conservando el orden', () => {
    const rows = entries.map((e, i) => ({ ...e, id: String(i) }))
    const groups = groupEntriesByDay(rows)
    expect(groups.map(g => [g.dateKey, g.items.length])).toEqual([
      ['2026-10-01', 2], ['2026-09-30', 2], ['2026-09-15', 1],
    ])
  })

  it('un movimiento tarde en la noche UTC cae en su día de Colombia', () => {
    // 2026-10-02T02:00Z = 1 oct 21:00 Bogotá
    const groups = groupEntriesByDay([{ created_at: '2026-10-02T02:00:00Z' }])
    expect(groups[0].dateKey).toBe('2026-10-01')
  })

  it('encabezado "Jueves 1 oct · +$25.800"', () => {
    expect(dayHeaderLabel('2026-10-01')).toBe('Jueves 1 oct')
    expect(dayHeaderLabel('2026-10-02', TODAY)).toBe('Hoy, viernes 2 oct')
    expect(`${dayHeaderLabel('2026-10-01')} · ${signedMoney(25800)}`).toBe('Jueves 1 oct · +$25.800')
  })

  it('signedMoney', () => {
    expect(signedMoney(25800)).toBe('+$25.800')
    expect(signedMoney(-14000)).toBe('−$14.000')
    expect(signedMoney(0)).toBe('$0')
  })
})
