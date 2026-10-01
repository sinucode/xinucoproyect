'use client'
// components/dashboard/inventory/StockSheets.tsx — compra, conteo físico y merma

import React, { useEffect, useState, useTransition } from 'react'
import { ArrowDownToLine, ClipboardCheck, Trash2, Info } from 'lucide-react'
import { recordPurchase, recordCount, recordWaste } from '@/actions/inventory'
import {
  MAX_STOCK_QTY,
  WASTE_REASONS,
  signedQty,
  wasteNote,
  weightedAverageCost,
} from '@/lib/inventory-utils'
import type { InventoryItem } from '@xinuco/types'
import { FundsWarning, useFundsCheck } from '@/components/finance/FundsWarning'
import { AccountPicker } from '@/components/finance/AccountPicker'
import { accountIdOrNull, paymentMethodForAccount, pickedAccount } from '@/lib/money-accounts'
import {
  SidePanel,
  PanelFooter,
  formatCOP,
  panelInputCls as inputCls,
  panelInputStyle as inputStyle,
  panelLabelCls as labelCls,
} from './SidePanel'

interface SheetProps {
  item:    InventoryItem
  onClose: () => void
  onDone:  () => void
}

/** Convierte el texto de un input numérico en entero; NaN si no es un entero válido. */
function toInt(v: string): number {
  if (v.trim() === '') return NaN
  const n = Number(v)
  return Number.isInteger(n) ? n : NaN
}

function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{message}</p>
}

// ── Registrar compra ──────────────────────────────────────────────────────────

