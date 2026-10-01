import type { MoneyMovement, ProfitLossResult, StaffProduction } from '@xinuco/types'
import {
  METHOD_LABEL,
  internalMoneyNote,
  movementMediumLabel,
  SOURCE_LABEL,
  summarizeMovements,
  monthRange,
  previousMonth,
  nextMonth,
  currentMonthKey,
  monthLabel,
  pctChange,
  toCsv,
  movementsCsv,
  monthShortLabel,
  monthsBetween,
  rangeDates,
  monthRangeLabel,
  rangeFileSuffix,
  profitLossMultiCsv,
  staffTotals,
  summarizeStaff,
  sortStaffByProduction,
  staffCsv,
} from '../accounting-utils'
import { businessTodayISODate } from '../agenda-time'

const mv = (extra: Partial<MoneyMovement>): MoneyMovement => ({
  kind: 'in',
  source: 'sale',
  occurred_on: '2026-09-10',
  occurred_time: '10:30',
  description: 'Venta · Juan',
  category: null,
  method: 'cash',
  amount: 50000,
  tip: 0,
  reference_id: null,
  ...extra,
})

describe('etiquetas', () => {
  it('medios de pago y orígenes en español', () => {
    expect(METHOD_LABEL.cash).toBe('Efectivo')
    expect(METHOD_LABEL.mercadopago).toBe('Mercado Pago')
    expect(METHOD_LABEL.loyalty_points).toBe('Puntos')
    expect(SOURCE_LABEL.team_payment).toBe('Pago al equipo')
    expect(SOURCE_LABEL.asset_purchase).toBe('Compra de equipo')
  })

  it('etiquetas de los movimientos del dueño, traslados y ajustes', () => {
    expect(SOURCE_LABEL.owner_contribution).toBe('Aporte del dueño')
    expect(SOURCE_LABEL.owner_loan).toBe('Préstamo del dueño')
    expect(SOURCE_LABEL.loan_repayment).toBe('Devolución de préstamo')
    expect(SOURCE_LABEL.owner_withdrawal).toBe('Retiro del dueño')
    expect(SOURCE_LABEL.transfer_in).toBe('Traslado entrada')
    expect(SOURCE_LABEL.transfer_out).toBe('Traslado salida')
    expect(SOURCE_LABEL.adjustment).toBe('Ajuste de saldo')
  })
})

describe('movementMediumLabel', () => {
  it('usa el nombre del medio; sin la columna cae al método; sin medio es "Otro medio" o "Puntos"', () => {
    expect(movementMediumLabel({ account: 'Nequi', method: 'transfer' })).toBe('Nequi')
    expect(movementMediumLabel({ method: 'card' })).toBe('Tarjeta')
    expect(movementMediumLabel({ account: null, method: 'other' })).toBe('Otro medio')
    expect(movementMediumLabel({ account: null, method: 'transfer' })).toBe('Otro medio')
    expect(movementMediumLabel({ account: null, method: 'loyalty_points' })).toBe('Puntos')
  })
})

