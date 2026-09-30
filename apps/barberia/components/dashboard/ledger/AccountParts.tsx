'use client'

// Piezas compartidas por "Pagos al equipo" (admin) y "Mi cuenta" (profesional, solo lectura):
// resumen de saldo, desglose desde el último pago e historial con filtros.

import { useCallback, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Wallet,
  Banknote,
  ArrowLeftRight,
  Loader2,
  Info,
  TrendingUp,
  ArrowUpRight,
  ArrowDownLeft,
  Gift,
  MinusCircle,
  HandCoins,
  type LucideIcon,
} from 'lucide-react'
import type { LedgerEntryType, TeamPaymentMethod } from '@xinuco/types'
import { formatCOP } from '@xinuco/utils'
import type { AccountEntry, StaffAccount } from '@/actions/ledger'
import {
  ENTRY_LABELS,
  ENTRY_SIGN,
  ENTRY_TYPES,
  TEAM_METHOD_SHORT,
  bogotaDateKey,
  formatLedgerDateTime,
  shortDateLabel,
} from '@/lib/team-payments'

// ── Filtros (vienen de la URL, ya validados en la página) ─────────────────────

export interface AccountViewFilters {
  type: LedgerEntryType | 'all'
  from: string   // 'YYYY-MM-DD' o ''
  to:   string
}

/**
 * Navegación por searchParams: cambiar filtros o pedir "Ver más" recarga la página del servidor
 * con los nuevos parámetros (los datos siempre salen del servidor, nunca del cliente).
 */
export function useAccountUrl() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const setParams = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    const qs = next.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    })
  }, [pathname, router, searchParams])

  return { setParams, pending }
}

// ── Badge de tipo ─────────────────────────────────────────────────────────────

const ENTRY_STYLE: Record<LedgerEntryType, { colors: string; icon: LucideIcon }> = {
  commission: { colors: 'text-amber-400 bg-amber-400/10 border-amber-400/20',       icon: TrendingUp },
  tip:        { colors: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20', icon: ArrowUpRight },
  bonus:      { colors: 'text-lime-400 bg-lime-400/10 border-lime-400/20',          icon: Gift },
  deduction:  { colors: 'text-rose-400 bg-rose-400/10 border-rose-400/20',          icon: MinusCircle },
  advance:    { colors: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',    icon: ArrowDownLeft },
  payment:    { colors: 'text-sky-400 bg-sky-400/10 border-sky-400/20',             icon: HandCoins },
}

export function EntryTypeBadge({ type }: { type: LedgerEntryType }) {
  const { colors, icon: Icon } = ENTRY_STYLE[type]
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap ${colors}`}
    >
      <Icon size={10} />
      {ENTRY_LABELS[type]}
    </span>
  )
}

// ── Medio de pago ─────────────────────────────────────────────────────────────

export const METHOD_ICONS: Record<TeamPaymentMethod, LucideIcon> = {
  cash_register: Banknote,
  transfer:      ArrowLeftRight,
  other:         Wallet,
}

function MethodTag({ method }: { method: TeamPaymentMethod }) {
  const Icon = METHOD_ICONS[method] ?? Wallet
  const isCash = method === 'cash_register'
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] ${
        isCash ? 'font-semibold px-2 py-0.5 rounded-full border' : 'text-xinuco-muted'
      }`}
      style={isCash ? {
        color: 'var(--primary-color)',
        borderColor: 'color-mix(in srgb, var(--primary-color) 35%, transparent)',
        background: 'color-mix(in srgb, var(--primary-color) 10%, transparent)',
      } : undefined}
    >
      <Icon size={11} />
      {TEAM_METHOD_SHORT[method]}
    </span>
  )
}

// ── Montos con signo ──────────────────────────────────────────────────────────

/** '−$ 10.000' (resta) o '$ 10.000'. */
function money(value: number): string {
  return `${value < 0 ? '−' : ''}${formatCOP(Math.abs(value))}`
}

// ════════════════════════════════════════════════════════════════════════════
// Resumen de saldo + desglose "desde el último pago"
// ════════════════════════════════════════════════════════════════════════════

