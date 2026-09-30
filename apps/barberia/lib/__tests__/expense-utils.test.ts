import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  categoryLabel,
  paymentMethodLabel,
  monthRange,
  shiftMonth,
  currentMonthKey,
  isValidMonthKey,
  pendingRecurring,
} from '../expense-utils'

const exp = (
  category: string,
  description: string,
  expense_date: string,
  extra: Record<string, unknown> = {},
) => ({ category, description, amount: 100000, expense_date, is_recurring: true, ...extra })

describe('categorías y medios de pago', () => {
  it('mantiene el orden y las etiquetas', () => {
    expect(EXPENSE_CATEGORIES.map(c => c.value)).toEqual([
      'rent', 'utilities', 'supplies', 'salary', 'maintenance', 'marketing', 'taxes', 'other',
    ])
    expect(categoryLabel('rent')).toBe('Arriendo')
    expect(categoryLabel('taxes')).toBe('Impuestos y trámites')
  })

  it('categoría desconocida devuelve el valor', () => {
    expect(categoryLabel('cosas')).toBe('cosas')
  })

  it('etiquetas de medios de pago', () => {
    expect(PAYMENT_METHODS.map(m => m.value)).toEqual(['cash_register', 'transfer', 'card', 'other'])
    expect(paymentMethodLabel('cash_register')).toBe('Efectivo de la caja')
    expect(paymentMethodLabel('card')).toBe('Tarjeta')
  })
})

describe('monthRange / shiftMonth', () => {
  it('rango de septiembre 2026', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30', label: 'Septiembre de 2026' })
  })

  it('febrero bisiesto y no bisiesto', () => {
    expect(monthRange('2028-02').to).toBe('2028-02-29')
    expect(monthRange('2027-02').to).toBe('2027-02-28')
  })

  it('diciembre termina el 31', () => {
    expect(monthRange('2026-12')).toMatchObject({ to: '2026-12-31', label: 'Diciembre de 2026' })
  })

  it('shiftMonth cruza años', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-09', -9)).toBe('2025-12')
    expect(shiftMonth('2026-09', 0)).toBe('2026-09')
  })

  it('isValidMonthKey', () => {
    expect(isValidMonthKey('2026-09')).toBe(true)
    expect(isValidMonthKey('2026-13')).toBe(false)
    expect(isValidMonthKey('2026-9')).toBe(false)
    expect(isValidMonthKey(undefined)).toBe(false)
  })

  it('currentMonthKey usa la fecha del negocio (America/Bogota)', () => {
    jest.useFakeTimers()
    // 2026-10-01 03:00 UTC = 2026-09-30 22:00 en Bogotá → sigue siendo septiembre
    jest.setSystemTime(new Date('2026-10-01T03:00:00Z'))
    expect(currentMonthKey()).toBe('2026-09')
    jest.useRealTimers()
  })
})

describe('pendingRecurring', () => {
  it('toma la plantilla más reciente y sugiere el mismo día del mes', () => {
    const history = [
      exp('rent', 'Arriendo local', '2026-07-05', { amount: 1000000 }),
      exp('rent', 'Arriendo local', '2026-08-05', { amount: 1200000 }),
    ]
    const res = pendingRecurring(history, [], '2026-09')
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({
      category: 'rent', description: 'Arriendo local', amount: 1200000, suggested_date: '2026-09-05',
    })
  })

  it('no está pendiente si el mes ya tiene la misma categoría + descripción (normalizada)', () => {
    const history = [exp('rent', 'Arriendo local', '2026-08-05')]
    const month = [exp('rent', '  arriendo LOCAL ', '2026-09-03', { is_recurring: false })]
    expect(pendingRecurring(history, month, '2026-09')).toEqual([])
  })

  it('misma descripción con otra categoría sigue pendiente', () => {
    const history = [exp('rent', 'Local', '2026-08-05')]
    const month = [exp('other', 'Local', '2026-09-03')]
    expect(pendingRecurring(history, month, '2026-09')).toHaveLength(1)
  })

  it('ajusta el día al último día del mes', () => {
    const history = [exp('utilities', 'Internet', '2026-01-31')]
    expect(pendingRecurring(history, [], '2026-02')[0].suggested_date).toBe('2026-02-28')
  })

  it('ignora gastos no fijos y gastos del mes o posteriores', () => {
    const history = [
      exp('rent', 'A', '2026-08-05', { is_recurring: false }),
      exp('rent', 'B', '2026-09-02'),
      exp('rent', 'C', '2026-10-02'),
    ]
    expect(pendingRecurring(history, [], '2026-09')).toEqual([])
  })

  it('no sugiere fechas posteriores a hoy', () => {
    const history = [exp('rent', 'Arriendo', '2026-08-28')]
    expect(pendingRecurring(history, [], '2026-09', '2026-09-10')[0].suggested_date).toBe('2026-09-10')
  })

  it('nunca sugiere efectivo de la caja', () => {
    const history = [exp('rent', 'Arriendo', '2026-08-05', { payment_method: 'cash_register' })]
    expect(pendingRecurring(history, [], '2026-09')[0].payment_method).toBe('transfer')
    const card = [exp('rent', 'Arriendo', '2026-08-05', { payment_method: 'card' })]
    expect(pendingRecurring(card, [], '2026-09')[0].payment_method).toBe('card')
  })
})
