import type { ManagementHeatCell, ManagementReport, ProfitLossResult } from '@xinuco/types'
import { buildInsights, findEmptiestBlock } from '../report-insights'

function pl(over: Partial<ProfitLossResult> = {}): ProfitLossResult {
  return {
    revenue: { services: 1_000_000, retail: 0, total: 1_000_000, discounts: 0, sales_count: 40 },
    tips: 0, cost_of_goods: 0,
    expenses: { total: 300_000, by_category: [] },
    gross_profit: 1_000_000, commissions: 300_000, depreciation: 0, asset_disposals: 0,
    net_profit: 400_000, margin_pct: 40,
    ...over,
  }
}

function report(over: Partial<ManagementReport> = {}): ManagementReport {
  return {
    period: { from: '2026-09-01', to: '2026-09-30', prev_from: '2026-08-02', prev_to: '2026-08-31', today: '2026-09-30' },
    pl: pl(),
    pl_prev: pl(),
    kpis: { sales_count: 40, clients: 30, services: 45 },
    kpis_prev: { sales_count: 40, clients: 30, services: 45 },
    monthly: [],
    leaks: { cancelled_count: 0, cancelled_value: 0, no_show_count: 0, no_show_value: 0, voided_count: 0, voided_value: 0, waste_value: 0, cash_shortfall: 0 },
    heatmap: [],
    staff: [],
    services: [],
    products: [],
    customers_monthly: [],
    at_risk: { count: 0, monthly_value: 0, top: [] },
    ...over,
  }
}

const cell = (dow: number, hour: number, booked: number, cap = 240): ManagementHeatCell =>
  ({ dow, hour, appointments: 1, booked_minutes: booked, capacity_minutes: cap, weeks: 4 })

describe('findEmptiestBlock', () => {
  it('encuentra martes de 2 a 5 p. m. con el % vacío', () => {
    const heat = [
      cell(2, 13, 200),        // lleno
      cell(2, 14, 60),         // 25 %
      cell(2, 15, 30),         // 12,5 %
      cell(2, 16, 0),          // 0 %
      cell(2, 17, 200),        // lleno
    ]
    const b = findEmptiestBlock(heat)!
    expect(b).toMatchObject({ dow: 2, startHour: 14, endHour: 16 })
    // vacío = 1 - (60+30+0)/720 = 87.5 % → 88
    expect(b.emptyPct).toBe(88)
  })

  it('exige al menos 2 horas seguidas y capacidad', () => {
    expect(findEmptiestBlock([cell(2, 14, 0), cell(2, 16, 0)])).toBeNull()                  // no son consecutivas
    expect(findEmptiestBlock([cell(2, 14, 0, 0), cell(2, 15, 0, 0)])).toBeNull()            // sin horario
    expect(findEmptiestBlock([cell(2, 14, 100), cell(2, 15, 100)])).toBeNull()              // ≥ 35 %
  })

  it('elige la franja con más silla vacía', () => {
    const heat = [cell(1, 9, 0), cell(1, 10, 0), cell(3, 9, 0), cell(3, 10, 0), cell(3, 11, 0)]
    expect(findEmptiestBlock(heat)).toMatchObject({ dow: 3, startHour: 9, endHour: 11 })
  })
})

