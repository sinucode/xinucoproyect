// lib/report-insights.ts — Recomendaciones del tablero gerencial (función PURA, sin servidor).
// Convierte el reporte en hasta 5 tarjetas priorizadas, con cifras concretas y en lenguaje simple.
import type { ManagementReport } from '@xinuco/types'
import { pctChange } from '@/lib/accounting-utils'
import {
  DOW_PLURAL, cellOccupancy, formatHourRange, formatMoney, formatPct, pluralize, staffOccupancyPct,
} from '@/lib/report-utils'

export type InsightTone = 'good' | 'warning' | 'critical'

export interface Insight {
  tone:   InsightTone
  title:  string
  detail: string
  href?:  string
}

export const MAX_INSIGHTS = 5
/** Una hora está "vacía" si menos de este % de su capacidad tiene citas. */
export const LOW_OCCUPANCY_PCT = 35
/** Un profesional con su agenda por debajo de este % merece atención. */
export const LOW_STAFF_OCCUPANCY_PCT = 50

const TONE_ORDER: Record<InsightTone, number> = { critical: 0, warning: 1, good: 2 }

export interface EmptyBlock {
  dow:        number
  startHour:  number
  /** Última hora incluida (la franja termina al final de esta hora). */
  endHour:    number
  emptyPct:   number
}

/**
 * La franja de ≥ 2 horas seguidas, de un mismo día, con ocupación < 35 % y horario de trabajo.
 * Gana la que más minutos de silla vacía acumula.
 */
export function findEmptiestBlock(heatmap: ManagementReport['heatmap']): EmptyBlock | null {
  const byDow = new Map<number, ManagementReport['heatmap']>()
  for (const c of heatmap) {
    if ((c.capacity_minutes ?? 0) <= 0) continue
    const list = byDow.get(c.dow) ?? []
    list.push(c)
    byDow.set(c.dow, list)
  }

  const candidates: (EmptyBlock & { emptyMinutes: number })[] = []

  for (const [dow, cells] of byDow) {
    const sorted = [...cells].sort((a, b) => a.hour - b.hour)
    let run: typeof sorted = []
    const flush = () => {
      if (run.length >= 2) {
        const cap = run.reduce((s, c) => s + c.capacity_minutes, 0)
        const booked = run.reduce((s, c) => s + Math.min(c.booked_minutes, c.capacity_minutes), 0)
        const emptyMinutes = cap - booked
        candidates.push({
          dow,
          startHour: run[0].hour,
          endHour: run[run.length - 1].hour,
          emptyPct: Math.round((emptyMinutes / cap) * 100),
          emptyMinutes,
        })
      }
      run = []
    }
    for (const c of sorted) {
      const occ = cellOccupancy(c)
      const isLow = occ !== null && occ * 100 < LOW_OCCUPANCY_PCT
      const consecutive = run.length === 0 || c.hour === run[run.length - 1].hour + 1
      if (isLow && consecutive) {
        run.push(c)
      } else {
        flush()
        if (isLow) run.push(c)
      }
    }
    flush()
  }

  if (candidates.length === 0) return null
  const best = candidates.reduce((a, b) => (b.emptyMinutes > a.emptyMinutes ? b : a))
  return { dow: best.dow, startHour: best.startHour, endHour: best.endHour, emptyPct: best.emptyPct }
}

/**
 * Recomendaciones del período, de la más urgente a la menos (máx. 5).
 * Orden: críticas → advertencias → buenas noticias; dentro de cada grupo, el orden de las reglas.
 */
