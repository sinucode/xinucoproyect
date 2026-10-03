'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { Check, Loader2, AlertCircle } from 'lucide-react'
import { cancelAppointmentByToken } from '@/actions/public-appointments'

const MAX_REASON = 300

export function CancelButton({ token, slug }: { token: string; slug: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError]   = useState<string | null>(null)
  const [done, setDone]     = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Al abrir el panel de confirmación, el foco va al campo del motivo.
  useEffect(() => {
    if (confirming) textareaRef.current?.focus()
  }, [confirming])

  // Server action vía <form action>: se envía por POST, nunca por GET.
  function handleSubmit(formData: FormData) {
    const value = String(formData.get('reason') ?? '')
    setError(null)
    startTransition(async () => {
      const res = await cancelAppointmentByToken(token, value)
      if ('error' in res) setError(res.error)
      else setDone(true)
    })
  }

  if (done) {
    return (
      <div className="flex flex-col items-center text-center animate-fade-in">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mb-4 shadow-lg"
          style={{ background: 'var(--primary-color)' }}
        >
          <Check size={30} style={{ color: 'var(--on-primary, #080808)' }} />
        </div>
        <h2 className="text-xl font-bold text-xinuco-text mb-1">Tu cita fue cancelada</h2>
        <p className="text-sm text-xinuco-muted">
          Te enviamos la confirmación a tu correo (si lo registraste).
        </p>
        <Link
          href={`/${slug}/book`}
          className="mt-6 inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-bold"
          style={{ background: 'var(--primary-color)', color: 'var(--on-primary, #080808)' }}
        >
          Reservar otra cita
        </Link>
      </div>
    )
  }

  if (!confirming) {
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 px-6 py-3 text-sm font-bold text-white transition-colors"
        >
          Cancelar mi cita
        </button>
        <p className="text-xs text-xinuco-muted text-center">
          Puedes cerrar esta página si no quieres cancelar.
        </p>
      </div>
    )
  }

  return (
    <form
      action={handleSubmit}
      role="group"
      aria-labelledby="cancel-confirm-title"
      aria-describedby="cancel-confirm-desc"
      className="flex flex-col gap-4 text-left"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !isPending) setConfirming(false)
      }}
    >
      <div>
        <h2 id="cancel-confirm-title" className="text-base font-bold text-xinuco-text">
          ¿Estás seguro de que quieres cancelar tu cita?
        </h2>
        <p id="cancel-confirm-desc" className="text-sm text-xinuco-muted mt-1">
          Esta acción no se puede deshacer. Liberaremos tu horario para otra persona.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cancel-reason" className="text-sm font-medium text-xinuco-text">
          ¿Por qué la cancelas? (opcional)
        </label>
        <textarea
          id="cancel-reason"
          name="reason"
          ref={textareaRef}
          rows={3}
          maxLength={MAX_REASON}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={isPending}
          placeholder="Ej: me surgió un imprevisto"
          className="w-full rounded-xl border border-xinuco-border bg-transparent px-3 py-2 text-sm text-xinuco-text placeholder:text-xinuco-muted resize-none focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-60"
        />
        <p className="text-xs text-xinuco-muted text-right" aria-live="polite">
          {reason.length}/{MAX_REASON}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 light:text-red-700 text-sm flex items-start gap-2 text-left"
        >
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#DC2626] hover:bg-red-700 disabled:opacity-60 px-6 py-3 text-sm font-bold text-white transition-colors"
        >
          {isPending ? <><Loader2 size={16} className="animate-spin" /> Cancelando…</> : 'Sí, cancelar cita'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="w-full inline-flex items-center justify-center rounded-xl border border-xinuco-border px-6 py-3 text-sm font-semibold text-xinuco-text hover:tint-5 disabled:opacity-60 transition-colors"
        >
          No, volver
        </button>
      </div>
    </form>
  )
}