describe('summarizeMovements', () => {
  it('suma entradas, salidas, neto y propinas', () => {
    const s = summarizeMovements([
      mv({ amount: 50000, tip: 5000 }),
      mv({ method: 'card', amount: 30000 }),
      mv({ kind: 'out', source: 'expense', method: 'cash', amount: 20000 }),
      mv({ kind: 'out', source: 'inventory_purchase', method: 'transfer', amount: 10000 }),
    ])
    expect(s.moneyIn).toBe(80000)
    expect(s.moneyOut).toBe(30000)
    expect(s.net).toBe(50000)
    expect(s.tips).toBe(5000)
    expect(s.pointsUsed).toBe(0)
  })

  it('lo pagado con puntos no es plata: va aparte', () => {
    const s = summarizeMovements([
      mv({ amount: 40000 }),
      mv({ method: 'loyalty_points', amount: 15000, tip: 2000 }),
    ])
    expect(s.moneyIn).toBe(40000)
    expect(s.pointsUsed).toBe(15000)
    expect(s.tips).toBe(0)
    expect(s.byMethod.map(m => m.method)).toEqual(['cash'])
    expect(s.bySource).toEqual([{ source: 'sale', total: 40000 }])
  })

  it('agrupa por medio (ordenado por movimiento) y por origen', () => {
    const s = summarizeMovements([
      mv({ method: 'cash', amount: 10000 }),
      mv({ method: 'card', amount: 90000 }),
      mv({ kind: 'out', source: 'expense', method: 'cash', amount: 4000 }),
    ])
    expect(s.byMethod).toEqual([
      { method: 'card', in: 90000, out: 0, net: 90000 },
      { method: 'cash', in: 10000, out: 4000, net: 6000 },
    ])
    expect(s.bySource).toEqual([
      { source: 'sale', total: 100000 },
      { source: 'expense', total: 4000 },
    ])
  })

  it('agrupa por medio del negocio (por nombre) con respaldo al método y "Otro medio"', () => {
    const s = summarizeMovements([
      mv({ account: 'Nequi', method: 'transfer', amount: 10000 }),
      mv({ account: 'Nequi', method: 'transfer', amount: 5000 }),
      mv({ kind: 'out', source: 'expense', account: 'Nequi', method: 'transfer', amount: 3000 }),
      mv({ account: 'Efectivo', method: 'cash', amount: 40000 }),
      mv({ kind: 'out', source: 'expense', account: null, method: 'other', amount: 7000 }),
      mv({ method: 'card', amount: 2000 }),
    ])
    expect(s.byAccount).toEqual([
      { label: 'Efectivo', in: 40000, out: 0, net: 40000 },
      { label: 'Nequi', in: 15000, out: 3000, net: 12000 },
      { label: 'Otro medio', in: 0, out: 7000, net: -7000 },
      { label: 'Tarjeta', in: 2000, out: 0, net: 2000 },
    ])
  })

  it('los movimientos del dueño, traslados y ajustes se siguen sumando y se desglosan aparte', () => {
    const s = summarizeMovements([
      mv({ amount: 100000 }),
      mv({ source: 'owner_contribution', account: 'Efectivo', amount: 50000 }),
      mv({ source: 'owner_loan', account: 'Nequi', method: 'transfer', amount: 30000 }),
      mv({ kind: 'out', source: 'owner_withdrawal', amount: 20000 }),
      mv({ kind: 'out', source: 'loan_repayment', amount: 10000 }),
      mv({ source: 'transfer_in', account: 'Nequi', method: 'transfer', amount: 25000 }),
      mv({ kind: 'out', source: 'transfer_out', account: 'Efectivo', amount: 25000 }),
      mv({ source: 'adjustment', amount: 1000 }),
      mv({ kind: 'out', source: 'adjustment', amount: 4000 }),
    ])
    expect(s.moneyIn).toBe(206000)
    expect(s.moneyOut).toBe(59000)
    expect(s.internal).toEqual({ ownerIn: 80000, ownerOut: 30000, transfers: 25000, adjustmentsIn: 1000, adjustmentsOut: 4000 })
    expect(internalMoneyNote(s, 'in')).toBe('Entró incluye aportes y préstamos del dueño $80.000, traslados $25.000 y ajustes de saldo $1.000.')
    expect(internalMoneyNote(s, 'out')).toBe('Salió incluye retiros y devoluciones al dueño $30.000, traslados $25.000 y ajustes de saldo $4.000.')
  })

  it('sin movimientos internos no hay nota', () => {
    const s = summarizeMovements([mv({ amount: 1000 })])
    expect(internalMoneyNote(s, 'in')).toBeNull()
    expect(internalMoneyNote(s, 'out')).toBeNull()
  })

  it('lista vacía', () => {
    expect(summarizeMovements([])).toEqual({
      moneyIn: 0, moneyOut: 0, net: 0, tips: 0, pointsUsed: 0, byMethod: [], byAccount: [], bySource: [],
      internal: { ownerIn: 0, ownerOut: 0, transfers: 0, adjustmentsIn: 0, adjustmentsOut: 0 },
    })
  })
})