describe('buildInsights', () => {
  it('sin problemas ni buenas noticias: no hay recomendaciones', () => {
    expect(buildInsights(report(), 'demo')).toEqual([])
  })

  it('franja vacía con copy concreto', () => {
    const out = buildInsights(report({ heatmap: [cell(2, 14, 30), cell(2, 15, 30), cell(2, 16, 30)] }), 'demo')
    expect(out).toHaveLength(1)
    expect(out[0].tone).toBe('warning')
    expect(out[0].title).toBe('Los martes de 2 a 5 p. m. tus sillas están vacías el 88 % del tiempo')
    expect(out[0].detail).toContain('promo')
  })

  it('citas perdidas: suma no asistió + canceladas', () => {
    const out = buildInsights(report({
      leaks: { cancelled_count: 3, cancelled_value: 90_000, no_show_count: 2, no_show_value: 60_000, voided_count: 0, voided_value: 0, waste_value: 0, cash_shortfall: 0 },
    }), 'demo')
    expect(out[0].title).toBe('Las citas perdidas te costaron $150.000 (2 no asistió, 3 cancelaciones)')
    expect(out[0].detail).toContain('pago anticipado')
  })

  it('clientes que no vuelven, con enlace al CRM', () => {
    const out = buildInsights(report({ at_risk: { count: 12, monthly_value: 480_000, top: [] } }), 'mi-barberia')
    expect(out[0].title).toBe('12 clientes no vuelven hace más de 45 días')
    expect(out[0].detail).toBe('Antes gastaban $480.000 al mes. Escríbeles con una oferta.')
    expect(out[0].href).toBe('/mi-barberia/dashboard/crm')
    const one = buildInsights(report({ at_risk: { count: 1, monthly_value: 50_000, top: [] } }), 'x')
    expect(one[0].title).toBe('1 cliente no vuelve hace más de 45 días')
  })

  it('profesional con agenda baja (solo si tiene horario)', () => {
    const staff = [
      { id: 'a', full_name: 'Carlos', scheduled_minutes: 1000, booked_minutes: 380, produced: 0, services: 0 },
      { id: 'b', full_name: 'Luis', scheduled_minutes: 1000, booked_minutes: 800, produced: 0, services: 0 },
      { id: 'c', full_name: 'Sin horario', scheduled_minutes: 0, booked_minutes: 0, produced: 0, services: 0 },
    ]
    const out = buildInsights(report({ staff }), 'demo')
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('Carlos tiene su agenda al 38 %')
    expect(out[0].detail).toBe('Asígnale más citas o promociona su horario.')
  })

  it('pérdida en el período es crítica y va primero', () => {
    const out = buildInsights(report({
      pl: pl({ net_profit: -250_000 }),
      at_risk: { count: 3, monthly_value: 90_000, top: [] },
    }), 'demo')
    expect(out[0].tone).toBe('critical')
    expect(out[0].title).toBe('El período va en pérdida: $250.000')
    expect(out[1].tone).toBe('warning')
  })

  it('gastos que suben más de 20 % y ingresos que suben más de 10 %', () => {
    const out = buildInsights(report({
      pl: pl({ expenses: { total: 390_000, by_category: [] }, revenue: { services: 1_200_000, retail: 0, total: 1_200_000, discounts: 0, sales_count: 40 } }),
      pl_prev: pl({ expenses: { total: 300_000, by_category: [] } }),
    }), 'demo')
    expect(out.map(i => i.tone)).toEqual(['warning', 'good'])
    expect(out[0].title).toBe('Tus gastos subieron 30 % frente al período anterior')
    expect(out[1].title).toBe('Ingresos +20 % vs el período anterior')
  })

  it('no avisa con cambios pequeños', () => {
    const out = buildInsights(report({
      pl: pl({ expenses: { total: 330_000, by_category: [] }, revenue: { services: 1_050_000, retail: 0, total: 1_050_000, discounts: 0, sales_count: 40 } }),
    }), 'demo')
    expect(out).toEqual([])
  })

  it('máximo 5, ordenadas por gravedad', () => {
    const out = buildInsights(report({
      pl: pl({ net_profit: -1, revenue: { services: 1_200_000, retail: 0, total: 1_200_000, discounts: 0, sales_count: 40 }, expenses: { total: 500_000, by_category: [] } }),
      leaks: { cancelled_count: 1, cancelled_value: 30_000, no_show_count: 1, no_show_value: 30_000, voided_count: 0, voided_value: 0, waste_value: 0, cash_shortfall: 0 },
      at_risk: { count: 5, monthly_value: 100_000, top: [] },
      heatmap: [cell(2, 14, 0), cell(2, 15, 0)],
      staff: [{ id: 'a', full_name: 'Ana', scheduled_minutes: 1000, booked_minutes: 100, produced: 0, services: 0 }],
      services: [{ name: 'Corte', count: 50, revenue: 900_000 }, { name: 'Barba', count: 10, revenue: 100_000 }],
      products: [{ name: 'Cera', count: 5, revenue: 50_000 }],
    }), 'demo')
    expect(out).toHaveLength(5)
    expect(out[0].tone).toBe('critical')
    const tones = out.map(i => i.tone)
    expect(tones).toEqual([...tones].sort((a, b) => ['critical', 'warning', 'good'].indexOf(a) - ['critical', 'warning', 'good'].indexOf(b)))
  })

  it('servicio estrella solo cuando domina (≥ 40 %) y hay más de uno', () => {
    const out = buildInsights(report({ services: [{ name: 'Corte', count: 50, revenue: 600_000 }, { name: 'Barba', count: 10, revenue: 400_000 }] }), 'demo')
    expect(out[0].title).toBe('Corte es tu servicio estrella: 60 % de lo que vendes en servicios')
    expect(buildInsights(report({ services: [{ name: 'Corte', count: 50, revenue: 300_000 }, { name: 'Barba', count: 10, revenue: 400_000 }, { name: 'Tinte', count: 1, revenue: 300_000 }] }), 'demo')).toEqual([])
  })
})
