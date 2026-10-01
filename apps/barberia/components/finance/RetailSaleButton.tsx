'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, ShoppingBag, X } from 'lucide-react'
import { getPosCatalog } from '@/actions/retail'
import { PointOfSale } from '@/components/pos/PointOfSale'
import type { PosCatalog } from '@/lib/pos-utils'

interface RetailSaleButtonProps {
  slug:          string
  activeShiftId: string | null
}

/**
 * RetailSaleButton — Acceso rápido "Venta Rápida" del Dashboard.
 *
 * Abre la misma Venta de productos de /retail dentro de un modal (disposición compacta).
 * - Con caja abierta: botón habilitado.
 * - Sin caja: botón deshabilitado con tooltip explicativo.
 */
export function RetailSaleButton({ slug, activeShiftId }: RetailSaleButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [catalog, setCatalog] = useState<PosCatalog | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const hasActiveShift = !!activeShiftId

  const loadCatalog = useCallback(async () => {
    const res = await getPosCatalog()
    if ('error' in res) {
      setLoadError(res.error)
      return
    }
    setLoadError(null)
    setCatalog(res)
  }, [])

  // Se carga el catálogo al abrir y se limpia al cerrar (siempre datos frescos)
  useEffect(() => {
    if (!isOpen) {
      setCatalog(null)
      setLoadError(null)
      return
    }
    void loadCatalog()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false) }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen, loadCatalog])

  return (
    <>
      {/* Botón de acceso rápido */}
      <div className="relative group">
        <button
          onClick={() => hasActiveShift && setIsOpen(true)}
          disabled={!hasActiveShift}
          aria-label={
            hasActiveShift
              ? 'Abrir venta rápida de productos'
              : 'Debes abrir un turno de caja primero'
          }
          className={`
            w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border
            font-semibold text-sm transition-all duration-200
            ${hasActiveShift
              ? 'border-[var(--primary-color)]/30 bg-[var(--primary-color)]/[0.06] text-[var(--primary-color)] hover:bg-[var(--primary-color)]/[0.12] hover:border-[var(--primary-color)]/50 cursor-pointer active:scale-[0.98]'
              : 'border-zinc-800 bg-zinc-900/20 text-zinc-600 cursor-not-allowed opacity-60'
            }
          `}
        >
          <div
            className={`p-2 rounded-xl shrink-0 ${
              hasActiveShift
                ? 'bg-[var(--primary-color)]/[0.12]'
                : 'bg-zinc-800/50'
            }`}
          >
            <ShoppingBag size={16} className={hasActiveShift ? 'text-[var(--primary-color)]' : 'text-zinc-600'} />
          </div>
          <div className="text-left min-w-0">
            <p className={`font-bold leading-none ${hasActiveShift ? 'text-[var(--primary-color)]' : 'text-zinc-600'}`}>
              Venta Rápida
            </p>
            <p className={`text-xs mt-0.5 ${hasActiveShift ? 'text-[var(--primary-color)]/60' : 'text-zinc-700'}`}>
              {hasActiveShift ? 'Vender productos sin cita' : 'Abre la caja para vender'}
            </p>
          </div>

          {/* Indicador visual de turno activo */}
          {hasActiveShift && (
            <div className="ml-auto shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
            </div>
          )}
        </button>

        {/* Tooltip para estado deshabilitado */}
        {!hasActiveShift && (
          <div
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-zinc-800 border border-zinc-700 whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-10"
          >
            Debes abrir un turno de caja primero
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-zinc-800" />
          </div>
        )}
      </div>

      {/* Venta de productos en modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
          onClick={() => setIsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-sale-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl max-h-[92dvh] flex flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border bg-zinc-950 shadow-2xl text-zinc-100"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 p-4 shrink-0">
              <div>
                <h2 id="quick-sale-title" className="text-lg font-bold text-xinuco-text">Venta Rápida</h2>
                <p className="text-xs text-xinuco-muted">Vende productos sin cita: se descuentan del inventario.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Cerrar"
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {loadError ? (
                <div role="alert" className="p-3 bg-red-950/40 border border-red-900/30 rounded-xl text-red-400 text-sm">
                  {loadError}
                </div>
              ) : !catalog ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-xinuco-muted">
                  <Loader2 size={16} className="animate-spin" /> Cargando productos…
                </div>
              ) : (
                <PointOfSale slug={slug} catalog={catalog} compact onSold={() => void loadCatalog()} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
