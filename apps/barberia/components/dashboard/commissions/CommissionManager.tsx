'use client'

import { useState, useTransition, useRef, useEffect, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  Plus,
  X,
  Loader2,
  Trash2,
  Pencil,
  Percent,
  DollarSign,
  RefreshCw,
} from 'lucide-react'
import {
  createCommissionRule,
  updateCommissionRule,
  deleteCommissionRule,
  applyPendingCommissions,
} from '@/actions/commissions'
import type {
  CommissionRuleWithRelations,
  CommissionRuleInput,
  CommissionsOverview,
  CommissionSummaryRow,
} from '@/actions/commissions'
import { AdminPageHeader, AdminEmptyState } from '@xinuco/ui'
import { addDaysToDateKey, businessTodayISODate } from '@/lib/agenda-time'
import { AUDIENCE_LABELS } from '@/lib/service-audience'

// ── Formato ───────────────────────────────────────────────────────────────────

function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style:    'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

const MAX_RANGE_DAYS = 366

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  )
}

// ── Períodos rápidos ──────────────────────────────────────────────────────────

function thisMonthRange(today: string) {
  return { from: `${today.slice(0, 8)}01`, to: today }
}

function lastMonthRange(today: string) {
  const firstThisMonth = `${today.slice(0, 8)}01`
  const lastDay = addDaysToDateKey(firstThisMonth, -1)
  return { from: `${lastDay.slice(0, 8)}01`, to: lastDay }
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════

type ServiceOption = CommissionsOverview['services'][number]

interface CommissionManagerProps {
  overview: CommissionsOverview
  slug:     string
}

export function CommissionManager({ overview, slug }: CommissionManagerProps) {
  const { rules, staff, services, summary, range } = overview
  const router = useRouter()

  const [modal, setModal] = useState<{ rule: CommissionRuleWithRelations | null } | null>(null)

  // Etiqueta de público solo si el negocio tiene servicios de más de un público
  const showAudience = useMemo(
    () => new Set(services.map(s => s.audience)).size > 1,
    [services],
  )
  const serviceLabel = (svc: { id: string; name: string } | null): string => {
    if (!svc) return 'Servicio'
    const full = services.find(s => s.id === svc.id)
    if (!full || !showAudience) return svc.name
    const suffix = full.audience === 'all' ? 'Unisex' : AUDIENCE_LABELS[full.audience]?.singular
    return suffix ? `${svc.name} · ${suffix}` : svc.name
  }

  return (
    <>
      <AdminPageHeader
        title="Comisiones"
        subtitle="Se registran solas al cobrar y quedan en la cuenta de cada profesional."
        hasData={true}
        actionButton={
          <button
            type="button"
            onClick={() => setModal({ rule: null })}
            className="btn-primary flex items-center gap-2 animate-fade-in"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span className="hidden sm:inline">Nueva regla</span>
            <span className="sm:hidden">Nueva</span>
          </button>
        }
      />

      <EarningsSection
        summary={summary}
        range={range}
        slug={slug}
        onApplied={() => router.refresh()}
      />

      <RulesSection
        rules={rules}
        serviceLabel={serviceLabel}
        onNew={() => setModal({ rule: null })}
        onEdit={rule => setModal({ rule })}
        onDeleted={() => router.refresh()}
      />

      {modal && (
        <RuleModal
          rule={modal.rule}
          staff={staff}
          services={services}
          serviceLabel={serviceLabel}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); router.refresh() }}
        />
      )}
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SECCIÓN "GANADO EN EL PERÍODO"
// ════════════════════════════════════════════════════════════════════════════