describe('meses', () => {
  it('previousMonth / nextMonth cruzan el año', () => {
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(previousMonth('2026-09')).toBe('2026-08')
    expect(nextMonth('2025-12')).toBe('2026-01')
  })

  it('monthRange de un mes pasado llega al último día', () => {
    expect(monthRange('2020-02')).toEqual({ from: '2020-02-01', to: '2020-02-29' })
    expect(monthRange('2021-02')).toEqual({ from: '2021-02-01', to: '2021-02-28' })
    expect(monthRange('2020-12')).toEqual({ from: '2020-12-01', to: '2020-12-31' })
  })

  it('monthRange del mes actual termina hoy (hora de Bogotá)', () => {
    const today = businessTodayISODate()
    expect(currentMonthKey()).toBe(today.slice(0, 7))
    expect(monthRange(currentMonthKey())).toEqual({ from: `${today.slice(0, 7)}-01`, to: today })
  })

  it('monthRange rechaza meses inválidos', () => {
    expect(() => monthRange('2026-13')).toThrow()
  })

  it('monthLabel', () => {
    expect(monthLabel('2026-09')).toBe('septiembre 2026')
    expect(monthLabel('2025-01')).toBe('enero 2025')
  })
})

describe('pctChange', () => {
  it('calcula el cambio', () => {
    expect(pctChange(120, 100)).toBeCloseTo(20)
    expect(pctChange(50, 100)).toBeCloseTo(-50)
  })
  it('null sin base', () => {
    expect(pctChange(100, 0)).toBeNull()
  })
  it('base negativa: mejorar es positivo', () => {
    expect(pctChange(-50, -100)).toBeCloseTo(50)
  })
})

describe('toCsv', () => {
  it('BOM, separador ; y CRLF', () => {
    expect(toCsv([['a', 1], ['b', null]])).toBe('﻿a;1\r\nb;\r\n')
  })
  it('entrecomilla ; comillas y saltos de línea', () => {
    expect(toCsv([['a;b', 'dice "hola"', 'x\ny']])).toBe('﻿"a;b";"dice ""hola""";"x\ny"\r\n')
  })
  it('neutraliza fórmulas de Excel en textos', () => {
    expect(toCsv([['=1+1']])).toBe("﻿'=1+1\r\n")
  })
  it('números enteros sin separadores, negativos intactos', () => {
    expect(toCsv([[1234567, -500]])).toBe('﻿1234567;-500\r\n')
  })
})

describe('movementsCsv', () => {
  it('ordena por fecha y hora', () => {
    const csv = movementsCsv([
      mv({ occurred_on: '2026-09-30', occurred_time: '09:00', description: 'C' }),
      mv({ occurred_on: '2026-09-05', occurred_time: null, description: 'A' }),
      mv({ occurred_on: '2026-09-30', occurred_time: '07:00', description: 'B' }),
    ])
    const order = ['A', 'B', 'C'].map(d => csv.indexOf(`;${d};`))
    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
  })

  it('encabezado y filas', () => {
    const csv = movementsCsv([
      mv({ amount: 50000, tip: 5000, method: 'mercadopago' }),
      mv({ kind: 'out', source: 'expense', occurred_time: null, description: 'Arriendo; local', category: 'Arriendo', account: 'Caja principal', amount: 1200000 }),
    ])
    const lines = csv.replace('﻿', '').split('\r\n')
    expect(lines[0]).toBe('Fecha;Hora;Tipo;Origen;Descripción;Categoría;Medio de pago;Medio;Monto;Propina')
    // Mismo día: el que solo tiene fecha va primero
    expect(lines[1]).toBe('2026-09-10;;Salida;Gasto;"Arriendo; local";Arriendo;Efectivo;Caja principal;1200000;0')
    expect(lines[2]).toBe('2026-09-10;10:30;Entrada;Venta;Venta · Juan;;Mercado Pago;;50000;5000')
  })
})

