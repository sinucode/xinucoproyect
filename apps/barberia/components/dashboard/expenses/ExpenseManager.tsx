'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
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
  Tags,
  Eye,
  EyeOff,
  Check,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import {
  createExpense,
  updateExpense,
  deleteExpense,
  registerRecurring,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  getExpenseCategoryUsage,
  type ExpensesOverview,
  type ExpenseInput,
} from '@/actions/expenses'
import type { Expense, ExpenseCategoryRow, ExpensePaymentMethod, ProfitLossResult } from '@xinuco/types'
import { AdminPageHeader, AdminEmptyState } from '@xinuco/ui'
import { FundsWarning, useFundsCheck } from '@/components/finance/FundsWarning'
import { AccountPicker } from '@/components/finance/AccountPicker'
import {
  OTHER_ACCOUNT_ID,
  accountIdOrNull,
  paymentMethodForAccount,
  pickedAccount,
  storedAccountValue,
} from '@/lib/money-accounts'
import { formatCOP } from '@xinuco/utils'
import {
  CATEGORY_PALETTE,
  MAX_CATEGORY_NAME,
  categoryName,
  categoryBadgeClass,
  categoryBarColor,
  paymentMethodLabel,
  visibleCategories,
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

function CategoryBadge({ category, categories }: { category: string; categories: ExpenseCategoryRow[] }) {
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${categoryBadgeClass(category, categories)}`}
    >
      {categoryName(category, categories)}
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

// ── Resumen del mes (el estado de resultados completo vive en Contabilidad) ───

function MonthResultCard({
  pl,
  plError,
  slug,
}: {
  pl:       ProfitLossResult | null
  plError?: string
  slug:     string
}) {
  if (!pl) {
    return (
      <section
        className="rounded-2xl p-5 flex items-start gap-3"
        style={{ background: 'rgb(var(--fg) / 0.03)', border: '1px solid var(--border-color)' }}
      >
        <AlertCircle size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-sm font-bold text-xinuco-text">Utilidad del mes</h2>
          <p className="text-xs text-xinuco-muted mt-1">
            {plError ?? 'No se pudo calcular la utilidad del mes.'}
          </p>
        </div>
      </section>
    )
  }

  const positive = pl.net_profit >= 0

  return (
    <section
      className="rounded-2xl p-4 sm:p-5"
      style={{ background: 'rgb(var(--fg) / 0.03)', border: '1px solid var(--border-color)' }}
      aria-label="Utilidad del mes"
    >
      <p className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">Utilidad del mes</p>
      <p className={`text-3xl font-bold tabular-nums mt-1 ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
        {!positive ? '−' : ''}{formatCOP(Math.abs(pl.net_profit))}
      </p>
      <p className="text-xs text-xinuco-muted mt-1">
        Ingresos {formatCOP(pl.revenue.total)} · Gastos {formatCOP(pl.expenses.total)}
      </p>
      <Link
        href={`/${slug}/dashboard/accounting`}
        className="inline-block mt-3 text-xs font-semibold hover:underline"
        style={{ color: 'var(--primary-color)' }}
      >
        Ver estado de resultados →
      </Link>
    </section>
  )
}

// ── Gastos fijos pendientes ───────────────────────────────────────────────────

