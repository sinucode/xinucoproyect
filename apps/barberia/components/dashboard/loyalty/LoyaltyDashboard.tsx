'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Gift,
  Search,
  X,
  Loader2,
  Check,
  AlertCircle,
  Users,
  Award,
  Coins,
  Stamp,
  SlidersHorizontal,
  History,
  Settings,
} from 'lucide-react'
import {
  adjustCustomerLoyalty,
  applyPendingLoyalty,
  findCustomerLoyalty,
} from '@/actions/loyalty'
import type { CustomerLoyaltyResult, LoyaltyOverview } from '@/actions/loyalty'
import {
  describeRule,
  formatMoney,
  formatUnits,
  type CustomerLoyalty,
  type LoyaltyMode,
  type LoyaltyMovement,
} from '@/lib/loyalty-utils'
import { StampDots } from './StampDots'
import { AdminPageHeader } from '@xinuco/ui'

// ── Props ─────────────────────────────────────────────────────────────────────

interface LoyaltyDashboardProps {
  slug:     string
  overview: LoyaltyOverview
  /** Solo un administrador puede ajustar saldos y aplicar a ventas anteriores. */
  isAdmin:  boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const dateFmt = new Intl.DateTimeFormat('es-CO', {
  timeZone:  'America/Bogota',
  day:       '2-digit',
  month:     'short',
  year:      'numeric',
  hour:      '2-digit',
  minute:    '2-digit',
  hourCycle: 'h23',
})

function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso))
}

const unitWord = (mode: LoyaltyMode, n: number) =>
  mode === 'points' ? (n === 1 ? 'punto' : 'puntos') : (n === 1 ? 'sello' : 'sellos')

const CARD_STYLE = { border: '1px solid var(--border-color)', background: 'rgb(var(--fg) / 0.02)' }

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL — LoyaltyDashboard
// ════════════════════════════════════════════════════════════════════════════