function BreakdownRow({
  label, value, sign, strong,
}: { label: string; value: number; sign: 1 | -1; strong?: boolean }) {
  const muted = value === 0
  return (
    <div className={`flex items-center justify-between gap-3 text-sm ${strong ? 'font-bold text-xinuco-text' : ''}`}>
      <span className={strong ? '' : 'text-xinuco-muted'}>{label}</span>
      <span
        className={`tabular-nums ${muted && !strong ? 'text-xinuco-muted' : ''} ${
          !strong && !muted ? (sign === 1 ? 'text-emerald-400' : 'text-red-400') : ''
        }`}
      >
        {value === 0 ? formatCOP(0) : sign === -1 ? `−${formatCOP(value)}` : formatCOP(value)}
      </span>
    </div>
  )
}

export function BalanceSummary({ account }: { account: StaffAccount }) {
  const { balance, settlement } = account
  const negative = balance < 0
  const sinceLabel = settlement.since ? shortDateLabel(bogotaDateKey(settlement.since)) : 'nunca'
  const differs = balance !== settlement.total_to_pay

  return (
    <section
      aria-label="Saldo"
      className="rounded-2xl p-5 flex flex-col gap-4 animate-fade-in"
      style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.03))' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider mb-1">
            Saldo total
          </span>
          <span
            className="text-3xl font-bold tabular-nums leading-none"
            style={{ color: negative ? '#f87171' : 'var(--primary-color)' }}
          >
            {money(balance)}
          </span>
          <span className="text-xs text-xinuco-muted mt-1.5">
            {negative
              ? 'Tiene anticipos por descontar en su próxima liquidación.'
              : balance === 0 ? 'Está al día.' : 'Es lo que se le debe hoy.'}
          </span>
        </div>
        <div
          className="w-12 h-12 shrink-0 rounded-xl flex items-center justify-center border"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
            borderColor:     'color-mix(in srgb, var(--primary-color) 25%, transparent)',
          }}
        >
          <Wallet size={22} style={{ color: 'var(--primary-color)' }} />
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
        <h3 className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
          Desde el último pago ({sinceLabel})
        </h3>
        <BreakdownRow label="Comisiones servicios" value={settlement.services_commission} sign={1} />
        <BreakdownRow label="Comisiones productos" value={settlement.products_commission} sign={1} />
        <BreakdownRow label="Propinas"             value={settlement.tips}                sign={1} />
        <BreakdownRow label="Bonos / a favor"      value={settlement.bonus}               sign={1} />
        <BreakdownRow label="Descuentos"           value={settlement.deductions}          sign={-1} />
        <BreakdownRow label="Anticipos"            value={settlement.advances}            sign={-1} />
        <div className="pt-2 mt-1" style={{ borderTop: '1px solid var(--border-color)' }}>
          <div className="flex items-center justify-between gap-3 text-sm font-bold text-xinuco-text">
            <span>Total a pagar</span>
            <span
              className="tabular-nums"
              style={{ color: settlement.total_to_pay < 0 ? '#f87171' : 'var(--primary-color)' }}
            >
              {money(settlement.total_to_pay)}
            </span>
          </div>
        </div>
        {differs && (
          <p className="text-xs text-xinuco-muted flex items-start gap-1.5 mt-1">
            <Info size={12} className="shrink-0 mt-0.5" />
            <span>
              El saldo total incluye movimientos anteriores al último pago (un pago que no saldó todo o se pagó de más).
            </span>
          </p>
        )}
      </div>
    </section>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Historial con filtros y "Ver más"
// ════════════════════════════════════════════════════════════════════════════