function EarningsSection({
  summary,
  range,
  slug,
  onApplied,
}: {
  summary:   CommissionSummaryRow[]
  range:     { from: string; to: string }
  slug:      string
  onApplied: () => void
}) {
  const [applyMsg, setApplyMsg] = useState<{ text: string; error: boolean } | null>(null)
  const [isApplying, startApply] = useTransition()

  const totals = summary.reduce(
    (acc, r) => ({
      services: acc.services + r.services_amount,
      count:    acc.count + r.services_count,
      products: acc.products + r.products_amount,
      tips:     acc.tips + r.tips_amount,
      total:    acc.total + r.total,
    }),
    { services: 0, count: 0, products: 0, tips: 0, total: 0 },
  )

  function handleApply() {
    setApplyMsg(null)
    startApply(async () => {
      const result = await applyPendingCommissions(range)
      if ('error' in result) {
        setApplyMsg({ text: result.error, error: true })
        return
      }
      setApplyMsg({
        text: result.entries > 0
          ? `Se registraron ${result.entries} ${result.entries === 1 ? 'movimiento' : 'movimientos'} en ${result.sales} ${result.sales === 1 ? 'venta' : 'ventas'}.`
          : 'No había ventas pendientes en este período.',
        error: false,
      })
      onApplied()
    })
  }

  return (
    <section aria-label="Ganado en el período" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-xinuco-text">Ganado en el período</h2>
        <PeriodBar range={range} />
      </div>

      {summary.length === 0 ? (
        <p
          className="text-sm text-xinuco-muted rounded-xl px-5 py-8 text-center"
          style={{ border: '1px dashed var(--border-color)' }}
        >
          Aún no hay comisiones en este período.
        </p>
      ) : (
        <div
          className="rounded-xl overflow-hidden animate-fade-in"
          style={{ border: '1px solid var(--border-color)' }}
        >
          {/* Encabezado (solo escritorio) */}
          <div
            className="hidden sm:grid grid-cols-[1.4fr_1.2fr_1fr_1fr_1fr] gap-3 px-5 py-3 text-xs font-semibold text-xinuco-muted uppercase tracking-wider"
            style={{ background: 'var(--surface-color, rgba(255,255,255,0.03))' }}
          >
            <span>Profesional</span>
            <span className="text-right">Servicios</span>
            <span className="text-right">Productos</span>
            <span className="text-right">Propinas</span>
            <span className="text-right">Total</span>
          </div>

          {summary.map(row => (
            <SummaryRow
              key={row.staff_id}
              name={row.staff_name}
              servicesAmount={row.services_amount}
              servicesCount={row.services_count}
              productsAmount={row.products_amount}
              tipsAmount={row.tips_amount}
              total={row.total}
            />
          ))}

          {summary.length > 1 && (
            <SummaryRow
              name="Total"
              servicesAmount={totals.services}
              servicesCount={totals.count}
              productsAmount={totals.products}
              tipsAmount={totals.tips}
              total={totals.total}
              footer
            />
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/${slug}/dashboard/ledger`}
            className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
            style={{ color: 'var(--primary-color)' }}
          >
            Ver cuentas y pagos →
          </Link>

          <button
            type="button"
            onClick={handleApply}
            disabled={isApplying}
            className="btn-ghost !px-4 !py-2 text-xs disabled:opacity-50"
          >
            {isApplying ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Aplicar reglas a ventas sin comisión
          </button>
        </div>

        <p className="text-xs text-xinuco-muted sm:text-right">
          Úsalo si creaste o cambiaste reglas después de cobrar. Lo ya registrado no cambia.
        </p>

        {applyMsg && (
          <p
            role="status"
            className={`text-xs rounded-lg border px-4 py-2.5 animate-fade-in ${
              applyMsg.error
                ? 'text-red-400 bg-red-400/10 border-red-400/20'
                : ''
            }`}
            style={applyMsg.error ? undefined : {
              background:  'rgba(197,160,89,0.08)',
              borderColor: 'rgba(197,160,89,0.2)',
              color:       'var(--primary-color)',
            }}
          >
            {applyMsg.text}
          </p>
        )}
      </div>
    </section>
  )
}

function SummaryRow({
  name,
  servicesAmount,
  servicesCount,
  productsAmount,
  tipsAmount,
  total,
  footer = false,
}: {
  name:           string
  servicesAmount: number
  servicesCount:  number
  productsAmount: number
  tipsAmount:     number
  total:          number
  footer?:        boolean
}) {
  return (
    <div
      className="grid grid-cols-3 sm:grid-cols-[1.4fr_1.2fr_1fr_1fr_1fr] gap-x-3 gap-y-2 px-5 py-4 items-center"
      style={{
        borderTop:  '1px solid var(--border-color)',
        background: footer ? 'var(--surface-color, rgba(255,255,255,0.02))' : undefined,
      }}
    >
      {/* Nombre + total (en móvil comparten la primera línea) */}
      <div className="col-span-2 sm:col-span-1 font-medium text-sm text-xinuco-text truncate">
        {name}
      </div>
      <div className="sm:hidden text-right text-sm font-bold tabular-nums text-xinuco-text">
        {formatCOP(total)}
      </div>

      <div className="sm:text-right flex flex-col">
        <span className="sm:hidden text-[10px] uppercase tracking-wide text-xinuco-muted">Servicios</span>
        <span className="text-sm tabular-nums text-xinuco-text">{formatCOP(servicesAmount)}</span>
        <span className="text-[11px] text-xinuco-muted">
          {servicesCount} {servicesCount === 1 ? 'servicio' : 'servicios'}
        </span>
      </div>
      <div className="sm:text-right flex flex-col">
        <span className="sm:hidden text-[10px] uppercase tracking-wide text-xinuco-muted">Productos</span>
        <span className="text-sm tabular-nums text-xinuco-text">{formatCOP(productsAmount)}</span>
      </div>
      <div className="sm:text-right flex flex-col">
        <span className="sm:hidden text-[10px] uppercase tracking-wide text-xinuco-muted">Propinas</span>
        <span className="text-sm tabular-nums text-xinuco-text">{formatCOP(tipsAmount)}</span>
      </div>
      <div className="hidden sm:block text-right text-sm font-bold tabular-nums text-xinuco-text">
        {formatCOP(total)}
      </div>
    </div>
  )
}

// ── Barra de período (una línea, actualiza la URL) ───────────────────────────

function PeriodBar({ range }: { range: { from: string; to: string } }) {
  const router   = useRouter()
  const pathname = usePathname()

  const today = businessTodayISODate()
  const month = thisMonthRange(today)
  const prev  = lastMonthRange(today)

  const active: 'month' | 'prev' | 'custom' =
    range.from === month.from && range.to === month.to ? 'month'
    : range.from === prev.from && range.to === prev.to ? 'prev'
    : 'custom'

  const [showRange, setShowRange] = useState(active === 'custom')
  const [from, setFrom] = useState(range.from)
  const [to, setTo]     = useState(range.to)
  const [error, setError] = useState<string | null>(null)

  // Mantener los inputs sincronizados si el rango cambia desde afuera
  useEffect(() => { setFrom(range.from); setTo(range.to) }, [range.from, range.to])

  function go(f: string, t: string) {
    router.push(`${pathname}?from=${f}&to=${t}`, { scroll: false })
  }

  function pick(r: { from: string; to: string }) {
    setError(null)
    setShowRange(false)
    go(r.from, r.to)
  }

  function onDates(nextFrom: string, nextTo: string) {
    setFrom(nextFrom)
    setTo(nextTo)
    if (!nextFrom || !nextTo) return
    if (nextFrom > nextTo) return setError('La fecha inicial no puede ser posterior a la final.')
    if (daysBetween(nextFrom, nextTo) + 1 > MAX_RANGE_DAYS) {
      return setError('El período no puede superar 366 días.')
    }
    setError(null)
    go(nextFrom, nextTo)
  }

  const chip = (isActive: boolean) =>
    `px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
      isActive ? '' : 'text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.04]'
    }`
  const chipStyle = (isActive: boolean) =>
    isActive
      ? { background: 'var(--primary-color)', color: '#080808', borderColor: 'var(--primary-color)' }
      : { borderColor: 'var(--border-color)' }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => pick(month)} className={chip(active === 'month')} style={chipStyle(active === 'month')}>
          Este mes
        </button>
        <button type="button" onClick={() => pick(prev)} className={chip(active === 'prev')} style={chipStyle(active === 'prev')}>
          Mes pasado
        </button>
        <button
          type="button"
          onClick={() => setShowRange(v => !v)}
          className={chip(active === 'custom')}
          style={chipStyle(active === 'custom')}
          aria-expanded={showRange}
        >
          Rango
        </button>

        {showRange && (
          <div className="flex items-center gap-2 animate-fade-in">
            <input
              type="date"
              aria-label="Desde"
              value={from}
              max={to || undefined}
              onChange={e => onDates(e.target.value, to)}
              className="input-base !w-auto !py-1.5 !px-3 text-xs"
            />
            <span className="text-xs text-xinuco-muted">a</span>
            <input
              type="date"
              aria-label="Hasta"
              value={to}
              min={from || undefined}
              onChange={e => onDates(from, e.target.value)}
              className="input-base !w-auto !py-1.5 !px-3 text-xs"
            />
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SECCIÓN "REGLAS"
// ════════════════════════════════════════════════════════════════════════════

type RuleGroupKey = 'general' | 'service' | 'staff' | 'staff_service'

const RULE_GROUPS: { key: RuleGroupKey; title: string }[] = [
  { key: 'general',       title: 'General (todo el equipo)' },
  { key: 'service',       title: 'Por servicio' },
  { key: 'staff',         title: 'Por profesional' },
  { key: 'staff_service', title: 'Profesional + servicio' },
]

function ruleGroupOf(rule: CommissionRuleWithRelations): RuleGroupKey {
  if (!rule.staff_id && !rule.service_id) return 'general'
  if (!rule.staff_id && rule.service_id)  return 'service'
  if (rule.staff_id && !rule.service_id)  return 'staff'
  return 'staff_service'
}

function RulesSection({
  rules,
  serviceLabel,
  onNew,
  onEdit,
  onDeleted,
}: {
  rules:        CommissionRuleWithRelations[]
  serviceLabel: (svc: { id: string; name: string } | null) => string
  onNew:        () => void
  onEdit:       (rule: CommissionRuleWithRelations) => void
  onDeleted:    () => void
}) {
  const grouped = RULE_GROUPS
    .map(g => ({ ...g, items: rules.filter(r => ruleGroupOf(r) === g.key) }))
    .filter(g => g.items.length > 0)

  return (
    <section aria-label="Reglas de comisión" className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-xinuco-text">Reglas</h2>

      {rules.length === 0 ? (
        <AdminEmptyState
          icon={Percent}
          title="Aún no hay reglas"
          description="Empieza con una regla general: por ejemplo 50% de cada servicio para todo el equipo. Después puedes afinar por servicio o por profesional."
          actionLabel="Crear regla general"
          onAction={onNew}
        />
      ) : (
        <>
          {grouped.map(g => (
            <div key={g.key} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
                {g.title}
              </h3>
              <div
                className="rounded-xl overflow-hidden"
                style={{ border: '1px solid var(--border-color)' }}
              >
                {g.items.map((rule, i) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    first={i === 0}
                    serviceLabel={serviceLabel}
                    onEdit={() => onEdit(rule)}
                    onDeleted={onDeleted}
                  />
                ))}
              </div>
            </div>
          ))}

          <p className="text-xs text-xinuco-muted">
            Se aplica la regla más específica: profesional + servicio › servicio › profesional › general.
          </p>
        </>
      )}
    </section>
  )
}

function RuleRow({
  rule,
  first,
  serviceLabel,
  onEdit,
  onDeleted,
}: {
  rule:         CommissionRuleWithRelations
  first:        boolean
  serviceLabel: (svc: { id: string; name: string } | null) => string
  onEdit:       () => void
  onDeleted:    () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, startDelete] = useTransition()

  const group = ruleGroupOf(rule)
  const staffName = rule.staff?.full_name ?? 'Profesional'
  const title =
    group === 'general'       ? 'Todo el equipo, todos los servicios'
    : group === 'service'     ? `${serviceLabel(rule.service)} (todo el equipo)`
    : group === 'staff'       ? staffName
    : `${staffName} — ${serviceLabel(rule.service)}`

  const chips: string[] = []
  if (rule.commission_percentage > 0) chips.push(`Servicios: ${rule.commission_percentage}%`)
  else if (rule.fixed_amount > 0)     chips.push(`Servicios: ${formatCOP(rule.fixed_amount)} fijo`)
  if (!rule.service_id && rule.product_percentage > 0) chips.push(`Productos: ${rule.product_percentage}%`)

  function handleDelete() {
    setError(null)
    startDelete(async () => {
      const result = await deleteCommissionRule(rule.id)
      if (result.error) {
        setError(result.error)
        setConfirming(false)
        return
      }
      onDeleted()
    })
  }

  return (
    <div
      className="flex flex-col gap-2 px-5 py-3.5 transition-opacity"
      style={{
        borderTop: first ? undefined : '1px solid var(--border-color)',
        opacity:   isDeleting ? 0.5 : 1,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-sm font-medium text-xinuco-text truncate">{title}</span>
          <div className="flex flex-wrap gap-1.5">
            {chips.map(c => (
              <span
                key={c}
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums"
                style={{
                  color:      'var(--primary-color)',
                  background: 'rgba(197,160,89,0.10)',
                  border:     '1px solid rgba(197,160,89,0.2)',
                }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>

        {confirming ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-xinuco-muted">¿Eliminar esta regla?</span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="px-3 py-1.5 rounded-lg font-medium text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {isDeleting && <Loader2 size={12} className="animate-spin" />}
              Sí, eliminar
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={isDeleting}
              className="px-3 py-1.5 rounded-lg text-xinuco-muted border hover:text-xinuco-text transition-colors"
              style={{ borderColor: 'var(--border-color)' }}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
              className="p-2 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.05] transition-colors"
              aria-label={`Editar regla: ${title}`}
              title="Editar"
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="p-2 rounded-lg text-red-400/70 hover:text-red-400 hover:bg-red-400/10 transition-colors"
              aria-label={`Eliminar regla: ${title}`}
              title="Eliminar"
            >
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL — Crear / editar regla
// ════════════════════════════════════════════════════════════════════════════

type CommissionMode = 'percentage' | 'fixed'

function RuleModal({
  rule,
  staff,
  services,
  serviceLabel,
  onClose,
  onSaved,
}: {
  rule:         CommissionRuleWithRelations | null
  staff:        { id: string; full_name: string }[]
  services:     ServiceOption[]
  serviceLabel: (svc: { id: string; name: string } | null) => string
  onClose:      () => void
  onSaved:      () => void
}) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const isEdit = rule !== null

  const [staffId,   setStaffId]   = useState<string>(rule?.staff_id ?? '')
  const [serviceId, setServiceId] = useState<string>(rule?.service_id ?? '')
  const [mode, setMode] = useState<CommissionMode>(
    rule && rule.commission_percentage === 0 && rule.fixed_amount > 0 ? 'fixed' : 'percentage',
  )
  const [value, setValue] = useState<string>(() => {
    if (!rule) return ''
    if (rule.commission_percentage > 0) return String(rule.commission_percentage)
    if (rule.fixed_amount > 0)          return String(rule.fixed_amount)
    return ''
  })
  const [productPct, setProductPct] = useState<string>(String(rule?.product_percentage ?? 0))
  const [formError, setFormError]   = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Cerrar con ESC
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Bloquear scroll del body
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const allServices = serviceId === ''
  const valueNum = value.trim() === '' ? 0 : Number(value)

  function changeMode(next: CommissionMode) {
    setMode(next)
    setValue('')
    setFormError(null)
  }

  function changeService(next: string) {
    setServiceId(next)
    // El % de productos solo aplica a reglas sin servicio específico
    if (next !== '') setProductPct('0')
    setFormError(null)
  }

  // Validación de cliente: refleja la del servidor
  function validate(): { input: CommissionRuleInput } | { error: string } {
    const pp = productPct.trim() === '' ? 0 : Number(productPct)
    if (!Number.isInteger(valueNum) || valueNum < 0) {
      return { error: 'El valor de la comisión debe ser un número entero.' }
    }
    if (!Number.isInteger(pp) || pp < 0 || pp > 100) {
      return { error: 'El porcentaje de productos debe ser un número entero entre 0 y 100.' }
    }
    if (serviceId && pp > 0) {
      return { error: 'El % de productos solo aplica a reglas sin servicio específico.' }
    }
    if (valueNum === 0) {
      if (!(allServices && pp > 0)) {
        return { error: 'Define una comisión por servicio o por productos mayor a 0.' }
      }
    } else if (mode === 'percentage' && valueNum > 100) {
      return { error: 'El porcentaje debe estar entre 1 y 100.' }
    } else if (mode === 'fixed' && valueNum > 10_000_000) {
      return { error: 'El monto fijo no puede superar $10.000.000.' }
    }
    return {
      input: {
        staff_id:           staffId || null,
        service_id:         serviceId || null,
        mode,
        value:              valueNum,
        product_percentage: pp,
      },
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const v = validate()
    if ('error' in v) return setFormError(v.error)

    startTransition(async () => {
      try {
        const result = rule
          ? await updateCommissionRule(rule.id, v.input)
          : await createCommissionRule(v.input)
        if (result.error) {
          setFormError(result.error)
          return
        }
        onSaved()
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : 'Error inesperado. Intenta de nuevo.')
      }
    })
  }

  // Resumen del alcance mientras se configura
  const staffName = staff.find(s => s.id === staffId)?.full_name ?? 'Profesional'
  const svc = services.find(s => s.id === serviceId) ?? null
  const scopePreview =
    !staffId && !serviceId ? 'Regla general: todo el equipo, todos los servicios'
    : !staffId ? `${serviceLabel(svc)} · todo el equipo`
    : !serviceId ? `${staffName} · todos los servicios`
    : `${staffName} · ${serviceLabel(svc)}`

  const labelCls = 'text-xs font-semibold text-xinuco-muted uppercase tracking-wider'

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-modal-title"
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl animate-fade-in"
        style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-5"
          style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-color)' }}
        >
          <div>
            <h2 id="rule-modal-title" className="text-lg font-bold text-xinuco-text">
              {isEdit ? 'Editar regla' : 'Nueva regla'}
            </h2>
            <p className="text-xs text-xinuco-muted mt-0.5">
              Define a quién aplica y cuánto gana.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.05] transition-colors"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-5">
          <div
            className="px-4 py-3 rounded-xl text-xs font-medium"
            style={{
              background: 'rgba(197,160,89,0.07)',
              border:     '1px solid rgba(197,160,89,0.15)',
              color:      'var(--primary-color)',
            }}
          >
            {scopePreview}
          </div>

          {/* Profesional */}
          <div className="flex flex-col gap-2">
            <label htmlFor="cr-staff" className={labelCls}>Profesional</label>
            <select
              id="cr-staff"
              value={staffId}
              onChange={e => { setStaffId(e.target.value); setFormError(null) }}
              className="input-base"
            >
              <option value="">Todo el equipo</option>
              {staff.map(s => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </select>
          </div>

          {/* Servicio */}
          <div className="flex flex-col gap-2">
            <label htmlFor="cr-service" className={labelCls}>Servicio</label>
            <select
              id="cr-service"
              value={serviceId}
              onChange={e => changeService(e.target.value)}
              className="input-base"
            >
              <option value="">Todos los servicios</option>
              {services.map(s => (
                <option key={s.id} value={s.id}>{serviceLabel(s)}</option>
              ))}
            </select>
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)' }} />

          {/* Comisión por servicio */}
          <div className="flex flex-col gap-3">
            <p className={labelCls}>Comisión por servicio</p>
            <div
              className="grid grid-cols-2 gap-1 p-1 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              {([
                ['percentage', 'Porcentaje', Percent],
                ['fixed',      'Monto fijo', DollarSign],
              ] as const).map(([m, label, Icon]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => changeMode(m)}
                  className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-200"
                  style={{
                    background: mode === m ? 'var(--primary-color)' : 'transparent',
                    color:      mode === m ? '#080808' : 'var(--text-color)',
                  }}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>

            <div className="relative">
              {mode === 'fixed' && (
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-xinuco-muted pointer-events-none">$</span>
              )}
              <input
                id="cr-value"
                type="number"
                inputMode="numeric"
                min={0}
                max={mode === 'percentage' ? 100 : 10_000_000}
                step={mode === 'percentage' ? 1 : 500}
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder={mode === 'percentage' ? 'Ej: 50' : 'Ej: 5000'}
                aria-label={mode === 'percentage' ? 'Porcentaje por servicio' : 'Monto fijo por servicio'}
                className={`input-base ${mode === 'fixed' ? 'pl-7' : 'pr-10'}`}
                autoFocus
              />
              {mode === 'percentage' && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-xinuco-muted pointer-events-none">%</span>
              )}
            </div>
            <p className="text-xs text-xinuco-muted">
              {mode === 'percentage'
                ? 'Sobre el valor del servicio después del descuento. La propina es 100% del profesional.'
                : `Se paga por cada servicio realizado${valueNum > 0 ? ` (${formatCOP(valueNum)})` : ''}.`}
            </p>
          </div>

          {/* Comisión por productos (solo con "Todos los servicios") */}
          {allServices && (
            <div className="flex flex-col gap-2">
              <label htmlFor="cr-products" className={labelCls}>Comisión por productos (%)</label>
              <div className="relative">
                <input
                  id="cr-products"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  value={productPct}
                  onChange={e => setProductPct(e.target.value)}
                  placeholder="0"
                  className="input-base pr-10"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-xinuco-muted pointer-events-none">%</span>
              </div>
              <p className="text-xs text-xinuco-muted">
                Lo que gana el profesional al vender un producto. Déjalo en 0 si no aplica.
              </p>
            </div>
          )}

          {formError && (
            <p
              role="alert"
              className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5 animate-fade-in"
            >
              {formError}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-lg text-sm font-medium text-xinuco-muted border transition-colors hover:text-xinuco-text hover:bg-white/[0.03]"
              style={{ borderColor: 'var(--border-color)' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 btn-primary !py-3 flex items-center justify-center gap-2"
            >
              {isPending ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Guardando…
                </>
              ) : (
                isEdit ? 'Guardar cambios' : 'Guardar regla'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
