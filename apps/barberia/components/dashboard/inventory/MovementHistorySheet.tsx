'use client'
// components/dashboard/inventory/MovementHistorySheet.tsx — historial de movimientos de un producto

import React, { useCallback, useEffect, useState } from 'react'
import { History, Loader2 } from 'lucide-react'
import { getMovementHistory, type MovementHistoryRow } from '@/actions/inventory'
import {
  MOVEMENT_LABELS,
  PAYMENT_LABELS,
  formatMovementDate,
  movementKind,
  signedQty,
  type MovementKind,
} from '@/lib/inventory-utils'
import type { InventoryItem } from '@xinuco/types'
import { SidePanel, formatCOP } from './SidePanel'

const BADGE_STYLES: Record<MovementKind, string> = {
  purchase:    'text-emerald-400 border-emerald-500/25 bg-emerald-500/10',
  sale:        'text-sky-400 border-sky-500/25 bg-sky-500/10',
  void_return: 'text-violet-400 border-violet-500/25 bg-violet-500/10',
  count:       'text-amber-400 border-amber-500/25 bg-amber-500/10',
  waste:       'text-red-400 border-red-500/25 bg-red-500/10',
}

function MovementRow({ m }: { m: MovementHistoryRow }) {
  const kind = movementKind(m)
  const label = MOVEMENT_LABELS[kind]
  const positive = m.quantity > 0

  // Notas automáticas que solo repiten el tipo no aportan nada
  const note = m.notes && m.notes !== label && m.notes !== 'Compra' ? m.notes : null

  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${BADGE_STYLES[kind]}`}>
          {label}
        </span>
        <span className={`text-base font-bold tabular-nums ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
          {signedQty(m.quantity)}
        </span>
      </div>

      {kind === 'purchase' && m.unit_cost != null && (
        <p className="text-xs text-zinc-300">
          {Math.abs(m.quantity)} × {formatCOP(m.unit_cost)}
          {m.total_cost != null && <> = <span className="font-semibold">{formatCOP(m.total_cost)}</span></>}
        </p>
      )}
      {kind === 'purchase' && (m.supplier || m.payment_method) && (
        <p className="text-[11px] text-zinc-500">
          {[m.supplier, m.payment_method ? PAYMENT_LABELS[m.payment_method] : null].filter(Boolean).join(' · ')}
        </p>
      )}

      {(kind === 'sale' || kind === 'void_return') && m.sale && (
        <p className="text-[11px] text-zinc-500">
          Venta de <span className="tabular-nums">{formatCOP(m.sale.total_amount)}</span>
          {m.sale.customer_name && <> · {m.sale.customer_name}</>}
        </p>
      )}

      {note && <p className="text-xs text-zinc-400">{note}</p>}

      <p className="text-[11px] text-zinc-600">
        {formatMovementDate(m.created_at)}
        {m.created_by_name && <> · {m.created_by_name}</>}
      </p>
    </li>
  )
}

export function MovementHistorySheet({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const [rows, setRows]       = useState<MovementHistoryRow[]>([])
  const [page, setPage]       = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async (pageToLoad: number, isCancelled: () => boolean) => {
    setLoading(true)
    setError(null)
    const res = await getMovementHistory(item.id, pageToLoad)
    if (isCancelled()) return
    if (res.error || !res.data) {
      setError(res.error ?? 'No se pudo cargar el historial.')
    } else {
      const incoming = res.data.rows
      setRows((prev) => (pageToLoad === 0 ? incoming : [...prev, ...incoming]))
      setHasMore(res.data.hasMore)
      setPage(pageToLoad)
    }
    setLoading(false)
  }, [item.id])

  useEffect(() => {
    let cancelled = false
    load(0, () => cancelled)
    return () => { cancelled = true }
  }, [load])

  return (
    <SidePanel
      title="Historial de movimientos"
      subtitle={`${item.name} · Stock actual ${item.current_stock}`}
      icon={<History size={16} style={{ color: 'var(--primary-color)' }} />}
      onClose={onClose}
      wide
    >
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3">
        {error && (
          <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
        )}

        {!error && !loading && rows.length === 0 && (
          <p className="text-sm text-zinc-500 text-center py-10">Este producto aún no tiene movimientos.</p>
        )}

        {rows.length > 0 && (
          <ul
            className="flex flex-col divide-y rounded-xl border"
            style={{ borderColor: 'var(--border-color)', backgroundColor: '#111111' }}
          >
            {rows.map((m) => <MovementRow key={m.id} m={m} />)}
          </ul>
        )}

        {loading && (
          <div className="flex justify-center py-6 text-zinc-500">
            <Loader2 size={18} className="animate-spin" />
          </div>
        )}

        {!loading && hasMore && (
          <button
            type="button"
            onClick={() => load(page + 1, () => false)}
            className="self-center text-sm font-semibold px-4 py-2 rounded-xl border transition-colors hover:bg-white/[0.04]"
            style={{ borderColor: 'var(--border-color)', color: 'var(--primary-color)' }}
          >
            Ver más
          </button>
        )}
      </div>
    </SidePanel>
  )
}
