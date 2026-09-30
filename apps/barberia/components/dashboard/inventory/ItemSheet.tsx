'use client'
// components/dashboard/inventory/ItemSheet.tsx — crear / editar producto

import React, { useState, useTransition } from 'react'
import { Package, Plus, Save, Info } from 'lucide-react'
import { createInventoryItem, updateInventoryItem } from '@/actions/inventory'
import { INVENTORY_CATEGORIES } from '@/lib/inventory-utils'
import type { InventoryItem, InventoryCategory } from '@xinuco/types'
import {
  SidePanel,
  PanelFooter,
  formatCOP,
  panelInputCls as inputCls,
  panelInputStyle as inputStyle,
  panelLabelCls as labelCls,
} from './SidePanel'

export const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  general:  'General',
  hair:     'Cabello',
  skincare: 'Skincare',
  tools:    'Herramientas',
  other:    'Otro',
}

interface ItemFormState {
  name:            string
  sku:             string
  category:        InventoryCategory
  description:     string
  current_stock:   string   // solo al crear (stock inicial)
  min_stock:       string
  unit_price:      string
  unit_cost:       string
  bookable_online: boolean
}

const EMPTY_FORM: ItemFormState = {
  name:            '',
  sku:             '',
  category:        'general',
  description:     '',
  current_stock:   '0',
  min_stock:       '0',
  unit_price:      '',
  unit_cost:       '',
  bookable_online: false,
}

function itemToFormState(item: InventoryItem): ItemFormState {
  return {
    name:            item.name,
    sku:             item.sku ?? '',
    category:        item.category,
    description:     item.description ?? '',
    current_stock:   String(item.current_stock),
    min_stock:       String(item.min_stock),
    unit_price:      item.unit_price !== null ? String(item.unit_price) : '',
    unit_cost:       item.unit_cost !== null ? String(item.unit_cost) : '',
    bookable_online: item.bookable_online ?? false,
  }
}

interface ItemSheetProps {
  editItem:  InventoryItem | null
  onClose:   () => void
  onSuccess: () => void
}

