'use client'

import { useMemo, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import type { ExpenseCategoryRow, ManagementReport } from '@xinuco/types'
import { monthLabel, pctChange } from '@/lib/accounting-utils'
import { categoryName } from '@/lib/expense-utils'
import { buildInsights } from '@/lib/report-insights'
import {
  DOW_NAMES, PERIOD_KEYS, PERIOD_LABELS, buildHeatmapGrid, buildWaterfall, cellOccupancy, formatHour, formatInt,
  formatMoney, formatMoneySigned, formatPct, per100Text, periodText, pluralize, relativeDays,
  staffOccupancyPct, monthShort, trimMonthly, type PeriodKey,
} from '@/lib/report-utils'
import { ChartCard } from './charts/ChartCard'
import { DivergingBars } from './charts/DivergingBars'
import { Heatmap } from './charts/Heatmap'
import { HBarList, type HBarItem } from './charts/HBarList'
import { Sparkline } from './charts/Sparkline'
import { StackedColumns } from './charts/StackedColumns'
import { CHART, STATUS_TEXT } from './charts/theme'
import { Waterfall } from './charts/Waterfall'
import { InsightCards } from './InsightCards'
import { Delta, StatTile } from './StatTile'

type CategoryInfo = Pick<ExpenseCategoryRow, 'slug' | 'name' | 'color' | 'is_hidden'>

const CARD_STYLE = { background: 'var(--surface-color, rgba(255,255,255,0.03))', border: '1px solid var(--border-color)' } as const

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 min-w-0">
      <div>
        <h2 className="text-lg font-serif font-bold text-xinuco-text">{title}</h2>
        {hint && <p className="text-xs text-xinuco-muted mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-xinuco-muted py-6 text-center">{children}</p>
}

// ── Período ───────────────────────────────────────────────────────────────────

function PeriodChips({ active, pending, onPick }: { active: PeriodKey; pending: boolean; onPick: (k: PeriodKey) => void }) {
  return (
    <div
      role="group"
      aria-label="Período del reporte"
      className="flex gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1"
      style={{ scrollbarWidth: 'none' }}
    >
      {PERIOD_KEYS.map(k => {
        const on = k === active
        return (
          <button
            key={k}
            type="button"
            onClick={() => onPick(k)}
            aria-pressed={on}
            disabled={pending && !on}
            className="shrink-0 min-h-[36px] px-3 rounded-full text-xs font-semibold whitespace-nowrap transition-colors disabled:opacity-60"
            style={{
              background: on ? 'var(--primary-color)' : 'transparent',
              color: on ? '#000' : 'var(--text-color)',
              border: `1px solid ${on ? 'var(--primary-color)' : 'var(--border-color)'}`,
            }}
          >
            {PERIOD_LABELS[k]}
          </button>
        )
      })}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export function ReportsDashboard({
  slug,
  periodo,
  report,
  from,
  to,
  error,
  categories,
}: {
  slug:       string
  periodo:    PeriodKey
  report:     ManagementReport | null
  from:       string | null
  to:         string | null
  error:      string | null
  categories: CategoryInfo[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const pick = (k: PeriodKey) => {
    if (k === periodo) return
    startTransition(() => router.push(`/${slug}/dashboard/reports?periodo=${k}`, { scroll: false }))
  }

  return (
    <div className="flex flex-col gap-8 min-w-0" aria-busy={pending}>
      <div className="flex flex-col gap-2">
        <PeriodChips active={periodo} pending={pending} onPick={pick} />
        {report && from && to && (
          <p className="text-xs text-xinuco-muted">
            {periodText(from, to)} · comparado con {periodText(report.period.prev_from, report.period.prev_to)}
          </p>
        )}
      </div>

      {!report ? (
        <div className="rounded-2xl p-6 text-center flex flex-col items-center gap-3" style={CARD_STYLE} role="alert">
          <p className="text-sm text-xinuco-text">{error ?? 'No se pudo cargar el reporte. Intenta de nuevo.'}</p>
          <button
            type="button"
            onClick={() => startTransition(() => router.refresh())}
            className="min-h-[40px] px-4 rounded-lg text-sm font-semibold"
            style={{ background: 'var(--primary-color)', color: '#000' }}
          >
            Reintentar
          </button>
        </div>
      ) : (
        <div className={`flex flex-col gap-8 min-w-0 transition-opacity ${pending ? 'opacity-50' : ''}`}>
          <ReportBody slug={slug} report={report} categories={categories} />
        </div>
      )}
    </div>
  )
}

// ── Cuerpo ────────────────────────────────────────────────────────────────────

function ReportBody({ slug, report, categories }: { slug: string; report: ManagementReport; categories: CategoryInfo[] }) {
  const { pl, pl_prev: prev, kpis, kpis_prev: kprev } = report
  const insights = useMemo(() => buildInsights(report, slug), [report, slug])

  const avgTicket = kpis.sales_count > 0 ? pl.revenue.total / kpis.sales_count : 0
  const avgTicketPrev = kprev.sales_count > 0 ? prev.revenue.total / kprev.sales_count : 0
  const netPositive = pl.net_profit >= 0
  const netPct = pctChange(pl.net_profit, prev.net_profit)
  const today = report.period.today

  const noSales = kpis.sales_count === 0 && pl.revenue.total === 0

  return (
    <>
      {noSales && (
        <p className="text-sm text-xinuco-muted rounded-xl px-4 py-3" style={{ border: '1px solid var(--border-color)' }}>
          Todavía no hay ventas en este período. Cuando cobres tus primeros servicios, aquí verás cómo va el negocio.
        </p>
      )}

      {/* 1. ¿Cómo va el negocio? */}
      <Section title="¿Cómo va el negocio?">
        <div className="rounded-2xl p-4 sm:p-6 min-w-0" style={CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wider text-xinuco-muted">Utilidad del período</p>
          <p
            className={`mt-1 text-[40px] sm:text-5xl leading-none font-bold tabular-nums break-words ${netPositive ? STATUS_TEXT.good : STATUS_TEXT.critical}`}
          >
            <span aria-hidden className="text-2xl sm:text-3xl align-middle mr-1.5">{netPositive ? '▲' : '▼'}</span>
            {formatMoney(pl.net_profit)}
          </p>
          <p className="mt-2 text-xs text-xinuco-muted">
            {netPositive ? 'Lo que le quedó al negocio' : 'Lo que el negocio perdió'} después de pagar todo.
          </p>
          <div className="mt-1">
            {netPct === null ? (
              <Delta current={null} previous={null} />
            ) : (
              <Delta current={pl.net_profit} previous={prev.net_profit} suffix="vs período anterior" />
            )}
          </div>

          <div className="mt-4">
            <p className="text-[11px] text-xinuco-muted mb-1">Utilidad mes a mes (últimos 12 meses)</p>
            <Sparkline
              ariaLabel="Utilidad de los últimos 12 meses"
              points={trimMonthly(report.monthly).map(m => ({
                label: monthShort(m.month),
                value: m.net,
                tooltip: {
                  title: monthLabel(m.month),
                  rows: [
                    { label: 'Ingresos', value: formatMoney(m.revenue) },
                    { label: 'Costos', value: formatMoney(m.costs) },
                    { label: m.net >= 0 ? 'Utilidad' : 'Pérdida', value: formatMoney(m.net), marker: m.net >= 0 ? CHART.good : CHART.critical },
                  ],
                },
              }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatTile
            label="Ingresos"
            value={formatMoney(pl.revenue.total)}
            delta={<Delta current={pl.revenue.total} previous={prev.revenue.total} />}
          />
          <StatTile
            label="Margen"
            value={pl.margin_pct === null ? '—' : formatPct(pl.margin_pct, 1)}
            delta={<Delta mode="pts" current={pl.margin_pct} previous={prev.margin_pct} />}
          />
          <StatTile
            label="Ticket promedio"
            value={formatMoney(avgTicket)}
            delta={<Delta current={avgTicket} previous={avgTicketPrev} />}
          />
          <StatTile
            label="Clientes atendidos"
            value={formatInt(kpis.clients)}
            delta={<Delta current={kpis.clients} previous={kprev.clients} />}
          />
          <StatTile
            className="col-span-2 lg:col-span-1"
            label="Servicios hechos"
            value={formatInt(kpis.services)}
            delta={<Delta current={kpis.services} previous={kprev.services} />}
          />
        </div>
      </Section>

      {/* Recomendaciones (justo después del resumen) */}
      <Section title="Recomendaciones" hint="Lo más importante para hacer ahora, según tus números.">
        <InsightCards insights={insights} />
      </Section>

      {/* 2. ¿Ganando o perdiendo? */}
      <Section title="¿Ganando o perdiendo?">
        <ProfitMonths report={report} />
        <WaterfallCard report={report} categories={categories} />
      </Section>

      {/* 3. Plata que se escapó */}
      <Section title="Plata que se escapó" hint="Ventas que pudieron ser tuyas y no llegaron.">
        <LeaksCard report={report} />
      </Section>

      {/* 4. Oportunidades */}
      <Section title="Oportunidades" hint="Dónde hay espacio para crecer.">
        <HeatmapCard report={report} />
        <StaffCard report={report} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <TopListCard
            title="Servicios que más dejan"
            subtitle="Lo que más plata trajo este período."
            items={report.services}
            unit={['vez', 'veces']}
            emptyText="Aún no hay servicios cobrados en este período."
          />
          <TopListCard
            title="Productos que más venden"
            subtitle="Tus productos con más ventas."
            items={report.products}
            unit={['unidad', 'unidades']}
            emptyText="Aún no hay productos vendidos en este período."
          />
        </div>
        <CustomersCard report={report} />
        <AtRiskCard slug={slug} report={report} today={today} />
      </Section>
    </>
  )
}

// ── 2a. Utilidad mes a mes ────────────────────────────────────────────────────

function ProfitMonths({ report }: { report: ManagementReport }) {
  const months = useMemo(() => trimMonthly(report.monthly), [report.monthly])
  return (
    <ChartCard
      title="Utilidad mes a mes"
      subtitle="Verde: ganaste. Rojo: perdiste."
      table={{
        columns: ['Mes', 'Ingresos', 'Costos', 'Utilidad'],
        rows: months.map(m => [monthLabel(m.month), formatMoney(m.revenue), formatMoney(m.costs), formatMoneySigned(m.net)]),
      }}
    >
      {months.length === 0 ? (
        <EmptyNote>Aún no hay meses para comparar.</EmptyNote>
      ) : (
        <DivergingBars
          ariaLabel="Utilidad o pérdida de cada mes"
          data={months.map(m => ({
            label: monthShort(m.month),
            value: m.net,
            tooltip: {
              title: monthLabel(m.month),
              rows: [
                { label: 'Ingresos', value: formatMoney(m.revenue) },
                { label: 'Costos', value: formatMoney(m.costs) },
                { label: m.net >= 0 ? '▲ Utilidad' : '▼ Pérdida', value: formatMoney(m.net), marker: m.net >= 0 ? CHART.good : CHART.critical },
              ],
            },
          }))}
        />
      )}
    </ChartCard>
  )
}

// ── 2b. De cada $100 que entran… ──────────────────────────────────────────────

function WaterfallCard({ report, categories }: { report: ManagementReport; categories: CategoryInfo[] }) {
  const steps = useMemo(
    () => buildWaterfall(report.pl, slug => categoryName(slug, categories)),
    [report.pl, categories],
  )
  const hasRevenue = report.pl.revenue.total > 0
  const net = report.pl.net_profit
  const per100 = hasRevenue ? Math.round((net / report.pl.revenue.total) * 100) : null

  return (
    <ChartCard
      title="De cada $100 que entran…"
      subtitle={
        per100 === null
          ? 'Adónde se va la plata que entra.'
          : per100 >= 0
            ? `…te quedan $${per100}. Esto es lo que se va por el camino.`
            : `…pierdes $${Math.abs(per100)}. Esto es lo que se va por el camino.`
      }
      table={{
        columns: ['Concepto', 'Monto', 'Por cada $100'],
        rows: steps.map(s => [
          s.label,
          s.kind === 'start' || s.kind === 'result' ? formatMoney(s.value) : formatMoneySigned(s.value),
          s.kind === 'start' ? '$100' : per100Text(s.per100),
        ]),
      }}
    >
      {!hasRevenue && steps.length <= 2 ? (
        <EmptyNote>Aún no hay ingresos ni costos en este período.</EmptyNote>
      ) : (
        <Waterfall steps={steps} ariaLabel="Cascada desde los ingresos hasta la utilidad" />
      )}
    </ChartCard>
  )
}

// ── 3. Plata que se escapó ────────────────────────────────────────────────────

function LeaksCard({ report }: { report: ManagementReport }) {
  const { leaks: l, pl } = report

  const rows = [
    { label: `Cancelaciones (${formatInt(l.cancelled_count)})`, value: l.cancelled_value, note: 'Valor de los servicios de las citas canceladas.' },
    { label: `No asistió (${formatInt(l.no_show_count)})`, value: l.no_show_value, note: 'Valor de los servicios de las citas a las que el cliente no llegó.' },
    { label: 'Descuentos', value: pl.revenue.discounts, note: 'Descuentos que diste en las ventas.' },
    { label: `Ventas anuladas (${formatInt(l.voided_count)})`, value: l.voided_value, note: 'Ventas que se anularon después de cobrarlas.' },
    { label: 'Mermas de inventario', value: l.waste_value, note: 'Productos dañados, vencidos o perdidos (a costo).' },
    { label: 'Faltantes de caja', value: l.cash_shortfall, note: 'Plata que faltó al cerrar la caja.' },
  ]
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value)

  const total = rows.reduce((s, r) => s + r.value, 0)

  const items: HBarItem[] = rows.map(r => ({
    label: r.label,
    value: r.value,
    valueLabel: formatMoney(r.value),
    tooltip: {
      title: r.label,
      rows: [
        { label: 'Valor', value: formatMoney(r.value), marker: CHART.orange },
        { label: 'Del total que se escapó', value: formatPct((r.value / total) * 100) },
      ],
      note: r.note,
    },
  }))

  return (
    <ChartCard
      title={total > 0 ? `Se escaparon ${formatMoney(total)} este período` : 'Plata que se escapó'}
      subtitle={total > 0 ? 'De mayor a menor.' : undefined}
      table={{ columns: ['Concepto', 'Valor'], rows: rows.map(r => [r.label, formatMoney(r.value)]) }}
    >
      {rows.length === 0 ? (
        <p className="flex items-center justify-center gap-2 text-sm py-6 text-xinuco-text">
          <CheckCircle2 size={18} style={{ color: CHART.good }} aria-hidden />
          No se te escapó plata este período. ¡Buen trabajo!
        </p>
      ) : (
        <HBarList items={items} color={CHART.orange} ariaLabel="Plata que se escapó por motivo" />
      )}
    </ChartCard>
  )
}

// ── 4a. Mapa de calor ─────────────────────────────────────────────────────────

function HeatmapCard({ report }: { report: ManagementReport }) {
  const grid = useMemo(() => buildHeatmapGrid(report.heatmap), [report.heatmap])
  const rows: (string | number)[][] = []
  for (const r of grid.rows) {
    for (const h of grid.hours) {
      const c = grid.get(r.dow, h)
      if (!c) continue
      const occ = cellOccupancy(c)
      rows.push([`${DOW_NAMES[r.dow]} ${formatHour(h)}`, occ === null ? 'Sin horario' : formatPct(occ * 100), c.appointments])
    }
  }

  return (
    <ChartCard
      title="¿Cuándo están llenas tus sillas?"
      subtitle="Ocupación por día y hora. Los cuadros oscuros son horas vacías: ahí hay oportunidad."
      table={{ columns: ['Día y hora', 'Ocupación', 'Citas'], rows }}
    >
      {grid.hours.length === 0 ? (
        <EmptyNote>Todavía no hay horarios de trabajo ni citas para mostrar.</EmptyNote>
      ) : (
        <Heatmap cells={report.heatmap} ariaLabel="Ocupación por día de la semana y hora" />
      )}
    </ChartCard>
  )
}

// ── 4b. Ocupación por profesional ─────────────────────────────────────────────

function StaffCard({ report }: { report: ManagementReport }) {
  const staff = useMemo(
    () =>
      [...report.staff].sort((a, b) => (staffOccupancyPct(b) ?? -1) - (staffOccupancyPct(a) ?? -1) || b.produced - a.produced),
    [report.staff],
  )

  const items: HBarItem[] = staff.map(s => {
    const pct = staffOccupancyPct(s)
    const produced = `Produjo ${formatMoney(s.produced)} · ${pluralize(s.services, 'servicio', 'servicios')}`
    return {
      label: s.full_name,
      value: pct ?? 0,
      valueLabel: pct === null ? 'Sin horario' : formatPct(pct),
      sub: produced,
      tooltip: {
        title: s.full_name,
        rows: [
          { label: 'Agenda ocupada', value: pct === null ? '—' : formatPct(pct), marker: CHART.blue },
          { label: 'Horas de trabajo', value: `${formatInt(Math.round(s.scheduled_minutes / 60))} h` },
          { label: 'Horas con citas', value: `${formatInt(Math.round(s.booked_minutes / 60))} h` },
          { label: 'Produjo', value: formatMoney(s.produced) },
          { label: 'Servicios', value: formatInt(s.services) },
        ],
      },
    }
  })

  return (
    <ChartCard
      title="Ocupación por profesional"
      subtitle="Qué parte de su horario tiene citas."
      table={{
        columns: ['Profesional', 'Ocupación', 'Produjo', 'Servicios'],
        rows: staff.map(s => {
          const pct = staffOccupancyPct(s)
          return [s.full_name, pct === null ? 'Sin horario' : formatPct(pct), formatMoney(s.produced), s.services]
        }),
      }}
    >
      {items.length === 0 ? (
        <EmptyNote>Aún no hay profesionales activos.</EmptyNote>
      ) : (
        <HBarList items={items} max={100} color={CHART.blue} ariaLabel="Ocupación de la agenda de cada profesional" />
      )}
    </ChartCard>
  )
}

// ── 4c. Servicios / productos ─────────────────────────────────────────────────

function TopListCard({
  title, subtitle, items, unit, emptyText,
}: {
  title:     string
  subtitle:  string
  items:     ManagementReport['services']
  unit:      [string, string]
  emptyText: string
}) {
  const total = items.reduce((s, i) => s + i.revenue, 0)
  const bars: HBarItem[] = items.map(i => ({
    label: i.name,
    value: i.revenue,
    valueLabel: formatMoney(i.revenue),
    sub: pluralize(i.count, unit[0], unit[1]),
    tooltip: {
      title: i.name,
      rows: [
        { label: 'Ingresos', value: formatMoney(i.revenue), marker: CHART.aqua },
        { label: 'Cantidad', value: pluralize(i.count, unit[0], unit[1]) },
        ...(total > 0 ? [{ label: 'De este top', value: formatPct((i.revenue / total) * 100) }] : []),
      ],
    },
  }))
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      table={{ columns: ['Nombre', 'Cantidad', 'Ingresos'], rows: items.map(i => [i.name, i.count, formatMoney(i.revenue)]) }}
    >
      {bars.length === 0 ? <EmptyNote>{emptyText}</EmptyNote> : <HBarList items={bars} color={CHART.aqua} ariaLabel={title} />}
    </ChartCard>
  )
}

// ── 4d. Clientes nuevos vs. recurrentes ───────────────────────────────────────

function CustomersCard({ report }: { report: ManagementReport }) {
  const data = report.customers_monthly
  return (
    <ChartCard
      title="Clientes nuevos vs. recurrentes"
      subtitle="Clientes que te compraron cada mes (últimos 6 meses)."
      legend={[
        { label: 'Recurrentes', color: CHART.blue },
        { label: 'Nuevos', color: CHART.aqua },
      ]}
      table={{
        columns: ['Mes', 'Recurrentes', 'Nuevos', 'Total'],
        rows: data.map(m => [monthLabel(m.month), m.returning_clients, m.new_clients, m.returning_clients + m.new_clients]),
      }}
    >
      {data.length === 0 ? (
        <EmptyNote>Aún no hay clientes registrados en ventas.</EmptyNote>
      ) : (
        <StackedColumns
          ariaLabel="Clientes recurrentes y nuevos por mes"
          series={[
            { name: 'Recurrentes', color: CHART.blue },
            { name: 'Nuevos', color: CHART.aqua },
          ]}
          data={data.map(m => ({
            label: monthShort(m.month),
            values: [m.returning_clients, m.new_clients],
            tooltip: {
              title: monthLabel(m.month),
              rows: [
                { label: 'Recurrentes', value: formatInt(m.returning_clients), marker: CHART.blue },
                { label: 'Nuevos', value: formatInt(m.new_clients), marker: CHART.aqua },
                { label: 'Total', value: formatInt(m.returning_clients + m.new_clients) },
              ],
            },
          }))}
        />
      )}
    </ChartCard>
  )
}

// ── 4e. Clientes que no vuelven ───────────────────────────────────────────────

function AtRiskCard({ slug, report, today }: { slug: string; report: ManagementReport; today: string }) {
  const risk = report.at_risk
  const top = risk.top.slice(0, 5)
  return (
    <section className="rounded-2xl p-4 sm:p-5 min-w-0" style={CARD_STYLE} aria-label="Clientes que no vuelven">
      <h3 className="text-sm font-bold text-xinuco-text">Clientes que no vuelven</h3>
      {risk.count === 0 ? (
        <p className="flex items-center gap-2 text-sm text-xinuco-text mt-3">
          <CheckCircle2 size={18} style={{ color: CHART.good }} aria-hidden />
          Ningún cliente habitual lleva más de 45 días sin venir.
        </p>
      ) : (
        <>
          <p className="mt-2 text-4xl font-bold tabular-nums text-xinuco-text leading-none">
            {formatInt(risk.count)}
            <span className="ml-2 text-sm font-medium text-xinuco-muted">
              {risk.count === 1 ? 'cliente dejó de venir' : 'clientes dejaron de venir'}
            </span>
          </p>
          <p className="text-sm text-xinuco-muted mt-2">
            Antes gastaban <span className="font-semibold text-xinuco-text">{formatMoney(risk.monthly_value)}</span> al mes.
          </p>
          <ul className="mt-3">
            {top.map((c, i) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 py-2"
                style={i > 0 ? { borderTop: '1px solid var(--border-color)' } : undefined}
              >
                <div className="min-w-0">
                  <p className="text-sm text-xinuco-text truncate">{c.name}</p>
                  <p className="text-[11px] text-xinuco-muted">
                    Última visita {relativeDays(c.last_visit, today)}{!c.has_phone && ' · sin teléfono'}
                  </p>
                </div>
                <span className="text-xs tabular-nums text-xinuco-muted whitespace-nowrap">{formatMoney(c.monthly_value)}/mes</span>
              </li>
            ))}
          </ul>
          <Link
            href={`/${slug}/dashboard/crm`}
            className="inline-block mt-3 text-sm font-semibold hover:underline"
            style={{ color: 'var(--primary-color)' }}
          >
            Ver clientes →
          </Link>
        </>
      )}
    </section>
  )
}
