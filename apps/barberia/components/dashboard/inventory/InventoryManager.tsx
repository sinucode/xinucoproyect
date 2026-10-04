'use client'
// components/dashboard/inventory/InventoryManager.tsx — RF Inventario

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Package,
  Plus,
  Search,
  AlertTriangle,
  ArrowDownToLine,
  ClipboardCheck,
  Trash2,
  History,
  Pencil,
  PowerOff,
  Loader2,
  MoreVertical,
  ChevronDown,
  Globe,
  CalendarClock,
} from 'lucide-react'
import { AdminPageHeader } from '@xinuco/ui'
import { deactivateInventoryItem } from '@/actions/inventory'
import { INVENTORY_CATEGORIES } from '@/lib/inventory-utils'
import type { InventoryItem, InventoryCategory } from '@xinuco/types'
import { formatApptTime, apptDateKey, dayLabel, businessTodayISODate } from '@/lib/agenda-time'
import { reservedByItem, reservationsForItem, type InventoryReservation } from '@/lib/inventory-reservations'
import { formatCOP } from './SidePanel'
import { ItemSheet, CATEGORY_LABELS } from './ItemSheet'
import { PurchaseSheet, CountSheet, WasteSheet } from './StockSheets'
import { MovementHistorySheet } from './MovementHistorySheet'

// ── Props ─────────────────────────────────────────────────────────────────────

interface InventoryManagerProps {
  items:          InventoryItem[]
  lowStockItems:  InventoryItem[]
  reservations:   InventoryReservation[]
  /** Hay un turno de caja abierto (habilita pagar compras con el efectivo de la caja). */
  hasOpenShift:   boolean
}

type PanelAction = 'purchase' | 'count' | 'waste' | 'history' | 'edit'

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

  const color = isLow    ? 'var(--st-red, #ef4444)'
              : isExact  ? 'var(--st-amber-2, #f59e0b)'
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

// ── Item Row ──────────────────────────────────────────────────────────────────

interface ItemRowProps {
  item:             InventoryItem
  reservations:     InventoryReservation[]
  onAction:         (action: PanelAction, item: InventoryItem) => void
  onDeactivate:     (itemId: string) => void
  isDeactivating:   boolean
}

