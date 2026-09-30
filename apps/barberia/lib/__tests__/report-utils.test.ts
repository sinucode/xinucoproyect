import type { ManagementHeatCell, ProfitLossResult } from '@xinuco/types'
import {
  periodRange, isPeriodKey, formatMoney, formatMoneySigned, formatMoneyCompact, formatPct, formatInt,
  trimMonthly, buildWaterfall, buildHeatmapGrid, cellOccupancy, heatCellText, formatHour, formatHourRange,
  relativeDays, periodText, rampColor, staffOccupancyPct, monthShort,
} from '../report-utils'

describe('periodRange', () => {
  it('este mes: del 1 a hoy', () => {
    expect(periodRange('mes', '2026-09-17')).toEqual({ from: '2026-09-01', to: '2026-09-17' })
  })
  it('mes pasado: mes calendario completo', () => {
    expect(periodRange('mes-pasado', '2026-09-17')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  })
  it('mes pasado en enero cruza de año y en marzo respeta febrero', () => {
    expect(periodRange('mes-pasado', '2026-01-05')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(periodRange('mes-pasado', '2026-03-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(periodRange('mes-pasado', '2024-03-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
  })
  it('últimos 3 meses: desde el día 1 de hace dos meses hasta hoy', () => {
    expect(periodRange('3-meses', '2026-09-17')).toEqual({ from: '2026-07-01', to: '2026-09-17' })
    expect(periodRange('3-meses', '2026-02-03')).toEqual({ from: '2025-12-01', to: '2026-02-03' })
  })
  it('este año: del 1 de enero a hoy', () => {
    expect(periodRange('anio', '2026-09-17')).toEqual({ from: '2026-01-01', to: '2026-09-17' })
  })
  it('ningún rango pasa de 400 días', () => {
    const r = periodRange('anio', '2026-12-31')
    const days = (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000
    expect(days).toBeLessThanOrEqual(400)
  })
  it('isPeriodKey valida la clave', () => {
    expect(isPeriodKey('mes')).toBe(true)
    expect(isPeriodKey('hoy')).toBe(false)
    expect(isPeriodKey(undefined)).toBe(false)
  })
})

describe('formato', () => {
  it('formatInt agrupa miles con punto', () => {
    expect(formatInt(0)).toBe('0')
    expect(formatInt(999)).toBe('999')
    expect(formatInt(1234)).toBe('1.234')
    expect(formatInt(1234567)).toBe('1.234.567')
  })
  it('formatMoney', () => {
    expect(formatMoney(1234567)).toBe('$1.234.567')
    expect(formatMoney(0)).toBe('$0')
    expect(formatMoney(-15000)).toBe('−$15.000')
    expect(formatMoney(1499.6)).toBe('$1.500')
  })
  it('formatMoneySigned', () => {
    expect(formatMoneySigned(5000)).toBe('+$5.000')
    expect(formatMoneySigned(-5000)).toBe('−$5.000')
    expect(formatMoneySigned(0)).toBe('$0')
  })
  it('formatMoneyCompact', () => {
    expect(formatMoneyCompact(1200000)).toBe('$1,2 M')
    expect(formatMoneyCompact(2000000)).toBe('$2 M')
    expect(formatMoneyCompact(850000)).toBe('$850 mil')
    expect(formatMoneyCompact(8500)).toBe('$8,5 mil')
    expect(formatMoneyCompact(420)).toBe('$420')
    expect(formatMoneyCompact(0)).toBe('$0')
    expect(formatMoneyCompact(-850000)).toBe('−$850 mil')
    expect(formatMoneyCompact(999800)).toBe('$1 M')
    expect(formatMoneyCompact(125000000)).toBe('$125 M')
  })
  it('formatPct', () => {
    expect(formatPct(72.4)).toBe('72 %')
    expect(formatPct(12.46, 1)).toBe('12,5 %')
    expect(formatPct(-5)).toBe('−5 %')
    expect(formatPct(0)).toBe('0 %')
  })
  it('horas', () => {
    expect(formatHour(15)).toBe('3 p. m.')
    expect(formatHour(12)).toBe('12 p. m.')
    expect(formatHour(8)).toBe('8 a. m.')
    expect(formatHourRange(14, 17)).toBe('de 2 a 5 p. m.')
    expect(formatHourRange(9, 11)).toBe('de 9 a 11 a. m.')
    expect(formatHourRange(11, 14)).toBe('de 11 a. m. a 2 p. m.')
    expect(formatHourRange(9, 12)).toBe('de 9 a. m. a 12 p. m.')
  })
  it('fechas', () => {
    expect(monthShort('2026-09')).toBe('sep')
    expect(periodText('2026-09-01', '2026-09-30')).toBe('1 sep – 30 sep 2026')
    expect(periodText('2025-12-01', '2026-02-03')).toBe('1 dic 2025 – 3 feb 2026')
    expect(relativeDays('2026-07-17', '2026-09-17')).toBe('hace 62 días')
    expect(relativeDays('2026-09-16', '2026-09-17')).toBe('hace 1 día')
    expect(relativeDays('2026-09-17', '2026-09-17')).toBe('hoy')
  })
})

describe('trimMonthly', () => {
  const m = (month: string, revenue: number, net = 0) => ({ month, revenue, net, costs: revenue - net, sales: 0 })
  it('empieza en el primer mes con ingresos', () => {
    const out = trimMonthly([m('2026-01', 0, -500), m('2026-02', 0, -500), m('2026-03', 1000, 200), m('2026-04', 0, -100)])
    expect(out.map(x => x.month)).toEqual(['2026-03', '2026-04'])
  })
  it('si ninguno tiene ingresos, muestra todos', () => {
    const all = [m('2026-01', 0, -5), m('2026-02', 0, -5)]
    expect(trimMonthly(all)).toEqual(all)
  })
  it('no recorta si el primero ya tiene ingresos', () => {
    const all = [m('2026-01', 10, 5), m('2026-02', 0, -5)]
    expect(trimMonthly(all)).toEqual(all)
  })
})

function pl(over: Partial<ProfitLossResult> = {}): ProfitLossResult {
  return {
    revenue: { services: 900_000, retail: 100_000, total: 1_000_000, discounts: 0, sales_count: 40 },
    tips: 0,
    cost_of_goods: 50_000,
    expenses: { total: 300_000, by_category: [{ category: 'rent', total: 200_000 }, { category: 'utilities', total: 100_000 }] },
    gross_profit: 950_000,
    commissions: 400_000,
    depreciation: 20_000,
    asset_disposals: 0,
    net_profit: 230_000,
    margin_pct: 23,
    ...over,
  }
}

describe('buildWaterfall', () => {
  const label = (s: string) => ({ rent: 'Arriendo', utilities: 'Servicios públicos' } as Record<string, string>)[s] ?? s

  it('arma los pasos en orden y cuadra con la utilidad', () => {
    const steps = buildWaterfall(pl(), label)
    expect(steps.map(s => s.label)).toEqual([
      'Ingresos', 'Costo de productos', 'Comisiones del equipo', 'Arriendo', 'Servicios públicos', 'Desgaste de equipos', 'Utilidad',
    ])
    const last = steps[steps.length - 1]
    expect(last.value).toBe(230_000)
    // el acumulado antes del resultado es la utilidad
    expect(steps[steps.length - 2].to).toBe(230_000)
    expect(steps[0].per100).toBe(100)
    expect(steps[2].per100).toBe(-40)
  })

  it('agrupa las categorías fuera del top 5 en "Otros gastos"', () => {
    const by = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((c, i) => ({ category: c, total: (7 - i) * 10 }))
    const steps = buildWaterfall(pl({ expenses: { total: 280, by_category: by } }), s => s)
    const labels = steps.map(s => s.label)
    expect(labels).toContain('Otros gastos menores')
    expect(labels).not.toContain('f')
    const other = steps.find(s => s.key === 'other-expenses')!
    expect(other.value).toBe(-(20 + 10))
  })

  it('omite pasos en cero y suma/resta la venta de equipos', () => {
    const steps = buildWaterfall(pl({ cost_of_goods: 0, commissions: 0, depreciation: 0, expenses: { total: 0, by_category: [] }, asset_disposals: 50_000, net_profit: 1_050_000 }), label)
    expect(steps.map(s => s.key)).toEqual(['revenue', 'disposals', 'result'])
    expect(steps[1].kind).toBe('gain')
    const loss = buildWaterfall(pl({ asset_disposals: -10_000 }), label).find(s => s.key === 'disposals')!
    expect(loss.kind).toBe('cost')
    expect(loss.value).toBe(-10_000)
  })

  it('pérdida: el resultado se llama Pérdida y es negativo', () => {
    const steps = buildWaterfall(pl({ net_profit: -100_000 }), label)
    expect(steps[steps.length - 1].label).toBe('Pérdida')
  })

  it('sin ingresos no calcula "de cada $100"', () => {
    const steps = buildWaterfall(pl({ revenue: { services: 0, retail: 0, total: 0, discounts: 0, sales_count: 0 } }), label)
    expect(steps.every(s => s.per100 === null)).toBe(true)
  })
})

describe('mapa de calor', () => {
  const cell = (dow: number, hour: number, booked: number, cap: number, appointments = 0, weeks: number | null = 4): ManagementHeatCell =>
    ({ dow, hour, appointments, booked_minutes: booked, capacity_minutes: cap, weeks })

  it('ocupación = reservado / capacidad (máx. 100 %) y null sin horario', () => {
    expect(cellOccupancy(cell(1, 9, 30, 120))).toBe(0.25)
    expect(cellOccupancy(cell(1, 9, 300, 120))).toBe(1)
    expect(cellOccupancy(cell(1, 9, 30, 0))).toBeNull()
  })

  it('arma filas lun-sáb, domingo solo con capacidad, y horas con capacidad', () => {
    const grid = buildHeatmapGrid([cell(1, 9, 10, 60), cell(2, 11, 0, 60), cell(0, 10, 30, 0, 2)])
    expect(grid.rows.map(r => r.label)).toEqual(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'])
    expect(grid.hours).toEqual([9, 10, 11])
    const withSunday = buildHeatmapGrid([cell(1, 9, 10, 60), cell(0, 10, 0, 60)])
    expect(withSunday.rows[withSunday.rows.length - 1].label).toBe('Dom')
    expect(buildHeatmapGrid([]).hours).toEqual([])
  })

  it('texto de la celda', () => {
    expect(heatCellText(cell(2, 15, 21, 60, 12, 4))).toBe('martes 3 p. m.: 35 % ocupado · 12 citas en 4 semanas')
    expect(heatCellText(cell(2, 15, 0, 60, 1, 1))).toBe('martes 3 p. m.: 0 % ocupado · 1 cita en 1 semana')
  })

  it('rampa de un solo tono: extremos exactos', () => {
    expect(rampColor(0)).toBe('rgb(24, 79, 149)')
    expect(rampColor(1)).toBe('rgb(205, 226, 251)')
    expect(rampColor(-3)).toBe(rampColor(0))
  })
})

describe('staffOccupancyPct', () => {
  it('porcentaje y null sin horario', () => {
    expect(staffOccupancyPct({ booked_minutes: 190, scheduled_minutes: 500 })).toBe(38)
    expect(staffOccupancyPct({ booked_minutes: 10, scheduled_minutes: 0 })).toBeNull()
    expect(staffOccupancyPct({ booked_minutes: 900, scheduled_minutes: 500 })).toBe(100)
  })
})