export function PurchaseSheet({
  item,
  hasOpenShift,
  onClose,
  onDone,
}: SheetProps & { hasOpenShift: boolean }) {
  const [qty, setQty]           = useState('')
  const [cost, setCost]         = useState(item.unit_cost !== null ? String(item.unit_cost) : '')
  const [supplier, setSupplier] = useState('')
  // Medio de pago: arranca en el primer medio que no sea la caja (como antes arrancaba en "Transferencia")
  const [accountChoice, setAccountChoice] = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const quantity = toInt(qty)
  const unitCost = toInt(cost)
  const qtyOk    = Number.isFinite(quantity) && quantity >= 1 && quantity <= MAX_STOCK_QTY
  const costOk   = Number.isFinite(unitCost) && unitCost >= 0

  const total = qtyOk && costOk ? quantity * unitCost : null
  // Aviso de saldo del medio con el que se paga la compra
  const funds = useFundsCheck({ accountId: accountChoice, amount: total ?? 0 })
  const account = pickedAccount(funds.accounts, accountChoice)
  const payment = account ? (paymentMethodForAccount(account, 'outflow') as 'cash_register' | 'transfer') : 'other'
  useEffect(() => {
    if (accountChoice !== null || !funds.loaded) return
    const first = funds.accounts.find(a => !a.is_cash_drawer)
    if (first) setAccountChoice(first.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funds.loaded])
  const newAvg = qtyOk && costOk
    ? weightedAverageCost(item.current_stock, item.unit_cost, quantity, unitCost)
    : null

  const handleSubmit = () => {
    setError(null)
    if (!qtyOk) { setError('La cantidad debe ser un entero mayor a 0.'); return }
    if (!costOk) { setError('Indica el costo unitario (COP).'); return }
    if (accountChoice === null) { setError('Elige cómo se pagó la compra.'); return }
    if (payment === 'cash_register' && !hasOpenShift) {
      setError('No hay caja abierta. Abre la caja o elige otro medio de pago.')
      return
    }

    startTransition(async () => {
      const result = await recordPurchase({
        itemId:        item.id,
        quantity,
        unitCost,
        supplier:      supplier.trim() || null,
        paymentMethod: payment,
        accountId:     accountIdOrNull(accountChoice),
      })
      if (result.error) {
        setError(result.error)
      } else {
        onDone()
        onClose()
      }
    })
  }

  return (
    <SidePanel
      title="Registrar compra"
      subtitle={item.name}
      icon={<ArrowDownToLine size={16} style={{ color: 'var(--primary-color)' }} />}
      onClose={onClose}
      footer={
        <PanelFooter
          onCancel={onClose}
          onConfirm={handleSubmit}
          confirmLabel="Registrar compra"
          pending={isPending}
          disabled={funds.blocked}
        />
      }
    >
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
        <p className="text-xs text-zinc-500">
          Stock actual: <span className="font-bold text-zinc-200 tabular-nums">{item.current_stock}</span>
          {item.unit_cost !== null && (
            <> · Costo promedio: <span className="font-bold text-zinc-200 tabular-nums">{formatCOP(item.unit_cost)}</span></>
          )}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>Cantidad <span className="text-red-400">*</span></label>
            <input
              type="number" min={1} step={1} inputMode="numeric"
              className={inputCls} style={inputStyle}
              placeholder="0" value={qty} autoFocus
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>Costo unitario COP <span className="text-red-400">*</span></label>
            <input
              type="number" min={0} step={1} inputMode="numeric"
              className={inputCls} style={inputStyle}
              placeholder="12000" value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>
        </div>

        <div
          className="rounded-xl border px-4 py-3 flex flex-col gap-1.5 text-sm"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Total de la compra</span>
            <span className="font-bold text-zinc-100 tabular-nums">{total !== null ? formatCOP(total) : '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Nuevo costo promedio</span>
            <span className="font-bold tabular-nums" style={{ color: 'var(--primary-color)' }}>
              {newAvg !== null ? formatCOP(newAvg) : '—'}
            </span>
          </div>
          {qtyOk && (
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Stock después</span>
              <span className="font-bold text-zinc-100 tabular-nums">{item.current_stock + quantity}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>
            Proveedor <span className="text-zinc-600 font-normal normal-case">(opcional)</span>
          </label>
          <input
            className={inputCls} style={inputStyle} maxLength={80}
            placeholder="Ej: Distribuidora Andina"
            value={supplier} onChange={(e) => setSupplier(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className={labelCls}>¿Cómo se pagó?</span>
          {!funds.loaded ? (
            <p className="text-xs text-zinc-500">Cargando medios de pago…</p>
          ) : (
            <AccountPicker
              accounts={funds.accounts}
              balances={funds.balances}
              value={accountChoice}
              onChange={setAccountChoice}
              allowOther
              disabledIds={hasOpenShift ? [] : funds.accounts.filter(a => a.is_cash_drawer).map(a => a.id)}
              ariaLabel="¿Cómo se pagó?"
            />
          )}
          {!hasOpenShift && (
            <p className="text-[11px] text-zinc-500">Abre la caja para pagar con Efectivo.</p>
          )}
          {payment === 'cash_register' && (
            <p className="text-[11px] text-zinc-500">
              Se resta del efectivo esperado del turno abierto.
            </p>
          )}
          <FundsWarning check={funds} />
        </div>

        <p className="flex items-start gap-2 text-[11px] text-zinc-500 rounded-lg bg-white/[0.03] px-3 py-2">
          <Info size={12} className="mt-0.5 flex-shrink-0" />
          La compra no es un gasto: su costo se cuenta cuando vendes el producto.
        </p>

        <ErrorBox message={error} />
      </div>
    </SidePanel>
  )
}

// ── Conteo físico ─────────────────────────────────────────────────────────────

export function CountSheet({ item, onClose, onDone }: SheetProps) {
  const [counted, setCounted] = useState('')
  const [reason, setReason]   = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const value   = toInt(counted)
  const valueOk = Number.isFinite(value) && value >= 0 && value <= MAX_STOCK_QTY
  const diff    = valueOk ? value - item.current_stock : null

  const handleSubmit = () => {
    setError(null)
    if (!valueOk) { setError('Indica cuántas contaste (entero mayor o igual a 0).'); return }
    if (diff === 0) { setError('El conteo es igual al stock actual; no hay nada que ajustar.'); return }
    if (!reason.trim()) { setError('Indica el motivo del conteo.'); return }

    startTransition(async () => {
      const result = await recordCount({ itemId: item.id, counted: value, reason: reason.trim() })
      if (result.error) {
        setError(result.error)
      } else {
        onDone()
        onClose()
      }
    })
  }

  return (
    <SidePanel
      title="Conteo físico"
      subtitle={item.name}
      icon={<ClipboardCheck size={16} style={{ color: 'var(--primary-color)' }} />}
      onClose={onClose}
      footer={
        <PanelFooter
          onCancel={onClose}
          onConfirm={handleSubmit}
          confirmLabel="Ajustar stock"
          pending={isPending}
        />
      }
    >
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
        <div
          className="rounded-xl border px-4 py-3 flex items-center justify-between text-sm"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <span className="text-zinc-400">Stock en el sistema</span>
          <span className="font-bold text-zinc-100 tabular-nums text-lg">{item.current_stock}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>¿Cuántas contaste? <span className="text-red-400">*</span></label>
          <input
            type="number" min={0} step={1} inputMode="numeric"
            className={inputCls} style={inputStyle}
            placeholder="0" value={counted} autoFocus
            onChange={(e) => setCounted(e.target.value)}
          />
        </div>

        {diff !== null && (
          <p
            className={`text-sm font-semibold rounded-lg px-3 py-2 ${
              diff === 0
                ? 'text-zinc-400 bg-white/[0.04]'
                : diff > 0
                  ? 'text-emerald-400 bg-emerald-400/10'
                  : 'text-red-400 bg-red-400/10'
            }`}
          >
            {diff === 0
              ? 'Coincide con el sistema: no hay diferencia.'
              : `Diferencia: ${signedQty(diff)} ${Math.abs(diff) === 1 ? 'unidad' : 'unidades'}`}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Motivo <span className="text-red-400">*</span></label>
          <input
            className={inputCls} style={inputStyle} maxLength={200}
            placeholder="Ej: conteo mensual"
            value={reason} onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <p className="flex items-start gap-2 text-[11px] text-zinc-500 rounded-lg bg-white/[0.03] px-3 py-2">
          <Info size={12} className="mt-0.5 flex-shrink-0" />
          El stock quedará en lo que contaste y la diferencia se guarda en el historial.
        </p>

        <ErrorBox message={error} />
      </div>
    </SidePanel>
  )
}

// ── Merma ─────────────────────────────────────────────────────────────────────

export function WasteSheet({ item, onClose, onDone }: SheetProps) {
  const [qty, setQty]       = useState('')
  const [reason, setReason] = useState<string>(WASTE_REASONS[0])
  const [detail, setDetail] = useState('')
  const [error, setError]   = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const quantity = toInt(qty)
  const qtyOk    = Number.isFinite(quantity) && quantity >= 1 && quantity <= item.current_stock
  const noStock  = item.current_stock <= 0

  const handleSubmit = () => {
    setError(null)
    if (noStock) { setError('Este producto no tiene stock para dar de baja.'); return }
    if (!Number.isFinite(quantity) || quantity < 1) { setError('La cantidad debe ser un entero mayor a 0.'); return }
    if (quantity > item.current_stock) {
      setError(`No puedes dar de baja más de lo que hay (${item.current_stock}).`)
      return
    }

    startTransition(async () => {
      const result = await recordWaste({
        itemId:   item.id,
        quantity,
        reason:   wasteNote(reason, detail),
      })
      if (result.error) {
        setError(result.error)
      } else {
        onDone()
        onClose()
      }
    })
  }

  return (
    <SidePanel
      title="Merma"
      subtitle={item.name}
      icon={<Trash2 size={16} style={{ color: 'var(--primary-color)' }} />}
      onClose={onClose}
      footer={
        <PanelFooter
          onCancel={onClose}
          onConfirm={handleSubmit}
          confirmLabel="Registrar merma"
          pending={isPending}
          disabled={noStock}
        />
      }
    >
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
        <p className="text-xs text-zinc-500">
          Stock actual: <span className="font-bold text-zinc-200 tabular-nums">{item.current_stock}</span>
        </p>

        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Cantidad <span className="text-red-400">*</span></label>
          <input
            type="number" min={1} max={item.current_stock} step={1} inputMode="numeric"
            className={inputCls} style={inputStyle}
            placeholder="0" value={qty} autoFocus disabled={noStock}
            onChange={(e) => setQty(e.target.value)}
          />
          {qtyOk && (
            <p className="text-[11px] text-zinc-500">
              Quedarán <span className="font-semibold text-zinc-300 tabular-nums">{item.current_stock - quantity}</span> en stock.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Motivo <span className="text-red-400">*</span></label>
          <select
            className={inputCls} style={inputStyle}
            value={reason} onChange={(e) => setReason(e.target.value)}
          >
            {WASTE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>
            Detalle <span className="text-zinc-600 font-normal normal-case">(opcional)</span>
          </label>
          <input
            className={inputCls} style={inputStyle} maxLength={150}
            placeholder="Ej: se cayó el frasco"
            value={detail} onChange={(e) => setDetail(e.target.value)}
          />
        </div>

        {noStock && (
          <p className="text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2">
            Este producto no tiene stock. Si el sistema está desactualizado, haz un conteo físico.
          </p>
        )}

        <ErrorBox message={error} />
      </div>
    </SidePanel>
  )
}
