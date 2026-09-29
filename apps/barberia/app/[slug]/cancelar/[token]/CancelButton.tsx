'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Check, Loader2, AlertCircle } from 'lucide-react'
import { cancelAppointmentByToken } from '@/actions/public-appointments'

export function CancelButton({ token, slug }: { token: string; slug: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone]   = useState(false)

  // Server action vía <form action>: se envía por POST, nunca por GET.
  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      const res = await cancelAppointmentByToken(token)
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
          <Check size={30} className="text-white" />
        </div>
        <h2 className="text-xl font-bold text-xinuco-text mb-1">Tu cita fue cancelada</h2>
        <p className="text-sm text-xinuco-muted">
          Te enviamos la confirmación a tu correo (si lo registraste).
        </p>
        <Link
          href={`/${slug}/book`}
          className="mt-6 inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-bold text-white"
          style={{ background: 'var(--primary-color)' }}
        >
          Reservar otra cita
        </Link>
      </div>
    )
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3">
      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2 text-left">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 px-6 py-3 text-sm font-bold text-white transition-colors"
      >
        {isPending ? <><Loader2 size={16} className="animate-spin" /> Cancelando…</> : 'Sí, cancelar mi cita'}
      </button>
      <p className="text-xs text-xinuco-muted text-center">
        Puedes cerrar esta página si no quieres cancelar.
      </p>
    </form>
  )
}