export function ItemSheet({ editItem, onClose, onSuccess }: ItemSheetProps) {
  const [form, setForm] = useState<ItemFormState>(editItem ? itemToFormState(editItem) : EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [createdPartially, setCreatedPartially] = useState(false)
  const [isPending, startTransition] = useTransition()
  const formRef = React.useRef<HTMLFormElement>(null)

  const set = (key: keyof ItemFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value }))

  const initialStock = Math.floor(Number(form.current_stock))
  const costEmpty    = form.unit_cost.trim() === ''

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const min_stock  = Math.floor(Number(form.min_stock))
    const unit_price = form.unit_price ? Math.floor(Number(form.unit_price)) : null
    const unit_cost  = form.unit_cost  ? Math.floor(Number(form.unit_cost))  : null

    if (form.name.trim().length < 2) { setError('El nombre debe tener al menos 2 caracteres.'); return }
    if (!editItem && (isNaN(initialStock) || initialStock < 0)) {
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
      const base = {
        name:            form.name.trim(),
        sku:             form.sku.trim() || null,
        category:        form.category,
        description:     form.description.trim() || null,
        min_stock,
        unit_price,
        unit_cost,
        bookable_online: form.bookable_online,
      }

      const result: { success?: boolean; error?: string; id?: string } = editItem
        ? await updateInventoryItem(editItem.id, base)
        : await createInventoryItem({ ...base, current_stock: initialStock })

      if (result.error) {
        // Producto creado pero falló el stock inicial: refrescar la lista y bloquear el reenvío
        // (reintentar duplicaría el producto; el stock se carga luego con "Registrar compra").
        if (result.id) { setCreatedPartially(true); onSuccess() }
        setError(result.error)
      } else {
        onSuccess()
        onClose()
      }
    })
  }

  return (
    <SidePanel
      title={editItem ? 'Editar producto' : 'Agregar producto'}
      icon={<Package size={16} style={{ color: 'var(--primary-color)' }} />}
      onClose={onClose}
      footer={
        <PanelFooter
          onCancel={onClose}
          onConfirm={() => formRef.current?.requestSubmit()}
          confirmLabel={editItem ? 'Guardar cambios' : 'Agregar producto'}
          pending={isPending}
          disabled={createdPartially}
          confirmIcon={editItem ? <Save size={14} /> : <Plus size={14} />}
        />
      }
    >
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="flex-1 overflow-y-auto p-5 flex flex-col gap-4"
      >
        {/* Nombre */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Nombre <span className="text-red-400">*</span></label>
          <input
            className={inputCls} style={inputStyle} maxLength={80}
            placeholder="Ej: Pomada capilar matte"
            value={form.name} onChange={set('name')} autoFocus
          />
        </div>

        {/* SKU */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>
            SKU / Código <span className="text-zinc-600 font-normal normal-case">(opcional)</span>
          </label>
          <input
            className={inputCls} style={inputStyle} maxLength={40}
            placeholder="Ej: POMADA-001"
            value={form.sku} onChange={set('sku')}
          />
        </div>

        {/* Categoría */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Categoría</label>
          <select className={inputCls} style={inputStyle} value={form.category} onChange={set('category')}>
            {INVENTORY_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
            ))}
          </select>
        </div>

        {/* Descripción */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>
            Descripción <span className="text-zinc-600 font-normal normal-case">(opcional)</span>
          </label>
          <textarea
            className={`${inputCls} resize-none`} style={inputStyle} rows={2} maxLength={300}
            placeholder="Descripción del producto..."
            value={form.description} onChange={set('description')}
          />
        </div>

        {/* Stock */}
        {editItem ? (
          <div
            className="rounded-xl border px-4 py-3 flex flex-col gap-1"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Stock actual</span>
              <span className="font-bold text-zinc-100 tabular-nums">{editItem.current_stock}</span>
            </div>
            <p className="flex items-start gap-1.5 text-[11px] text-zinc-500">
              <Info size={12} className="mt-0.5 flex-shrink-0" />
              El stock cambia con compras, ventas, conteos y mermas.
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          {!editItem && (
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Stock inicial <span className="text-red-400">*</span></label>
              <input
                type="number" min={0} step={1} inputMode="numeric"
                className={inputCls} style={inputStyle}
                placeholder="0" value={form.current_stock} onChange={set('current_stock')}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>Stock mínimo <span className="text-red-400">*</span></label>
            <input
              type="number" min={0} step={1} inputMode="numeric"
              className={inputCls} style={inputStyle}
              placeholder="0" value={form.min_stock} onChange={set('min_stock')}
            />
          </div>
        </div>

        {/* Precio venta + Costo unitario */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>
              Precio venta COP <span className="text-zinc-600 font-normal normal-case">(opcional)</span>
            </label>
            <input
              type="number" min={0} step={1} inputMode="numeric"
              className={inputCls} style={inputStyle}
              placeholder="25000" value={form.unit_price} onChange={set('unit_price')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>
              Costo unitario COP <span className="text-zinc-600 font-normal normal-case">(opcional)</span>
            </label>
            <input
              type="number" min={0} step={1} inputMode="numeric"
              className={inputCls} style={inputStyle}
              placeholder="15000" value={form.unit_cost} onChange={set('unit_cost')}
            />
          </div>
        </div>
        <p className="-mt-2 text-[11px] text-zinc-500">
          {editItem
            ? 'El costo se recalcula solo con cada compra (costo promedio). Edítalo aquí solo para corregirlo.'
            : !isNaN(initialStock) && initialStock > 0
              ? costEmpty
                ? 'Sin costo, el stock inicial entra a $0 y el costo promedio se ajusta con tus próximas compras.'
                : `El stock inicial se registra como una compra de ${initialStock} × ${formatCOP(Math.floor(Number(form.unit_cost)) || 0)}.`
              : 'Puedes dejarlo vacío y registrarlo con tu primera compra.'}
        </p>

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
            type="checkbox" role="switch"
            checked={form.bookable_online}
            onChange={(e) => setForm((p) => ({ ...p, bookable_online: e.target.checked }))}
            className="mt-0.5 h-5 w-5 shrink-0 rounded accent-[var(--primary-color)]"
          />
        </label>

        {error && (
          <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
        )}
      </form>
    </SidePanel>
  )
}
