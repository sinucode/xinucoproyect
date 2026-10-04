'use client'

// AuditLogViewer — "Auditoría": quién hizo qué y cuándo. Alertas de la semana, filtros,
// lista agrupada por día y detalle antes/después. Solo lectura (los registros los escribe la BD).

import { useRef, useState, useTransition } from 'react'
import {
  Banknote,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Package,
  Settings,
  TriangleAlert,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { getAuditLogs } from '@/actions/audit'
import {
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABEL,
  auditCategoryOf,
  auditDayKey,
  auditDayLabel,
  auditSentence,
  diffRows,
  formatAuditClock,
  formatAuditTime,
  type AuditActorOption,
  type AuditAlertItem,
  type AuditCategory,
  type AuditFilters,
} from '@/lib/audit-utils'
import type { AuditLog } from '@xinuco/types'

interface AuditLogViewerProps {
  initialLogs:    AuditLog[]
  initialHasMore: boolean
  /** Null = no se pudo cargar. */
  actors:         AuditActorOption[] | null
  alerts:         AuditAlertItem[] | null
  /** Día de hoy en Colombia ('YYYY-MM-DD'), calculado en el servidor. */
  today:          string
  initialError?:  string | null
}

const CATEGORY_ICON: Record<AuditCategory, LucideIcon> = {
  money:        Wallet,
  cash:         Banknote,
  inventory:    Package,
  appointments: CalendarDays,
  team:         Users,
  settings:     Settings,
  customers:    UserRound,
}

const AMBER = 'var(--st-amber, #fbbf24)'
const AMBER_BORDER = 'rgba(251,191,36,0.35)'
const AMBER_BG = 'rgba(251,191,36,0.10)'

const EMPTY_FILTERS: AuditFilters = {}

function hasAnyFilter(f: AuditFilters): boolean {
  return !!(f.category || f.actor || f.from || f.to || f.onlyWarnings)
}

const chip = (active: boolean) =>
  `px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap ${
    active ? '' : 'text-xinuco-muted hover:text-xinuco-text'
  }`
const chipStyle = (active: boolean) => active
  ? {
      borderColor: 'var(--primary-color)',
      color: 'var(--primary-color)',
      background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
    }
  : { borderColor: 'var(--border-color)' }

// ── Tarjeta de alertas ────────────────────────────────────────────────────────

function AlertsCard({ alerts }: { alerts: AuditAlertItem[] | null }) {
  return (
    <section
      aria-label="Últimos 7 días"
      className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3"
      style={{ border: '1px solid var(--border-color)', background: 'rgb(var(--fg) / 0.03)' }}
    >
      <h2 className="text-sm font-bold text-xinuco-text uppercase tracking-wider">Últimos 7 días</h2>
      {alerts === null ? (
        <p className="text-sm text-xinuco-muted">No se pudo calcular el resumen de la semana.</p>
      ) : alerts.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-xinuco-muted">
          <Check size={16} className="shrink-0 text-emerald-400" />
          Sin movimientos delicados esta semana
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {alerts.map(a => (
            <li
              key={a.key}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border min-w-0"
              style={a.tone === 'warning'
                ? { borderColor: AMBER_BORDER, background: AMBER_BG, color: AMBER }
                : { borderColor: 'var(--border-color)' }}
            >
              {a.tone === 'warning' && <TriangleAlert size={12} className="shrink-0" />}
              <span className={`break-words ${a.tone === 'warning' ? '' : 'text-xinuco-text'}`}>{a.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Detalle antes / después ───────────────────────────────────────────────────

function DetailTable({ log }: { log: AuditLog }) {
  const hasOld = log.old_value !== null && log.old_value !== undefined
  const hasNew = log.new_value !== null && log.new_value !== undefined
  const rows = diffRows(log.old_value, log.new_value)
  const both = hasOld && hasNew

  if (rows.length === 0) {
    return <p className="text-xs text-xinuco-muted">No hay más detalles de este movimiento.</p>
  }

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
      <table className="w-full table-fixed text-xs">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-xinuco-muted" style={{ background: 'rgb(var(--fg) / 0.03)' }}>
            <th className="px-3 py-2 font-semibold">Campo</th>
            {both ? (
              <>
                <th className="px-3 py-2 font-semibold">Antes</th>
                <th className="px-3 py-2 font-semibold">Después</th>
              </>
            ) : (
              <th className="px-3 py-2 font-semibold">Valor</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.campo}-${i}`} className="align-top" style={{ borderTop: '1px solid var(--border-color)' }}>
              <td className="px-3 py-2 font-medium text-xinuco-text break-words">{r.campo}</td>
              {both ? (
                <>
                  <td className="px-3 py-2 text-xinuco-muted break-words">{r.antes}</td>
                  <td className="px-3 py-2 text-xinuco-text break-words">{r.despues}</td>
                </>
              ) : (
                <td className="px-3 py-2 text-xinuco-text break-words">{hasNew ? r.despues : r.antes}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Fila ──────────────────────────────────────────────────────────────────────

function LogRow({ log, first, open, onToggle }: { log: AuditLog; first: boolean; open: boolean; onToggle: () => void }) {
  const category = auditCategoryOf(log)
  const Icon = CATEGORY_ICON[category]
  const warning = log.severity === 'warning'
  const canExpand = (log.old_value !== null && log.old_value !== undefined)
    || (log.new_value !== null && log.new_value !== undefined)

  return (
    <li
      className="flex gap-3 px-3 sm:px-4 py-3 min-w-0"
      style={{
        borderTop: first ? undefined : '1px solid var(--border-color)',
        borderLeft: warning ? `3px solid ${AMBER}` : '3px solid transparent',
        background: warning ? 'rgba(251,191,36,0.04)' : undefined,
      }}
    >
      <span
        className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center mt-0.5"
        style={warning
          ? { background: AMBER_BG, color: AMBER }
          : { background: 'color-mix(in srgb, var(--primary-color) 10%, transparent)', color: 'var(--primary-color)' }}
        title={AUDIT_CATEGORY_LABEL[category]}
      >
        <Icon size={15} />
      </span>

      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <p className="text-sm text-xinuco-text break-words">
          <strong className="font-semibold">{log.actor_name ?? 'Sistema'}</strong>{' '}
          {auditSentence(log)}
        </p>
        <p className="text-xs text-xinuco-muted flex flex-wrap items-center gap-x-2">
          <span title={formatAuditTime(log.created_at)}>{formatAuditClock(log.created_at)}</span>
          <span aria-hidden>·</span>
          <span>{AUDIT_CATEGORY_LABEL[category]}</span>
          {warning && (
            <span className="inline-flex items-center gap-1 font-semibold" style={{ color: AMBER }}>
              <TriangleAlert size={11} /> Para revisar
            </span>
          )}
        </p>

        {canExpand && (
          <>
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className="self-start inline-flex items-center gap-1 text-xs font-medium hover:underline"
              style={{ color: 'var(--primary-color)' }}
            >
              {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {open ? 'Ocultar detalle' : 'Ver detalle'}
            </button>
            {open && (
              <div className="flex flex-col gap-1.5 animate-fade-in">
                <p className="text-[11px] text-xinuco-muted">{formatAuditTime(log.created_at)}</p>
                <DetailTable log={log} />
              </div>
            )}
          </>
        )}
      </div>
    </li>
  )
}

// ── Visor ─────────────────────────────────────────────────────────────────────

export function AuditLogViewer({
  initialLogs, initialHasMore, actors, alerts, today, initialError = null,
}: AuditLogViewerProps) {
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS)
  const [logs, setLogs] = useState<AuditLog[]>(initialLogs)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [error, setError] = useState<string | null>(initialError)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const [loadingMore, startMore] = useTransition()
  // Evita que una respuesta vieja pise a una más reciente al cambiar filtros rápido
  const requestId = useRef(0)

  function applyFilters(patch: Partial<AuditFilters>) {
    const next: AuditFilters = { ...filters, ...patch }
    setFilters(next)
    setError(null)
    const id = ++requestId.current
    startTransition(async () => {
      const res = await getAuditLogs(next)
      if (id !== requestId.current) return
      if ('error' in res) {
        setError(res.error)
        return
      }
      setLogs(res.logs)
      setHasMore(res.hasMore)
      setOpenIds(new Set())
    })
  }

  function loadMore() {
    const last = logs[logs.length - 1]
    if (!last) return
    setError(null)
    const id = requestId.current
    startMore(async () => {
      const res = await getAuditLogs({ ...filters, before: { createdAt: last.created_at, id: last.id } })
      if (id !== requestId.current) return
      if ('error' in res) {
        setError(res.error)
        return
      }
      setLogs(prev => {
        const seen = new Set(prev.map(l => l.id))
        return [...prev, ...res.logs.filter(l => !seen.has(l.id))]
      })
      setHasMore(res.hasMore)
    })
  }

  function toggle(id: string) {
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Agrupar por día de Colombia (la lista ya viene del más nuevo al más viejo)
  const groups: { day: string; items: AuditLog[] }[] = []
  for (const log of logs) {
    const day = auditDayKey(log.created_at)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(log)
    else groups.push({ day, items: [log] })
  }

  const filtered = hasAnyFilter(filters)

  return (
    <div className="flex flex-col gap-5 min-w-0">
      <AlertsCard alerts={alerts} />

      {/* Filtros */}
      <section aria-label="Filtros" className="flex flex-col gap-3 min-w-0">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por tema">
          <button
            type="button"
            onClick={() => applyFilters({ category: undefined })}
            aria-pressed={!filters.category}
            className={chip(!filters.category)}
            style={chipStyle(!filters.category)}
          >
            Todo
          </button>
          {AUDIT_CATEGORIES.map(c => (
            <button
              key={c.key}
              type="button"
              onClick={() => applyFilters({ category: c.key })}
              aria-pressed={filters.category === c.key}
              className={chip(filters.category === c.key)}
              style={chipStyle(filters.category === c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-xinuco-muted uppercase tracking-wider min-w-0">
            Quién
            <select
              value={filters.actor ?? ''}
              onChange={e => applyFilters({ actor: e.target.value || undefined })}
              disabled={actors === null}
              className="input-base !py-2 !px-3 !text-xs normal-case font-normal"
            >
              <option value="">Todos</option>
              {(actors ?? []).map(a => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-xinuco-muted uppercase tracking-wider min-w-0">
            Desde
            <input
              type="date"
              value={filters.from ?? ''}
              max={filters.to || undefined}
              onChange={e => applyFilters({ from: e.target.value || undefined })}
              className="input-base !py-2 !px-3 !text-xs normal-case font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-xinuco-muted uppercase tracking-wider min-w-0">
            Hasta
            <input
              type="date"
              value={filters.to ?? ''}
              min={filters.from || undefined}
              onChange={e => applyFilters({ to: e.target.value || undefined })}
              className="input-base !py-2 !px-3 !text-xs normal-case font-normal"
            />
          </label>
          <div className="flex items-center gap-3 flex-wrap pb-0.5">
            <button
              type="button"
              role="switch"
              aria-checked={!!filters.onlyWarnings}
              onClick={() => applyFilters({ onlyWarnings: filters.onlyWarnings ? undefined : true })}
              className={`${chip(!!filters.onlyWarnings)} inline-flex items-center gap-1.5`}
              style={filters.onlyWarnings
                ? { borderColor: AMBER_BORDER, color: AMBER, background: AMBER_BG }
                : chipStyle(false)}
            >
              <TriangleAlert size={12} />
              Solo alertas
            </button>
            {filtered && (
              <button
                type="button"
                onClick={() => applyFilters({
                  category: undefined, actor: undefined, from: undefined, to: undefined, onlyWarnings: undefined,
                })}
                className="text-xs font-medium hover:underline"
                style={{ color: 'var(--primary-color)' }}
              >
                Quitar filtros
              </button>
            )}
          </div>
        </div>
      </section>

      {error && (
        <p role="alert" className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3 break-words">
          {error}
        </p>
      )}

      {/* Lista */}
      <section aria-label="Registros" aria-busy={pending} className="flex flex-col gap-4 min-w-0">
        {pending && (
          <div className="flex items-center gap-2 text-xs text-xinuco-muted">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Cargando…
          </div>
        )}

        {groups.length === 0 ? (
          !pending && !error && (
            <div
              className="rounded-xl px-4 py-10 text-center text-sm text-xinuco-muted"
              style={{ border: '1px solid var(--border-color)', background: 'rgb(var(--fg) / 0.02)' }}
            >
              Todavía no hay registros con estos filtros.
            </div>
          )
        ) : (
          <div className={`flex flex-col gap-4 ${pending ? 'opacity-60' : ''}`}>
            {groups.map(g => (
              <div key={g.day} className="flex flex-col gap-2 min-w-0">
                <h3 className="text-xs font-bold text-xinuco-muted uppercase tracking-wider">
                  {auditDayLabel(g.day, today)}
                </h3>
                <ul
                  className="rounded-xl overflow-hidden min-w-0"
                  style={{ border: '1px solid var(--border-color)', background: 'rgb(var(--fg) / 0.02)' }}
                >
                  {g.items.map((log, i) => (
                    <LogRow
                      key={log.id}
                      log={log}
                      first={i === 0}
                      open={openIds.has(log.id)}
                      onToggle={() => toggle(log.id)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore || pending}
            className="btn-ghost self-center !py-2.5 !px-5 !text-xs"
          >
            {loadingMore && <Loader2 size={14} className="animate-spin" aria-hidden />}
            {loadingMore ? 'Cargando…' : 'Cargar más'}
          </button>
        )}
      </section>
    </div>
  )
}