function ItemRow({ item, reservations, onAction, onDeactivate, isDeactivating }: ItemRowProps) {
  const [menuOpen, setMenuOpen]           = useState(false)
  const [confirmDrop, setConfirmDrop]     = useState(false)
  const [showReserved, setShowReserved]   = useState(false)

  const isLow = item.current_stock < item.min_stock
  const reservedQty = reservations.reduce((sum, r) => sum + r.quantity, 0)
  const reservedTooltip = reservations
    .map((r) => `${r.customer_name ?? 'Cliente'} — ${reservationWhen(r.start_time)} (${r.quantity})`)
    .join('\n')

  const menuItemCls = 'w-full flex items-center gap-2.5 text-left text-sm px-4 py-2.5 hover:bg-fg/[0.05] transition-colors text-zinc-200'
  const pick = (action: PanelAction) => { setMenuOpen(false); onAction(action, item) }

  return (
    <div
      className="rounded-xl border transition-colors"
      style={{
        backgroundColor: 'var(--card-color, #111111)',
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
            {item.unit_price ? (
              <span className="text-[11px] text-zinc-500">{formatCOP(item.unit_price)}</span>
            ) : null}
            {item.unit_cost ? (
              <span className="text-[11px] text-zinc-600" title="Costo promedio">
                Costo {formatCOP(item.unit_cost)}
              </span>
            ) : null}
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
            onClick={() => onAction('purchase', item)}
            title="Registrar compra"
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg text-zinc-400 hover:text-emerald-400 hover:bg-emerald-400/10 transition-colors"
          >
            <ArrowDownToLine size={15} />
            <span className="hidden sm:inline">Compra</span>
          </button>

          {/* 3-dot menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Más acciones"
              aria-expanded={menuOpen}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-fg/[0.05] transition-colors"
            >
              <MoreVertical size={15} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div
                  className="absolute right-0 top-8 z-20 rounded-xl shadow-xl border min-w-[190px] overflow-hidden"
                  style={{ backgroundColor: 'var(--secondary-color)', borderColor: 'var(--border-color)' }}
                >
                  <button onClick={() => pick('purchase')} className={menuItemCls}>
                    <ArrowDownToLine size={14} className="text-zinc-500" /> Registrar compra
                  </button>
                  <button onClick={() => pick('count')} className={menuItemCls}>
                    <ClipboardCheck size={14} className="text-zinc-500" /> Conteo físico
                  </button>
                  <button onClick={() => pick('waste')} className={menuItemCls}>
                    <Trash2 size={14} className="text-zinc-500" /> Merma
                  </button>
                  <button onClick={() => pick('history')} className={menuItemCls}>
                    <History size={14} className="text-zinc-500" /> Historial
                  </button>
                  <div className="border-t" style={{ borderColor: 'var(--border-color)' }} />
                  <button onClick={() => pick('edit')} className={menuItemCls}>
                    <Pencil size={14} className="text-zinc-500" /> Editar
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); setConfirmDrop(true) }}
                    className="w-full flex items-center gap-2.5 text-left text-sm px-4 py-2.5 hover:bg-red-500/10 text-red-400 transition-colors"
                  >
                    <PowerOff size={14} /> Desactivar
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


// ── Main Component ────────────────────────────────────────────────────────────

// ── Main Component ────────────────────────────────────────────────────────────

export function InventoryManager({
  items: serverItems,
  lowStockItems,
  reservations,
  hasOpenShift,
}: InventoryManagerProps) {
  const router                                  = useRouter()
  // Los ítems vienen del servidor (se actualizan con router.refresh); solo se oculta al instante el desactivado
  const [removedIds, setRemovedIds]             = useState<Set<string>>(new Set())
  const items                                   = serverItems.filter((i) => !removedIds.has(i.id))
  const [showCreate, setShowCreate]             = useState(false)
  const [panel, setPanel]                       = useState<{ action: PanelAction; itemId: string } | null>(null)
  const [deactivatingId, setDeactivatingId]     = useState<string | null>(null)
  const [deactivateError, setDeactivateError]   = useState<string | null>(null)
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
    setDeactivateError(null)
    startTransition(async () => {
      try {
        const result = await deactivateInventoryItem(itemId)
        if (result.error) {
          setDeactivateError(result.error)
        } else {
          setRemovedIds((prev) => new Set(prev).add(itemId))
          router.refresh()
        }
      } finally {
        setDeactivatingId(null)
      }
    })
  }

  const handleAction = (action: PanelAction, item: InventoryItem) => {
    setPanel({ action, itemId: item.id })
  }

  const closePanel = () => setPanel(null)
  const handleSuccess = () => router.refresh()

  // El ítem del panel se busca en la lista viva: tras una compra el stock del panel se mantiene coherente
  const panelItem = panel ? items.find((i) => i.id === panel.itemId) ?? null : null

  const inputStyle = {
    backgroundColor: 'var(--sunken-color, #0D0D0D)',
    borderColor:     'var(--border-color)',
    color:           'var(--text-color, #F4F4F4)',
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Page Header */}
      <AdminPageHeader
        title="Inventario"
        subtitle={
          items.length > 0
            ? `${items.length} ${items.length === 1 ? 'producto' : 'productos'} · Stock, compras, conteos y mermas`
            : 'Stock, compras, conteos y mermas de tus productos'
        }
        actionButton={
          <button
            onClick={() => setShowCreate(true)}
            className="flex min-h-11 items-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl transition-opacity hover:opacity-90 flex-shrink-0"
            style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
          >
            <Plus size={15} />
            <span className="hidden sm:inline">Agregar producto</span>
            <span className="sm:hidden">Agregar</span>
          </button>
        }
      />

      {/* Summary Bar */}
      <div className="flex flex-wrap gap-3">
        {/* Total items */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm"
          style={{ backgroundColor: 'var(--card-color, #111111)', borderColor: 'var(--border-color)' }}
        >
          <Package size={14} style={{ color: 'var(--primary-color)' }} />
          <span className="text-zinc-400">Total:</span>
          <span className="font-bold text-zinc-100">{totalItems}</span>
        </div>

        {/* Low stock */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm"
          style={{
            backgroundColor: 'var(--card-color, #111111)',
            borderColor:     lowStockCount > 0 ? 'rgba(245,158,11,0.4)' : 'var(--border-color)',
          }}
        >
          <AlertTriangle
            size={14}
            style={{ color: lowStockCount > 0 ? 'var(--st-amber-2, #f59e0b)' : 'rgb(var(--zinc-500))' }}
          />
          <span className="text-zinc-400">Stock bajo:</span>
          <span
            className="font-bold"
            style={{ color: lowStockCount > 0 ? 'var(--st-amber-2, #f59e0b)' : 'rgb(var(--zinc-500))' }}
          >
            {lowStockCount}
          </span>
        </div>

        {/* Total value */}
        {totalInventoryValue > 0 && (
          <div
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm"
            style={{ backgroundColor: 'var(--card-color, #111111)', borderColor: 'var(--border-color)' }}
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
                  color:           'var(--st-amber-2, #f59e0b)',
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
            {INVENTORY_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
        </div>
      </div>

      {deactivateError && (
        <p role="alert" className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{deactivateError}</p>
      )}

      {/* Items list or empty state */}
      {filteredItems.length === 0 ? (
        <div
          className="rounded-2xl flex flex-col items-center justify-center gap-4 py-16 border"
          style={{ backgroundColor: 'var(--card-color, #111111)', borderColor: 'var(--border-color)' }}
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
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
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
              onAction={handleAction}
              onDeactivate={handleDeactivate}
              isDeactivating={deactivatingId === item.id}
            />
          ))}
        </div>
      )}

      {/* Crear producto */}
      {showCreate && (
        <ItemSheet editItem={null} onClose={() => setShowCreate(false)} onSuccess={handleSuccess} />
      )}

      {/* Paneles por producto: compra, conteo, merma, historial, edición */}
      {panel && panelItem && panel.action === 'purchase' && (
        <PurchaseSheet item={panelItem} hasOpenShift={hasOpenShift} onClose={closePanel} onDone={handleSuccess} />
      )}
      {panel && panelItem && panel.action === 'count' && (
        <CountSheet item={panelItem} onClose={closePanel} onDone={handleSuccess} />
      )}
      {panel && panelItem && panel.action === 'waste' && (
        <WasteSheet item={panelItem} onClose={closePanel} onDone={handleSuccess} />
      )}
      {panel && panelItem && panel.action === 'history' && (
        <MovementHistorySheet item={panelItem} onClose={closePanel} />
      )}
      {panel && panelItem && panel.action === 'edit' && (
        <ItemSheet editItem={panelItem} onClose={closePanel} onSuccess={handleSuccess} />
      )}
    </div>
  )
}