function EntryRow({ entry }: { entry: AccountEntry }) {
  const signed = ENTRY_SIGN[entry.entry_type] * entry.amount
  const period = entry.entry_type === 'payment' && entry.period_from && entry.period_to
    ? `Período: ${shortDateLabel(entry.period_from)} – ${shortDateLabel(entry.period_to)}`
    : null
  const isProduct = entry.entry_type === 'commission' && entry.item_type === 'product'
  const note = entry.notes || (isProduct ? 'Comisión de producto' : '—')

  const amount = (
    <span
      className={`text-sm font-bold tabular-nums text-right whitespace-nowrap ${
        signed >= 0 ? 'text-emerald-400' : 'text-red-400'
      }`}
    >
      {signed >= 0 ? '+' : '−'}{formatCOP(entry.amount)}
    </span>
  )

  const meta = (
    <span className="text-[11px] text-xinuco-muted flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{formatLedgerDateTime(entry.created_at)}</span>
      {period && <span>{period}</span>}
      {entry.payment_method && <MethodTag method={entry.payment_method} />}
    </span>
  )

  return (
    <li style={{ borderTop: '1px solid var(--border-color)' }}>
      {/* Escritorio */}
      <div className="hidden sm:grid grid-cols-[9rem_1fr_auto] items-center gap-x-4 px-4 py-3.5">
        <div><EntryTypeBadge type={entry.entry_type} /></div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm text-xinuco-text break-words">{note}</span>
          {meta}
        </div>
        {amount}
      </div>

      {/* Móvil */}
      <div className="sm:hidden flex flex-col gap-1.5 px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <EntryTypeBadge type={entry.entry_type} />
          {amount}
        </div>
        <span className="text-sm text-xinuco-text break-words">{note}</span>
        {meta}
      </div>
    </li>
  )
}

export function AccountHistory({
  account,
  filters,
  onFiltersChange,
  onLoadMore,
  pending,
}: {
  account: StaffAccount
  filters: AccountViewFilters
  onFiltersChange: (next: Partial<AccountViewFilters>) => void
  onLoadMore: () => void
  pending: boolean
}) {
  const hasFilters = filters.type !== 'all' || !!filters.from || !!filters.to

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap ${
      active ? '' : 'text-xinuco-muted hover:text-xinuco-text'
    }`
  const chipStyle = (active: boolean) => active
    ? {
        borderColor: 'var(--primary-color)',
        color: 'var(--primary-color)',
        background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
      }
    : { borderColor: 'var(--border-color)' }

  return (
    <section aria-label="Historial" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-xinuco-text uppercase tracking-wider">Historial</h2>
        {pending && <Loader2 size={14} className="animate-spin text-xinuco-muted" aria-label="Cargando" />}
      </div>

      {/* Filtros: tipo */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por tipo">
        <button
          type="button"
          onClick={() => onFiltersChange({ type: 'all' })}
          aria-pressed={filters.type === 'all'}
          className={chip(filters.type === 'all')}
          style={chipStyle(filters.type === 'all')}
        >
          Todos
        </button>
        {ENTRY_TYPES.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => onFiltersChange({ type: t })}
            aria-pressed={filters.type === t}
            className={chip(filters.type === t)}
            style={chipStyle(filters.type === t)}
          >
            {ENTRY_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Filtros: fechas */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-xinuco-muted uppercase tracking-wider">
          Desde
          <input
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={e => onFiltersChange({ from: e.target.value })}
            className="input-base !py-2 !px-3 !text-xs normal-case font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-xinuco-muted uppercase tracking-wider">
          Hasta
          <input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={e => onFiltersChange({ to: e.target.value })}
            className="input-base !py-2 !px-3 !text-xs normal-case font-normal"
          />
        </label>
        {hasFilters && (
          <button
            type="button"
            onClick={() => onFiltersChange({ type: 'all', from: '', to: '' })}
            className="text-xs font-medium hover:underline pb-2.5"
            style={{ color: 'var(--primary-color)' }}
          >
            Quitar filtros
          </button>
        )}
      </div>

      {account.entries.length === 0 ? (
        <div
          className="rounded-xl px-4 py-10 text-center text-sm text-xinuco-muted"
          style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.02))' }}
        >
          {hasFilters ? 'No hay movimientos con esos filtros.' : 'Todavía no hay movimientos.'}
        </div>
      ) : (
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.02))' }}
        >
          <div
            className="hidden sm:grid grid-cols-[9rem_1fr_auto] gap-x-4 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-xinuco-muted"
            style={{ background: 'var(--surface-color, rgba(255,255,255,0.03))' }}
          >
            <span>Tipo</span>
            <span>Detalle</span>
            <span className="text-right">Monto</span>
          </div>
          <ul>
            {account.entries.map(entry => <EntryRow key={entry.id} entry={entry} />)}
          </ul>
        </div>
      )}

      {account.hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={pending}
          className="btn-ghost !py-2.5 text-xs self-center"
        >
          {pending ? <Loader2 size={13} className="animate-spin" /> : null}
          Ver más ({account.total - account.entries.length} restantes)
        </button>
      )}
    </section>
  )
}
