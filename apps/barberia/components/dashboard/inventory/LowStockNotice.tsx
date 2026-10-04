'use client'

import { Package } from 'lucide-react'
import { useFeature } from '@/lib/features/context'

const MAX_SHOWN = 3

interface LowStockNoticeProps {
  items: { id: string; name: string; current_stock: number }[]
  slug:  string
}

/**
 * Aviso compacto del dashboard del administrador: productos con stock igual o por debajo del
 * mínimo. Solo aparece si el módulo Inventario está activo en el plan (o en prueba).
 * Es cliente únicamente para leer los feature flags; enlaza a la página de Inventario.
 */
export function LowStockNotice({ items, slug }: LowStockNoticeProps) {
  const inventoryOn = useFeature('inventory')
  if (!inventoryOn || items.length === 0) return null

  const shown = items.slice(0, MAX_SHOWN)
  const extra = items.length - shown.length

  return (
    <a
      href={`/${slug}/dashboard/inventory`}
      className="flex items-start gap-3 rounded-2xl p-4 transition-colors hover:bg-fg/[0.03]"
      style={{
        background: 'color-mix(in srgb, var(--primary-color) 7%, transparent)',
        border: '1px solid color-mix(in srgb, var(--primary-color) 30%, transparent)',
      }}
    >
      <Package size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--primary-color)' }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-xinuco-text">
          Inventario: {items.length} {items.length === 1 ? 'producto' : 'productos'} por agotarse
        </p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {shown.map(item => (
            <li key={item.id} className="text-xs text-xinuco-muted truncate">
              <span className="text-xinuco-text font-medium">{item.name}</span>
              {' · '}
              <span className="tabular-nums">{item.current_stock}</span>
            </li>
          ))}
          {extra > 0 && <li className="text-xs text-xinuco-muted">y {extra} más</li>}
        </ul>
      </div>
      <span className="text-xs shrink-0 self-center" style={{ color: 'var(--primary-color)' }}>Ver →</span>
    </a>
  )
}
