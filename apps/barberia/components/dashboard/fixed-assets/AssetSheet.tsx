'use client'
// components/dashboard/fixed-assets/AssetSheet.tsx — agregar / editar equipo

import React, { useState, useTransition } from 'react'
import { Package, Plus, Save, Info, ChevronDown } from 'lucide-react'
import { registerFixedAsset, updateFixedAsset } from '@/actions/fixed-assets'
import { businessTodayISODate } from '@/lib/agenda-time'
import {
  ASSET_CATEGORIES,
  MAX_ASSET_PRICE,
  MAX_LIFE_MONTHS,
  METHOD_HINTS,
  METHOD_LABELS,
  MIN_ASSET_DATE,
  PAYMENT_ORDER,
  PURCHASE_PAYMENT_LABELS,
  SELECTABLE_CATEGORIES,
  categoryDefaultMonths,
  categoryLabel,
  firstMonthDepreciation,
  formatDateES,
  fullyDepreciatedOn,
  lifeLabel,
  mapAssetError,
  monthYearES,
  monthlyDepreciation,
} from '@/lib/fixed-assets-utils'
import type {
  AssetPaymentMethod,
  DepreciationMethod,
  FixedAsset,
  FixedAssetCategory,
} from '@xinuco/types'
import { SidePanel, PanelFooter, panelLabelCls as labelCls } from '../inventory/SidePanel'
import { ChoiceButtons, ErrorBox, MoneyInput, formatCOP, inputCls, inputStyle, toInt } from './shared'

interface AssetSheetProps {
  /** null = agregar equipo nuevo; con equipo = editar. */
  editAsset:    FixedAsset | null
  /** Hay un turno de caja abierto (habilita pagar con el efectivo de la caja). */
  hasOpenShift: boolean
  onClose:      () => void
  onDone:       (message: string) => void
}

const FIELD_HINT = 'text-[11px] text-zinc-500'

