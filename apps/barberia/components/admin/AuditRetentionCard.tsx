'use client'

import { useState, useTransition } from 'react'
import { ScrollText, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { updateAuditRetention } from '@/actions/platform-settings'
import {
  AUDIT_RETENTION_OPTIONS,
  DEFAULT_AUDIT_RETENTION_MONTHS,
  retentionLabel,
} from '@/lib/audit-retention'

interface AuditRetentionCardProps {
  initialMonths:        number
  initialUpdatedAt:     string | null
  initialUpdatedByName: string | null
}

function optionLabel(months: number): string {
  return months === DEFAULT_AUDIT_RETENTION_MONTHS
    ? `${retentionLabel(months)} (recomendado)`
    : retentionLabel(months)
}

function formatBogota(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function AuditRetentionCard({
  initialMonths, initialUpdatedAt, initialUpdatedByName,
}: AuditRetentionCardProps) {
  const [saved, setSaved]         = useState(initialMonths)
  const [selected, setSelected]   = useState(initialMonths)
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt)
  const [updatedBy, setUpdatedBy] = useState(initialUpdatedByName)
  const [message, setMessage]     = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const unchanged = selected === saved

  function handleSave() {
    setMessage(null)
    startTransition(async () => {
      const res = await updateAuditRetention(selected)
      if (res.success) {
        setSaved(res.months)
        setUpdatedAt(res.updatedAt)
        setUpdatedBy(res.updatedByName)
        setMessage({ ok: true, text: 'Plazo guardado.' })
      } else {
        setMessage({ ok: false, text: res.error })
      }
    })
  }

  return (
    <div className="rounded-xl border border-xinuco-border overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-xinuco-border bg-xinuco-surface/50">
        <ScrollText size={15} className="text-xinuco-muted" />
        <h2 className="text-sm font-semibold text-xinuco-text">Auditoría de las barberías</h2>
      </div>

      <div className="px-5 py-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="audit-retention" className="text-xs text-xinuco-muted">
            Conservar el registro durante
          </label>
          <select
            id="audit-retention"
            value={selected}
            onChange={e => { setSelected(Number(e.target.value)); setMessage(null) }}
            disabled={pending}
            className="text-xs bg-xinuco-surface border border-xinuco-border rounded-lg px-3 py-2 text-xinuco-text focus:outline-none focus:border-xinuco-primary disabled:opacity-50"
          >
            {AUDIT_RETENTION_OPTIONS.map(m => (
              <option key={m} value={m}>{optionLabel(m)}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleSave}
            disabled={unchanged || pending}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-xinuco-border text-xinuco-text hover:border-xinuco-primary hover:text-xinuco-primary transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending && <Loader2 size={12} className="animate-spin" />}
            Guardar
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

        <p className="text-xs text-xinuco-muted leading-relaxed">
          Cuánto tiempo se guarda el registro de quién hizo qué en cada barbería. Lo más viejo se
          borra solo cada día. Recomendado: 3 años (plazo general en que la DIAN puede revisar una
          declaración). Mínimo 1 año.
        </p>

        {updatedBy && updatedAt && (
          <p className="text-[11px] text-xinuco-muted">
            Último cambio: {formatBogota(updatedAt)} por {updatedBy}
          </p>
        )}
      </div>
    </div>
  )
}
