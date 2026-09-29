'use client'
// components/dashboard/inventory/InventoryManager.tsx — RF Inventario

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Package,
  Plus,
  X,
  Search,
  AlertTriangle,
  ArrowUpCircle,
  ArrowDownCircle,
  Loader2,
  MoreVertical,
  ChevronDown,
  Globe,
  CalendarClock,
} from 'lucide-react'
import {
  createInventoryItem,
  updateInventoryItem,
  deactivateInventoryItem,
  recordMovement,
} from '@/actions/inventory'
import type {
  InventoryItem,
  InventoryCategory,
  MovementType,
} from '@xinuco/types'
import { formatApptTime, apptDateKey, dayLabel, businessTodayISODate } from '@/lib/agenda-time'
import { reservedByItem, reservationsForItem, type InventoryReservation } from '@/lib/inventory-reservations'

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCOP(n: number): string {
  return '$' + n.toLocaleString('es-CO')
}

const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  general:  'General',
  hair:     'Cabello',
  skincare: 'Skincare',
  tools:    'Herramientas',
  other:    'Otro',
}

const ALL_CATEGORIES: InventoryCategory[] = ['general', 'hair', 'skincare', 'tools', 'other']

// ── Props ─────────────────────────────────────────────────────────────────────

interface InventoryManagerProps {
  items:          InventoryItem[]
  lowStockItems:  InventoryItem[]
  reservations:   InventoryReservation[]
  businessId:     string
  slug:           string
}

/** "Hoy 10:30 a. m." — hora del negocio (start_time guarda hora local como UTC). */
function reservationWhen(iso: string): string {
  return `${dayLabel(apptDateKey(iso), businessTodayISODate())} ${formatApptTime(iso)}`
}

// ── Stock Gauge ───────────────────────────────────────────────────────────────

function StockGauge({ item }: { item: InventoryItem }) {
  const max  = Math.max(item.min_stock * 2, 1)
  const pct  = Math.min(Math.round((item.current_stock / max) * 100), 100)
  const isLow    = item.current_stock < item.min_stock
  const isExact  = item.current_stock === item.min_stock

  const color = isLow    ? '#ef4444'
              : isExact  ? '#f59e0b'
              : 'var(--primary-color)'

  return (
    <div className="flex flex-col gap-1 min-w-[80px]">
      <div className="flex items-center justify-between gap-1">
        <span
          className="text-xs font-bold tabular-nums"
          style={{ color }}
        >
          {item.current_stock}
        </span>
        {item.min_stock > 0 && (
          <span className="text-[10px] text-zinc-600">/ {item.min_stock} mín</span>
        )}
      </div>
      <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

// ── Category Badge ─────────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: InventoryCategory }) {
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{
        color:           'var(--primary-color)',
        backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
        border:          '1px solid color-mix(in srgb, var(--primary-color) 20%, transparent)',
      }}
    >
      {CATEGORY_LABELS[category]}
    </span>
  )
}

// ── Movement Form (inline) ─────────────────────────────────────────────────────

interface MovementFormProps {
  item:          InventoryItem
  direction:     'in' | 'out'
  businessId:    string
  slug:          string
  onClose:       () => void
  onSuccess:     () => void
}