export function AssetSheet({ editAsset, hasOpenShift, onClose, onDone }: AssetSheetProps) {
  const isEdit = editAsset !== null
  const today = businessTodayISODate()

  const initialCategory: FixedAssetCategory = editAsset?.category ?? 'equipment'
  const initialLife = editAsset?.useful_life_months ?? categoryDefaultMonths(initialCategory)

  const [name, setName]             = useState(editAsset?.name ?? '')
  const [category, setCategory]     = useState<FixedAssetCategory>(initialCategory)
  const [date, setDate]             = useState(editAsset?.purchase_date ?? today)
  const [price, setPrice]           = useState(editAsset ? String(editAsset.purchase_price) : '')
  const [payment, setPayment]       = useState<AssetPaymentMethod>('transfer')
  const [years, setYears]           = useState(String(Math.floor(initialLife / 12)))
  const [extraMonths, setExtraMonths] = useState(String(initialLife % 12))
  // Si la persona ya tocó la vida útil, cambiar de categoría no la pisa
  const [lifeTouched, setLifeTouched] = useState(isEdit)
  const [salvage, setSalvage]       = useState(editAsset ? String(editAsset.salvage_value) : '0')
  const [method, setMethod]         = useState<DepreciationMethod>(editAsset?.depreciation_method ?? 'straight_line')
  const [serial, setSerial]         = useState(editAsset?.serial_number ?? '')
  const [location, setLocation]     = useState(editAsset?.location ?? '')
  const [description, setDescription] = useState(editAsset?.description ?? '')
  const [showAdvanced, setShowAdvanced] = useState(
    isEdit && (
      (editAsset?.salvage_value ?? 0) > 0 ||
      editAsset?.depreciation_method === 'declining_balance' ||
      !!editAsset?.serial_number || !!editAsset?.location || !!editAsset?.description
    ),
  )
  const [error, setError]           = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const priceN   = toInt(price)
  const salvageN = toInt(salvage === '' ? '0' : salvage)
  const lifeN    = toInt(years) * 12 + toInt(extraMonths)

  const priceOk   = Number.isFinite(priceN) && priceN > 0 && priceN <= MAX_ASSET_PRICE
  const salvageOk = Number.isFinite(salvageN) && salvageN >= 0 && (!priceOk || salvageN < priceN)
  const lifeOk    = Number.isFinite(lifeN) && lifeN >= 1 && lifeN <= MAX_LIFE_MONTHS
  const dateOk    = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today && date >= MIN_ASSET_DATE

  const suggested = categoryDefaultMonths(category)

  // Vista previa inmediata del desgaste
  const preview = priceOk && salvageOk && lifeOk && dateOk
    ? (() => {
        const v = {
          purchase_date: date, purchase_price: priceN, salvage_value: salvageN,
          useful_life_months: lifeN, depreciation_method: method,
        }
        return {
          perMonth: method === 'straight_line'
            ? monthlyDepreciation(priceN, salvageN, lifeN)
            : firstMonthDepreciation(v),
          endsOn: fullyDepreciatedOn(v),
        }
      })()
    : null

  const handleCategory = (next: FixedAssetCategory) => {
    setCategory(next)
    if (!lifeTouched) {
      const months = categoryDefaultMonths(next)
      setYears(String(Math.floor(months / 12)))
      setExtraMonths(String(months % 12))
    }
  }

  const handleSubmit = () => {
    setError(null)
    if (!name.trim()) { setError(mapAssetError('name_required')); return }
    if (!dateOk) { setError(mapAssetError('invalid_date')); return }
    if (!priceOk) { setError('Escribe cuánto costó el equipo (un valor mayor a 0).'); return }
    if (!lifeOk) { setError(mapAssetError('invalid_life')); return }
    if (!salvageOk) { setError(mapAssetError('invalid_salvage')); return }
    if (!isEdit && payment === 'cash_register' && !hasOpenShift) {
      setError(mapAssetError('shift_not_open'))
      return
    }

    startTransition(async () => {
      if (isEdit && editAsset) {
        const result = await updateFixedAsset(editAsset.id, {
          name:                name.trim(),
          category,
          description:         description.trim() || null,
          serial_number:       serial.trim() || null,
          location:            location.trim() || null,
          purchase_date:       date,
          purchase_price:      priceN,
          salvage_value:       salvageN,
          useful_life_months:  lifeN,
          depreciation_method: method,
        })
        if (result.error) { setError(result.error); return }
        onDone(`Guardamos los cambios de «${name.trim()}».`)
      } else {
        const result = await registerFixedAsset({
          name:                name.trim(),
          category,
          purchase_date:       date,
          purchase_price:      priceN,
          salvage_value:       salvageN,
          useful_life_months:  lifeN,
          depreciation_method: method,
          payment_method:      payment,
          serial_number:       serial.trim() || null,
          location:            location.trim() || null,
          description:         description.trim() || null,
        })
        if (result.error) { setError(result.error); return }
        onDone(`Agregamos «${name.trim()}» a tus equipos.`)
      }
      onClose()
    })
  }

  return (
    <SidePanel
      title={isEdit ? 'Editar equipo' : 'Agregar equipo'}
      subtitle={isEdit ? editAsset?.name : 'Sillas, máquinas y demás equipos del negocio'}
      icon={<Package size={16} style={{ color: 'var(--primary-color)' }} />}
      onClose={onClose}
      footer={
        <PanelFooter
          onCancel={onClose}
          onConfirm={handleSubmit}
          confirmLabel={isEdit ? 'Guardar cambios' : 'Agregar equipo'}
          confirmIcon={isEdit ? <Save size={14} /> : <Plus size={14} />}
          pending={isPending}
        />
      }
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 flex flex-col gap-4">
        {/* Nombre */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls} htmlFor="asset-name">Nombre <span className="text-red-400">*</span></label>
          <input
            id="asset-name"
            className={inputCls} style={inputStyle} maxLength={150}
            placeholder="Ej: Silla de barbería Takara" value={name} autoFocus={!isEdit}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Categoría */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls} htmlFor="asset-category">Categoría</label>
          <select
            id="asset-category"
            className={inputCls} style={inputStyle}
            value={category} onChange={(e) => handleCategory(e.target.value as FixedAssetCategory)}
          >
            {/* Un equipo antiguo de categoría "Vehículo" la conserva, pero no se ofrece en equipos nuevos */}
            {editAsset?.category === 'vehicle' && <option value="vehicle">{categoryLabel('vehicle')}</option>}
            {SELECTABLE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{ASSET_CATEGORIES[c].label}</option>
            ))}
          </select>
          <p className={FIELD_HINT}>{ASSET_CATEGORIES[category].hint}</p>
        </div>

        {/* Fecha y precio */}
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5 min-w-0">
            <label className={labelCls} htmlFor="asset-date">Fecha de compra</label>
            <input
              id="asset-date"
              type="date" min={MIN_ASSET_DATE} max={today}
              className={`${inputCls} min-w-0`} style={inputStyle}
              value={date} onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5 min-w-0">
            <label className={labelCls}>Precio <span className="text-red-400">*</span></label>
            <MoneyInput value={price} onChange={setPrice} placeholder="1200000" ariaLabel="Precio del equipo" />
          </div>
        </div>

        {/* ¿Cómo se pagó? */}
        <div className="flex flex-col gap-2">
          <span className={labelCls}>¿Cómo se pagó?</span>
          {isEdit ? (
            <p className="text-sm text-zinc-300">
              {editAsset?.payment_method ? PURCHASE_PAYMENT_LABELS[editAsset.payment_method] : 'Sin dato'}
              <span className="block text-[11px] text-zinc-500 mt-0.5">
                Esto no se puede cambiar después de registrar el equipo.
              </span>
            </p>
          ) : (
            <>
              <ChoiceButtons<AssetPaymentMethod>
                ariaLabel="¿Cómo se pagó?"
                columns={3}
                value={payment}
                onChange={setPayment}
                options={PAYMENT_ORDER.map((p) => ({ value: p, label: PURCHASE_PAYMENT_LABELS[p] }))}
                disabled={(p) => p === 'cash_register' && !hasOpenShift}
              />
              {!hasOpenShift && (
                <p className={FIELD_HINT}>Abre la caja para poder pagar con su efectivo.</p>
              )}
              <p className={FIELD_HINT}>
                Si sale de la caja, se descuenta del cuadre del turno. No se registra en Gastos.
              </p>
            </>
          )}
        </div>

        {/* Vida útil */}
        <div className="flex flex-col gap-1.5">
          <span className={labelCls}>Vida útil</span>
          <div className="grid grid-cols-2 gap-3">
            <select
              aria-label="Años de vida útil"
              className={inputCls} style={inputStyle}
              value={years}
              onChange={(e) => { setYears(e.target.value); setLifeTouched(true) }}
            >
              {Array.from({ length: 51 }, (_, i) => i).map((y) => (
                <option key={y} value={y}>{y} {y === 1 ? 'año' : 'años'}</option>
              ))}
            </select>
            <select
              aria-label="Meses de vida útil"
              className={inputCls} style={inputStyle}
              value={extraMonths}
              onChange={(e) => { setExtraMonths(e.target.value); setLifeTouched(true) }}
            >
              {Array.from({ length: 12 }, (_, i) => i).map((m) => (
                <option key={m} value={m}>{m} {m === 1 ? 'mes' : 'meses'}</option>
              ))}
            </select>
          </div>
          <p className={FIELD_HINT}>
            {lifeOk ? <>Se desgasta durante {lifeLabel(lifeN)}. </> : null}
            Sugerido para esta categoría: {lifeLabel(suggested)}. Para impuestos, confírmalo con tu contador.
          </p>
        </div>

        {/* Vista previa */}
        <div
          className="rounded-xl border px-4 py-3 text-sm flex flex-col gap-1"
          style={{ borderColor: 'var(--border-color)' }}
          aria-live="polite"
        >
          {preview ? (
            <>
              <p className="text-zinc-200">
                {method === 'straight_line' ? 'Se desgastará ' : 'El primer mes se desgastará cerca de '}
                <span className="font-bold tabular-nums" style={{ color: 'var(--primary-color)' }}>
                  {formatCOP(preview.perMonth)}
                </span>
                {method === 'straight_line' ? ' por mes' : ''}
              </p>
              <p className="text-[11px] text-zinc-500">
                Termina de desgastarse en {monthYearES(preview.endsOn)} ({formatDateES(preview.endsOn)}).
              </p>
            </>
          ) : (
            <p className="text-zinc-500 text-xs">Completa el precio y la vida útil para ver cuánto se desgasta por mes.</p>
          )}
        </div>

        {/* Opciones avanzadas */}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="flex items-center gap-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-colors self-start"
          >
            <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            Opciones avanzadas
          </button>

          {showAdvanced && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Valor residual</label>
                <MoneyInput value={salvage} onChange={setSalvage} placeholder="0" ariaLabel="Valor residual" />
                <p className={FIELD_HINT}>Lo que crees que valdrá al final.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className={labelCls}>Método de desgaste</span>
                <ChoiceButtons<DepreciationMethod>
                  ariaLabel="Método de desgaste"
                  columns={2}
                  value={method}
                  onChange={setMethod}
                  options={(['straight_line', 'declining_balance'] as DepreciationMethod[]).map((m) => ({
                    value: m, label: METHOD_LABELS[m],
                  }))}
                />
                <p className={FIELD_HINT}>{METHOD_HINTS[method]}</p>
              </div>

              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5 min-w-0">
                  <label className={labelCls} htmlFor="asset-serial">Serial</label>
                  <input
                    id="asset-serial"
                    className={inputCls} style={inputStyle} maxLength={100}
                    placeholder="Opcional" value={serial} onChange={(e) => setSerial(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5 min-w-0">
                  <label className={labelCls} htmlFor="asset-location">Ubicación</label>
                  <input
                    id="asset-location"
                    className={inputCls} style={inputStyle} maxLength={100}
                    placeholder="Ej: Estación 2" value={location} onChange={(e) => setLocation(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className={labelCls} htmlFor="asset-description">Descripción</label>
                <textarea
                  id="asset-description"
                  rows={2} maxLength={500}
                  className={`${inputCls} resize-none`} style={inputStyle}
                  placeholder="Opcional" value={description} onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {!isEdit && (
          <p className="flex items-start gap-2 text-[11px] text-zinc-500 rounded-lg bg-white/[0.03] px-3 py-2">
            <Info size={12} className="mt-0.5 flex-shrink-0" />
            La compra no es un gasto del mes: el equipo se va desgastando poco a poco y ese desgaste se resta en Contabilidad.
          </p>
        )}

        <ErrorBox message={error} />
      </div>
    </SidePanel>
  )
}
