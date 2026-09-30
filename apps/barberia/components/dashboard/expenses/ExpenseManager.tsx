'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus,
  X,
  Loader2,
  Trash2,
  Pencil,
  Repeat,
  Lock,
  ChevronLeft,
  ChevronRight,
  Banknote,
  ArrowLeftRight,
  CreditCard,
  Wallet,
  AlertCircle,
  Info,
  Receipt,
  ToggleLeft,
  ToggleRight,
  type LucideIcon,
} from 'lucide-react'
import {
  createExpense,
  updateExpense,
  deleteExpense,
  registerRecurring,
  type ExpensesOverview,
  type ExpenseInput,
} from '@/actions/expenses'
import type { Expense, ExpensePaymentMethod, ProfitLossResult } from '@xinuco/types'
import { AdminPageHeader, AdminEmptyState } from '@xinuco/ui'
import { formatCOP } from '@xinuco/utils'
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  categoryLabel,
  categoryBadgeClass,
  categoryBarColor,
  paymentMethodLabel,
  type PendingRecurringExpense,
} from '@/lib/expense-utils'

// ── Constantes / helpers ──────────────────────────────────────────────────────

const MAX_AMOUNT = 100_000_000

const PAYMENT_ICONS: Record<ExpensePaymentMethod, LucideIcon> = {
  cash_register: Banknote,
  transfer:      ArrowLeftRight,
  card:          CreditCard,
  other:         Wallet,
}

/** 'mar 29 sept' a partir de 'YYYY-MM-DD' (sin corrimientos de zona horaria). */
function formatShortDate(dateKey: string): string {
  const label = new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('es-CO', {
    weekday: 'short',
    day:     'numeric',
    month:   'short',
    timeZone: 'UTC',
  })
  return label.replace(/[,.]/g, '').replace(/\bde\b\s*/g, '').replace(/\s+/g, ' ').trim()
}

function formatPct(value: number): string {
  return `${value.toLocaleString('es-CO', { maximumFractionDigits: 1 })}%`
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, 9)
}

function formatThousands(digits: string): string {
  return digits ? Number(digits).toLocaleString('es-CO') : ''
}

// ── Sub-componentes de presentación ───────────────────────────────────────────

function CategoryBadge({ category }: { category: string }) {
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${categoryBadgeClass(category)}`}
    >
      {categoryLabel(category)}
    </span>
  )
}

function PaymentMethodTag({ method }: { method: ExpensePaymentMethod }) {
  const Icon = PAYMENT_ICONS[method] ?? Wallet
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
      {paymentMethodLabel(method)}
    </span>
  )
}

// ── Estado de resultados ──────────────────────────────────────────────────────

function StatementRow({
  sign,
  label,
  value,
  hint,
  strong,
}: {
  sign?:   '−' | '='
  label:   string
  value:   number
  hint?:   string
  strong?: boolean
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="w-4 shrink-0 text-center text-sm text-xinuco-muted tabular-nums">{sign ?? ''}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${strong ? 'font-semibold' : ''} text-xinuco-text`}>{label}</p>
        {hint && <p className="text-[11px] text-xinuco-muted mt-0.5">{hint}</p>}
      </div>
      <span className={`text-sm tabular-nums whitespace-nowrap ${strong ? 'font-bold' : 'font-medium'} text-xinuco-text`}>
        {sign === '−' && value > 0 ? '−' : ''}{formatCOP(value)}
      </span>
    </div>
  )
}

