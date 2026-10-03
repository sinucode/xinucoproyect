'use client'

// "Tu día": resumen compacto del barbero en Inicio (próxima cita, citas de hoy, ganado, fila).
// 2 columnas en móvil, 4 en escritorio. Las tarjetas sin dato muestran "—".

import { useEffect, useState, type ReactNode } from 'react'
import { CalendarCheck, Clock, Users, Wallet } from 'lucide-react'
import { businessWallNowMs } from '@/lib/agenda-status'
import { formatApptTime } from '@/lib/agenda-time'
import { formatMinutesUntil, type DaySummary } from '@/lib/day-summary'

export interface TuDiaData {
  summary: DaySummary
  /** Comisión + propina de hoy (COP). null = no se pudo leer. */
  earned: number | null
  /** Fila de espera de hoy. null = no se pudo leer. */
  queue: { waiting: number; mine: number } | null
}

interface TuDiaSummaryProps {
  data: TuDiaData
  /** "Ahora" del negocio calculado en el servidor (hora local como UTC, en ms) */
  nowWallMs: number
}

const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

export function TuDiaSummary({ data, nowWallMs }: TuDiaSummaryProps) {
  const { summary, earned, queue } = data

  // El "en X min" se mantiene al día sin recargar
  const [nowMs, setNowMs] = useState(nowWallMs)
  useEffect(() => {
    const t = setInterval(() => setNowMs(businessWallNowMs()), 60_000)
    return () => clearInterval(t)
  }, [])

  const next = summary.next
  const nextStart = next?.appt.start_time ? Date.parse(next.appt.start_time) : NaN
  const minutesUntil = Number.isNaN(nextStart) ? 0 : Math.max(0, Math.ceil((nextStart - nowMs) / 60_000))

  return (
    <div>
      <h2 className="mb-2 font-semibold text-xinuco-text">Tu día</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Próxima cita" icon={<Clock size={14} aria-hidden="true" />} wideOnMobile>
          {next ? (
            <>
              <p className="truncate text-base font-bold text-xinuco-text">{next.appt.customer_name}</p>
              <p className="truncate text-xs text-xinuco-muted">{next.appt.service_name}</p>
              <p className="mt-1 text-xs font-semibold text-xinuco-primary">
                {next.appt.start_time ? formatApptTime(next.appt.start_time) : '—'} · {formatMinutesUntil(minutesUntil)}
              </p>
            </>
          ) : (
            <p className="text-sm font-medium text-xinuco-muted">Sin más citas hoy</p>
          )}
        </StatCard>

        <StatCard label="Citas hoy" icon={<CalendarCheck size={14} aria-hidden="true" />}>
          <p className="text-2xl font-bold tabular-nums text-xinuco-text">{summary.total}</p>
          <p className="text-xs text-xinuco-muted">
            {summary.attended} {summary.attended === 1 ? 'atendida' : 'atendidas'} · {summary.pending}{' '}
            {summary.pending === 1 ? 'pendiente' : 'pendientes'}
          </p>
        </StatCard>

        <StatCard label="Ganado hoy" icon={<Wallet size={14} aria-hidden="true" />}>
          <p className="text-2xl font-bold tabular-nums text-xinuco-text">{earned === null ? '—' : COP.format(earned)}</p>
          <p className="text-xs text-xinuco-muted">Comisiones y propinas</p>
        </StatCard>

        <StatCard label="Fila" icon={<Users size={14} aria-hidden="true" />}>
          <p className="text-2xl font-bold tabular-nums text-xinuco-text">{queue === null ? '—' : queue.waiting}</p>
          <p className="text-xs text-xinuco-muted">
            {queue === null
              ? 'No se pudo cargar'
              : queue.waiting === 0
                ? 'Nadie esperando'
                : `esperando · ${queue.mine} para ti`}
          </p>
        </StatCard>
      </div>
    </div>
  )
}

function StatCard({
  label, icon, children, wideOnMobile = false,
}: { label: string; icon: ReactNode; children: ReactNode; wideOnMobile?: boolean }) {
  return (
    <div
      className={`card min-w-0 border border-zinc-900 bg-zinc-950/40 p-3 ${wideOnMobile ? 'col-span-2 lg:col-span-1' : ''}`}
    >
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-xinuco-muted">
        {icon}
        {label}
      </p>
      {children}
    </div>
  )
}