export function buildInsights(report: ManagementReport, slug: string): Insight[] {
  const out: Insight[] = []
  const { pl, pl_prev: prev, leaks, at_risk: risk } = report

  // 1. Pérdida en el período
  if (pl.net_profit < 0) {
    out.push({
      tone: 'critical',
      title: `El período va en pérdida: ${formatMoney(Math.abs(pl.net_profit))}`,
      detail: 'Lo que salió fue más de lo que entró. Revisa los gastos más grandes y las comisiones.',
    })
  }

  // 2. Citas perdidas (no asistió + canceladas)
  const lostValue = (leaks.no_show_value ?? 0) + (leaks.cancelled_value ?? 0)
  if (lostValue > 0) {
    out.push({
      tone: 'warning',
      title: `Las citas perdidas te costaron ${formatMoney(lostValue)} (${leaks.no_show_count} no asistió, ${pluralize(leaks.cancelled_count, 'cancelación', 'cancelaciones')})`,
      detail: 'Activa el pago anticipado o recordatorios para que los clientes lleguen.',
    })
  }

  // 3. Clientes que no vuelven
  if (risk.count > 0) {
    out.push({
      tone: 'warning',
      title: `${risk.count === 1 ? '1 cliente no vuelve' : `${risk.count} clientes no vuelven`} hace más de 45 días`,
      detail: `Antes gastaban ${formatMoney(risk.monthly_value)} al mes. Escríbeles con una oferta.`,
      href: `/${slug}/dashboard/crm`,
    })
  }

  // 4. Franja más vacía
  const block = findEmptiestBlock(report.heatmap)
  if (block) {
    out.push({
      tone: 'warning',
      title: `Los ${DOW_PLURAL[block.dow]} ${formatHourRange(block.startHour, block.endHour + 1)} tus sillas están vacías el ${block.emptyPct} % del tiempo`,
      detail: 'Prueba una promo para esas horas.',
    })
  }

  // 5. Profesional con poca agenda
  const lowStaff = report.staff
    .map(s => ({ s, pct: staffOccupancyPct(s) }))
    .filter((x): x is { s: typeof x.s; pct: number } => x.pct !== null && x.pct < LOW_STAFF_OCCUPANCY_PCT)
    .sort((a, b) => a.pct - b.pct)[0]
  if (lowStaff) {
    out.push({
      tone: 'warning',
      title: `${lowStaff.s.full_name} tiene su agenda al ${Math.round(lowStaff.pct)} %`,
      detail: 'Asígnale más citas o promociona su horario.',
    })
  }

  // 6. Gastos creciendo
  const expGrowth = pctChange(pl.expenses.total, prev.expenses.total)
  if (expGrowth !== null && expGrowth > 20) {
    out.push({
      tone: 'warning',
      title: `Tus gastos subieron ${formatPct(expGrowth)} frente al período anterior`,
      detail: `Pasaron de ${formatMoney(prev.expenses.total)} a ${formatMoney(pl.expenses.total)}. Revisa en qué categoría subieron.`,
    })
  }

  // 7. Ingresos creciendo
  const revGrowth = pctChange(pl.revenue.total, prev.revenue.total)
  if (revGrowth !== null && revGrowth > 10) {
    out.push({
      tone: 'good',
      title: `Ingresos +${formatPct(revGrowth)} vs el período anterior`,
      detail: `Vendiste ${formatMoney(pl.revenue.total)} contra ${formatMoney(prev.revenue.total)}. Sigue así.`,
    })
  }

  // 8. Servicio estrella (solo si hay espacio)
  const svcTotal = report.services.reduce((s, x) => s + x.revenue, 0)
  const topSvc = report.services[0]
  if (topSvc && svcTotal > 0 && topSvc.revenue / svcTotal >= 0.4 && report.services.length > 1) {
    out.push({
      tone: 'good',
      title: `${topSvc.name} es tu servicio estrella: ${formatPct((topSvc.revenue / svcTotal) * 100)} de lo que vendes en servicios`,
      detail: 'Ofrécelo en combo con otro servicio para subir el ticket.',
    })
  }

  // 9. Producto que más vende (solo si hay espacio)
  const topPrd = report.products[0]
  if (topPrd && topPrd.revenue > 0) {
    out.push({
      tone: 'good',
      title: `${topPrd.name} es el producto que más vendes: ${formatMoney(topPrd.revenue)}`,
      detail: 'Ten siempre stock y ofrécelo al cobrar el servicio.',
    })
  }

  return out
    .map((insight, index) => ({ insight, index }))
    .sort((a, b) => TONE_ORDER[a.insight.tone] - TONE_ORDER[b.insight.tone] || a.index - b.index)
    .slice(0, MAX_INSIGHTS)
    .map(x => x.insight)
}