function ProfitLossStatement({ pl, plError, monthLabel }: { pl: ProfitLossResult | null; plError?: string; monthLabel: string }) {
  if (!pl) {
    return (
      <section
        className="rounded-2xl p-5 flex items-start gap-3"
        style={{ background: 'var(--surface-color, rgba(255,255,255,0.03))', border: '1px solid var(--border-color)' }}
      >
        <AlertCircle size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-sm font-bold text-xinuco-text">Estado de resultados</h2>
          <p className="text-xs text-xinuco-muted mt-1">
            {plError ?? 'No se pudo calcular el estado de resultados.'}
          </p>
        </div>
      </section>
    )
  }

  const positive = pl.net_profit >= 0
  const netColor = positive ? 'text-emerald-400' : 'text-red-400'

  return (
    <section
      className="rounded-2xl p-5 sm:p-6"
      style={{ background: 'var(--surface-color, rgba(255,255,255,0.03))', border: '1px solid var(--border-color)' }}
      aria-label="Estado de resultados"
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="text-sm font-bold text-xinuco-text">Estado de resultados</h2>
        <span className="text-xs text-xinuco-muted">{monthLabel}</span>
      </div>

      <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
        <StatementRow
          label="Ingresos"
          value={pl.revenue.total}
          strong
          hint={`servicios ${formatCOP(pl.revenue.services)} · productos ${formatCOP(pl.revenue.retail)} · ${pl.revenue.sales_count} ${pl.revenue.sales_count === 1 ? 'venta' : 'ventas'}`}
        />
        <StatementRow sign="−" label="Costo de productos vendidos" value={pl.cost_of_goods} />
        <StatementRow sign="=" label="Utilidad bruta" value={pl.gross_profit} strong />
        <StatementRow sign="−" label="Comisiones del equipo" value={pl.commissions} />
        <StatementRow sign="−" label="Gastos" value={pl.expenses.total} />
      </div>

      <div
        className="mt-3 pt-4 flex items-end justify-between gap-3 border-t-2"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">= Utilidad neta</p>
          {pl.margin_pct !== null && (
            <p className="text-xs text-xinuco-muted mt-1">Margen {formatPct(pl.margin_pct)}</p>
          )}
        </div>
        <span className={`text-3xl sm:text-4xl font-bold tabular-nums ${netColor}`}>
          {!positive ? '−' : ''}{formatCOP(Math.abs(pl.net_profit))}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-1 text-[11px] text-xinuco-muted">
        <p>Las propinas ({formatCOP(pl.tips)}) no cuentan como ingreso: son del profesional.</p>
        {pl.revenue.discounts > 0 && <p>Incluye {formatCOP(pl.revenue.discounts)} en descuentos.</p>}
        <p>El costo de productos usa el costo registrado en Inventario.</p>
      </div>
    </section>
  )
}

// ── Gastos fijos pendientes ───────────────────────────────────────────────────

