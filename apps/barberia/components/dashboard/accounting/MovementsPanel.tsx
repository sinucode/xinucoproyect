'use client'

import { useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  ArrowUpFromLine,
  HandCoins,
  Landmark,
  Package,
  Receipt,
  ShoppingBag,
  SlidersHorizontal,
  Undo2,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { MoneyMovement, MoneyMovementSource } from '@xinuco/types'
import { formatCOP } from '@xinuco/utils'
import { SOURCE_LABEL, internalMoneyNote, movementMediumLabel, summarizeMovements } from '@/lib/accounting-utils'
import { auditDayLabel } from '@/lib/audit-utils'

const SOURCE_ICON: Record<MoneyMovementSource, LucideIcon> = {
  sale:               ShoppingBag,
  asset_sale:         Wrench,
  expense:            Receipt,
  team_advance:       Wallet,
  team_payment:       Users,
  inventory_purchase: Package,
  asset_purchase:     Wrench,
  owner_contribution: HandCoins,
  owner_loan:         Landmark,
  loan_repayment:     Undo2,
  owner_withdrawal:   ArrowUpFromLine,
  transfer_in:        ArrowLeftRight,
  transfer_out:       ArrowLeftRight,
  adjustment:         SlidersHorizontal,
}

type KindFilter = 'all' | 'in' | 'out'

const KIND_CHIPS: { key: KindFilter; label: string }[] = [
  { key: 'all', label: 'Todo' },
  { key: 'in',  label: 'Entradas' },
  { key: 'out', label: 'Salidas' },
]

const PAGE_SIZE = 150

const cardStyle = {
  background: 'rgb(var(--fg) / 0.03)',
  border: '1px solid var(--border-color)',
} as const

function signed(value: number): string {
  return `${value < 0 ? '−' : ''}${formatCOP(Math.abs(value))}`
}

function SummaryCard({ label, value, color, className = '' }: { label: string; value: string; color: string; className?: string }) {
  return (
    <div className={`rounded-xl p-3 sm:p-4 min-w-0 ${className}`} style={cardStyle}>
      <p className="text-[11px] font-semibold text-xinuco-muted uppercase tracking-wider">{label}</p>
      <p className={`text-lg sm:text-xl font-bold tabular-nums mt-1 break-words ${color}`}>{value}</p>
    </div>
  )
}

function MovementRow({ m }: { m: MoneyMovement }) {
  const Icon = SOURCE_ICON[m.source] ?? Wallet
  const isPoints = m.method === 'loyalty_points'
  const isIn = m.kind === 'in'
  const amountColor = isPoints ? 'text-xinuco-muted' : isIn ? 'text-emerald-400' : 'text-red-400'
  const details = [
    m.category,
    movementMediumLabel(m),
    m.occurred_time,
  ].filter(Boolean).join(' · ')

  return (
    <li className="flex items-start gap-3 py-3">
      <span
        className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-xinuco-muted"
        style={{ background: 'rgb(var(--fg) / 0.05)' }}
        title={SOURCE_LABEL[m.source]}
        aria-hidden
      >
        <Icon size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-xinuco-text break-words">{m.description}</p>
        <p className="text-[11px] text-xinuco-muted mt-0.5 break-words">{details}</p>
        {m.tip > 0 && (
          <p className="text-[11px] text-xinuco-muted mt-0.5">Incluye {formatCOP(m.tip)} de propina</p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className={`text-sm font-semibold tabular-nums whitespace-nowrap ${amountColor}`}>
          {isPoints ? '' : isIn ? '+' : '−'}{formatCOP(m.amount)}
        </p>
        {isPoints && <p className="text-[10px] text-xinuco-muted mt-0.5">con puntos</p>}
      </div>
    </li>
  )
}

export function MovementsPanel({ rows, today }: { rows: MoneyMovement[]; today: string }) {
  const [kind, setKind] = useState<KindFilter>('all')
  const [medium, setMedium] = useState<string>('all')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const summary = useMemo(() => summarizeMovements(rows), [rows])
  // Aportes, préstamos, retiros, traslados y ajustes cuentan en Entró/Salió: se avisa cuánto es de cada cosa
  const internalNotes = useMemo(
    () => [internalMoneyNote(summary, 'in'), internalMoneyNote(summary, 'out')].filter((n): n is string => !!n),
    [summary],
  )

  // Medios presentes en el mes (incluye "Puntos" si hubo ventas pagadas con puntos)
  const mediumOptions = useMemo(() => {
    const set = new Set<string>(rows.map(movementMediumLabel))
    return [...set].sort((a, b) => a.localeCompare(b, 'es'))
  }, [rows])

  const filtered = useMemo(() => {
    const list = rows.filter(r =>
      (kind === 'all' || r.kind === kind) && (medium === 'all' || movementMediumLabel(r) === medium),
    )
    // Más reciente primero: día y luego hora (sin hora, al final del día)
    return list.sort((a, b) =>
      b.occurred_on.localeCompare(a.occurred_on) ||
      (b.occurred_time ?? '').localeCompare(a.occurred_time ?? ''),
    )
  }, [rows, kind, medium])

  const visible = filtered.slice(0, limit)

  const groups = useMemo(() => {
    const out: { day: string; items: MoneyMovement[] }[] = []
    for (const m of visible) {
      const last = out[out.length - 1]
      if (last && last.day === m.occurred_on) last.items.push(m)
      else out.push({ day: m.occurred_on, items: [m] })
    }
    return out
  }, [visible])

  if (rows.length === 0) {
    return (
      <section className="rounded-2xl p-8 text-center" style={cardStyle}>
        <p className="text-sm font-semibold text-xinuco-text">No hubo movimientos este mes.</p>
        <p className="text-xs text-xinuco-muted mt-1">Cuando cobres ventas o registres gastos, aparecerán aquí.</p>
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Resumen */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <SummaryCard label="Entró" value={formatCOP(summary.moneyIn)} color="text-emerald-400" />
        <SummaryCard label="Salió" value={formatCOP(summary.moneyOut)} color="text-red-400" />
        <SummaryCard
          label="Quedó"
          value={signed(summary.net)}
          color={summary.net >= 0 ? 'text-emerald-400' : 'text-red-400'}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {(summary.tips > 0 || summary.pointsUsed > 0 || internalNotes.length > 0) && (
        <div className="flex flex-col gap-1 text-[11px] text-xinuco-muted -mt-2">
          {internalNotes.map(note => <p key={note}>{note}</p>)}
          {summary.tips > 0 && <p>Incluye {formatCOP(summary.tips)} de propinas (son de los profesionales).</p>}
          {summary.pointsUsed > 0 && (
            <p>Pagado con puntos: {formatCOP(summary.pointsUsed)} (no es plata que entró).</p>
          )}
        </div>
      )}

      {/* Por medio de pago */}
      {summary.byAccount.length > 0 && (
        <section className="rounded-2xl p-4 sm:p-5" style={cardStyle} aria-label="Por medio de pago">
          <h2 className="text-sm font-bold text-xinuco-text">Por medio de pago</h2>
          <p className="text-[11px] text-xinuco-muted mt-0.5">Úsalo para cuadrar con el banco y la caja.</p>
          <ul className="mt-2 divide-y" style={{ borderColor: 'var(--border-color)' }}>
            {summary.byAccount.map(m => (
              <li key={m.label} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-xinuco-text">{m.label}</p>
                  <p className="text-[11px] text-xinuco-muted mt-0.5 break-words">
                    Entró {formatCOP(m.in)} · Salió {formatCOP(m.out)}
                  </p>
                </div>
                <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${m.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {signed(m.net)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-2" role="group" aria-label="Tipo de movimiento">
          {KIND_CHIPS.map(c => {
            const active = kind === c.key
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={active}
                onClick={() => { setKind(c.key); setLimit(PAGE_SIZE) }}
                className="min-h-9 px-3.5 rounded-full text-xs font-semibold transition-colors"
                style={active
                  ? { background: 'var(--primary-color)', color: '#000', border: '1px solid var(--primary-color)' }
                  : { border: '1px solid var(--border-color)', color: 'var(--text-muted, #a1a1aa)' }}
              >
                {c.label}
              </button>
            )
          })}
        </div>
        <select
          value={medium}
          onChange={e => { setMedium(e.target.value); setLimit(PAGE_SIZE) }}
          aria-label="Medio de pago"
          className="input-base sm:w-56 sm:ml-auto"
        >
          <option value="all">Todos los medios de pago</option>
          {mediumOptions.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {/* Lista por día */}
      {filtered.length === 0 ? (
        <p className="text-sm text-xinuco-muted text-center py-8">No hay movimientos con ese filtro.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(g => (
            <section key={g.day} className="rounded-2xl px-4" style={cardStyle} aria-label={auditDayLabel(g.day, today)}>
              <h3 className="text-[11px] font-semibold text-xinuco-muted uppercase tracking-wider pt-3">
                {auditDayLabel(g.day, today)}
              </h3>
              <ul className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                {g.items.map((m, i) => (
                  <MovementRow key={`${m.source}-${m.reference_id ?? ''}-${m.occurred_time ?? ''}-${i}`} m={m} />
                ))}
              </ul>
            </section>
          ))}

          {filtered.length > visible.length && (
            <button
              type="button"
              onClick={() => setLimit(l => l + PAGE_SIZE)}
              className="min-h-10 rounded-xl text-sm font-semibold text-xinuco-muted hover:text-xinuco-text transition-colors"
              style={{ border: '1px solid var(--border-color)' }}
            >
              Ver más ({(filtered.length - visible.length).toLocaleString('es-CO')} restantes)
            </button>
          )}
        </div>
      )}
    </div>
  )
}