describe('meses y rangos', () => {
  it('monthShortLabel', () => {
    expect(monthShortLabel('2026-01')).toBe('ene 2026')
    expect(monthShortLabel('2025-12')).toBe('dic 2025')
  })

  it('monthsBetween incluye ambos extremos y cruza el año', () => {
    expect(monthsBetween('2026-01', '2026-01')).toEqual(['2026-01'])
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(monthsBetween('2026-01', '2026-12')).toHaveLength(12)
    expect(monthsBetween('2026-03', '2026-01')).toEqual([])
    expect(monthsBetween('x', '2026-01')).toEqual([])
  })

  it('rangeDates: último día de un mes pasado y hoy si es el actual', () => {
    expect(rangeDates('2025-01', '2025-02')).toEqual({ from: '2025-01-01', to: '2025-02-28' })
    expect(rangeDates('2024-01', '2024-02').to).toBe('2024-02-29')
    const cur = currentMonthKey()
    expect(rangeDates('2020-01', cur)).toEqual({ from: '2020-01-01', to: businessTodayISODate() })
    expect(() => rangeDates('2026-13', '2026-01')).toThrow()
  })

  it('texto y sufijo de archivo', () => {
    expect(monthRangeLabel('2026-09', '2026-09')).toBe('septiembre 2026')
    expect(monthRangeLabel('2026-01', '2026-09')).toBe('enero 2026 a septiembre 2026')
    expect(rangeFileSuffix('2026-09', '2026-09')).toBe('2026-09')
    expect(rangeFileSuffix('2026-01', '2026-09')).toBe('2026-01_a_2026-09')
  })
})

describe('profitLossMultiCsv', () => {
  const pl = (over: Partial<ProfitLossResult> = {}): ProfitLossResult => ({
    revenue: { services: 900000, retail: 100000, total: 1000000, discounts: 20000, sales_count: 30 },
    tips: 50000,
    cost_of_goods: 40000,
    expenses: { total: 300000, by_category: [{ category: 'rent', total: 250000 }, { category: 'c_x', total: 50000 }] },
    gross_profit: 960000,
    commissions: 400000,
    depreciation: 10000,
    asset_disposals: -5000,
    net_profit: 245000,
    margin_pct: 24.5,
    ...over,
  })
  const jan = pl()
  const feb = pl({
    revenue: { services: 100, retail: 0, total: 100, discounts: 0, sales_count: 1 },
    expenses: { total: 70, by_category: [{ category: 'rent', total: 20 }, { category: 'luz', total: 50 }] },
    net_profit: 30,
    depreciation: undefined,
    asset_disposals: undefined,
  })
  const total = pl({
    revenue: { services: 900100, retail: 100000, total: 1000100, discounts: 20000, sales_count: 31 },
    expenses: { total: 300070, by_category: [{ category: 'rent', total: 250020 }, { category: 'c_x', total: 50000 }, { category: 'luz', total: 50 }] },
    net_profit: 245030,
  })
  const name = (s: string) => ({ rent: 'Arriendo', c_x: 'Otra cosa', luz: 'Luz' }[s] ?? s)
  const csv = profitLossMultiCsv(
    [{ month: '2026-01', pl: jan }, { month: '2026-02', pl: feb }],
    total,
    'enero 2026 a febrero 2026',
    name,
  )
  const lines = csv.replace('﻿', '').split('\r\n')

  it('encabezado con un mes por columna y el total', () => {
    expect(lines[0]).toBe('Estado de resultados;enero 2026 a febrero 2026')
    expect(lines[1]).toBe('Concepto;ene 2026;feb 2026;Total')
  })

  it('una columna por mes y el total', () => {
    expect(lines).toContain('Ingresos por servicios;900000;100;900100')
    expect(lines).toContain('Ingresos totales;1000000;100;1000100')
    expect(lines).toContain('Gastos;300000;70;300070')
    expect(lines).toContain('Utilidad neta;245000;30;245030')
    expect(lines).toContain('Desgaste de equipos;10000;0;10000')
    expect(lines).toContain('Venta o baja de equipos;-5000;0;-5000')
  })

  it('categorías de gasto: unión de todos los meses, 0 donde faltan', () => {
    expect(lines).toContain('Gastos - Arriendo;250000;20;250020')
    expect(lines).toContain('Gastos - Otra cosa;50000;0;50000')
    expect(lines).toContain('Gastos - Luz;0;50;50')
  })

  it('todas las filas tienen el mismo número de columnas', () => {
    for (const l of lines.filter(Boolean)) expect(l.split(';')).toHaveLength(l.startsWith('Estado de resultados') ? 2 : 4)
  })

  it('con un solo mes funciona igual', () => {
    const one = profitLossMultiCsv([{ month: '2026-01', pl: jan }], jan, 'enero 2026', name)
    expect(one).toContain('Concepto;ene 2026;Total')
    expect(one).toContain('Comisiones del equipo;400000;400000')
  })
})

