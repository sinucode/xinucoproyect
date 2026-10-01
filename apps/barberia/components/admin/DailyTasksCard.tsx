'use client'

import { useState, useTransition } from 'react'
import { CalendarClock, Loader2, CheckCircle2, AlertCircle, Play } from 'lucide-react'
import { runDailyTasks, type DailyTasksSummary } from '@/actions/platform-settings'

interface DailyTasksCardProps {
  /** Solo indica si CRON_SECRET existe en el servidor (nunca su valor). */
  secretConfigured: boolean
}

function SummaryLine({ label, value, tone = 'ok' }: { label: string; value: string; tone?: 'ok' | 'warn' | 'error' }) {
  const color = tone === 'error' ? 'text-red-400' : tone === 'warn' ? 'text-amber-400' : 'text-xinuco-text'
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-xinuco-border last:border-0">
      <span className="text-xs text-xinuco-muted">{label}</span>
      <span className={`text-xs font-medium text-right ${color}`}>{value}</span>
    </div>
  )
}

export function DailyTasksCard({ secretConfigured }: DailyTasksCardProps) {
  const [pending, startTransition] = useTransition()
  const [summary, setSummary] = useState<DailyTasksSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleRun() {
    setError(null)
    setSummary(null)
    startTransition(async () => {
      const res = await runDailyTasks()
      if (res.success) setSummary(res.summary)
      else setError(res.error)
    })
  }

  const r = summary?.reminders
  const fe = summary?.fixedExpenses
  const ap = summary?.auditPurge

  return (
    <div className="rounded-xl border border-xinuco-border overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-xinuco-border bg-xinuco-surface/50">
        <CalendarClock size={15} className="text-xinuco-muted" />
        <h2 className="text-sm font-semibold text-xinuco-text">Tareas diarias</h2>
      </div>

      <div className="px-5 py-4 space-y-4">
        <p className="text-xs text-xinuco-muted leading-relaxed">
          Cada día a las 8:00 a. m. (Colombia) se envían los recordatorios de las citas de mañana, se
          registran los gastos fijos y se borra la auditoría vencida. Corre para <strong>todas</strong> las
          barberías. Puedes correrlas ahora si hace falta; no repite lo que ya se hizo.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={pending || !secretConfigured}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-xinuco-border text-xinuco-text hover:border-xinuco-primary hover:text-xinuco-primary transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {pending ? 'Corriendo…' : 'Correr ahora'}
          </button>
          {!secretConfigured && (
            <p className="text-xs text-red-400">
              Falta la variable <code className="font-mono">CRON_SECRET</code> en el servidor.
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-xs text-red-400">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            {error}
          </p>
        )}

        {r && fe && ap && (
          <div role="status">
            <p className="flex items-center gap-1.5 text-xs text-green-400 mb-2">
              <CheckCircle2 size={12} />
              Tareas terminadas.
            </p>
            <div className="rounded-lg border border-xinuco-border px-4">
              <SummaryLine
                label="Recordatorios enviados"
                value={`${r.sent} de ${r.processed} citas${r.skipped ? ` · ${r.skipped} ya enviados` : ''}${r.failed ? ` · ${r.failed} con error` : ''}`}
                tone={r.failed > 0 ? 'warn' : 'ok'}
              />
              {'error' in fe ? (
                <SummaryLine label="Gastos fijos" value={`Error: ${fe.error}`} tone="error" />
              ) : (
                <SummaryLine
                  label="Gastos fijos"
                  value={`${fe.registered} registrados · ${fe.reminders} avisos${fe.errors ? ` · ${fe.errors} con error` : ''}`}
                  tone={fe.errors > 0 ? 'warn' : 'ok'}
                />
              )}
              {'error' in ap ? (
                <SummaryLine label="Auditoría" value={`Error: ${ap.error}`} tone="error" />
              ) : (
                <SummaryLine
                  label="Auditoría vencida borrada"
                  value={`${ap.deleted} registros${ap.retentionMonths ? ` (plazo ${ap.retentionMonths} meses)` : ''}`}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