function MovementForm({ item, direction, businessId, slug, onClose, onSuccess }: MovementFormProps) {
  const [qty, setQty]       = useState('')
  const [type, setType]     = useState<MovementType>(direction === 'in' ? 'purchase' : 'sale')
  const [notes, setNotes]   = useState('')
  const [error, setError]   = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const inTypes:  MovementType[] = ['purchase', 'adjustment']
  const outTypes: MovementType[] = ['sale', 'waste', 'adjustment']
  const typeOptions = direction === 'in' ? inTypes : outTypes

  const typeLabels: Record<MovementType, string> = {
    purchase:   'Compra',
    sale:       'Venta',
    adjustment: 'Ajuste',
    waste:      'Merma',
  }

  const inputCls   = 'w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors placeholder-zinc-600'
  const inputStyle = {
    backgroundColor: 'var(--bg-color)',
    borderColor:     'var(--border-color)',
    color:           'var(--text-color, #F4F4F4)',
  }

  const handleConfirm = () => {
    setError(null)
    const quantity = Math.floor(Number(qty))
    if (!qty || quantity <= 0) {
      setError('La cantidad debe ser un entero mayor a 0.')
      return
    }
    const finalQty = direction === 'out' ? -quantity : quantity

    startTransition(async () => {
      const result = await recordMovement(businessId, item.id, finalQty, type, notes.trim() || null, slug)
      if (result.error) {
        setError(result.error)
      } else {
        onSuccess()
        onClose()
      }
    })
  }

  return (
    <div
      className="mt-2 rounded-xl p-4 border flex flex-col gap-3"
      style={{ backgroundColor: '#0D0D0D', borderColor: 'var(--border-color)' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-zinc-300">
          {direction === 'in' ? 'Registrar entrada' : 'Registrar salida'}
        </span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* Cantidad */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Cantidad
          </label>
          <input
            type="number"
            min={1}
            step={1}
            className={inputCls}
            style={inputStyle}
            placeholder="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            autoFocus
          />
        </div>

        {/* Tipo */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Tipo
          </label>
          <select
            className={inputCls}
            style={inputStyle}
            value={type}
            onChange={(e) => setType(e.target.value as MovementType)}
          >
            {typeOptions.map((t) => (
              <option key={t} value={t}>{typeLabels[t]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Notas */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          Notas <span className="text-zinc-700 font-normal normal-case">(opcional)</span>
        </label>
        <input
          className={inputCls}
          style={inputStyle}
          placeholder="Observaciones..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex gap-2 justify-end">
        <button
          onClick={onClose}
          className="text-xs px-3 py-1.5 rounded-lg border text-zinc-400 hover:text-zinc-200 transition-colors"
          style={{ borderColor: 'var(--border-color)' }}
        >
          Cancelar
        </button>
        <button
          onClick={handleConfirm}
          disabled={isPending}
          className="text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-all disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
        >
          {isPending ? <Loader2 size={11} className="animate-spin" /> : null}
          Confirmar
        </button>
      </div>
    </div>
  )
}

// ── Item Row ──────────────────────────────────────────────────────────────────

interface ItemRowProps {
  item:             InventoryItem
  reservations:     InventoryReservation[]
  businessId:       string
  slug:             string
  onEdit:           (item: InventoryItem) => void
  onDeactivate:     (itemId: string) => void
  isDeactivating:   boolean
}

function ItemRow({ item, reservations, businessId, slug, onEdit, onDeactivate, isDeactivating }: ItemRowProps) {
  const router                            = useRouter()
  const [menuOpen, setMenuOpen]           = useState(false)
  const [confirmDrop, setConfirmDrop]     = useState(false)
  const [movement, setMovement]           = useState<'in' | 'out' | null>(null)
  const [showReserved, setShowReserved]   = useState(false)

  const isLow = item.current_stock < item.min_stock
  const reservedQty = reservations.reduce((sum, r) => sum + r.quantity, 0)
  const reservedTooltip = reservations
    .map((r) => `${r.customer_name ?? 'Cliente'} — ${reservationWhen(r.start_time)} (${r.quantity})`)
    .join('\n')

  return (
    <div
      className="rounded-xl border transition-colors"
      style={{
        backgroundColor: '#111111',
        borderColor:     isLow ? 'rgba(239,68,68,0.35)' : 'var(--border-color)',
      }}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Icon */}
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--primary-color) 10%, transparent)',
            border:          '1px solid color-mix(in srgb, var(--primary-color) 18%, transparent)',
          }}
        >
          <Package size={14} style={{ color: 'var(--primary-color)' }} />
        </div>

        {/* Name + SKU + category */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-zinc-100 truncate">{item.name}</span>
            {item.sku && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                {item.sku}
              </span>
            )}
            <CategoryBadge category={item.category} />
            {item.bookable_online && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full text-sky-400 border border-sky-500/25 bg-sky-500/10"
                title="Disponible para reserva en línea"
              >
                <Globe size={10} />
                En línea
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {item.unit_price && (
              <span className="text-[11px] text-zinc-500">{formatCOP(item.unit_price)}</span>
            )}
            {reservedQty > 0 && (
              <button
                type="button"
                onClick={() => setShowReserved((v) => !v)}
                title={reservedTooltip}
                aria-expanded={showReserved}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full text-amber-400 border border-amber-500/25 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
              >
                <CalendarClock size={10} />
                Apartado: {reservedQty}
              </button>
            )}
          </div>
        </div>

        {/* Stock gauge */}
        <div className="hidden sm:block w-24 flex-shrink-0">
          <StockGauge item={item} />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setMovement(movement === 'in' ? null : 'in')}
            title="Entrada de stock"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-emerald-400 hover:bg-emerald-400/10 transition-colors"
          >
            <ArrowUpCircle size={16} />
          </button>
          <button
            onClick={() => setMovement(movement === 'out' ? null : 'out')}
            title="Salida de stock"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
          >
            <ArrowDownCircle size={16} />
          </button>

          {/* 3-dot menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05] transition-colors"
            >
              <MoreVertical size={15} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div
                  className="absolute right-0 top-8 z-20 rounded-xl shadow-xl border min-w-[140px] overflow-hidden"
                  style={{ backgroundColor: '#1A1A1A', borderColor: 'var(--border-color)' }}
                >
                  <button
                    onClick={() => { setMenuOpen(false); onEdit(item) }}
                    className="w-full text-left text-sm px-4 py-2.5 hover:bg-white/[0.05] transition-colors text-zinc-200"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); setConfirmDrop(true) }}
                    className="w-full text-left text-sm px-4 py-2.5 hover:bg-red-500/10 text-red-400 transition-colors"
                  >
                    Desactivar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile stock gauge */}
      <div className="sm:hidden px-4 pb-3">
        <StockGauge item={item} />
      </div>

      {/* Lista de apartados (cliente + fecha/hora) */}
      {showReserved && reservedQty > 0 && (
        <ul
          className="mx-4 mb-3 flex flex-col divide-y rounded-lg border text-xs"
          style={{ borderColor: 'var(--border-color)' }}
        >
          {reservations.map((r) => (
            <li key={r.appointment_id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate text-zinc-200">
                {r.customer_name ?? 'Cliente'}
                {r.customer_phone && <span className="text-zinc-500"> · {r.customer_phone}</span>}
              </span>
              <span className="shrink-0 text-zinc-400 tabular-nums">
                {reservationWhen(r.start_time)} · {r.quantity} {r.quantity === 1 ? 'ud.' : 'uds.'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Movement form */}
      {movement && (
        <div className="px-4 pb-4">
          <MovementForm
            item={item}
            direction={movement}
            businessId={businessId}
            slug={slug}
            onClose={() => setMovement(null)}
            onSuccess={() => { router.refresh() }}
          />
        </div>
      )}

      {/* Confirm deactivation */}
      {confirmDrop && (
        <div
          className="mx-4 mb-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 border"
          style={{ backgroundColor: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.25)' }}
        >
          <span className="text-xs text-red-400">¿Desactivar este producto?</span>
          <div className="flex gap-2">
            <button
              disabled={isDeactivating}
              onClick={() => { setConfirmDrop(false); onDeactivate(item.id) }}
              className="text-[11px] font-bold px-3 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
            >
              {isDeactivating ? <Loader2 size={11} className="animate-spin" /> : 'Confirmar'}
            </button>
            <button
              onClick={() => setConfirmDrop(false)}
              className="text-[11px] px-3 py-1 rounded-lg bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Item Sheet (Add / Edit) ───────────────────────────────────────────────────

interface ItemSheetProps {
  businessId: string
  slug:       string
  editItem:   InventoryItem | null
  onClose:    () => void
  onSuccess:  () => void
}

interface ItemFormState {
  name:          string
  sku:           string
  category:      InventoryCategory
  description:   string
  current_stock: string
  min_stock:     string
  unit_price:    string
  unit_cost:     string
  bookable_online: boolean
}

const EMPTY_FORM: ItemFormState = {
  name:          '',
  sku:           '',
  category:      'general',
  description:   '',
  current_stock: '0',
  min_stock:     '0',
  unit_price:    '',
  unit_cost:     '',
  bookable_online: false,
}

function itemToFormState(item: InventoryItem): ItemFormState {
  return {
    name:          item.name,
    sku:           item.sku           ?? '',
    category:      item.category,
    description:   item.description   ?? '',
    current_stock: String(item.current_stock),
    min_stock:     String(item.min_stock),
    unit_price:    item.unit_price !== null ? String(item.unit_price) : '',
    unit_cost:     item.unit_cost  !== null ? String(item.unit_cost)  : '',
    bookable_online: item.bookable_online ?? false,
  }
}

function ItemSheet({ businessId, slug, editItem, onClose, onSuccess }: ItemSheetProps) {
  const [form, setForm]               = useState<ItemFormState>(
    editItem ? itemToFormState(editItem) : EMPTY_FORM
  )
  const [error, setError]             = useState<string | null>(null)
  const [isPending, startTransition]  = useTransition()
  const formRef                       = React.useRef<HTMLFormElement>(null)

  const inputCls =
    'w-full rounded-xl px-3 py-2.5 text-sm border outline-none transition-colors placeholder-zinc-600'
  const inputStyle = {
    backgroundColor: 'var(--bg-color)',
    borderColor:     'var(--border-color)',
    color:           'var(--text-color, #F4F4F4)',
  }
  const labelCls = 'text-xs font-semibold text-zinc-500 uppercase tracking-wide'

  const set = (key: keyof ItemFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const current_stock = Math.floor(Number(form.current_stock))
    const min_stock     = Math.floor(Number(form.min_stock))
    const unit_price    = form.unit_price ? Math.floor(Number(form.unit_price)) : null
    const unit_cost     = form.unit_cost  ? Math.floor(Number(form.unit_cost))  : null

    if (!form.name.trim()) { setError('El nombre del producto es requerido.'); return }
    if (isNaN(current_stock) || current_stock < 0) {
      setError('El stock inicial debe ser un número mayor o igual a 0.')
      return
    }
    if (isNaN(min_stock) || min_stock < 0) {
      setError('El stock mínimo debe ser un número mayor o igual a 0.')
      return
    }
    if (unit_price !== null && (isNaN(unit_price) || unit_price < 0)) {
      setError('El precio de venta debe ser un número mayor o igual a 0.')
      return
    }
    if (unit_cost !== null && (isNaN(unit_cost) || unit_cost < 0)) {
      setError('El costo unitario debe ser un número mayor o igual a 0.')
      return
    }

    startTransition(async () => {
      const input = {
        name:          form.name.trim(),
        sku:           form.sku.trim()          || null,
        category:      form.category,
        description:   form.description.trim()  || null,
        current_stock,
        min_stock,
        unit_price,
        unit_cost,
        bookable_online: form.bookable_online,
      }

      let result: { success?: boolean; error?: string }

      if (editItem) {
        result = await updateInventoryItem(businessId, editItem.id, input, slug)
      } else {
        result = await createInventoryItem(businessId, input, slug)
      }

      if (result.error) {
        setError(result.error)
      } else {
        onSuccess()
        onClose()
      }
    })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 h-full z-50 w-full max-w-md flex flex-col shadow-2xl"
        style={{ backgroundColor: 'var(--bg-color)', borderLeft: '1px solid var(--border-color)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'color-mix(in srgb, var(--primary-color) 15%, transparent)' }}
            >
              <Package size={16} style={{ color: 'var(--primary-color)' }} />
            </div>
            <span className="font-semibold text-sm text-zinc-100">
              {editItem ? 'Editar producto' : 'Agregar producto'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto p-5 flex flex-col gap-4"
        >
          {/* Nombre */}
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>
              Nombre <span className="text-red-400">*</span>
            </label>
            <input
              className={inputCls}
              style={inputStyle}
              placeholder="Ej: Pomada capilar matte"
              value={form.name}
              onChange={set('name')}
              autoFocus
            />
          </div>

          {/* SKU */}
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>
              SKU / Código{' '}
              <span className="text-zinc-600 font-normal normal-case">(opcional)</span>
            </label>
            <input
              className={inputCls}
              style={inputStyle}
              placeholder="Ej: POMADA-001"
              value={form.sku}
              onChange={set('sku')}
            />
          </div>

          {/* Categoría */}
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>Categoría</label>
            <select
              className={inputCls}
              style={inputStyle}
              value={form.category}
              onChange={set('category')}
            >
              {ALL_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
              ))}
            </select>
          </div>

          {/* Descripción */}
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>
              Descripción{' '}
              <span className="text-zinc-600 font-normal normal-case">(opcional)</span>
            </label>
            <textarea
              className={`${inputCls} resize-none`}
              style={inputStyle}
              rows={2}
              placeholder="Descripción del producto..."
              value={form.description}
              onChange={set('description')}
            />
          </div>

          {/* Stock inicial + Stock mínimo */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>
                Stock {editItem ? 'actual' : 'inicial'} <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                min={0}
                step={1}
                className={inputCls}
                style={inputStyle}
                placeholder="0"
                value={form.current_stock}
                onChange={set('current_stock')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>
                Stock mínimo <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                min={0}
                step={1}
                className={inputCls}
                style={inputStyle}
                placeholder="0"
                value={form.min_stock}
                onChange={set('min_stock')}
              />
            </div>
          </div>

          {/* Precio venta + Costo unitario */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>
                Precio venta COP{' '}
                <span className="text-zinc-600 font-normal normal-case">(opcional)</span>
              </label>
              <input
                type="number"
                min={0}
                step={1}
                className={inputCls}
                style={inputStyle}
                placeholder="25000"
                value={form.unit_price}
                onChange={set('unit_price')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>
                Costo unitario COP{' '}
                <span className="text-zinc-600 font-normal normal-case">(opcional)</span>
              </label>
              <input
                type="number"
                min={0}
                step={1}
                className={inputCls}
                style={inputStyle}
                placeholder="15000"
                value={form.unit_cost}
                onChange={set('unit_cost')}
              />
            </div>
          </div>

          {/* Reserva en línea */}
          <label
            className="flex items-start justify-between gap-4 rounded-xl border px-3 py-3 cursor-pointer"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-zinc-200">Disponible para reserva en línea</span>
              <span className="text-[11px] text-zinc-500">
                El cliente podrá apartarlo al reservar (requiere precio de venta). Se paga en el local.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={form.bookable_online}
              onChange={(e) => setForm((p) => ({ ...p, bookable_online: e.target.checked }))}
              className="mt-0.5 h-5 w-5 shrink-0 rounded accent-[var(--primary-color)]"
            />
          </label>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
          )}
        </form>

        {/* Footer */}
        <div
          className="px-5 py-4 border-t flex gap-3"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
            style={{ borderColor: 'var(--border-color)' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => formRef.current?.requestSubmit()}
            disabled={isPending}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all hover:scale-105 disabled:opacity-50 disabled:scale-100"
            style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
          >
            {isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            {editItem ? 'Guardar cambios' : 'Agregar producto'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function InventoryManager({
  items: initialItems,
  lowStockItems,
  reservations,
  businessId,
  slug,
}: InventoryManagerProps) {
  const router                                  = useRouter()
  const [items, setItems]                       = useState<InventoryItem[]>(initialItems)
  const [showSheet, setShowSheet]               = useState(false)
  const [editingItem, setEditingItem]           = useState<InventoryItem | null>(null)
  const [deactivatingId, setDeactivatingId]     = useState<string | null>(null)
  const [, startTransition]                     = useTransition()

  // Search & filter state
  const [search, setSearch]                     = useState('')
  const [categoryFilter, setCategoryFilter]     = useState<InventoryCategory | 'all'>('all')

  // Computed summary values
  const totalItems      = items.length
  const lowStockCount   = items.filter((i) => i.current_stock <= i.min_stock).length
  const totalInventoryValue = items.reduce((sum, i) => {
    if (i.unit_cost !== null) {
      return sum + i.current_stock * i.unit_cost
    }
    return sum
  }, 0)

  // Apartados por ítem y alertas (apartado > existencias)
  const reservedMap = reservedByItem(reservations)
  const oversoldItems = items.filter((i) => (reservedMap[i.id] ?? 0) > i.current_stock)

  // Filtered items
  const filteredItems = items.filter((item) => {
    const matchSearch =
      search === '' ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.sku?.toLowerCase().includes(search.toLowerCase()) ?? false)
    const matchCategory =
      categoryFilter === 'all' || item.category === categoryFilter
    return matchSearch && matchCategory
  })

  const handleDeactivate = (itemId: string) => {
    setDeactivatingId(itemId)
    startTransition(async () => {
      try {
        await deactivateInventoryItem(businessId, itemId, slug)
        setItems((prev) => prev.filter((i) => i.id !== itemId))
        router.refresh()
      } finally {
        setDeactivatingId(null)
      }
    })
  }

  const handleEdit = (item: InventoryItem) => {
    setEditingItem(item)
    setShowSheet(true)
  }

  const handleCloseSheet = () => {
    setShowSheet(false)
    setEditingItem(null)
  }

  const handleSuccess = () => {
    router.refresh()
  }

  const inputStyle = {
    backgroundColor: '#0D0D0D',
    borderColor:     'var(--border-color)',
    color:           'var(--text-color, #F4F4F4)',
  }

  return (
    <div className="flex flex-col gap-5 pt-6">
      {/* Page Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
              border:          '1px solid color-mix(in srgb, var(--primary-color) 25%, transparent)',
            }}
          >
            <Package size={22} style={{ color: 'var(--primary-color)' }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-serif font-bold text-xl text-zinc-100">Inventario</h1>
              {items.length > 0 && (
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    color:           'var(--primary-color)',
                    backgroundColor: 'color-mix(in srgb, var(--primary-color) 15%, transparent)',
                  }}
                >
                  {items.length} {items.length === 1 ? 'producto' : 'productos'}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              Control de stock de productos del negocio
            </p>
          </div>
        </div>

        <button
          onClick={() => { setEditingItem(null); setShowSheet(true) }}
          className="flex items-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl transition-all hover:scale-105 flex-shrink-0"
          style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
        >
          <Plus size={15} />
          <span className="hidden sm:inline">Agregar producto</span>
          <span className="sm:hidden">Agregar</span>
        </button>
      </div>

      {/* Summary Bar */}
      <div className="flex flex-wrap gap-3">
        {/* Total items */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm"
          style={{ backgroundColor: '#111111', borderColor: 'var(--border-color)' }}
        >
          <Package size={14} style={{ color: 'var(--primary-color)' }} />
          <span className="text-zinc-400">Total:</span>
          <span className="font-bold text-zinc-100">{totalItems}</span>
        </div>

        {/* Low stock */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm"
          style={{
            backgroundColor: '#111111',
            borderColor:     lowStockCount > 0 ? 'rgba(245,158,11,0.4)' : 'var(--border-color)',
          }}
        >
          <AlertTriangle
            size={14}
            style={{ color: lowStockCount > 0 ? '#f59e0b' : 'var(--zinc-500, #71717a)' }}
          />
          <span className="text-zinc-400">Stock bajo:</span>
          <span
            className="font-bold"
            style={{ color: lowStockCount > 0 ? '#f59e0b' : '#71717a' }}
          >
            {lowStockCount}
          </span>
        </div>

        {/* Total value */}
        {totalInventoryValue > 0 && (
          <div
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm"
            style={{ backgroundColor: '#111111', borderColor: 'var(--border-color)' }}
          >
            <span className="text-zinc-400">Valor en inventario:</span>
            <span className="font-bold" style={{ color: 'var(--primary-color)' }}>
              {formatCOP(totalInventoryValue)}
            </span>
          </div>
        )}
      </div>

      {/* Apartado sin existencias */}
      {oversoldItems.length > 0 && (
        <div
          role="alert"
          className="rounded-xl px-4 py-3 flex flex-col gap-2 border"
          style={{ backgroundColor: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.35)' }}
        >
          {oversoldItems.map((item) => {
            const itemRes  = reservationsForItem(reservations, item.id)
            const customers = Array.from(
              new Set(
                itemRes.map((r) =>
                  r.customer_phone
                    ? `${r.customer_name ?? 'Cliente'} (${r.customer_phone})`
                    : (r.customer_name ?? 'Cliente')
                )
              )
            ).join(', ')
            return (
              <div key={item.id} className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <span className="text-xs font-semibold text-red-400">
                  Apartado sin existencias: {item.name} — {reservedMap[item.id]} apartadas, {item.current_stock} en inventario. Contacta a: {customers}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Low stock alert banner */}
      {lowStockItems.length > 0 && (
        <div
          className="rounded-xl px-4 py-3 flex flex-col gap-2 border"
          style={{ backgroundColor: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.3)' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-amber-400">
              {lowStockItems.length} {lowStockItems.length === 1 ? 'producto' : 'productos'} con stock bajo
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {lowStockItems.map((item) => (
              <span
                key={item.id}
                className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: 'rgba(245,158,11,0.12)',
                  color:           '#f59e0b',
                  border:          '1px solid rgba(245,158,11,0.25)',
                }}
              >
                {item.name} ({item.current_stock})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Search + Category filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            className="w-full rounded-xl pl-9 pr-3 py-2.5 text-sm border outline-none transition-colors placeholder-zinc-600"
            style={inputStyle}
            placeholder="Buscar por nombre o SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Category filter */}
        <div className="relative">
          <select
            className="appearance-none rounded-xl px-3 pr-8 py-2.5 text-sm border outline-none transition-colors cursor-pointer"
            style={inputStyle}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as InventoryCategory | 'all')}
          >
            <option value="all">Todas las categorías</option>
            {ALL_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
        </div>
      </div>

      {/* Items list or empty state */}
      {filteredItems.length === 0 ? (
        <div
          className="rounded-2xl flex flex-col items-center justify-center gap-4 py-16 border"
          style={{ backgroundColor: '#111111', borderColor: 'var(--border-color)' }}
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--primary-color) 10%, transparent)',
              border:          '1px solid color-mix(in srgb, var(--primary-color) 20%, transparent)',
            }}
          >
            <Package size={32} style={{ color: 'var(--primary-color)', opacity: 0.6 }} />
          </div>
          <div className="text-center">
            <p className="font-semibold text-zinc-200">
              {items.length === 0 ? 'No hay productos en inventario' : 'Sin resultados para esta búsqueda'}
            </p>
            <p className="text-sm text-zinc-500 mt-1">
              {items.length === 0
                ? 'Agrega tu primer producto para controlar el stock'
                : 'Intenta con otro nombre, SKU o categoría'}
            </p>
          </div>
          {items.length === 0 && (
            <button
              onClick={() => { setEditingItem(null); setShowSheet(true) }}
              className="flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl transition-all hover:scale-105"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--primary-color) 15%, transparent)',
                color:           'var(--primary-color)',
                border:          '1px solid color-mix(in srgb, var(--primary-color) 25%, transparent)',
              }}
            >
              <Plus size={14} />
              Agregar producto
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredItems.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              reservations={reservationsForItem(reservations, item.id)}
              businessId={businessId}
              slug={slug}
              onEdit={handleEdit}
              onDeactivate={handleDeactivate}
              isDeactivating={deactivatingId === item.id}
            />
          ))}
        </div>
      )}

      {/* Add / Edit Sheet */}
      {showSheet && (
        <ItemSheet
          businessId={businessId}
          slug={slug}
          editItem={editingItem}
          onClose={handleCloseSheet}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}
