'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { StaffProduction } from '@xinuco/types'
import { formatCOP } from '@xinuco/utils'
import { sortStaffByProduction, staffTotals, summarizeStaff } from '@/lib/accounting-utils'

const cardStyle = {
  background: 'var(--surface-color, rgba(255,255,255,0.03))',
  border: '1px solid var(--border-color)',
} as const

function signed(value: number): string {
  return `${value < 0 ? '−' : ''}${formatCOP(Math.abs(value))}`
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl p-3 sm:p-4 min-w-0" style={cardStyle}>
      <p className="text-[11px] font-semibold text-xinuco-muted uppercase tracking-wider">{label}</p>
      <p className={`text-lg sm:text-xl font-bold tabular-nums mt-1 break-words ${color}`}>{value}</p>
    </div>
  )
}

function Line({ label, value, detail, valueClass = 'text-xinuco-text' }: {
  label:       string
  value:       string
  detail?:     string
  valueClass?: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-xinuco-muted">{label}</span>
        <span className={`text-sm font-bold tabular-nums ${valueClass}`}>{value}</span>
      </div>
      {detail && <p className="text-[11px] text-xinuco-muted mt-0.5 break-words">{detail}</p>}
    </div>
  )
}

function StaffCard({ row, max, ledgerHref }: { row: StaffProduction; max: number; ledgerHref: string }) {
  const t = staffTotals(row)
  const pct = max > 0 ? Math.max(0, Math.min(100, (t.produced / max) * 100)) : 0

  const producedDetail = [
    `servicios ${formatCOP(row.services_revenue)}`,
    `productos ${formatCOP(row.products_revenue)}`,
    `${row.services_count.toLocaleString('es-CO')} ${row.services_count === 1 ? 'servicio' : 'servicios'}`,
  ].join(' · ')

  const earnedParts = [
    row.commissions ? `comisiones ${formatCOP(row.commissions)}` : null,
    row.tips        ? `propinas ${formatCOP(row.tips)}` : null,
    row.bonuses     ? `bonos ${formatCOP(row.bonuses)}` : null,
    row.deductions  ? `descuentos −${formatCOP(row.deductions)}` : null,
  ].filter(Boolean) as string[]

  const paidParts = [
    row.advances ? `anticipos ${formatCOP(row.advances)}` : null,
    row.payments ? `pagos ${formatCOP(row.payments)}` : null,
  ].filter(Boolean) as string[]

  const balance = row.balance_now

  return (
    <li className="rounded-2xl p-4 flex flex-col gap-3 min-w-0" style={cardStyle}>
      <div className="flex items-center gap-2 min-w-0">
        <h3 className="text-sm font-bold text-xinuco-text truncate">{row.full_name}</h3>
        {!row.is_active && (
          <span
            className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-xinuco-muted rounded-full px-2 py-0.5"
            style={{ border: '1px solid var(--border-color)' }}
          >
            inactivo
          </span>
        )}
      </div>

      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)' }}
        role="img"
        aria-label={`Produjo ${formatCOP(t.produced)}`}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--primary-color)' }} />
      </div>

      <div className="flex flex-col gap-2.5">
        <Line label="Produjo" value={formatCOP(t.produced)} detail={producedDetail} />
        <Line
          label="Ganó"
          value={signed(t.earned)}
          detail={earnedParts.length ? earnedParts.join(' · ') : undefined}
        />
        <Line
          label="Se le pagó"
          value={formatCOP(t.paid)}
          detail={paidParts.length ? paidParts.join(' · ') : undefined}
        />
        <Line label="Le quedó al negocio" value={signed(t.kept)} valueClass={t.kept < 0 ? 'text-red-400' : 'text-emerald-400'} />
      </div>

      <div
        className="flex items-center justify-between gap-3 pt-3 flex-wrap"
        style={{ borderTop: '1px solid var(--border-color)' }}
      >
        <p className={`text-sm font-bold tabular-nums ${balance > 0 ? 'text-amber-400' : balance < 0 ? 'text-red-400' : 'text-xinuco-muted'}`}>
          {balance < 0
            ? `Le pagaste de más ${formatCOP(Math.abs(balance))}`
            : `Saldo pendiente hoy ${formatCOP(balance)}`}
        </p>
        <Link
          href={ledgerHref}
          className="text-xs font-semibold min-h-10 inline-flex items-center"
          style={{ color: 'var(--primary-color)' }}
        >
          Ver cuenta →
        </Link>
      </div>
    </li>
  )
}

export function StaffPanel({ slug, rows }: { slug: string; rows: StaffProduction[] }) {
  const sorted = useMemo(() => sortStaffByProduction(rows), [rows])
  const summary = useMemo(() => summarizeStaff(rows), [rows])
  const max = sorted.length ? staffTotals(sorted[0]).produced : 0
  const hasActivity = rows.some(r => {
    const t = staffTotals(r)
    return t.produced !== 0 || t.earned !== 0 || t.paid !== 0 || r.services_count > 0
  })
  const ledgerHref = `/${slug}/dashboard/ledger`

  if (!hasActivity) {
    return (
      <section className="rounded-2xl p-6 text-center" style={cardStyle} aria-label="Por profesional">
        <p className="text-sm text-xinuco-muted">No hubo ventas ni pagos al equipo este mes.</p>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Por profesional">
      <div className="grid grid-cols-2 gap-3">
        <SummaryCard label="El equipo produjo" value={formatCOP(summary.produced)} color="text-xinuco-text" />
        <SummaryCard label="Ganó" value={signed(summary.earned)} color="text-emerald-400" />
        <SummaryCard label="Se le pagó" value={formatCOP(summary.paid)} color="text-xinuco-text" />
        <SummaryCard
          label="Pendiente hoy"
          value={signed(summary.pending)}
          color={summary.pending > 0 ? 'text-amber-400' : 'text-xinuco-text'}
        />
      </div>

      <ul className="flex flex-col gap-3">
        {sorted.map(r => (
          <StaffCard key={r.staff_id} row={r} max={max} ledgerHref={ledgerHref} />
        ))}
      </ul>

      <p className="text-[11px] text-xinuco-muted">
        Las propinas son del profesional: no cuentan en lo que produjo para el negocio. Las ventas anuladas no cuentan.
      </p>
    </section>
  )
}