export function LoyaltyDashboard({ slug, overview, isAdmin }: LoyaltyDashboardProps) {
  const { settings, summary, movements } = overview
  const mode = settings.loyalty_mode

  return (
    <>
      <AdminPageHeader
        title="Lealtad"
        subtitle={describeRule(settings)}
        hasData={isAdmin}
        actionButton={
          <Link
            href={`/${slug}/dashboard/settings/loyalty`}
            className="btn-ghost flex items-center gap-2 !py-2 !px-3 text-xs"
          >
            <Settings size={14} />
            Cambiar en Configuración
          </Link>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Users size={18} />}
          label="Clientes con saldo"
          value={formatUnits(summary.customers_with_balance)}
        />
        <StatCard
          icon={mode === 'points' ? <Coins size={18} /> : <Stamp size={18} />}
          label={mode === 'points' ? 'Puntos vigentes' : 'Sellos vigentes'}
          value={formatUnits(summary.total_balance)}
          hint={mode === 'points' ? `Equivalen a ${formatMoney(summary.total_balance * settings.loyalty_point_value_cop)}` : undefined}
        />
        <StatCard
          icon={<Gift size={18} />}
          label="Listos para canjear"
          value={formatUnits(summary.customers_ready)}
          hint={mode === 'stamps' ? 'tienen su servicio gratis' : 'clientes con saldo para canjear'}
        />
        <StatCard
          icon={<Award size={18} />}
          label="Canjeado"
          value={`${formatUnits(summary.redeemed_total)} ${unitWord(mode, summary.redeemed_total)}`}
          hint={`${formatMoney(summary.discount_given_cop)} en descuentos`}
        />
      </div>

      {isAdmin && <ApplyPending />}

      <CustomerLookup mode={mode} isAdmin={isAdmin} />

      <MovementsTable movements={movements} mode={mode} />
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// STAT CARD
// ════════════════════════════════════════════════════════════════════════════

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon:  React.ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl p-5 flex flex-col gap-2" style={{ border: '1px solid var(--border-color)' }}>
      <div className="flex items-center gap-2 text-xinuco-muted">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <span className="text-2xl font-bold tabular-nums" style={{ color: 'var(--primary-color)' }}>
        {value}
      </span>
      {hint && <span className="text-xs text-xinuco-muted">{hint}</span>}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// APLICAR A VENTAS ANTERIORES (admin)
// ════════════════════════════════════════════════════════════════════════════

function ApplyPending() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function handleApply() {
    setMessage(null)
    startTransition(async () => {
      const res = await applyPendingLoyalty()
      if (res.error) {
        setMessage({ ok: false, text: res.error })
        return
      }
      const sales = res.sales ?? 0
      setMessage({
        ok: true,
        text: sales === 0
          ? 'No había ventas pendientes este mes: todo estaba al día.'
          : `Se aplicó a ${formatUnits(sales)} ${sales === 1 ? 'venta' : 'ventas'} (${formatUnits(res.units ?? 0)} en total).`,
      })
      router.refresh()
    })
  }

  return (
    <div className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={CARD_STYLE}>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-xinuco-text">Ventas anteriores</p>
        <p className="text-xs text-xinuco-muted">
          Da lealtad a las ventas pagadas de este mes que aún no la tienen. No duplica las que ya la recibieron.
        </p>
        {message && (
          <p
            role={message.ok ? 'status' : 'alert'}
            className={`text-xs mt-2 ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}
          >
            {message.text}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={handleApply}
        disabled={isPending}
        className="btn-ghost flex items-center gap-2 !py-2 !px-3 text-xs shrink-0"
      >
        {isPending ? <Loader2 size={13} className="animate-spin" /> : <History size={13} />}
        Aplicar a ventas anteriores
      </button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BUSCAR CLIENTE — por teléfono o nombre
// ════════════════════════════════════════════════════════════════════════════

function CustomerLookup({ mode, isAdmin }: { mode: LoyaltyMode; isAdmin: boolean }) {
  const [query, setQuery]       = useState('')
  const [lastQuery, setLastQuery] = useState('')
  const [results, setResults]   = useState<CustomerLoyaltyResult[] | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<CustomerLoyaltyResult | null>(null)
  const [isPending, startTransition] = useTransition()

  function search(q: string) {
    startTransition(async () => {
      const res = await findCustomerLoyalty(q)
      setError(res.error ?? null)
      setResults(res.error ? null : res.results)
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (q.length < 2) {
      setError('Escribe al menos 2 letras del nombre o números del teléfono.')
      setResults(null)
      return
    }
    setLastQuery(q)
    search(q)
  }

  return (
    <section className="rounded-xl p-5 flex flex-col gap-4" style={CARD_STYLE} aria-label="Buscar cliente">
      <div>
        <h2 className="text-sm font-bold text-xinuco-text">Consultar un cliente</h2>
        <p className="text-xs text-xinuco-muted">Busca por teléfono o nombre para ver su saldo.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-xinuco-muted pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Teléfono o nombre"
            className="input-base !pl-9 !py-2.5"
            aria-label="Buscar cliente por teléfono o nombre"
          />
        </div>
        <button type="submit" disabled={isPending} className="btn-primary !py-2.5 !px-4 text-sm">
          {isPending ? <Loader2 size={15} className="animate-spin" /> : 'Buscar'}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {results && results.length === 0 && !error && (
        <p className="text-sm text-xinuco-muted">No se encontró ningún cliente con «{lastQuery}».</p>
      )}

      {results && results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((r) => (
            <li key={r.customer.id}>
              <CustomerCard result={r} mode={mode} canAdjust={isAdmin} onAdjust={() => setAdjusting(r)} />
            </li>
          ))}
        </ul>
      )}

      {adjusting && adjusting.loyalty && (
        <AdjustSheet
          customer={adjusting.customer}
          loyalty={adjusting.loyalty}
          onClose={() => setAdjusting(null)}
          onDone={() => {
            setAdjusting(null)
            search(lastQuery)
          }}
        />
      )}
    </section>
  )
}

function CustomerCard({
  result,
  mode,
  canAdjust,
  onAdjust,
}: {
  result:    CustomerLoyaltyResult
  mode:      LoyaltyMode
  canAdjust: boolean
  onAdjust:  () => void
}) {
  const { customer, loyalty } = result

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl p-3"
      style={{ border: '1px solid var(--border-color)' }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-xinuco-text truncate">{customer.full_name}</p>
        <p className="text-xs text-xinuco-muted tabular-nums">{customer.phone}</p>

        {!loyalty ? (
          <p className="text-xs text-red-400 mt-1">No se pudo cargar el saldo.</p>
        ) : loyalty.mode === 'points' ? (
          <div className="mt-1.5">
            <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--primary-color)' }}>
              {formatUnits(loyalty.balance)} {unitWord('points', loyalty.balance)}
              <span className="text-xinuco-muted font-normal">
                {' '}· {formatMoney(loyalty.value_cop ?? loyalty.balance * loyalty.point_value_cop)}
              </span>
            </p>
            {loyalty.expiring_30d > 0 && (
              <p className="text-xs text-amber-400">
                {formatUnits(loyalty.expiring_30d)} {unitWord('points', loyalty.expiring_30d)} vencen en los próximos 30 días
              </p>
            )}
          </div>
        ) : (
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <StampDots balance={loyalty.balance} required={loyalty.stamps_required} />
            <span className="text-xs font-semibold text-xinuco-text tabular-nums">
              {loyalty.balance}/{loyalty.stamps_required}
            </span>
            {loyalty.can_redeem && (
              <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border text-emerald-400 bg-emerald-400/10 border-emerald-400/20">
                Servicio gratis listo
              </span>
            )}
          </div>
        )}
      </div>

      {canAdjust && loyalty && (
        <button
          type="button"
          onClick={onAdjust}
          className="btn-ghost flex items-center gap-1.5 !py-2 !px-3 text-xs shrink-0"
          aria-label={`Ajustar ${mode === 'points' ? 'puntos' : 'sellos'} de ${customer.full_name}`}
        >
          <SlidersHorizontal size={13} />
          Ajustar
        </button>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// AJUSTAR SALDO (admin) — panel lateral: sumar / restar + motivo obligatorio
// ════════════════════════════════════════════════════════════════════════════

function AdjustSheet({
  customer,
  loyalty,
  onClose,
  onDone,
}: {
  customer: CustomerLoyaltyResult['customer']
  loyalty:  CustomerLoyalty
  onClose:  () => void
  onDone:   () => void
}) {
  const router = useRouter()
  const [sign, setSign]     = useState<1 | -1>(1)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError]   = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Cerrar con ESC y bloquear el scroll del fondo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const n = Math.floor(Number(amount)) || 0
  const delta = sign * n
  const newBalance = loyalty.balance + delta
  const word = unitWord(loyalty.mode, 2)

  function handleSave() {
    setError(null)
    if (n <= 0) return setError(`Ingresa cuántos ${word} ${sign === 1 ? 'sumar' : 'restar'}.`)
    if (newBalance < 0) return setError('No puedes restar más de lo que tiene el cliente.')
    if (reason.trim().length < 3) return setError('Escribe el motivo del ajuste (mínimo 3 letras).')

    startTransition(async () => {
      const res = await adjustCustomerLoyalty(customer.id, delta, reason)
      if (res.error) return setError(res.error)
      router.refresh()
      onDone()
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={`Ajustar ${word} de ${customer.full_name}`}
    >
      <div
        className="w-full max-w-sm h-dvh overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] flex flex-col gap-5 border-l"
        style={{ background: 'var(--bg-color)', borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-xinuco-text">Ajustar saldo</h2>
            <p className="text-xs text-xinuco-muted truncate">{customer.full_name} · {customer.phone}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-fg/[0.05] transition-colors"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-xinuco-text">
          Saldo actual: <span className="font-bold tabular-nums">{formatUnits(loyalty.balance)}</span>{' '}
          {unitWord(loyalty.mode, loyalty.balance)}
        </p>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de ajuste">
          {([[1, 'Sumar (+)'], [-1, 'Restar (−)']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={sign === value}
              onClick={() => setSign(value)}
              className="rounded-xl border py-2.5 text-sm font-semibold transition-colors"
              style={{
                borderColor:     sign === value ? 'var(--primary-color)' : 'var(--border-color)',
                color:           sign === value ? 'var(--primary-color)' : 'var(--text-color, #F4F4F4)',
                backgroundColor: sign === value ? 'color-mix(in srgb, var(--primary-color) 8%, transparent)' : 'transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="adjust-amount" className="text-xs font-semibold text-xinuco-muted uppercase tracking-wide">
            Cantidad de {word}
          </label>
          <input
            id="adjust-amount"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input-base"
          />
          {n > 0 && (
            <p className="text-xs text-xinuco-muted">
              Quedará en <span className="font-semibold text-xinuco-text tabular-nums">{formatUnits(Math.max(0, newBalance))}</span>
              {loyalty.mode === 'points' && ` (${formatMoney(Math.max(0, newBalance) * loyalty.point_value_cop)})`}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="adjust-reason" className="text-xs font-semibold text-xinuco-muted uppercase tracking-wide">
            Motivo (obligatorio)
          </label>
          <textarea
            id="adjust-reason"
            rows={3}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: Cortesía por la espera"
            className="input-base resize-none"
          />
        </div>

        {error && (
          <p role="alert" className="flex items-start gap-2 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </p>
        )}

        <div className="flex gap-2 mt-auto">
          <button type="button" onClick={onClose} disabled={isPending} className="btn-ghost flex-1 !py-2.5 text-sm">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={isPending} className="btn-primary flex-1 !py-2.5 text-sm">
            {isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Guardar ajuste
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ACTIVIDAD RECIENTE
// ════════════════════════════════════════════════════════════════════════════

const TYPE_BADGE: Record<LoyaltyMovement['entry_type'], { label: string; className: string }> = {
  earn:   { label: 'Ganó',   className: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  redeem: { label: 'Canjeó', className: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  adjust: { label: 'Ajuste', className: 'text-sky-400 bg-sky-400/10 border-sky-400/20' },
}

function MovementsTable({ movements, mode }: { movements: LoyaltyMovement[]; mode: LoyaltyMode }) {
  const unitsLabel = mode === 'points' ? 'Puntos' : 'Sellos'

  return (
    <section aria-label="Actividad reciente" className="flex flex-col gap-3">
      <h2 className="text-sm font-bold text-xinuco-text">Actividad reciente</h2>

      {movements.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-14 text-center rounded-xl"
          style={{ border: '1px dashed var(--border-color)' }}
        >
          <Gift size={30} className="text-xinuco-muted mb-3 opacity-40" />
          <p className="text-sm text-xinuco-muted">
            Aún no hay movimientos. Se generan solos cuando cobras a un cliente registrado.
          </p>
        </div>
      ) : (
        <div className="rounded-xl overflow-x-auto" style={{ border: '1px solid var(--border-color)' }}>
          <table className="w-full text-left min-w-[640px]">
            <thead>
              <tr style={{ background: 'rgb(var(--fg) / 0.02)' }}>
                {['Cliente', 'Tipo', unitsLabel, 'Equivale a', 'Fecha', 'Nota'].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-xinuco-muted ${i === 2 || i === 3 ? 'text-right' : ''}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const badge = TYPE_BADGE[m.entry_type]
                return (
                  <tr
                    key={m.id}
                    className="transition-colors hover:bg-fg/[0.02]"
                    style={{ borderTop: '1px solid var(--border-color)' }}
                  >
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-xinuco-text leading-tight">
                        {m.customer?.full_name ?? 'Cliente desconocido'}
                      </p>
                      <p className="text-xs text-xinuco-muted tabular-nums">{m.customer?.phone ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-bold tabular-nums ${m.units >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {m.units >= 0 ? '+' : '−'}{formatUnits(Math.abs(m.units))}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-xinuco-muted tabular-nums whitespace-nowrap">
                      {m.entry_type === 'redeem' && m.discount_cop != null ? formatMoney(m.discount_cop) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-xinuco-muted tabular-nums whitespace-nowrap">
                      {formatDate(m.created_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-xinuco-muted max-w-[220px] truncate" title={m.notes ?? undefined}>
                      {m.notes ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p
            className="px-4 py-3 text-xs text-xinuco-muted"
            style={{ borderTop: '1px solid var(--border-color)', background: 'rgb(var(--fg) / 0.02)' }}
          >
            Últimos {movements.length} {movements.length === 1 ? 'movimiento' : 'movimientos'} (máximo 100)
          </p>
        </div>
      )}
    </section>
  )
}
