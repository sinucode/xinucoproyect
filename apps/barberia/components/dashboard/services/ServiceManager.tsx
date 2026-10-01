'use client'

import { useState, useTransition, useCallback, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, X, Loader2, Clock, Scissors,
  MoreVertical, Pencil, Power, Trash2, Save, CheckCircle2, AlertCircle, Copy,
} from 'lucide-react'
import {
  createService, updateService, setServiceActive, deleteService, setServiceAudiences,
  type ServiceOverviewItem, type ServicesOverview,
} from '@/actions/services'
import type { ServiceAudience, ServiceAudienceOrAll } from '@xinuco/types'
import {
  AUDIENCE_ORDER, AUDIENCE_LABELS, serviceAudienceOf, isServiceVisible, servicesForAudience,
} from '@/lib/service-audience'
import { AdminPageHeader } from '@xinuco/ui'
import { AdminEmptyState } from '@xinuco/ui'

// ════════════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ════════════════════════════════════════════════════════════════════════════════

type Staff = ServicesOverview['staff'][number]
type Workstation = ServicesOverview['workstations'][number]

/** Formatea precio entero a string COP para el input — 15000 → "$ 15.000" */
function formatCOP(raw: number | string): string {
  const num = parseInt(String(raw).replace(/\D/g, ''), 10)
  if (isNaN(num) || num === 0) return ''
  return '$ ' + num.toLocaleString('es-CO')
}