function PendingRecurringBanner({
  items,
  busyKey,
  onRegister,
  onRegisterAll,
}: {
  items:         PendingRecurringExpense[]
  busyKey:       string | null
  onRegister:    (item: PendingRecurringExpense) => void
  onRegisterAll: () => void
}) {
  const count = items.length
  return (
    <section
      className="rounded-2xl p-4 sm:p-5"
      style={{
        background: 'color-mix(in srgb, var(--primary-color) 7%, transparent)',
        border: '1px solid color-mix(in srgb, var(--primary-color) 30%, transparent)',
      }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Repeat size={16} style={{ color: 'var(--primary-color)' }} />
          <h2 className="text-sm font-bold text-xinuco-text">
            Tienes {count} {count === 1 ? 'gasto fijo pendiente' : 'gastos fijos pendientes'} este mes
          </h2>
        </div>
        {count > 1 && (
          <button
            type="button"
            onClick={onRegisterAll}
            disabled={busyKey !== null}
            className="btn-primary !py-2 !px-4 !text-xs self-start sm:self-auto"
          >
            {busyKey === 'all' && <Loader2 size={13} className="animate-spin" />}
            Registrar todos
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {items.map(item => {
          const key = `${item.category}::${item.description}`
          return (
            <li
              key={key}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5"
              style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-xinuco-text truncate">{item.description}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                  <CategoryBadge category={item.category} />
                  <span className="text-[11px] text-xinuco-muted">{formatShortDate(item.suggested_date)}</span>
                </div>
              </div>
              <span className="text-sm font-bold tabular-nums text-xinuco-text">{formatCOP(item.amount)}</span>
              <button
                type="button"
                onClick={() => onRegister(item)}
                disabled={busyKey !== null}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:bg-white/[0.05] disabled:opacity-50"
                style={{ borderColor: 'var(--border-color)', color: 'var(--primary-color)' }}
              >
                {busyKey === key ? <Loader2 size={13} className="animate-spin" /> : 'Registrar'}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── Resumen por categoría ─────────────────────────────────────────────────────

function CategorySummary({ totals, grandTotal }: { totals: { category: string; total: number }[]; grandTotal: number }) {
  if (totals.length === 0 || grandTotal <= 0) return null
  return (
    <section
      className="rounded-2xl p-5"
      style={{ background: 'var(--surface-color, rgba(255,255,255,0.03))', border: '1px solid var(--border-color)' }}
    >
      <h2 className="text-sm font-bold text-xinuco-text mb-4">Gastos por categoría</h2>
      <ul className="flex flex-col gap-3">
        {totals.map(({ category, total }) => {
          const pct = (total / grandTotal) * 100
          return (
            <li key={category}>
              <div className="flex items-center justify-between gap-3 text-xs mb-1.5">
                <span className="text-xinuco-text font-medium">{categoryLabel(category)}</span>
                <span className="text-xinuco-muted tabular-nums">
                  <span className="text-xinuco-text font-semibold">{formatCOP(total)}</span> · {formatPct(pct)}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--border-color) 60%, transparent)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(pct, 2)}%`, background: categoryBarColor(category) }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── Fila de gasto ─────────────────────────────────────────────────────────────

function ExpenseRow({
  expense,
  locked,
  onEdit,
  onDelete,
}: {
  expense:  Expense
  locked:   boolean
  onEdit:   () => void
  onDelete: () => void
}) {
  const lockedTip = 'Ya se cuadró en un cierre de caja'
  const actionClass =
    'p-2 rounded-lg text-xinuco-muted transition-colors hover:text-xinuco-text hover:bg-white/[0.05] disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-xinuco-muted'

  return (
    <li
      className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 border-t first:border-t-0"
      style={{ borderColor: 'var(--border-color)' }}
    >
      <span className="w-[68px] sm:w-20 shrink-0 text-xs text-xinuco-muted capitalize tabular-nums">
        {formatShortDate(expense.expense_date)}
      </span>

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <span className="text-sm font-medium text-xinuco-text leading-tight break-words">{expense.description}</span>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <CategoryBadge category={expense.category} />
          <PaymentMethodTag method={expense.payment_method} />
          {expense.is_recurring && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
              <Repeat size={10} />
              Fijo
            </span>
          )}
        </div>
      </div>

      <span className="text-sm font-bold tabular-nums whitespace-nowrap text-xinuco-text">
        {formatCOP(expense.amount)}
      </span>

      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onEdit}
          disabled={locked}
          title={locked ? lockedTip : 'Editar'}
          aria-label={`Editar ${expense.description}`}
          className={actionClass}
        >
          {locked ? <Lock size={15} /> : <Pencil size={15} />}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={locked}
          title={locked ? lockedTip : 'Eliminar'}
          aria-label={`Eliminar ${expense.description}`}
          className={`${actionClass} ${locked ? '' : 'hover:!text-red-400'}`}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  )
}

// ── Confirmación in-app ───────────────────────────────────────────────────────

function ConfirmDeleteDialog({
  expense,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  expense:   Expense
  pending:   boolean
  error:     string | null
  onCancel:  () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending) onCancel() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel, pending])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Eliminar gasto"
    >
      <div
        className="w-full max-w-sm rounded-2xl p-5 flex flex-col gap-4 animate-fade-in"
        style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}
      >
        <div>
          <h3 className="text-base font-bold text-xinuco-text">¿Eliminar este gasto?</h3>
          <p className="text-sm text-xinuco-muted mt-1.5">
            {expense.description} · {formatCOP(expense.amount)}. Esta acción no se puede deshacer.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-xinuco-muted border transition-colors hover:text-xinuco-text hover:bg-white/[0.03]"
            style={{ borderColor: 'var(--border-color)' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Eliminar
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SHEET — Crear / editar gasto
// ════════════════════════════════════════════════════════════════════════════

function ExpenseSheet({
  expense,
  today,
  hasActiveShift,
  onClose,
  onSaved,
}: {
  expense:        Expense | null   // null = nuevo
  today:          string
  hasActiveShift: boolean
  onClose:        () => void
  onSaved:        () => void
}) {
  const isEdit = expense !== null
  const backdropRef = useRef<HTMLDivElement>(null)

  const [category,    setCategory]    = useState<string>(expense?.category ?? 'rent')
  const [description, setDescription] = useState(expense?.description ?? '')
  const [amountDigits, setAmountDigits] = useState(expense ? String(expense.amount) : '')
  const [expenseDate, setExpenseDate] = useState(expense?.expense_date ?? today)
  const [method,      setMethod]      = useState<ExpensePaymentMethod>(expense?.payment_method ?? 'transfer')
  const [isRecurring, setIsRecurring] = useState(expense?.is_recurring ?? false)
  const [formError,   setFormError]   = useState<string | null>(null)
  const [isPending,   startTransition] = useTransition()

  const isCash = method === 'cash_register'

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

  function pickMethod(next: ExpensePaymentMethod) {
    if (next === 'cash_register' && !hasActiveShift) return
    setMethod(next)
    // El efectivo de la caja es siempre del día
    if (next === 'cash_register') setExpenseDate(today)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const desc = description.trim()
    const amount = Number(amountDigits)

    if (desc.length < 2 || desc.length > 120) return setFormError('La descripción debe tener entre 2 y 120 caracteres.')
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
      return setFormError('El monto debe estar entre $1 y $100.000.000.')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) return setFormError('La fecha es requerida.')
    if (expenseDate > today) return setFormError('La fecha no puede ser futura.')
    if (isCash && !hasActiveShift) return setFormError('No hay caja abierta. Abre la caja o elige otro medio de pago.')
    if (isCash && expenseDate !== today) return setFormError('Un gasto pagado con efectivo de la caja debe ser de hoy.')

    const input: ExpenseInput = {
      category,
      description:    desc,
      amount,
      expense_date:   expenseDate,
      is_recurring:   isRecurring,
      payment_method: method,
    }

    startTransition(async () => {
      try {
        const result = isEdit ? await updateExpense(expense.id, input) : await createExpense(input)
        if (result.error) {
          setFormError(result.error)
          return
        }
        onSaved()
      } catch {
        setFormError('Error inesperado. Intenta de nuevo.')
      }
    })
  }

  const labelClass = 'text-xs font-semibold text-xinuco-muted uppercase tracking-wider'

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        className="h-full overflow-y-auto animate-slide-in-right w-[95vw] sm:w-[440px]"
        style={{ background: 'var(--bg-color)', borderLeft: '1px solid var(--border-color)' }}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-5"
          style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-color)' }}
        >
          <div>
            <h2 className="text-lg font-bold text-xinuco-text">{isEdit ? 'Editar gasto' : 'Nuevo gasto'}</h2>
            <p className="text-xs text-xinuco-muted mt-0.5">Registra lo que sale del negocio.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.05] transition-colors"
            aria-label="Cerrar panel"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-5">
          {/* Descripción */}
          <div className="flex flex-col gap-2">
            <label htmlFor="exp-desc" className={labelClass}>Descripción *</label>
            <input
              id="exp-desc"
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ej: Arriendo del local"
              autoFocus
              maxLength={120}
              className="input-base"
            />
          </div>

          {/* Categoría */}
          <div className="flex flex-col gap-2">
            <label htmlFor="exp-category" className={labelClass}>Categoría *</label>
            <select
              id="exp-category"
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="input-base"
            >
              {EXPENSE_CATEGORIES.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-xs text-xinuco-muted">La compra de productos para vender se registra en Inventario.</p>
          </div>

          {/* Monto */}
          <div className="flex flex-col gap-2">
            <label htmlFor="exp-amount" className={labelClass}>Monto (COP) *</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-xinuco-muted pointer-events-none">$</span>
              <input
                id="exp-amount"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={formatThousands(amountDigits)}
                onChange={e => setAmountDigits(digitsOnly(e.target.value))}
                placeholder="1.500.000"
                className="input-base pl-7 tabular-nums"
              />
            </div>
          </div>

          {/* ¿Cómo se pagó? */}
          <div className="flex flex-col gap-2">
            <span id="exp-method-label" className={labelClass}>¿Cómo se pagó? *</span>
            <div role="radiogroup" aria-labelledby="exp-method-label" className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map(pm => {
                const Icon = PAYMENT_ICONS[pm.value]
                const selected = method === pm.value
                const disabled = pm.value === 'cash_register' && !hasActiveShift
                return (
                  <button
                    key={pm.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={disabled}
                    onClick={() => pickMethod(pm.value)}
                    className="flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    style={selected ? {
                      borderColor: 'var(--primary-color)',
                      color: 'var(--primary-color)',
                      background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
                    } : {
                      borderColor: 'var(--border-color)',
                      color: 'var(--text-color)',
                    }}
                  >
                    <Icon size={14} />
                    {pm.label}
                  </button>
                )
              })}
            </div>
            {!hasActiveShift && (
              <p className="text-xs text-xinuco-muted flex items-center gap-1.5">
                <Info size={12} className="shrink-0" />
                Abre la caja para usar esta opción
              </p>
            )}
            {isCash && (
              <p className="text-xs text-xinuco-muted flex items-center gap-1.5">
                <Info size={12} className="shrink-0" />
                Se resta del efectivo esperado al cerrar la caja.
              </p>
            )}
          </div>

          {/* Fecha */}
          <div className="flex flex-col gap-2">
            <label htmlFor="exp-date" className={labelClass}>Fecha *</label>
            <input
              id="exp-date"
              type="date"
              value={expenseDate}
              max={today}
              disabled={isCash}
              onChange={e => setExpenseDate(e.target.value)}
              className="input-base disabled:opacity-60"
            />
            {isCash && <p className="text-xs text-xinuco-muted">El efectivo de la caja siempre se registra con la fecha de hoy.</p>}
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)' }} />

          {/* Gasto fijo */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-xinuco-text">Gasto fijo mensual</p>
              <p className="text-xs text-xinuco-muted mt-0.5">Cada mes te recordaremos registrarlo.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isRecurring}
              onClick={() => setIsRecurring(prev => !prev)}
              className="transition-colors shrink-0"
              aria-label="Gasto fijo mensual"
            >
              {isRecurring ? (
                <ToggleRight size={34} className="text-emerald-400" />
              ) : (
                <ToggleLeft size={34} className="text-xinuco-muted" />
              )}
            </button>
          </div>

          {formError && (
            <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5 animate-fade-in">
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
            <button type="submit" disabled={isPending} className="flex-1 btn-primary !py-3 flex items-center justify-center gap-2">
              {isPending ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Guardando…
                </>
              ) : (
                isEdit ? 'Guardar cambios' : 'Guardar gasto'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL — ExpenseManager
// ════════════════════════════════════════════════════════════════════════════

interface ExpenseManagerProps {
  overview:        ExpensesOverview
  slug:            string
  today:           string
  currentMonthKey: string
  prevMonthKey:    string
  nextMonthKey:    string | null
}

export function ExpenseManager({
  overview,
  slug,
  today,
  prevMonthKey,
  nextMonthKey,
}: ExpenseManagerProps) {
  const router = useRouter()
  const { month, expenses, pl, plError, pendingRecurring, activeShift } = overview

  const [navPending, startNav] = useTransition()
  const [sheet, setSheet] = useState<{ expense: Expense | null } | null>(null)
  const [toDelete, setToDelete] = useState<Expense | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, startDelete] = useTransition()
  const [filter, setFilter] = useState<string>('all')
  const [recurringBusy, setRecurringBusy] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  const basePath = `/${slug}/dashboard/expenses`
  function goToMonth(key: string) {
    setFilter('all')
    startNav(() => router.push(`${basePath}?month=${key}`))
  }

  // Totales por categoría (del listado del mes)
  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of expenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount)
    return [...map.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
  }, [expenses])
  const grandTotal = categoryTotals.reduce((sum, c) => sum + c.total, 0)

  const activeFilter = filter === 'all' || categoryTotals.some(c => c.category === filter) ? filter : 'all'
  const visible = activeFilter === 'all' ? expenses : expenses.filter(e => e.category === activeFilter)

  // Un gasto de caja de un turno que ya no es el activo ya se cuadró en un cierre
  const isLocked = (e: Expense) => !!e.shift_id && e.shift_id !== activeShift?.id

  function handleSaved() {
    setSheet(null)
    router.refresh()
  }

  function confirmDelete() {
    if (!toDelete) return
    const target = toDelete
    setDeleteError(null)
    startDelete(async () => {
      const result = await deleteExpense(target.id)
      if (result.error) {
        setDeleteError(result.error)
        return
      }
      setToDelete(null)
      router.refresh()
    })
  }

  async function registerItems(items: PendingRecurringExpense[], busyKey: string) {
    setPageError(null)
    setRecurringBusy(busyKey)
    try {
      const result = await registerRecurring(items.map(i => ({
        category:       i.category,
        description:    i.description,
        amount:         i.amount,
        expense_date:   i.suggested_date,
        payment_method: i.payment_method,
      })))
      if (result.error) setPageError(result.error)
      else router.refresh()
    } catch {
      setPageError('No se pudieron registrar los gastos. Intenta de nuevo.')
    } finally {
      setRecurringBusy(null)
    }
  }

  return (
    <>
      <AdminPageHeader
        title="Gastos"
        subtitle="Registra lo que sale del negocio y mira cuánto te queda."
        actionButton={
          <button type="button" onClick={() => setSheet({ expense: null })} className="btn-primary !py-2.5">
            <Plus size={16} />
            Nuevo gasto
          </button>
        }
      />

      {/* Navegador de mes */}
      <div
        className="flex items-center justify-between rounded-xl px-2 py-1.5"
        style={{ background: 'var(--surface-color, rgba(255,255,255,0.03))', border: '1px solid var(--border-color)' }}
      >
        <button
          type="button"
          onClick={() => goToMonth(prevMonthKey)}
          disabled={navPending}
          className="p-2 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.05] transition-colors disabled:opacity-40"
          aria-label="Mes anterior"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-semibold text-xinuco-text flex items-center gap-2">
          {month.label}
          {navPending && <Loader2 size={13} className="animate-spin text-xinuco-muted" />}
        </span>
        <button
          type="button"
          onClick={() => nextMonthKey && goToMonth(nextMonthKey)}
          disabled={navPending || !nextMonthKey}
          className="p-2 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.05] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Mes siguiente"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className={`flex flex-col gap-6 transition-opacity ${navPending ? 'opacity-60' : ''}`}>
        {pageError && (
          <p
            role="alert"
            className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3"
          >
            {pageError}
            <button type="button" onClick={() => setPageError(null)} aria-label="Cerrar aviso"><X size={14} /></button>
          </p>
        )}

        <ProfitLossStatement pl={pl} plError={plError} monthLabel={month.label} />

        {pendingRecurring.length > 0 && (
          <PendingRecurringBanner
            items={pendingRecurring}
            busyKey={recurringBusy}
            onRegister={item => registerItems([item], `${item.category}::${item.description}`)}
            onRegisterAll={() => registerItems(pendingRecurring, 'all')}
          />
        )}

        <CategorySummary totals={categoryTotals} grandTotal={grandTotal} />

        {expenses.length === 0 ? (
          <AdminEmptyState
            icon={Receipt}
            title={`Sin gastos en ${month.label}`}
            description="Cuando registres arriendo, servicios u otros gastos del negocio, aparecerán aquí y se restarán de tu utilidad."
            actionLabel="Nuevo gasto"
            onAction={() => setSheet({ expense: null })}
          />
        ) : (
          <section className="flex flex-col gap-3">
            {/* Filtros por categoría */}
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por categoría">
              {[{ category: 'all', label: 'Todas', count: expenses.length },
                ...categoryTotals.map(c => ({
                  category: c.category,
                  label: categoryLabel(c.category),
                  count: expenses.filter(e => e.category === c.category).length,
                }))].map(chip => {
                const selected = activeFilter === chip.category
                return (
                  <button
                    key={chip.category}
                    type="button"
                    onClick={() => setFilter(chip.category)}
                    aria-pressed={selected}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors"
                    style={selected ? {
                      borderColor: 'var(--primary-color)',
                      color: 'var(--primary-color)',
                      background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
                    } : {
                      borderColor: 'var(--border-color)',
                      color: 'var(--text-color)',
                    }}
                  >
                    {chip.label} <span className="opacity-60 font-medium">{chip.count}</span>
                  </button>
                )
              })}
            </div>

            <ul
              className="rounded-2xl overflow-hidden"
              style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.02))' }}
            >
              {visible.map(expense => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  locked={isLocked(expense)}
                  onEdit={() => setSheet({ expense })}
                  onDelete={() => { setDeleteError(null); setToDelete(expense) }}
                />
              ))}
            </ul>
          </section>
        )}
      </div>

      {sheet && (
        <ExpenseSheet
          expense={sheet.expense}
          today={today}
          hasActiveShift={!!activeShift}
          onClose={() => setSheet(null)}
          onSaved={handleSaved}
        />
      )}

      {toDelete && (
        <ConfirmDeleteDialog
          expense={toDelete}
          pending={deleting}
          error={deleteError}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </>
  )
}
