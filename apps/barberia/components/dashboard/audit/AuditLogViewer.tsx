'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, Loader2, Shield } from 'lucide-react'
import { getAuditLogs } from '@/actions/audit'
import type { AuditLog, Json } from '@xinuco/types'

// ── Tipos ─────────────────────────────────────────────────────────────────────

type EntityTypeFilter =
  | 'all'
  | 'appointment'
  | 'staff'
  | 'service'
  | 'shift'
  | 'sale'

interface AuditLogViewerProps {
  initialLogs: AuditLog[]
  businessId:  string
}

// ── Configuración de badges por prefijo de acción ─────────────────────────────

const ACTION_BADGE_CONFIG: Record<string, { bg: string; text: string; border: string }> = {
  appointment: { bg: 'rgba(59,130,246,0.12)',  text: '#60a5fa', border: 'rgba(59,130,246,0.25)' },
  staff:       { bg: 'rgba(168,85,247,0.12)', text: '#c084fc', border: 'rgba(168,85,247,0.25)' },
  sale:        { bg: 'rgba(234,179,8,0.12)',  text: '#facc15', border: 'rgba(234,179,8,0.25)'  },
  shift:       { bg: 'rgba(34,197,94,0.12)',  text: '#4ade80', border: 'rgba(34,197,94,0.25)'  },
  service:     { bg: 'rgba(148,163,184,0.12)', text: '#94a3b8', border: 'rgba(148,163,184,0.25)' },
}

function getActionBadgeStyle(action: string) {
  const prefix = action.split('.')[0]
  return (
    ACTION_BADGE_CONFIG[prefix] ?? {
      bg: 'rgba(255,255,255,0.07)',
      text: 'var(--text-color)',
      border: 'var(--border-color)',
    }
  )
}

// ── Formatear timestamp a fecha y hora local en español Colombia ──────────────

function formatTimestamp(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
  }
}

// ── Renderizar JSONB como diff legible ────────────────────────────────────────

function JsonBlock({ label, value }: { label: string; value: Json | null }) {
  if (value === null || value === undefined) return null
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-color)', opacity: 0.5 }}>
        {label}
      </span>
      <pre
        className="text-xs rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre-wrap break-words"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', color: 'var(--text-color)' }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

// ── Fila de log con expansión ─────────────────────────────────────────────────