/** Precio para mostrar en la tabla — 300000 → "$300.000" */
function displayCOP(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

/** Extrae entero limpio de string COP — "$ 15.000" → 15000 */
function parseCOP(formatted: string): number {
  const clean = formatted.replace(/\D/g, '')
  return clean ? parseInt(clean, 10) : 0
}

/** Formatea minutos a string legible — 90 → "1h 30min" */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

function durationLabel(s: ServiceOverviewItem): string {
  const buffer = s.buffer_time_minutes ?? 0
  return buffer > 0 ? `${formatDuration(s.duration_minutes)} + ${buffer} limpieza` : formatDuration(s.duration_minutes)
}

function monthLabel(s: ServiceOverviewItem): string {
  return s.month_count > 0 ? `${s.month_count} · ${displayCOP(s.month_revenue)}` : '—'
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

type Notice = { type: 'success' | 'error' | 'info'; text: string }

/** Datos con los que se prellena el formulario de "Nuevo servicio" (al duplicar). */
interface ServiceDraft {
  name:                string
  description:         string | null
  duration_minutes:    number
  buffer_time_minutes: number
  price_cop:           number
  staff_ids:           string[]
  workstation_ids:     string[]
  audience:            ServiceAudienceOrAll
}

/** Etiqueta corta del público en badges — 'all' → "Unisex". */
function audienceBadgeLabel(a: ServiceAudienceOrAll): string {
  return a === 'all' ? 'Unisex' : AUDIENCE_LABELS[a].singular
}

/** Público destino al duplicar: el primer activo distinto del origen ('all' → el primero activo). */
function duplicateTarget(source: ServiceAudienceOrAll, active: ServiceAudience[]): ServiceAudience {
  return active.find(a => a !== source) ?? active[0]
}

// ════════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL — ServiceManager (Client Island)
// ════════════════════════════════════════════════════════════════════════════════

interface ServiceManagerProps {
  overview: ServicesOverview
}

export function ServiceManager({ overview }: ServiceManagerProps) {
  const router = useRouter()
  const [services, setServices] = useState<ServiceOverviewItem[]>(overview.services)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingService, setEditingService] = useState<ServiceOverviewItem | null>(null)
  const [draft, setDraft] = useState<ServiceDraft | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const { staff, workstations } = overview
  const [audiences, setAudiences] = useState<ServiceAudience[]>(overview.audiences)
  const [tabState, setTabState] = useState<'all' | ServiceAudience>('all')
  const multi = audiences.length > 1
  // Si el público de la pestaña se desactivó, se vuelve a "Todos".
  const tab: 'all' | ServiceAudience = tabState === 'all' || audiences.includes(tabState) ? tabState : 'all'

  // La fuente de verdad es el servidor: al hacer router.refresh() llegan props nuevas.
  useEffect(() => { setServices(overview.services) }, [overview.services])
  useEffect(() => { setAudiences(overview.audiences) }, [overview.audiences])

  // Activos primero, luego por nombre (también tras un toggle optimista).
  const sorted = useMemo(
    () => [...services].sort((a, b) =>
      Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name, 'es')),
    [services],
  )

  // El aviso se oculta solo
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(t)
  }, [notice])

  // Con pestaña de público seleccionada, la lista solo muestra ese público (+ unisex).
  const visibleList = useMemo(
    () => (multi && tab !== 'all' ? servicesForAudience(sorted, tab) : sorted),
    [sorted, multi, tab],
  )

  const handleCreate = () => { setEditingService(null); setDraft(null); setSheetOpen(true) }
  const handleEdit = useCallback((service: ServiceOverviewItem) => {
    setEditingService(service)
    setDraft(null)
    setSheetOpen(true)
  }, [])
  const handleDuplicate = useCallback((service: ServiceOverviewItem) => {
    const target = duplicateTarget(serviceAudienceOf(service), audiences)
    setEditingService(null)
    setDraft({
      name:                `${service.name} – ${AUDIENCE_LABELS[target].singular}`.slice(0, 80),
      description:         service.description,
      duration_minutes:    service.duration_minutes,
      buffer_time_minutes: service.buffer_time_minutes ?? 0,
      price_cop:           service.price_cop,
      staff_ids:           service.staff_ids,
      workstation_ids:     service.workstation_ids,
      audience:            target,
    })
    setSheetOpen(true)
  }, [audiences])
  const handleClose = useCallback(() => { setSheetOpen(false); setEditingService(null); setDraft(null) }, [])

  const handleSaved = useCallback(() => {
    setNotice({ type: 'success', text: editingService ? 'Servicio actualizado.' : 'Servicio creado.' })
    setSheetOpen(false)
    setEditingService(null)
    setDraft(null)
    router.refresh()
  }, [editingService, router])

  const rowProps = {
    staff,
    audiences,
    onEdit: handleEdit,
    onDuplicate: handleDuplicate,
    onOptimistic: (updated: ServiceOverviewItem) =>
      setServices(prev => prev.map(s => (s.id === updated.id ? updated : s))),
    onNotice: setNotice,
    onRefresh: () => router.refresh(),
  }

  return (
    <>
      <AdminPageHeader
        title="Menú de Servicios"
        subtitle="Configura cortes, precios, duraciones y quién los hace."
        hasData={services.length > 0}
        actionButton={
          <button
            id="btn-add-service"
            onClick={handleCreate}
            className="btn-primary flex items-center gap-2 shrink-0 whitespace-nowrap animate-fade-in"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span className="hidden sm:inline">Añadir Servicio</span>
            <span className="sm:hidden">Añadir</span>
          </button>
        }
      />

      {notice && (
        <div
          role="status"
          className={`flex items-start gap-2.5 text-sm rounded-lg px-4 py-3 border animate-fade-in ${
            notice.type === 'error'
              ? 'text-red-400 bg-red-400/10 border-red-400/20'
              : notice.type === 'info'
                ? 'text-amber-400 bg-amber-400/10 border-amber-400/20'
                : 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
          }`}
        >
          {notice.type === 'error' || notice.type === 'info'
            ? <AlertCircle size={16} className="mt-0.5 shrink-0" />
            : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Cerrar aviso" className="opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      <AudienceControl
        audiences={audiences}
        onChange={setAudiences}
        onNotice={setNotice}
        onRefresh={() => router.refresh()}
      />

      {multi && services.length > 0 && (
        <div role="tablist" aria-label="Filtrar por público" className="flex flex-wrap gap-2">
          {(['all', ...audiences] as ('all' | ServiceAudience)[]).map(t => {
            const selected = tab === t
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTabState(t)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  selected ? '' : 'text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.03]'
                }`}
                style={selected
                  ? { background: 'var(--primary-color)', color: 'var(--bg-color)', borderColor: 'var(--primary-color)' }
                  : { borderColor: 'var(--border-color)' }}
              >
                {t === 'all' ? 'Todos' : AUDIENCE_LABELS[t].plural}
              </button>
            )
          })}
        </div>
      )}

      <section aria-label="Lista de servicios">
        {services.length === 0 ? (
          <AdminEmptyState
            icon={Scissors}
            title="Catálogo vacío"
            description="Aún no has registrado ningún servicio. Añade tu primer corte, tratamiento o producto para comenzar a recibir reservas."
            actionLabel="Añadir Primer Servicio"
            onAction={handleCreate}
          />
        ) : (
          <>
            {/* Desktop: tabla */}
            <div
              className="hidden xl:block rounded-xl animate-fade-in [&_thead_th:first-child]:rounded-tl-xl [&_thead_th:last-child]:rounded-tr-xl"
              style={{ border: '1px solid var(--border-color)' }}
            >
              <table className="w-full text-sm" aria-label="Catálogo de servicios">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.03))' }}>
                    <Th>Servicio</Th>
                    <Th>Duración</Th>
                    <Th>Precio</Th>
                    <Th>Este mes</Th>
                    <Th>Barberos</Th>
                    <Th center>Estado</Th>
                    <Th right><span className="sr-only">Acciones</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleList.map(service => (
                    <ServiceRow key={service.id} service={service} {...rowProps} />
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '1px solid var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.02))' }}>
                    <td colSpan={7} className="px-5 py-3 text-xs text-xinuco-muted">
                      {visibleList.length} servicio{visibleList.length !== 1 ? 's' : ''} registrado{visibleList.length !== 1 ? 's' : ''}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile: tarjetas */}
            <div className="xl:hidden flex flex-col gap-3 animate-fade-in">
              {visibleList.map(service => (
                <ServiceCard key={service.id} service={service} {...rowProps} />
              ))}
              <p className="text-xs text-xinuco-muted px-1">
                {visibleList.length} servicio{visibleList.length !== 1 ? 's' : ''} registrado{visibleList.length !== 1 ? 's' : ''}
              </p>
            </div>
          </>
        )}
      </section>

      {sheetOpen && (
        <ServiceSheet
          service={editingService}
          draft={draft}
          audiences={audiences}
          defaultAudience={tab !== 'all' ? tab : audiences[0]}
          staff={staff}
          workstations={workstations}
          onClose={handleClose}
          onSaved={handleSaved}
        />
      )}
    </>
  )
}

/** "Públicos que atiendes": chips que se guardan al instante (optimista, con reversa si falla). */
function AudienceControl({
  audiences, onChange, onNotice, onRefresh,
}: {
  audiences: ServiceAudience[]
  onChange: (a: ServiceAudience[]) => void
  onNotice: (n: Notice) => void
  onRefresh: () => void
}) {
  const [isPending, startTransition] = useTransition()

  function toggle(a: ServiceAudience) {
    const active = audiences.includes(a)
    if (active && audiences.length === 1) {
      onNotice({ type: 'info', text: 'Debes atender al menos un público.' })
      return
    }
    const previous = audiences
    const next = AUDIENCE_ORDER.filter(x => (x === a ? !active : audiences.includes(x)))
    onChange(next)
    startTransition(async () => {
      const result = await setServiceAudiences(next)
      if (result.error) {
        onChange(previous)
        onNotice({ type: 'error', text: result.error })
        return
      }
      onRefresh()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider mr-1">
          Públicos que atiendes
        </span>
        {AUDIENCE_ORDER.map(a => {
          const active = audiences.includes(a)
          const isLast = active && audiences.length === 1
          return (
            <button
              key={a}
              type="button"
              aria-pressed={active}
              disabled={isPending || isLast}
              title={isLast ? 'Debes atender al menos un público.' : undefined}
              onClick={() => toggle(a)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                active ? '' : 'text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.03]'
              } ${isPending ? 'opacity-60 cursor-wait' : isLast ? 'cursor-not-allowed' : ''}`}
              style={active
                ? { background: 'var(--primary-color)', color: 'var(--bg-color)', borderColor: 'var(--primary-color)' }
                : { borderColor: 'var(--border-color)' }}
            >
              {AUDIENCE_LABELS[a].plural}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-xinuco-muted">
        Con más de uno, tus clientes eligen para quién es la cita al reservar.
      </p>
    </div>
  )
}

/** Badge del público del servicio + aviso si está oculto por público desactivado. */
function AudienceInfo({
  service, audiences, block,
}: { service: ServiceOverviewItem; audiences: ServiceAudience[]; block?: boolean }) {
  const hidden = !isServiceVisible(service, audiences)
  if (audiences.length <= 1 && !hidden) return null
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${block ? '' : 'mt-1'}`}>
      <span
        className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-xinuco-muted"
        style={{ border: '1px solid var(--border-color)' }}
      >
        {audienceBadgeLabel(serviceAudienceOf(service))}
      </span>
      {hidden && (
        <span className="text-[11px] text-amber-400/90">Oculto en reservas: público desactivado</span>
      )}
    </div>
  )
}

function Th({ children, center, right }: { children: React.ReactNode; center?: boolean; right?: boolean }) {
  return (
    <th className={`px-4 py-3.5 text-xs font-semibold text-xinuco-muted uppercase tracking-wider ${
      center ? 'text-center' : right ? 'text-right' : 'text-left'
    }`}>
      {children}
    </th>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// ACCIONES COMPARTIDAS (tabla + tarjetas)
// ════════════════════════════════════════════════════════════════════════════════

interface RowProps {
  service: ServiceOverviewItem
  staff: Staff[]
  audiences: ServiceAudience[]
  onEdit: (s: ServiceOverviewItem) => void
  onDuplicate: (s: ServiceOverviewItem) => void
  onOptimistic: (s: ServiceOverviewItem) => void
  onNotice: (n: Notice) => void
  onRefresh: () => void
}

function useServiceActions({ service, onOptimistic, onNotice, onRefresh }: RowProps) {
  const [isPendingToggle, startToggle] = useTransition()
  const [isPendingDelete, startDelete] = useTransition()

  /** Toggle de estado con UI optimista y rollback si el servidor rechaza. */
  function toggle() {
    const next = !service.is_active
    onOptimistic({ ...service, is_active: next })
    startToggle(async () => {
      const result = await setServiceActive(service.id, next)
      if (result.error) {
        onOptimistic({ ...service, is_active: !next })
        onNotice({ type: 'error', text: result.error })
        return
      }
      onRefresh()
    })
  }

  /** Eliminar (o archivar, según decida el servidor). */
  function remove() {
    if (!confirm(`¿Eliminar "${service.name}"? Si ya tiene citas o ventas se archivará en lugar de borrarse.`)) return
    startDelete(async () => {
      const result = await deleteService(service.id)
      if (result.error) {
        onNotice({ type: 'error', text: result.error })
        return
      }
      onNotice(
        result.archived
          ? { type: 'info', text: result.message ?? 'El servicio se archivó.' }
          : { type: 'success', text: 'Servicio eliminado.' },
      )
      onRefresh()
    })
  }

  return { toggle, remove, isPendingToggle, isPendingDelete, isPending: isPendingToggle || isPendingDelete }
}

function StatusSwitch({ active, pending, onClick }: { active: boolean; pending: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={active ? 'Servicio activo' : 'Servicio inactivo'}
      onClick={onClick}
      disabled={pending}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${pending ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
      style={{
        backgroundColor: active ? 'var(--primary-color)' : 'var(--surface-color, #333)',
        '--tw-ring-color': 'var(--primary-color)',
      } as React.CSSProperties}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
          active ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
      {pending && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={12} className="animate-spin text-white/70" />
        </span>
      )}
    </button>
  )
}

function ActionsMenu({
  service, pending, onEdit, onDuplicate, onToggle, onDelete,
}: {
  service: ServiceOverviewItem
  pending: boolean
  onEdit: () => void
  /** Solo se pasa cuando el negocio atiende más de un público. */
  onDuplicate?: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        disabled={pending}
        className="p-1.5 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.05] transition-colors disabled:opacity-40"
        aria-label={`Acciones para ${service.name}`}
      >
        {pending ? <Loader2 size={16} className="animate-spin" /> : <MoreVertical size={16} />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 w-44 rounded-xl shadow-2xl z-20 py-1.5 overflow-hidden animate-fade-in origin-top-right text-left"
            style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}
          >
            <button
              onClick={() => { setOpen(false); onEdit() }}
              className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs font-medium text-xinuco-text hover:bg-white/[0.04] transition-colors text-left"
            >
              <Pencil size={13} style={{ color: 'var(--primary-color)' }} />
              Editar
            </button>
            {onDuplicate && (
              <button
                onClick={() => { setOpen(false); onDuplicate() }}
                className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs font-medium text-xinuco-text hover:bg-white/[0.04] transition-colors text-left"
              >
                <Copy size={13} style={{ color: 'var(--primary-color)' }} />
                Duplicar
              </button>
            )}
            <button
              onClick={() => { setOpen(false); onToggle() }}
              className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs font-medium text-xinuco-text hover:bg-white/[0.04] transition-colors text-left"
            >
              <Power size={13} className={service.is_active ? 'text-amber-400' : 'text-emerald-400'} />
              {service.is_active ? 'Desactivar' : 'Activar'}
            </button>
            <div className="my-1 mx-3" style={{ borderTop: '1px solid var(--border-color)' }} />
            <button
              onClick={() => { setOpen(false); onDelete() }}
              className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs font-medium text-red-400 hover:bg-red-400/10 transition-colors text-left"
            >
              <Trash2 size={13} />
              Eliminar
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** "Todos" o hasta 3 avatares con iniciales + "+N". */
function StaffCell({ service, staff }: { service: ServiceOverviewItem; staff: Staff[] }) {
  if (staff.length === 0) return <span className="text-xinuco-muted">—</span>
  if (service.staff_ids.length >= staff.length) {
    return <span className="text-xs font-medium text-xinuco-muted">Todos</span>
  }
  const people = service.staff_ids
    .map(id => staff.find(s => s.id === id))
    .filter((s): s is Staff => Boolean(s))
  if (people.length === 0) return <span className="text-xinuco-muted">—</span>
  const shown = people.slice(0, 3)
  const extra = people.length - shown.length

  return (
    <div className="flex items-center" title={people.map(p => p.full_name).join(', ')}>
      <div className="flex -space-x-1.5">
        {shown.map(p => (
          <span
            key={p.id}
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-xinuco-text"
            style={{ background: 'var(--surface-color, #333)', border: '1px solid var(--border-color)' }}
          >
            {initials(p.full_name)}
          </span>
        ))}
      </div>
      {extra > 0 && <span className="ml-1.5 text-xs text-xinuco-muted">+{extra}</span>}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// FILA (desktop) y TARJETA (mobile)
// ════════════════════════════════════════════════════════════════════════════════

function ServiceRow(props: RowProps) {
  const { service, staff, audiences, onEdit, onDuplicate } = props
  const a = useServiceActions(props)

  return (
    <tr
      className="transition-all duration-200 hover:bg-white/[0.02]"
      style={{
        borderTop: '1px solid var(--border-color)',
        opacity: a.isPending ? 0.4 : service.is_active ? 1 : 0.55,
      }}
    >
      <td className="px-4 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-xinuco-text leading-tight">{service.name}</span>
          {service.description && (
            <span className="text-xs text-xinuco-muted line-clamp-1">{service.description}</span>
          )}
          <AudienceInfo service={service} audiences={audiences} />
        </div>
      </td>
      <td className="px-4 py-4">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-xinuco-muted whitespace-nowrap">
          <Clock size={13} style={{ color: 'var(--primary-color)' }} />
          {durationLabel(service)}
        </span>
      </td>
      <td className="px-4 py-4">
        <span className="font-semibold text-xinuco-text tabular-nums">{displayCOP(service.price_cop)}</span>
      </td>
      <td className="px-4 py-4">
        <span className="text-xs text-xinuco-muted tabular-nums whitespace-nowrap">{monthLabel(service)}</span>
      </td>
      <td className="px-4 py-4"><StaffCell service={service} staff={staff} /></td>
      <td className="px-4 py-4">
        <div className="flex items-center justify-center">
          <StatusSwitch active={service.is_active} pending={a.isPendingToggle} onClick={a.toggle} />
        </div>
      </td>
      <td className="px-4 py-4 text-right">
        <ActionsMenu
          service={service}
          pending={a.isPending}
          onEdit={() => onEdit(service)}
          onDuplicate={audiences.length > 1 ? () => onDuplicate(service) : undefined}
          onToggle={a.toggle}
          onDelete={a.remove}
        />
      </td>
    </tr>
  )
}

function ServiceCard(props: RowProps) {
  const { service, staff, audiences, onEdit, onDuplicate } = props
  const a = useServiceActions(props)

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3 transition-opacity"
      style={{
        border: '1px solid var(--border-color)',
        background: 'var(--surface-color, rgba(255,255,255,0.02))',
        opacity: a.isPending ? 0.4 : service.is_active ? 1 : 0.55,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-medium text-xinuco-text leading-tight">{service.name}</span>
          {service.description && (
            <span className="text-xs text-xinuco-muted line-clamp-2">{service.description}</span>
          )}
          <AudienceInfo service={service} audiences={audiences} />
        </div>
        <ActionsMenu
          service={service}
          pending={a.isPending}
          onEdit={() => onEdit(service)}
          onDuplicate={audiences.length > 1 ? () => onDuplicate(service) : undefined}
          onToggle={a.toggle}
          onDelete={a.remove}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-xinuco-text tabular-nums">{displayCOP(service.price_cop)}</span>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-xinuco-muted">
          <Clock size={12} style={{ color: 'var(--primary-color)' }} />
          {durationLabel(service)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-xs text-xinuco-muted tabular-nums">
            <span className="uppercase tracking-wider text-[10px] mr-1.5">Este mes</span>
            {monthLabel(service)}
          </span>
          <StaffCell service={service} staff={staff} />
        </div>
        <StatusSwitch active={service.is_active} pending={a.isPendingToggle} onClick={a.toggle} />
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// SHEET PANEL — Crear / Editar Servicio
// ════════════════════════════════════════════════════════════════════════════════

function ServiceSheet({
  service,
  draft,
  audiences,
  defaultAudience,
  staff,
  workstations,
  onClose,
  onSaved,
}: {
  service: ServiceOverviewItem | null
  /** Prellenado para "Duplicar" (solo al crear). */
  draft: ServiceDraft | null
  audiences: ServiceAudience[]
  defaultAudience: ServiceAudience
  staff: Staff[]
  workstations: Workstation[]
  onClose: () => void
  onSaved: () => void
}) {
  const isEditing = Boolean(service)
  const backdropRef = useRef<HTMLDivElement>(null)

  // Al editar se usa el servicio; al duplicar, el borrador; si no, formulario vacío.
  const src = service ?? draft

  const allStaffInitially = !src || staff.length === 0 || src.staff_ids.length >= staff.length

  // Público: opciones = activos + unisex (+ el actual si ya no está activo)
  const initialAudience: ServiceAudienceOrAll =
    service ? serviceAudienceOf(service) : draft?.audience ?? defaultAudience
  const audienceOptions: ServiceAudienceOrAll[] = [
    ...audiences, 'all' as const,
    ...(initialAudience !== 'all' && !audiences.includes(initialAudience) ? [initialAudience] : []),
  ]
  const showAudienceField =
    audiences.length > 1 || (Boolean(service) && initialAudience !== audiences[0])

  const [audience, setAudience]         = useState<ServiceAudienceOrAll>(initialAudience)
  const [name, setName]                 = useState(src?.name ?? '')
  const [description, setDesc]          = useState(src?.description ?? '')
  const [duration, setDuration]         = useState(String(src?.duration_minutes ?? '30'))
  const [buffer, setBuffer]             = useState(String(src?.buffer_time_minutes ?? '0'))
  const [priceDisplay, setPriceDisplay] = useState(src?.price_cop ? formatCOP(src.price_cop) : '')
  const [staffMode, setStaffMode]       = useState<'all' | 'some'>(allStaffInitially ? 'all' : 'some')
  const [staffSel, setStaffSel]         = useState<string[]>(allStaffInitially ? [] : src!.staff_ids)
  const [wsSel, setWsSel]               = useState<string[]>(src?.workstation_ids ?? [])
  const [formError, setFormError]       = useState<string | null>(null)
  const [isPending, startTransition]    = useTransition()

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const handlePriceChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '')
    setPriceDisplay(digits ? '$ ' + parseInt(digits, 10).toLocaleString('es-CO') : '')
  }, [])

  const toggleIn = (list: string[], id: string) =>
    list.includes(id) ? list.filter(x => x !== id) : [...list, id]

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (staffMode === 'some' && staffSel.length === 0) {
      return setFormError('Elige al menos un barbero o selecciona "Todos los barberos".')
    }

    const input = {
      name:                name.trim(),
      description:         description.trim() || null,
      duration_minutes:    parseInt(duration, 10),
      buffer_time_minutes: buffer.trim() === '' ? 0 : parseInt(buffer, 10),
      price_cop:           parseCOP(priceDisplay),
      audience,
      staff_ids:           staffMode === 'all' || staffSel.length >= staff.length ? ('all' as const) : staffSel,
      workstation_ids:     wsSel,
    }

    startTransition(async () => {
      try {
        const result = isEditing && service
          ? await updateService(service.id, input)
          : await createService(input)
        if (result.error) { setFormError(result.error); return }
        onSaved()
      } catch (err: unknown) {
        setFormError((err as Error)?.message ?? 'Error inesperado. Intenta de nuevo.')
      }
    })
  }

  const label = 'text-xs font-semibold text-xinuco-muted uppercase tracking-wider'

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        className="h-dvh overflow-y-auto pb-[env(safe-area-inset-bottom)] animate-slide-in-right w-[95vw] sm:w-[450px]"
        style={{ background: 'var(--bg-color)', borderLeft: '1px solid var(--border-color)' }}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-5"
          style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-color)' }}
        >
          <div>
            <h2 className="text-lg font-bold text-xinuco-text">
              {isEditing ? 'Editar Servicio' : 'Nuevo Servicio'}
            </h2>
            <p className="text-xs text-xinuco-muted mt-0.5">
              {isEditing ? 'Actualiza los datos del servicio.' : 'Configura un nuevo servicio para tu catálogo.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.05] transition-colors"
            aria-label="Cerrar panel"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="svc-name" className={label}>Nombre del servicio *</label>
            <input
              id="svc-name" type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Corte Clásico" required autoFocus maxLength={80} className="input-base"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="svc-desc" className={label}>
              Descripción <span className="normal-case opacity-50">(opcional)</span>
            </label>
            <textarea
              id="svc-desc" value={description} onChange={(e) => setDesc(e.target.value)}
              placeholder="Describe brevemente el servicio..." rows={3} maxLength={300}
              className="input-base resize-none"
            />
          </div>

          {showAudienceField && (
            <div className="flex flex-col gap-2">
              <label htmlFor="svc-audience" className={label}>Para</label>
              <select
                id="svc-audience" value={audience}
                onChange={(e) => setAudience(e.target.value as ServiceAudienceOrAll)}
                className="input-base"
              >
                {audienceOptions.map(a => (
                  <option key={a} value={a}>{a === 'all' ? AUDIENCE_LABELS.all.plural : AUDIENCE_LABELS[a].singular}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="svc-duration" className={label}>Duración (min) *</label>
              <input
                id="svc-duration" type="number" min={5} max={480} value={duration}
                onChange={(e) => setDuration(e.target.value)} placeholder="30" required className="input-base"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="svc-price" className={label}>Precio (COP) *</label>
              <input
                id="svc-price" type="text" inputMode="numeric" value={priceDisplay}
                onChange={handlePriceChange} placeholder="$ 25.000" required className="input-base tabular-nums"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="svc-buffer" className={label}>Limpieza entre citas (min)</label>
            <input
              id="svc-buffer" type="number" min={0} max={60} value={buffer}
              onChange={(e) => setBuffer(e.target.value)} placeholder="0" className="input-base"
            />
            <p className="text-xs text-xinuco-muted">Tiempo para limpiar antes del siguiente cliente</p>
          </div>

          {/* ¿Quién lo hace? */}
          <fieldset className="flex flex-col gap-3">
            <legend className={`${label} mb-2`}>¿Quién lo hace?</legend>
            <label className="flex items-center gap-2.5 text-sm text-xinuco-text cursor-pointer">
              <input
                type="radio" name="svc-staff-mode" checked={staffMode === 'all'}
                onChange={() => setStaffMode('all')}
              />
              Todos los barberos
            </label>
            <label className="flex items-center gap-2.5 text-sm text-xinuco-text cursor-pointer">
              <input
                type="radio" name="svc-staff-mode" checked={staffMode === 'some'}
                onChange={() => setStaffMode('some')}
              />
              Solo algunos
            </label>

            {staffMode === 'some' && (
              <div
                className="flex flex-col gap-1 rounded-lg p-2 ml-6"
                style={{ border: '1px solid var(--border-color)' }}
              >
                {staff.length === 0 ? (
                  <p className="text-xs text-xinuco-muted px-2 py-1.5">No hay barberos activos.</p>
                ) : staff.map(s => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2.5 text-sm text-xinuco-text px-2 py-1.5 rounded-md hover:bg-white/[0.03] cursor-pointer"
                  >
                    <input
                      type="checkbox" checked={staffSel.includes(s.id)}
                      onChange={() => setStaffSel(prev => toggleIn(prev, s.id))}
                    />
                    {s.full_name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {/* Estaciones — solo si el negocio tiene */}
          {workstations.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className={`${label} mb-2`}>Estaciones</legend>
              <div
                className="flex flex-col gap-1 rounded-lg p-2"
                style={{ border: '1px solid var(--border-color)' }}
              >
                {workstations.map(w => (
                  <label
                    key={w.id}
                    className="flex items-center gap-2.5 text-sm text-xinuco-text px-2 py-1.5 rounded-md hover:bg-white/[0.03] cursor-pointer"
                  >
                    <input
                      type="checkbox" checked={wsSel.includes(w.id)}
                      onChange={() => setWsSel(prev => toggleIn(prev, w.id))}
                    />
                    {w.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-xinuco-muted">Si eliges estaciones, solo se agenda cuando alguna esté libre</p>
            </fieldset>
          )}

          {formError && (
            <p
              role="alert"
              className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5 animate-fade-in"
            >
              {formError}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 py-3 rounded-lg text-sm font-medium text-xinuco-muted border transition-colors hover:text-xinuco-text hover:bg-white/[0.03]"
              style={{ borderColor: 'var(--border-color)' }}
            >
              Cancelar
            </button>
            <button
              id="btn-save-service" type="submit" disabled={isPending}
              className="flex-1 btn-primary !py-3 flex items-center justify-center gap-2"
            >
              {isPending ? (
                <><Loader2 size={15} className="animate-spin" />Guardando…</>
              ) : (
                <><Save size={15} />{isEditing ? 'Actualizar' : 'Guardar'}</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
