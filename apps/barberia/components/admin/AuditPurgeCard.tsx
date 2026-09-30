'use client'

import { useEffect, useState, useTransition } from 'react'
import { Trash2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { countAuditLogsBefore, purgeAuditLogsBeforeToday } from '@/actions/platform-settings'

interface AuditPurgeCardProps {
  businesses: { id: string; name: string }[]
  /** Hoy en Colombia, 'YYYY-MM-DD' */
  todayISO:   string
}

/** '2026-09-30' → '30/09/2026' */
function formatDMY(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function formatCount(n: number): string {
  return n.toLocaleString('es-CO')
}

export function AuditPurgeCard({ businesses, todayISO }: AuditPurgeCardProps) {
  const [businessId, setBusinessId] = useState('')
  const [count, setCount]           = useState<number | null>(null)
  const [scopeName, setScopeName]   = useState('')
  const [open, setOpen]             = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [message, setMessage]       = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition]  = useTransition()

  const dateLabel = formatDMY(todayISO)

  function closeDialog() {
    if (pending) return
    setOpen(false)
    setConfirmText('')
    setDialogError(null)
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) {
        setOpen(false)
        setConfirmText('')
        setDialogError(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pending])

  function handleStart() {
    setMessage(null)
    setDialogError(null)
    setConfirmText('')
    startTransition(async () => {
      const res = await countAuditLogsBefore(businessId || null)
      if ('error' in res) {
        setMessage({ ok: false, text: res.error })
        return
      }
      setCount(res.count)
      setScopeName(
        businessId
          ? (businesses.find(b => b.id === businessId)?.name ?? 'la barbería seleccionada')
          : 'todas las barberías',
      )
      setOpen(true)
    })
  }

  function handlePurge() {
    setDialogError(null)
    startTransition(async () => {
      const res = await purgeAuditLogsBeforeToday(businessId || null, confirmText)
      if (res.success) {
        setOpen(false)
        setConfirmText('')
        setCount(null)
        setMessage({ ok: true, text: `Se borraron ${formatCount(res.deleted)} registros.` })
      } else {
        setDialogError(res.error)
      }
    })
  }

  const canConfirm = confirmText.trim().toUpperCase() === 'BORRAR' && (count ?? 0) > 0 && !pending

  return (
    <div className="rounded-xl border border-red-500/30 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-red-500/30 bg-red-500/5">
        <Trash2 size={15} className="text-red-400" />
        <div>
          <p className="text-[10px] uppercase tracking-wider text-red-400">Zona de peligro</p>
          <h2 className="text-sm font-semibold text-xinuco-text">Borrar registros de auditoría</h2>
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        <p className="text-xs text-xinuco-muted leading-relaxed">
          Borra de forma permanente los registros anteriores a hoy ({dateLabel}). Los de hoy se
          conservan. Úsalo solo para limpiar datos de prueba.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="audit-purge-business" className="text-xs text-xinuco-muted">
            Barbería
          </label>
          <select
            id="audit-purge-business"
            value={businessId}
            onChange={e => { setBusinessId(e.target.value); setMessage(null) }}
            disabled={pending}
            className="text-xs bg-xinuco-surface border border-xinuco-border rounded-lg px-3 py-2 text-xinuco-text focus:outline-none focus:border-xinuco-primary disabled:opacity-50 max-w-full"
          >
            <option value="">Todas las barberías</option>
            {businesses.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleStart}
            disabled={pending}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-red-500/60 text-red-400 hover:bg-red-500/10 hover:border-red-500 transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending && !open && <Loader2 size={12} className="animate-spin" />}
            Borrar registros anteriores a hoy
          </button>
        </div>

        {message && (
          <p
            role="status"
            className={`flex items-center gap-1.5 text-xs ${message.ok ? 'text-green-400' : 'text-red-400'}`}
          >
            {message.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            {message.text}
          </p>
        )}
      </div>

      {open && count !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeDialog}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-purge-title"
            className="w-full max-w-md rounded-xl border border-xinuco-border bg-xinuco-surface p-5 space-y-4 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="audit-purge-title" className="text-sm font-semibold text-xinuco-text">
              Borrar registros de auditoría
            </h3>

            {count === 0 ? (
              <>
                <p className="text-xs text-xinuco-muted leading-relaxed">
                  No hay registros anteriores a hoy para borrar.
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="text-xs font-medium px-3 py-2 rounded-lg border border-xinuco-border text-xinuco-text hover:border-xinuco-primary hover:text-xinuco-primary transition-all duration-200 cursor-pointer"
                  >
                    Cerrar
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-3 space-y-2">
                  <p className="text-xs font-semibold text-red-400">
                    ⚠ Esta acción no se puede deshacer.
                  </p>
                  <p className="text-xs text-red-300 leading-relaxed">
                    Se borrarán {formatCount(count)} registros de auditoría de {scopeName} anteriores
                    al {dateLabel}. Los administradores ya no podrán ver quién hizo esas acciones
                    (anulaciones, descuentos, cierres de caja, pagos…). En cada barbería quedará una
                    nota de que Soporte Xinuco hizo este borrado.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="audit-purge-confirm" className="text-xs text-xinuco-muted">
                    Escribe BORRAR para confirmar
                  </label>
                  <input
                    id="audit-purge-confirm"
                    type="text"
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    disabled={pending}
                    autoComplete="off"
                    autoFocus
                    className="w-full text-xs bg-xinuco-bg border border-xinuco-border rounded-lg px-3 py-2 text-xinuco-text focus:outline-none focus:border-red-500 disabled:opacity-50"
                  />
                </div>

                {dialogError && (
                  <p role="alert" className="flex items-center gap-1.5 text-xs text-red-400">
                    <AlertCircle size={12} />
                    {dialogError}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeDialog}
                    disabled={pending}
                    className="text-xs font-medium px-3 py-2 rounded-lg border border-xinuco-border text-xinuco-text hover:border-xinuco-primary hover:text-xinuco-primary transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handlePurge}
                    disabled={!canConfirm}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-500 transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {pending && <Loader2 size={12} className="animate-spin" />}
                    Borrar {formatCount(count)} registros
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
