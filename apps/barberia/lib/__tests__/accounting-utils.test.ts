import type { MoneyMovement, ProfitLossResult } from '@xinuco/types'
import {
  METHOD_LABEL,
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
  profitLossCsv,
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

  it('lista vacía', () => {
    expect(summarizeMovements([])).toEqual({
      moneyIn: 0, moneyOut: 0, net: 0, tips: 0, pointsUsed: 0, byMethod: [], bySource: [],
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
      mv({ kind: 'out', source: 'expense', occurred_time: null, description: 'Arriendo; local', category: 'Arriendo', amount: 1200000 }),
    ])
    const lines = csv.replace('﻿', '').split('\r\n')
    expect(lines[0]).toBe('Fecha;Hora;Tipo;Origen;Descripción;Categoría;Medio de pago;Monto;Propina')
    // Mismo día: el que solo tiene fecha va primero
    expect(lines[1]).toBe('2026-09-10;;Salida;Gasto;"Arriendo; local";Arriendo;Efectivo;1200000;0')
    expect(lines[2]).toBe('2026-09-10;10:30;Entrada;Venta;Venta · Juan;;Mercado Pago;50000;5000')
  })
})

describe('profitLossCsv', () => {
  const pl: ProfitLossResult = {
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
  }

  it('incluye todas las líneas', () => {
    const csv = profitLossCsv(pl, 'septiembre 2026', s => (s === 'rent' ? 'Arriendo' : 'Otra cosa'))
    const lines = csv.replace('﻿', '').split('\r\n')
    expect(lines).toContain('Concepto;Valor')
    expect(lines).toContain('Estado de resultados;septiembre 2026')
    expect(lines).toContain('Ingresos por servicios;900000')
    expect(lines).toContain('Ingresos por productos;100000')
    expect(lines).toContain('Descuentos;20000')
    expect(lines).toContain('Ingresos totales;1000000')
    expect(lines).toContain('Costo de productos vendidos;40000')
    expect(lines).toContain('Utilidad bruta;960000')
    expect(lines).toContain('Comisiones del equipo;400000')
    expect(lines).toContain('Gastos;300000')
    expect(lines).toContain('Gastos - Arriendo;250000')
    expect(lines).toContain('Gastos - Otra cosa;50000')
    expect(lines).toContain('Desgaste de equipos;10000')
    expect(lines).toContain('Venta o baja de equipos;-5000')
    expect(lines).toContain('Utilidad neta;245000')
    expect(lines).toContain('Propinas (no son ingreso del negocio);50000')
  })
})
