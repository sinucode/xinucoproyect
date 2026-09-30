import {
  DEFAULT_EXPENSE_CATEGORIES,
  CATEGORY_PALETTE,
  PAYMENT_METHODS,
  categoryName,
  categoryBadgeClass,
  categoryBarColor,
  slugifyCategory,
  visibleCategories,
  isValidCategoryColor,
  paymentMethodLabel,
  monthRange,
  shiftMonth,
  currentMonthKey,
  isValidMonthKey,
  pendingRecurring,
  anchorDay,
} from '../expense-utils'

const exp = (
  category: string,
  description: string,
  expense_date: string,
  extra: Record<string, unknown> = {},
) => ({ category, description, amount: 100000, expense_date, is_recurring: true, ...extra })

describe('categorías', () => {
  it('las 8 por defecto conservan slug, nombre y orden', () => {
    expect(DEFAULT_EXPENSE_CATEGORIES.map(c => c.slug)).toEqual([
      'rent', 'utilities', 'supplies', 'salary', 'maintenance', 'marketing', 'taxes', 'other',
    ])
    expect(DEFAULT_EXPENSE_CATEGORIES.map(c => c.sort_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(DEFAULT_EXPENSE_CATEGORIES.every(c => isValidCategoryColor(c.color))).toBe(true)
    expect(categoryName('rent')).toBe('Arriendo')
    expect(categoryName('taxes')).toBe('Impuestos y trámites')
  })

  it('la paleta tiene entre 8 y 10 colores únicos', () => {
    const keys = CATEGORY_PALETTE.map(c => c.key)
    expect(keys.length).toBeGreaterThanOrEqual(8)
    expect(keys.length).toBeLessThanOrEqual(10)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('el nombre sale de la lista del negocio; slug por defecto → nombre por defecto; desconocido → slug', () => {
    const biz = [{ slug: 'rent', name: 'Alquiler' }, { slug: 'c_cafe', name: 'Café' }]
    expect(categoryName('rent', biz)).toBe('Alquiler')
    expect(categoryName('c_cafe', biz)).toBe('Café')
    expect(categoryName('utilities', biz)).toBe('Servicios públicos')
    expect(categoryName('cosas', biz)).toBe('cosas')
    expect(categoryName('cosas')).toBe('cosas')
  })

  it('colores: el de la categoría, el del slug por defecto o gris', () => {
    const biz = [{ slug: 'c_cafe', name: 'Café', color: 'red' }, { slug: 'c_x', name: 'X', color: 'nope' }]
    expect(categoryBarColor('c_cafe', biz)).toBe('#f87171')
    expect(categoryBadgeClass('c_cafe', biz)).toContain('text-red-400')
    expect(categoryBarColor('rent')).toBe('#60a5fa')
    expect(categoryBarColor('c_x', biz)).toBe('#a1a1aa')
    expect(categoryBarColor('desconocida')).toBe('#a1a1aa')
  })

  it('visibleCategories descarta las ocultas', () => {
    const list = [{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B', is_hidden: true }, { slug: 'c', name: 'C', is_hidden: false }]
    expect(visibleCategories(list).map(c => c.slug)).toEqual(['a', 'c'])
  })
})

describe('slugifyCategory', () => {
  it('minúsculas, sin tildes, no alfanumérico → _, prefijo c_', () => {
    expect(slugifyCategory('Café y Bebidas')).toBe('c_cafe_y_bebidas')
    expect(slugifyCategory('  Ñandú & Piñas!! ')).toBe('c_nandu_pinas')
    expect(slugifyCategory('Agua/Luz')).toBe('c_agua_luz')
  })

  it('nunca choca con los slugs por defecto', () => {
    expect(slugifyCategory('rent')).toBe('c_rent')
    expect(slugifyCategory('Otros')).toBe('c_otros')
  })

  it('recorta a 30 caracteres (sin el prefijo) y respeta el patrón de la BD', () => {
    const slug = slugifyCategory('Una categoría con un nombre larguísimo que no cabe')
    expect(slug.length).toBeLessThanOrEqual(32)
    expect(slug).toMatch(/^[a-z0-9_]{2,40}$/)
    expect(slug.endsWith('_')).toBe(false)
  })

  it('un nombre sin letras ni números usa un slug genérico', () => {
    expect(slugifyCategory('¡¡¡')).toBe('c_categoria')
  })

  it('garantiza unicidad con _2, _3', () => {
    expect(slugifyCategory('Café', ['c_cafe'])).toBe('c_cafe_2')
    expect(slugifyCategory('Café', ['c_cafe', 'c_cafe_2'])).toBe('c_cafe_3')
    expect(slugifyCategory('Café', ['c_otro'])).toBe('c_cafe')
  })
})

describe('medios de pago', () => {
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
      category: 'rent', description: 'Arriendo local', amount: 1200000,
      due_date: '2026-09-05', suggested_date: '2026-09-05',
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
    const res = pendingRecurring(history, [], '2026-02')[0]
    expect(res.due_date).toBe('2026-02-28')
    expect(res.suggested_date).toBe('2026-02-28')
  })

  it('día 31 en un mes de 30 días vence el 30; en uno de 31 vence el 31', () => {
    const history = [exp('rent', 'Arriendo', '2026-08-31')]
    expect(pendingRecurring(history, [], '2026-09')[0].due_date).toBe('2026-09-30')
    expect(pendingRecurring(history, [], '2026-10')[0].due_date).toBe('2026-10-31')
    expect(pendingRecurring(history, [], '2028-02')[0].due_date).toBe('2028-02-29')
  })

  it('ignora gastos del mes o posteriores como plantilla', () => {
    const history = [
      exp('rent', 'B', '2026-09-02'),
      exp('rent', 'C', '2026-10-02'),
    ]
    expect(pendingRecurring(history, [], '2026-09')).toEqual([])
  })

  it('un gasto nunca marcado como fijo no genera pendientes', () => {
    const history = [exp('rent', 'A', '2026-08-05', { is_recurring: false })]
    expect(pendingRecurring(history, [], '2026-09')).toEqual([])
  })

  it('quitar la marca "fijo" al gasto más reciente detiene el grupo', () => {
    const history = [
      exp('rent', 'Arriendo', '2026-07-05'),                                   // fijo
      exp('rent', 'Arriendo', '2026-08-05', { is_recurring: false }),          // el último ya no es fijo
    ]
    expect(pendingRecurring(history, [], '2026-09')).toEqual([])
  })

  it('si el más reciente sí es fijo, un gasto anterior no fijo no molesta', () => {
    const history = [
      exp('rent', 'Arriendo', '2026-07-05', { is_recurring: false }),
      exp('rent', 'Arriendo', '2026-08-06', { amount: 999 }),
    ]
    const res = pendingRecurring(history, [], '2026-09')
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ amount: 999, due_date: '2026-09-06' })
  })

  it('la plantilla más reciente gana aunque el historial venga desordenado', () => {
    const history = [
      exp('rent', 'Arriendo', '2026-08-05', { is_recurring: false }),
      exp('rent', 'Arriendo', '2026-06-05'),
    ]
    expect(pendingRecurring(history, [], '2026-09')).toEqual([])
  })

  it('no sugiere fechas posteriores a hoy, pero conserva el vencimiento', () => {
    const history = [exp('rent', 'Arriendo', '2026-08-28')]
    const res = pendingRecurring(history, [], '2026-09', '2026-09-10')[0]
    expect(res.suggested_date).toBe('2026-09-10')
    expect(res.due_date).toBe('2026-09-28')
  })

  it('cambio de mes: para el 1 de octubre se calcula sobre octubre con el historial de septiembre', () => {
    const history = [
      exp('rent', 'Arriendo', '2026-09-01', { amount: 1500000 }),
      exp('utilities', 'Internet', '2026-09-30'),
    ]
    const res = pendingRecurring(history, [], '2026-10', '2026-09-30')
    expect(res.map(r => [r.description, r.due_date])).toEqual([
      ['Arriendo', '2026-10-01'],
      ['Internet', '2026-10-30'],
    ])
  })

  it('ordena por vencimiento', () => {
    const history = [exp('rent', 'B', '2026-08-20'), exp('rent', 'A', '2026-08-03')]
    expect(pendingRecurring(history, [], '2026-09').map(r => r.description)).toEqual(['A', 'B'])
  })

  it('nunca sugiere efectivo de la caja', () => {
    const history = [exp('rent', 'Arriendo', '2026-08-05', { payment_method: 'cash_register' })]
    expect(pendingRecurring(history, [], '2026-09')[0].payment_method).toBe('transfer')
    const card = [exp('rent', 'Arriendo', '2026-08-05', { payment_method: 'card' })]
    expect(pendingRecurring(card, [], '2026-09')[0].payment_method).toBe('card')
  })
})

describe('anchorDay', () => {
  const e = (expense_date: string, auto_registered = false) => ({
    category: 'rent', description: 'Arriendo', amount: 1, expense_date, is_recurring: true, auto_registered,
  })

  it('usa el día del registro más reciente', () => {
    expect(anchorDay([e('2026-08-10'), e('2026-09-15')])).toBe(15)
  })

  it('ignora el ajuste automático al último día de un mes corto', () => {
    expect(anchorDay([e('2026-01-31'), e('2026-02-28', true)])).toBe(31)
    expect(anchorDay([e('2026-08-31'), e('2026-09-30', true)])).toBe(31)
  })

  it('un cambio manual de día manda', () => {
    expect(anchorDay([e('2026-01-31'), e('2026-02-28', true), e('2026-03-20')])).toBe(20)
  })
})
