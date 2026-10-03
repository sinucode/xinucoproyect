'use client'

// "¿Dejar nota del corte?": aviso opcional que aparece al terminar una cita.
// Guarda la nota en el expediente del cliente (addCustomerNote, ligada a la cita).

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { addCustomerNote } from '@/actions/crm'
import { ResponsiveSheet } from '@/components/layout/ResponsiveSheet'

export interface FinishNoteTarget {
  customerId: string
  customerName: string
  appointmentId: string
}

interface FinishNoteSheetProps {
  target: FinishNoteTarget | null
  onClose: () => void
}

const MAX_NOTE = 1000

export function FinishNoteSheet({ target, onClose }: FinishNoteSheetProps) {
  return (
    <ResponsiveSheet
      open={!!target}
      onClose={onClose}
      title="¿Dejar nota del corte?"
      subtitle="Queda en el expediente del cliente"
    >
      {target && <FinishNoteForm key={target.appointmentId} target={target} onClose={onClose} />}
    </ResponsiveSheet>
  )
}

function FinishNoteForm({ target, onClose }: { target: FinishNoteTarget; onClose: () => void }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const content = text.trim()
    if (!content) return
    setSaving(true)
    setError(null)
    try {
      const res = await addCustomerNote(target.customerId, content, target.appointmentId)
      if (res.error) {
        setError(res.error)
        return
      }
      onClose()
    } catch {
      setError('Error inesperado. Intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 pt-1">
      <p className="text-sm text-xinuco-muted">
        Cita de <span className="font-semibold text-xinuco-text">{target.customerName}</span> terminada.
        Por ejemplo: el degradado que le gustó, la máquina que usaste o lo que pidió para la próxima.
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="finish-note" className="text-xs font-semibold uppercase tracking-wider text-xinuco-muted">
          Nota (opcional)
        </label>
        <textarea
          id="finish-note"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_NOTE}
          rows={4}
          autoFocus
          placeholder="Ej: Degradado bajo, tijera arriba. Le gustó."
          className="input-base resize-none"
        />
        <span className="self-end text-[10px] text-xinuco-muted">{text.length}/{MAX_NOTE}</span>
      </div>

      {error && (
        <p className="rounded-xl border border-amber-900/30 bg-amber-950/20 p-3 text-xs text-amber-400" role="alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="min-h-11 rounded-xl border border-xinuco-border text-sm font-semibold text-xinuco-muted hover:text-xinuco-text"
        >
          Omitir
        </button>
        <button type="submit" disabled={saving || !text.trim()} className="btn-primary min-h-11 disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : 'Guardar nota'}
        </button>
      </div>
    </form>
  )
}
