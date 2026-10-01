'use client'

import { useId, useState, useTransition } from 'react'
import Link from 'next/link'
import { Palmtree, Loader2, AlertCircle, TriangleAlert, Plus, Trash2 } from 'lucide-react'
import { createCustomClosure, removeClosure } from '@/actions/closures'
import {
  MAX_CLOSURE_DAYS,
  MAX_REASON,
  addDaysKey,
  appointmentsRangeWarning,
  closureRangeLabel,
  validateClosureInput,
} from '@/lib/business-closures'
import { SectionHeader, cardStyle, type ClosureRow } from '@/components/dashboard/settings/ClosuresShared'

interface CustomClosuresPanelProps {
  slug:      string
  todayKey:  string
  closures:  ClosureRow[]
  onAdd:     (row: ClosureRow) => void
  onRemove:  (id: string) => void
}

const inputStyle = {
  backgroundColor: 'var(--bg-color)',
  borderColor:     'var(--border-color)',
  color:           'var(--text-color, #F4F4F4)',
} as const
const inputCls = 'w-full rounded-xl px-3 py-2.5 text-sm border outline-none transition-colors placeholder-zinc-600 disabled:opacity-50'
const labelCls = 'text-xs font-semibold text-zinc-400 uppercase tracking-wide'

function AgendaWarning({ count, slug }: { count: number; slug: string }) {
  const text = appointmentsRangeWarning(count)
  if (!text) return null
  return (
    <p role="status" className="flex items-start gap-1.5 text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2">
      <TriangleAlert size={12} className="shrink-0 mt-0.5" />
      <span>
        {text}{' '}
        <Link href={`/${slug}/dashboard/appointments`} className="font-semibold underline underline-offset-2 whitespace-nowrap">
          Ir a la Agenda →
        </Link>
      </span>
    </p>
  )
}

export function CustomClosuresPanel({ slug, todayKey, closures, onAdd, onRemove }: CustomClosuresPanelProps) {
  const uid = useId()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [warning, setWarning] = useState<number>(0)
  const [isPending, startTransition] = useTransition()

  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const custom = closures
    .filter(c => c.kind === 'custom' && c.date_to >= todayKey)
    .sort((a, b) => (a.date_from < b.date_from ? -1 : a.date_from > b.date_from ? 1 : 0))

  function handleFromChange(value: string) {
    setFrom(value)
    setFormError(null)
    // Si "hasta" quedó antes de "desde", lo acerca
    if (value && (!to || to < value)) setTo(value)
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setWarning(0)

    const invalid = validateClosureInput({ date_from: from, date_to: to || from, reason }, todayKey)
    if (invalid) return setFormError(invalid)

    startTransition(async () => {
      const res = await createCustomClosure({ date_from: from, date_to: to || from, reason })
      if (res.error || !res.id) {
        setFormError(res.error ?? 'No se pudo guardar.')
        return
      }
      onAdd({ id: res.id, date_from: from, date_to: to || from, kind: 'custom', reason: reason.trim() })
      setWarning(res.appointments ?? 0)
      setFrom(''); setTo(''); setReason('')
    })
  }

  async function handleRemove(id: string) {
    setRemovingId(id)
    setListError(null)
    const res = await removeClosure(id)
    if (res.error) setListError(res.error)
    else onRemove(id)
    setRemovingId(null)
    setConfirmId(null)
  }

  return (
    <section className="rounded-2xl p-5 flex flex-col gap-5" style={cardStyle()} aria-label="Cierres propios">
      <SectionHeader
        icon={<Palmtree size={17} style={{ color: 'var(--primary-color)' }} />}
        title="Cierres propios (vacaciones, remodelación)"
        subtitle={`Cierra el negocio por varios días, hasta ${MAX_CLOSURE_DAYS} seguidos. Nadie podrá reservar en esas fechas.`}
      />

      <form onSubmit={handleCreate} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5 min-w-0">
            <label htmlFor={`${uid}-from`} className={labelCls}>Desde</label>
            <input
              id={`${uid}-from`}
              type="date"
              value={from}
              min={todayKey}
              onChange={e => handleFromChange(e.target.value)}
              disabled={isPending}
              className={inputCls}
              style={inputStyle}
            />
          </div>
          <div className="flex flex-col gap-1.5 min-w-0">
            <label htmlFor={`${uid}-to`} className={labelCls}>Hasta</label>
            <input
              id={`${uid}-to`}
              type="date"
              value={to}
              min={from || todayKey}
              max={from ? addDaysKey(from, MAX_CLOSURE_DAYS) : undefined}
              onChange={e => { setTo(e.target.value); setFormError(null) }}
              disabled={isPending}
              className={inputCls}
              style={inputStyle}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-reason`} className={labelCls}>Motivo</label>
          <input
            id={`${uid}-reason`}
            type="text"
            value={reason}
            maxLength={MAX_REASON}
            onChange={e => { setReason(e.target.value); setFormError(null) }}
            disabled={isPending}
            placeholder="Ej: Vacaciones de fin de año"
            className={inputCls}
            style={inputStyle}
          />
        </div>

        {formError && (
          <p role="alert" className="flex items-start gap-1.5 text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            {formError}
          </p>
        )}

        <AgendaWarning count={warning} slug={slug} />

        <button
          type="submit"
          disabled={isPending}
          className="flex items-center justify-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl transition-all disabled:opacity-50 sm:self-end"
          style={{ backgroundColor: 'var(--primary-color)', color: '#080808' }}
        >
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Cerrar esos días
        </button>
      </form>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Próximos cierres</h3>

        {custom.length === 0 ? (
          <p className="text-xs text-zinc-500">No tienes cierres propios programados.</p>
        ) : (
          <ul className="flex flex-col rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
            {custom.map((c, idx) => (
              <li
                key={c.id}
                className="flex flex-col gap-2 px-4 py-3"
                style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--border-color)' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-200 break-words">{c.reason}</p>
                    <p className="text-xs text-zinc-500">{closureRangeLabel(c.date_from, c.date_to)}</p>
                  </div>

                  {confirmId === c.id ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        disabled={removingId === c.id}
                        className="text-xs text-zinc-400 px-2 py-1.5"
                      >
                        No
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(c.id)}
                        disabled={removingId === c.id}
                        className="flex items-center gap-1 text-xs font-semibold text-red-400 border border-red-400/40 rounded-lg px-2.5 py-1.5 disabled:opacity-50"
                      >
                        {removingId === c.id && <Loader2 size={11} className="animate-spin" />}
                        Sí, quitar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setConfirmId(c.id); setListError(null) }}
                      className="flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-red-400 shrink-0 px-2 py-1.5"
                    >
                      <Trash2 size={12} />
                      Quitar
                    </button>
                  )}
                </div>
                {confirmId === c.id && (
                  <p className="text-[11px] text-zinc-500">
                    Se vuelve a abrir el negocio en esas fechas y tus clientes podrán reservar de nuevo.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {listError && (
          <p role="alert" className="flex items-start gap-1.5 text-xs text-red-400">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            {listError}
          </p>
        )}
      </div>
    </section>
  )
}