function AuditLogRow({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false)
  const { date, time } = formatTimestamp(log.created_at)
  const badgeStyle = getActionBadgeStyle(log.action)
  const hasDetails = log.old_value !== null || log.new_value !== null

  return (
    <>
      <tr
        className="transition-colors duration-150 hover:bg-white/[0.025] cursor-pointer"
        style={{ borderTop: '1px solid var(--border-color)' }}
        onClick={() => hasDetails && setExpanded(e => !e)}
        aria-expanded={hasDetails ? expanded : undefined}
      >
        {/* Timestamp */}
        <td className="px-4 py-3 whitespace-nowrap">
          <div className="flex flex-col">
            <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-color)' }}>{time}</span>
            <span className="text-[11px]" style={{ color: 'var(--text-color)', opacity: 0.45 }}>{date}</span>
          </div>
        </td>

        {/* Actor */}
        <td className="px-4 py-3 whitespace-nowrap hidden sm:table-cell">
          <span className="text-xs" style={{ color: 'var(--text-color)', opacity: 0.8 }}>
            {log.actor_name ?? <span style={{ opacity: 0.4 }}>Sistema</span>}
          </span>
        </td>

        {/* Action badge */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border whitespace-nowrap"
            style={{ background: badgeStyle.bg, color: badgeStyle.text, borderColor: badgeStyle.border }}
          >
            {log.action}
          </span>
        </td>

        {/* Entity */}
        <td className="px-4 py-3 hidden md:table-cell">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium capitalize" style={{ color: 'var(--text-color)' }}>{log.entity_type}</span>
            {log.entity_id && (
              <span className="text-[10px] font-mono truncate max-w-[120px]" style={{ color: 'var(--text-color)', opacity: 0.4 }}>
                {log.entity_id.substring(0, 8)}…
              </span>
            )}
          </div>
        </td>

        {/* Expand indicator */}
        <td className="px-4 py-3 text-right">
          {hasDetails ? (
            expanded
              ? <ChevronDown size={14} style={{ color: 'var(--text-color)', opacity: 0.5 }} className="ml-auto" />
              : <ChevronRight size={14} style={{ color: 'var(--text-color)', opacity: 0.5 }} className="ml-auto" />
          ) : (
            <span className="text-[10px]" style={{ color: 'var(--text-color)', opacity: 0.25 }}>—</span>
          )}
        </td>
      </tr>

      {/* Fila expandida con diff de valores */}
      {expanded && hasDetails && (
        <tr style={{ borderTop: '1px solid var(--border-color)' }}>
          <td colSpan={5} className="px-4 pb-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <JsonBlock label="Valor anterior" value={log.old_value} />
              <JsonBlock label="Valor nuevo"    value={log.new_value} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

const ENTITY_FILTER_OPTIONS: { value: EntityTypeFilter; label: string }[] = [
  { value: 'all',         label: 'Todos'       },
  { value: 'appointment', label: 'Citas'        },
  { value: 'staff',       label: 'Equipo'       },
  { value: 'service',     label: 'Servicios'    },
  { value: 'shift',       label: 'Turnos'       },
  { value: 'sale',        label: 'Ventas'       },
]

export function AuditLogViewer({ initialLogs, businessId }: AuditLogViewerProps) {
  const [logs,          setLogs]          = useState<AuditLog[]>(initialLogs)
  const [entityFilter,  setEntityFilter]  = useState<EntityTypeFilter>('all')
  const [dateFrom,      setDateFrom]      = useState('')
  const [dateTo,        setDateTo]        = useState('')
  const [offset,        setOffset]        = useState(initialLogs.length)
  const [hasMore,       setHasMore]       = useState(initialLogs.length === 100)
  const [isPending,     startTransition]  = useTransition()

  // ── Aplicar filtros (reinicia la lista) ──────────────────────────────────────

  function handleFilterChange(
    newEntityFilter:  EntityTypeFilter,
    newDateFrom:      string,
    newDateTo:        string,
  ) {
    setEntityFilter(newEntityFilter)
    setDateFrom(newDateFrom)
    setDateTo(newDateTo)
    setOffset(0)
    setHasMore(false)

    startTransition(async () => {
      const result = await getAuditLogs(businessId, {
        entityType: newEntityFilter !== 'all' ? newEntityFilter : undefined,
        dateFrom:   newDateFrom || undefined,
        dateTo:     newDateTo   || undefined,
        limit:      100,
      })
      setLogs(result)
      setOffset(result.length)
      setHasMore(result.length === 100)
    })
  }

  // ── Cargar más (paginación) ───────────────────────────────────────────────────

  function handleLoadMore() {
    startTransition(async () => {
      const result = await getAuditLogs(businessId, {
        entityType: entityFilter !== 'all' ? entityFilter : undefined,
        dateFrom:   dateFrom || undefined,
        dateTo:     dateTo   || undefined,
        limit:      100,
      })
      // Append — filtrar duplicados por id
      const existingIds = new Set(logs.map(l => l.id))
      const newLogs = result.filter(l => !existingIds.has(l.id))
      setLogs(prev => [...prev, ...newLogs])
      setOffset(prev => prev + newLogs.length)
      setHasMore(result.length === 100 && newLogs.length > 0)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Barra de filtros */}
      <div
        className="flex flex-wrap items-end gap-3 p-4 rounded-xl"
        style={{ background: 'var(--surface-color, rgba(255,255,255,0.03))', border: '1px solid var(--border-color)' }}
      >
        {/* Selector de tipo de entidad */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-color)', opacity: 0.5 }}>
            Tipo de entidad
          </label>
          <select
            value={entityFilter}
            onChange={e => handleFilterChange(e.target.value as EntityTypeFilter, dateFrom, dateTo)}
            className="input-base text-sm h-9 py-0"
            style={{ minWidth: '140px' }}
            disabled={isPending}
          >
            {ENTITY_FILTER_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Date From */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-color)', opacity: 0.5 }}>
            Desde
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => handleFilterChange(entityFilter, e.target.value, dateTo)}
            className="input-base text-sm h-9 py-0"
            disabled={isPending}
          />
        </div>

        {/* Date To */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-color)', opacity: 0.5 }}>
            Hasta
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={e => handleFilterChange(entityFilter, dateFrom, e.target.value)}
            className="input-base text-sm h-9 py-0"
            disabled={isPending}
          />
        </div>

        {/* Spinner de filtrado */}
        {isPending && (
          <div className="flex items-end pb-1.5">
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
          </div>
        )}
      </div>

      {/* Tabla de logs */}
      {logs.length === 0 && !isPending ? (
        /* Empty state */
        <div
          className="flex flex-col items-center justify-center gap-3 py-16 rounded-xl"
          style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.02))' }}
        >
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)' }}
          >
            <Shield size={22} style={{ color: 'var(--text-color)', opacity: 0.3 }} />
          </div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-color)', opacity: 0.6 }}>
            Sin registros de auditoría
          </p>
          <p className="text-xs text-center max-w-xs" style={{ color: 'var(--text-color)', opacity: 0.35 }}>
            Las acciones significativas en el sistema aparecerán aquí.
          </p>
        </div>
      ) : (
        <div
          className="overflow-x-auto rounded-xl animate-fade-in"
          style={{ border: '1px solid var(--border-color)' }}
        >
          <table className="w-full text-sm" aria-label="Tabla de auditoría">
            <thead>
              <tr style={{ background: 'var(--surface-color, rgba(255,255,255,0.03))', borderBottom: '1px solid var(--border-color)' }}>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-color)', opacity: 0.5 }}>
                  Fecha / Hora
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider hidden sm:table-cell" style={{ color: 'var(--text-color)', opacity: 0.5 }}>
                  Actor
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-color)', opacity: 0.5 }}>
                  Acción
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider hidden md:table-cell" style={{ color: 'var(--text-color)', opacity: 0.5 }}>
                  Entidad
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-color)', opacity: 0.5 }}>
                  Detalle
                </th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <AuditLogRow key={log.id} log={log} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación: Cargar más */}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isPending}
            className="btn-ghost flex items-center gap-2 text-sm px-6 py-2.5"
          >
            {isPending ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Cargando…
              </>
            ) : (
              'Cargar más'
            )}
          </button>
        </div>
      )}

      {/* Contador */}
      {logs.length > 0 && (
        <p className="text-xs text-center" style={{ color: 'var(--text-color)', opacity: 0.35 }}>
          Mostrando {logs.length} registro{logs.length !== 1 ? 's' : ''}
          {hasMore ? ' · hay más disponibles' : ' · fin del historial'}
        </p>
      )}
    </div>
  )
}