function PendingRecurringBanner({
  items,
  categories,
  today,
  busyKey,
  onRegister,
  onRegisterDue,
}: {
  items:         PendingRecurringExpense[]
  categories:    ExpenseCategoryRow[]
  today:         string
  busyKey:       string | null
  onRegister:    (item: PendingRecurringExpense) => void
  onRegisterDue: () => void
}) {
  const count = items.length
  const dueCount = items.filter(i => i.due_date <= today).length
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
            Gastos fijos de este mes
            <span
              className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full"
              style={{
                background: 'color-mix(in srgb, var(--primary-color) 15%, transparent)',
                color: 'var(--primary-color)',
              }}
            >
              {count}
            </span>
          </h2>
        </div>
        {dueCount > 1 && (
          <button
            type="button"
            onClick={onRegisterDue}
            disabled={busyKey !== null}
            className="btn-primary !py-2 !px-4 !text-xs self-start sm:self-auto"
          >
            {busyKey === 'all' && <Loader2 size={13} className="animate-spin" />}
            Registrar los vencidos
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {items.map(item => {
          const key = `${item.category}::${item.description}`
          const upcoming = item.due_date > today
          return (
            <li
              key={key}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5"
              style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-xinuco-text truncate">{item.description}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                  <CategoryBadge category={item.category} categories={categories} />
                  <span className="text-[11px] text-xinuco-muted">
                    {upcoming
                      ? `Se registrará solo el ${formatShortDate(item.due_date)}`
                      : `Vence ${item.due_date === today ? 'hoy' : formatShortDate(item.due_date)}`}
                  </span>
                </div>
              </div>
              <span className="text-sm font-bold tabular-nums text-xinuco-text">{formatCOP(item.amount)}</span>
              <button
                type="button"
                onClick={() => onRegister(item)}
                disabled={busyKey !== null}
                className={
                  upcoming
                    ? 'text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors hover:bg-fg/[0.05] disabled:opacity-50 text-xinuco-muted hover:text-xinuco-text'
                    : 'text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:bg-fg/[0.05] disabled:opacity-50'
                }
                style={upcoming
                  ? { borderColor: 'var(--border-color)' }
                  : { borderColor: 'var(--border-color)', color: 'var(--primary-color)' }}
              >
                {busyKey === key ? <Loader2 size={13} className="animate-spin" /> : upcoming ? 'Registrar ahora' : 'Registrar'}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── Resumen por categoría ─────────────────────────────────────────────────────

function CategorySummary({
  totals,
  grandTotal,
  categories,
}: {
  totals:     { category: string; total: number }[]
  grandTotal: number
  categories: ExpenseCategoryRow[]
}) {
  if (totals.length === 0 || grandTotal <= 0) return null
  return (
    <section
      className="rounded-2xl p-5"
      style={{ background: 'rgb(var(--fg) / 0.03)', border: '1px solid var(--border-color)' }}
    >
      <h2 className="text-sm font-bold text-xinuco-text mb-4">Gastos por categoría</h2>
      <ul className="flex flex-col gap-3">
        {totals.map(({ category, total }) => {
          const pct = (total / grandTotal) * 100
          return (
            <li key={category}>
              <div className="flex items-center justify-between gap-3 text-xs mb-1.5">
                <span className="text-xinuco-text font-medium">{categoryName(category, categories)}</span>
                <span className="text-xinuco-muted tabular-nums">
                  <span className="text-xinuco-text font-semibold">{formatCOP(total)}</span> · {formatPct(pct)}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--border-color) 60%, transparent)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(pct, 2)}%`, background: categoryBarColor(category, categories) }}
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
  categories,
  locked,
  onEdit,
  onDelete,
}: {
  expense:    Expense
  categories: ExpenseCategoryRow[]
  locked:     boolean
  onEdit:   () => void
  onDelete: () => void
}) {
  const lockedTip = 'Ya se cuadró en un cierre de caja'
  const actionClass =
    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xinuco-muted transition-colors hover:text-xinuco-text hover:bg-fg/[0.05] disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-xinuco-muted'

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
          <CategoryBadge category={expense.category} categories={categories} />
          <PaymentMethodTag method={expense.payment_method} />
          {expense.is_recurring && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
              <Repeat size={10} />
              Fijo
            </span>
          )}
          {expense.auto_registered && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-xinuco-muted"
              title="Se registró solo el día que le tocaba"
            >
              <Zap size={10} />
              Automático
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
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-xinuco-muted border transition-colors hover:text-xinuco-text hover:bg-fg/[0.03]"
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

const NEW_CATEGORY_OPTION = '__new__'

function ExpenseSheet({
  expense,
  categories,
  today,
  hasActiveShift,
  onClose,
  onSaved,
  onCategoryCreated,
}: {
  expense:           Expense | null   // null = nuevo
  categories:        ExpenseCategoryRow[]
  today:             string
  hasActiveShift:    boolean
  onClose:           () => void
  onSaved:           () => void
  onCategoryCreated: () => void
}) {
  const isEdit = expense !== null
  const backdropRef = useRef<HTMLDivElement>(null)

  // Categorías del negocio + las creadas desde este formulario (antes de que la página se refresque)
  const [createdCategories, setCreatedCategories] = useState<ExpenseCategoryRow[]>([])
  const allCategories = useMemo(
    () => [...categories, ...createdCategories.filter(c => !categories.some(k => k.slug === c.slug))],
    [categories, createdCategories],
  )
  // Solo las visibles; una oculta se conserva únicamente si el gasto que se edita ya la tiene
  const selectable = allCategories.filter(c => !c.is_hidden || c.slug === expense?.category)

  const [category,    setCategory]    = useState<string>(expense?.category ?? selectable[0]?.slug ?? '')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [newCategoryName,  setNewCategoryName]  = useState('')
  const [categoryBusy,     startCategory]       = useTransition()
  const [categoryError,    setCategoryError]    = useState<string | null>(null)
  const [description, setDescription] = useState(expense?.description ?? '')
  const [amountDigits, setAmountDigits] = useState(expense ? String(expense.amount) : '')
  const [expenseDate, setExpenseDate] = useState(expense?.expense_date ?? today)
  // Medio de pago: al editar, el guardado ("other" si no tenía); al crear arranca en el primer medio que no sea la caja
  const [accountChoice, setAccountChoice] = useState<string | null>(expense ? storedAccountValue(expense.account_id) : null)
  const [isRecurring, setIsRecurring] = useState(expense?.is_recurring ?? false)
  const [formError,   setFormError]   = useState<string | null>(null)
  const [isPending,   startTransition] = useTransition()

  // Aviso de saldo: solo al crear (un gasto que se edita ya descontó su plata)
  const funds = useFundsCheck({ accountId: accountChoice, amount: Number(amountDigits), enabled: !isEdit })
  const accountValue = accountChoice
  const account = pickedAccount(funds.accounts, accountValue)
  const isCash = !!account?.is_cash_drawer
  // Medio guardado que ya no está activo: se conserva tal cual (con su método de pago de siempre)
  const keepsStored = isEdit && !account && accountValue !== null && accountValue !== OTHER_ACCOUNT_ID
  const method: ExpensePaymentMethod = account
    ? (paymentMethodForAccount(account, 'expense') as ExpensePaymentMethod)
    : accountValue === OTHER_ACCOUNT_ID || accountValue === null
      ? 'other'
      : expense?.payment_method ?? 'other'
  // Al crear, arranca con el primer medio que no sea la caja (como antes arrancaba en "Transferencia")
  useEffect(() => {
    if (isEdit || accountChoice !== null || !funds.loaded) return
    const first = funds.accounts.find(a => !a.is_cash_drawer)
    if (first) setAccountChoice(first.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funds.loaded])

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

  function pickCategory(value: string) {
    setCategoryError(null)
    if (value === NEW_CATEGORY_OPTION) {
      setCreatingCategory(true)
      return
    }
    setCreatingCategory(false)
    setCategory(value)
  }

  function handleCreateCategory() {
    const name = newCategoryName.trim()
    if (name.length < 2) return setCategoryError('El nombre debe tener al menos 2 caracteres.')
    setCategoryError(null)
    startCategory(async () => {
      try {
        const result = await createExpenseCategory(name)
        if (result.error || !result.category) {
          setCategoryError(result.error ?? 'No se pudo crear la categoría.')
          return
        }
        const created = result.category
        setCreatedCategories(prev => [...prev, created])
        setCategory(created.slug)
        setCreatingCategory(false)
        setNewCategoryName('')
        onCategoryCreated()
      } catch {
        setCategoryError('Error inesperado. Intenta de nuevo.')
      }
    })
  }

  function pickAccount(next: string) {
    const picked = pickedAccount(funds.accounts, next)
    if (picked?.is_cash_drawer && !hasActiveShift) return
    setAccountChoice(next)
    // El efectivo de la caja es siempre del día
    if (picked?.is_cash_drawer) setExpenseDate(today)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const desc = description.trim()
    const amount = Number(amountDigits)

    if (!category || creatingCategory) return setFormError('Elige una categoría válida.')
    if (desc.length < 2 || desc.length > 120) return setFormError('La descripción debe tener entre 2 y 120 caracteres.')
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
      return setFormError('El monto debe estar entre $1 y $100.000.000.')
    }
    if (accountValue === null) return setFormError('Elige cómo se pagó el gasto.')
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
      account_id:     accountIdOrNull(accountValue),
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
        className="h-dvh overflow-y-auto pb-[env(safe-area-inset-bottom)] animate-slide-in-right w-[95vw] sm:w-[440px]"
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
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-fg/[0.05] transition-colors"
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
              value={creatingCategory ? NEW_CATEGORY_OPTION : category}
              onChange={e => pickCategory(e.target.value)}
              className="input-base"
            >
              {selectable.map(opt => (
                <option key={opt.slug} value={opt.slug}>{opt.name}{opt.is_hidden ? ' (oculta)' : ''}</option>
              ))}
              <option value={NEW_CATEGORY_OPTION}>+ Nueva categoría…</option>
            </select>
            {creatingCategory && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCategory() } }}
                  placeholder="Nombre de la categoría"
                  aria-label="Nombre de la nueva categoría"
                  maxLength={MAX_CATEGORY_NAME}
                  autoFocus
                  className="input-base flex-1 min-w-0"
                />
                <button
                  type="button"
                  onClick={handleCreateCategory}
                  disabled={categoryBusy}
                  className="btn-primary !py-2.5 !px-4 !text-xs shrink-0"
                >
                  {categoryBusy ? <Loader2 size={13} className="animate-spin" /> : 'Crear'}
                </button>
              </div>
            )}
            {categoryError && (
              <p role="alert" className="text-xs text-red-400">{categoryError}</p>
            )}
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
            {!funds.loaded ? (
              <p className="flex items-center gap-2 text-xs text-xinuco-muted">
                <Loader2 size={14} className="animate-spin" /> Cargando medios de pago…
              </p>
            ) : (
              <AccountPicker
                accounts={funds.accounts}
                balances={funds.balances}
                value={accountValue}
                onChange={pickAccount}
                allowOther
                disabledIds={hasActiveShift ? [] : funds.accounts.filter(a => a.is_cash_drawer).map(a => a.id)}
                ariaLabel="¿Cómo se pagó?"
              />
            )}
            {keepsStored && (
              <p className="text-xs text-xinuco-muted flex items-center gap-1.5">
                <Info size={12} className="shrink-0" />
                Este gasto se pagó con un medio que ya no está activo; se conserva. Elige otro para cambiarlo.
              </p>
            )}
            {!hasActiveShift && (
              <p className="text-xs text-xinuco-muted flex items-center gap-1.5">
                <Info size={12} className="shrink-0" />
                Abre la caja para pagar con Efectivo
              </p>
            )}
            {isCash && (
              <p className="text-xs text-xinuco-muted flex items-center gap-1.5">
                <Info size={12} className="shrink-0" />
                Se resta del efectivo esperado al cerrar la caja.
              </p>
            )}
            <FundsWarning check={funds} />
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
              <p className="text-xs text-xinuco-muted mt-0.5">
                {isRecurring
                  ? `Se registrará solo cada mes el día ${Number(expenseDate.slice(8, 10)) || 1} y te avisaremos un día antes por correo.`
                  : 'Actívalo para gastos que se repiten cada mes.'}
              </p>
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
              className="flex-1 py-3 rounded-lg text-sm font-medium text-xinuco-muted border transition-colors hover:text-xinuco-text hover:bg-fg/[0.03]"
              style={{ borderColor: 'var(--border-color)' }}
            >
              Cancelar
            </button>
            <button type="submit" disabled={isPending || funds.blocked} className="flex-1 btn-primary !py-3 flex items-center justify-center gap-2">
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
// SHEET — Categorías del negocio
// ════════════════════════════════════════════════════════════════════════════

function ColorPicker({
  value,
  onPick,
  size = 22,
}: {
  value:  string | null
  onPick: (key: string) => void
  size?:  number
}) {
  return (
    <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
      {CATEGORY_PALETTE.map(c => {
        const selected = value === c.key
        return (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c.label}
            title={c.label}
            onClick={() => onPick(c.key)}
            className="rounded-full flex items-center justify-center transition-transform hover:scale-110"
            style={{
              width: size,
              height: size,
              background: c.bar,
              boxShadow: selected ? `0 0 0 2px var(--bg-color), 0 0 0 4px ${c.bar}` : undefined,
            }}
          >
            {selected && <Check size={12} className="text-black/70" />}
          </button>
        )
      })}
    </div>
  )
}

function CategoryRowEditor({
  category,
  usage,
  busy,
  onRename,
  onColor,
  onToggleHidden,
  onDelete,
}: {
  category:       ExpenseCategoryRow
  usage:          number | null   // null = cargando
  busy:           boolean
  onRename:       (name: string) => Promise<boolean>
  onColor:        (color: string) => void
  onToggleHidden: () => void
  onDelete:       () => void
}) {
  const [draft, setDraft] = useState(category.name)
  const [paletteOpen, setPaletteOpen] = useState(false)
  useEffect(() => { setDraft(category.name) }, [category.name])

  function commitName() {
    const next = draft.trim()
    if (next === category.name) return
    if (next.length < 2) { setDraft(category.name); return }
    // Si el servidor lo rechaza (p. ej. nombre repetido), vuelve al nombre real
    onRename(next).then(ok => { if (!ok) setDraft(category.name) })
  }

  const inUse = (usage ?? 0) > 0
  const canDelete = usage !== null && !inUse
  const iconBtn =
    'p-2 rounded-lg text-xinuco-muted transition-colors hover:text-xinuco-text hover:bg-fg/[0.05] disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-xinuco-muted'

  return (
    <li
      className="rounded-xl px-3 py-2.5 flex flex-col gap-2"
      style={{ background: 'rgb(var(--fg) / 0.03)', border: '1px solid var(--border-color)', opacity: category.is_hidden ? 0.7 : 1 }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPaletteOpen(o => !o)}
          aria-label={`Cambiar color de ${category.name}`}
          aria-expanded={paletteOpen}
          className="shrink-0 w-5 h-5 rounded-full"
          style={{ background: categoryBarColor(category.slug, [category]) }}
        />
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') { setDraft(category.name); e.currentTarget.blur() }
          }}
          maxLength={MAX_CATEGORY_NAME}
          disabled={busy}
          aria-label={`Nombre de la categoría ${category.name}`}
          className="flex-1 min-w-0 bg-transparent text-sm font-medium text-xinuco-text rounded-md px-2 py-1 border border-transparent hover:border-[var(--border-color)] focus:border-[var(--primary-color)] focus:outline-none"
        />
        <button
          type="button"
          onClick={onToggleHidden}
          disabled={busy}
          title={category.is_hidden ? 'Mostrar en el formulario' : 'Ocultar del formulario'}
          aria-label={category.is_hidden ? `Mostrar ${category.name}` : `Ocultar ${category.name}`}
          aria-pressed={category.is_hidden}
          className={iconBtn}
        >
          {category.is_hidden ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy || !canDelete}
          title={
            usage === null ? 'Calculando…'
            : inUse ? `Tiene ${usage} ${usage === 1 ? 'gasto' : 'gastos'}: ocúltala en lugar de borrarla`
            : 'Eliminar'
          }
          aria-label={`Eliminar ${category.name}`}
          className={`${iconBtn} ${canDelete ? 'hover:!text-red-400' : ''}`}
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="flex items-center gap-2 pl-7 text-[11px] text-xinuco-muted">
        {category.is_hidden && (
          <span className="font-semibold uppercase tracking-wide text-amber-400">Oculta</span>
        )}
        <span>
          {usage === null ? '…' : usage === 0 ? 'Sin gastos' : `${usage} ${usage === 1 ? 'gasto' : 'gastos'}`}
        </span>
      </div>

      {paletteOpen && (
        <div className="pl-7 pb-1">
          <ColorPicker value={category.color} onPick={key => { setPaletteOpen(false); onColor(key) }} />
        </div>
      )}
    </li>
  )
}

function CategoriesSheet({
  categories,
  onClose,
  onChanged,
}: {
  categories: ExpenseCategoryRow[]
  onClose:    () => void
  onChanged:  () => void
}) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const [list, setList] = useState<ExpenseCategoryRow[]>(categories)
  const [usage, setUsage] = useState<Record<string, number> | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<string>(CATEGORY_PALETTE[categories.length % CATEGORY_PALETTE.length].key)
  const [creating, startCreate] = useTransition()

  function close() {
    if (dirty) onChanged()
    onClose()
  }

  // Cuántos gastos tiene cada categoría (habilita o no el borrado)
  useEffect(() => {
    let cancelled = false
    getExpenseCategoryUsage()
      .then(res => {
        if (cancelled) return
        if ('error' in res) setError(res.error)
        else setUsage(res.usage)
      })
      .catch(() => { if (!cancelled) setError('No se pudo cargar el uso de las categorías.') })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  async function update(id: string, patch: { name?: string; color?: string; is_hidden?: boolean }): Promise<boolean> {
    setError(null)
    setBusyId(id)
    try {
      const res = await updateExpenseCategory(id, patch)
      if (res.error || !res.category) {
        setError(res.error ?? 'No se pudo guardar el cambio.')
        return false
      }
      const updated = res.category
      setList(prev => prev.map(c => (c.id === id ? updated : c)))
      setDirty(true)
      return true
    } catch {
      setError('Error inesperado. Intenta de nuevo.')
      return false
    } finally {
      setBusyId(null)
    }
  }

  async function remove(category: ExpenseCategoryRow) {
    setError(null)
    setBusyId(category.id)
    try {
      const res = await deleteExpenseCategory(category.id)
      if (res.error) {
        setError(res.error)
        return
      }
      setList(prev => prev.filter(c => c.id !== category.id))
      setDirty(true)
    } catch {
      setError('Error inesperado. Intenta de nuevo.')
    } finally {
      setBusyId(null)
    }
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const name = newName.trim()
    if (name.length < 2) return setError('El nombre debe tener al menos 2 caracteres.')
    startCreate(async () => {
      try {
        const res = await createExpenseCategory(name, newColor)
        if (res.error || !res.category) {
          setError(res.error ?? 'No se pudo crear la categoría.')
          return
        }
        const created = res.category
        setList(prev => [...prev, created])
        setUsage(prev => (prev ? { ...prev, [created.slug]: 0 } : prev))
        setNewName('')
        setNewColor(CATEGORY_PALETTE[(list.length + 1) % CATEGORY_PALETTE.length].key)
        setDirty(true)
      } catch {
        setError('Error inesperado. Intenta de nuevo.')
      }
    })
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === backdropRef.current) close() }}
    >
      <div
        className="h-dvh overflow-y-auto pb-[env(safe-area-inset-bottom)] animate-slide-in-right w-[95vw] sm:w-[440px]"
        style={{ background: 'var(--bg-color)', borderLeft: '1px solid var(--border-color)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Categorías de gasto"
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-5"
          style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-color)' }}
        >
          <div>
            <h2 className="text-lg font-bold text-xinuco-text">Categorías</h2>
            <p className="text-xs text-xinuco-muted mt-0.5">Organiza tus gastos a tu manera.</p>
          </div>
          <button
            type="button"
            onClick={close}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-fg/[0.05] transition-colors"
            aria-label="Cerrar panel"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5">
          {error && (
            <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5 animate-fade-in">
              {error}
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {list.map(category => (
              <CategoryRowEditor
                key={category.id}
                category={category}
                usage={usage === null ? null : (usage[category.slug] ?? 0)}
                busy={busyId === category.id}
                onRename={name => update(category.id, { name })}
                onColor={color => { void update(category.id, { color }) }}
                onToggleHidden={() => { void update(category.id, { is_hidden: !category.is_hidden }) }}
                onDelete={() => remove(category)}
              />
            ))}
          </ul>
          <p className="text-xs text-xinuco-muted -mt-2">
            Las categorías con gastos no se pueden borrar: ocúltalas y dejarán de aparecer al crear gastos, sin perder tu historial.
          </p>

          <form
            onSubmit={handleCreate}
            className="rounded-xl p-4 flex flex-col gap-3"
            style={{ border: '1px dashed var(--border-color)' }}
          >
            <label htmlFor="new-cat-name" className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
              + Nueva categoría
            </label>
            <input
              id="new-cat-name"
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Ej: Café y bebidas"
              maxLength={MAX_CATEGORY_NAME}
              className="input-base"
            />
            <ColorPicker value={newColor} onPick={setNewColor} />
            <button type="submit" disabled={creating} className="btn-primary !py-2.5 self-start flex items-center gap-2">
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Agregar categoría
            </button>
          </form>
        </div>
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
  const { month, expenses, pl, plError, pendingRecurring, activeShift, categories } = overview

  const [navPending, startNav] = useTransition()
  const [sheet, setSheet] = useState<{ expense: Expense | null } | null>(null)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [toDelete, setToDelete] = useState<Expense | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, startDelete] = useTransition()
  const [filter, setFilter] = useState<string>('all')
  const [recurringBusy, setRecurringBusy] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  // ?nuevo=1 (acción rápida "+" del menú móvil): abre el formulario y limpia el parámetro
  const pathname = usePathname()
  const searchParams = useSearchParams()
  useEffect(() => {
    if (searchParams.get('nuevo') !== '1') return
    setSheet({ expense: null })
    const next = new URLSearchParams(searchParams.toString())
    next.delete('nuevo')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [searchParams, pathname, router])

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
        expense_date:   i.due_date,
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCategoriesOpen(true)}
              className="flex min-h-11 items-center gap-2 !py-2.5 px-4 rounded-lg text-sm font-medium text-xinuco-text border transition-colors hover:bg-fg/[0.05]"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <Tags size={16} />
              Categorías
            </button>
            <button type="button" onClick={() => setSheet({ expense: null })} className="btn-primary min-h-11 !py-2.5">
              <Plus size={16} />
              Nuevo gasto
            </button>
          </div>
        }
      />

      {/* Navegador de mes */}
      <div
        className="flex items-center justify-between rounded-xl px-2 py-1.5"
        style={{ background: 'rgb(var(--fg) / 0.03)', border: '1px solid var(--border-color)' }}
      >
        <button
          type="button"
          onClick={() => goToMonth(prevMonthKey)}
          disabled={navPending}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-fg/[0.05] transition-colors disabled:opacity-40"
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
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-fg/[0.05] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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

        <MonthResultCard pl={pl} plError={plError} slug={slug} />

        {pendingRecurring.length > 0 && (
          <PendingRecurringBanner
            items={pendingRecurring}
            categories={categories}
            today={today}
            busyKey={recurringBusy}
            onRegister={item => registerItems([item], `${item.category}::${item.description}`)}
            onRegisterDue={() => registerItems(pendingRecurring.filter(i => i.due_date <= today), 'all')}
          />
        )}

        <CategorySummary totals={categoryTotals} grandTotal={grandTotal} categories={categories} />

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
                  label: categoryName(c.category, categories),
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
              style={{ border: '1px solid var(--border-color)', background: 'rgb(var(--fg) / 0.02)' }}
            >
              {visible.map(expense => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  categories={categories}
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
          categories={categories}
          today={today}
          hasActiveShift={!!activeShift}
          onClose={() => setSheet(null)}
          onSaved={handleSaved}
          onCategoryCreated={() => router.refresh()}
        />
      )}

      {categoriesOpen && (
        <CategoriesSheet
          categories={categories}
          onClose={() => setCategoriesOpen(false)}
          onChanged={() => router.refresh()}
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