describe('por profesional', () => {
  const st = (extra: Partial<StaffProduction>): StaffProduction => ({
    staff_id: 'a', full_name: 'Ana', is_active: true, services_count: 10,
    services_revenue: 500000, products_revenue: 100000,
    commissions: 250000, tips: 30000, bonuses: 20000, deductions: 10000,
    advances: 50000, payments: 100000, balance_now: 140000,
    ...extra,
  })

  it('staffTotals: produjo, ganó, pagado y lo que le quedó al negocio', () => {
    expect(staffTotals(st({}))).toEqual({
      produced: 600000,
      earned: 290000,   // 250000 + 30000 + 20000 − 10000
      paid: 150000,
      kept: 340000,     // 600000 − 250000 − 20000 + 10000
    })
  })

  it('summarizeStaff suma todo el equipo y el saldo de hoy', () => {
    const s = summarizeStaff([
      st({}),
      st({ staff_id: 'b', full_name: 'Beto', services_revenue: 100000, products_revenue: 0, commissions: 40000, tips: 0, bonuses: 0, deductions: 0, advances: 60000, payments: 0, balance_now: -20000 }),
    ])
    expect(s.produced).toBe(700000)
    expect(s.earned).toBe(330000)
    expect(s.paid).toBe(210000)
    expect(s.kept).toBe(400000)
    expect(s.pending).toBe(120000)
    expect(s.count).toBe(2)
  })

  it('summarizeStaff de lista vacía es todo cero', () => {
    expect(summarizeStaff([])).toEqual({ produced: 0, earned: 0, paid: 0, kept: 0, pending: 0, count: 0 })
  })

  it('ordena por lo que produjo', () => {
    const sorted = sortStaffByProduction([
      st({ full_name: 'Zoe', services_revenue: 10, products_revenue: 0 }),
      st({ full_name: 'Ana', services_revenue: 900, products_revenue: 0 }),
      st({ full_name: 'Bea', services_revenue: 10, products_revenue: 0 }),
    ])
    expect(sorted.map(r => r.full_name)).toEqual(['Ana', 'Bea', 'Zoe'])
  })

  it('staffCsv: encabezado y fila', () => {
    const lines = staffCsv([st({})]).replace('﻿', '').split('\r\n')
    expect(lines[0]).toBe(
      'Profesional;Servicios hechos;Produjo en servicios;Produjo en productos;Produjo total;Comisiones;Propinas;Bonos;Descuentos;Ganó total;Anticipos;Pagos;Pagado total;Le quedó al negocio;Saldo pendiente hoy',
    )
    expect(lines[1]).toBe('Ana;10;500000;100000;600000;250000;30000;20000;10000;290000;50000;100000;150000;340000;140000')
  })
})
