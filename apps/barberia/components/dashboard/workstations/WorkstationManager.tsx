'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, X, Loader2, Armchair, Pencil, Trash2, Save, CheckCircle2, AlertCircle, Info,
} from 'lucide-react'
import {
  createWorkstation, updateWorkstation, setWorkstationActive, deleteWorkstation,
  type WorkstationOverviewItem, type WorkstationsOverview,
} from '@/actions/workstations'
import { AUDIENCE_LABELS } from '@/lib/service-audience'
import { AdminPageHeader, AdminEmptyState } from '@xinuco/ui'

type Notice = { type: 'success' | 'error'; text: string }
type ServiceOption = WorkstationsOverview['services'][number]

const EXPLAIN_SHARED =
  'Registra solo lo que se comparte. Si tienes 1 lavacabezas, dos clientes no pueden usarlo a la vez aunque los atiendan barberos distintos. ' +
  'Las sillas de cada barbero no hace falta registrarlas: eso ya lo controla su horario.'
const EXPLAIN_CAPACITY = 'Con 2 estaciones iguales (ej. 2 sillas de niños) caben 2 citas a la vez.'

// ════════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL — WorkstationManager (Client Island)
// ════════════════════════════════════════════════════════════════════════════════

export function WorkstationManager({ overview }: { overview: WorkstationsOverview }) {
  const router = useRouter()
  const { services, audiences } = overview
  const [stations, setStations] = useState<WorkstationOverviewItem[]>(overview.workstations)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<WorkstationOverviewItem | null>(null)
  const [toDelete, setToDelete] = useState<WorkstationOverviewItem | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  // La fuente de verdad es el servidor: al hacer router.refresh() llegan props nuevas.
  useEffect(() => { setStations(overview.workstations) }, [overview.workstations])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(t)
  }, [notice])

  const multiAudience = audiences.length > 1

  const handleCreate = () => { setEditing(null); setSheetOpen(true) }
  const handleEdit = (w: WorkstationOverviewItem) => { setEditing(w); setSheetOpen(true) }
  const handleClose = () => { setSheetOpen(false); setEditing(null) }

  const handleSaved = () => {
    setNotice({ type: 'success', text: editing ? 'Estación actualizada.' : 'Estación creada.' })
    setSheetOpen(false)
    setEditing(null)
    router.refresh()
  }

  const handleDeleted = () => {
    setToDelete(null)
    setNotice({ type: 'success', text: 'Estación eliminada.' })
    router.refresh()
  }

  return (
    <>
      <AdminPageHeader
        title="Estaciones"
        subtitle="Espacios que se comparten: lavacabezas, sillón de tinte, silla de niños…"
        hasData={stations.length > 0}
        actionButton={
          <button onClick={handleCreate} className="btn-primary flex items-center gap-2 animate-fade-in">
            <Plus size={16} strokeWidth={2.5} />
            <span className="hidden sm:inline">Nueva estación</span>
            <span className="sm:hidden">Nueva</span>
          </button>
        }
      />

      {notice && (
        <div
          role="status"
          className={`flex items-start gap-2.5 text-sm rounded-lg px-4 py-3 border animate-fade-in ${
            notice.type === 'error'
              ? 'text-red-400 bg-red-400/10 border-red-400/20'
              : 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
          }`}
        >
          {notice.type === 'error'
            ? <AlertCircle size={16} className="mt-0.5 shrink-0" />
            : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Cerrar aviso" className="opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Cómo funcionan las estaciones */}
      {stations.length > 0 && (
        <div
          className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm text-xinuco-muted"
          style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color)' }}
        >
          <Info size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--primary-color)' }} />
          <div className="flex flex-col gap-1.5 leading-relaxed">
            <p>{EXPLAIN_SHARED}</p>
            <p>{EXPLAIN_CAPACITY}</p>
          </div>
        </div>
      )}

      <section aria-label="Lista de estaciones">
        {stations.length === 0 ? (
          <AdminEmptyState
            icon={Armchair}
            title="Aún no tienes estaciones"
            description={`${EXPLAIN_SHARED} ${EXPLAIN_CAPACITY}`}
            actionLabel="Nueva estación"
            onAction={handleCreate}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 animate-fade-in">
            {stations.map(station => (
              <StationCard
                key={station.id}
                station={station}
                services={services}
                showAudience={multiAudience}
                onOptimistic={updated =>
                  setStations(prev => prev.map(w => (w.id === updated.id ? updated : w)))}
                onEdit={() => handleEdit(station)}
                onDelete={() => setToDelete(station)}
                onNotice={setNotice}
                onRefresh={() => router.refresh()}
              />
            ))}
          </div>
        )}
      </section>

      {sheetOpen && (
        <WorkstationSheet
          station={editing}
          services={services}
          showAudience={multiAudience}
          onClose={handleClose}
          onSaved={handleSaved}
        />
      )}

      {toDelete && (
        <ConfirmDelete
          station={toDelete}
          onCancel={() => setToDelete(null)}
          onDeleted={handleDeleted}
        />
      )}
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// TARJETA DE ESTACIÓN
// ════════════════════════════════════════════════════════════════════════════════

function audienceTag(s: ServiceOption): string {
  return s.audience === 'all' ? 'Unisex' : (AUDIENCE_LABELS[s.audience]?.singular ?? '')
}

function StationCard({
  station, services, showAudience, onOptimistic, onEdit, onDelete, onNotice, onRefresh,
}: {
  station: WorkstationOverviewItem
  services: ServiceOption[]
  showAudience: boolean
  onOptimistic: (w: WorkstationOverviewItem) => void
  onEdit: () => void
  onDelete: () => void
  onNotice: (n: Notice) => void
  onRefresh: () => void
}) {
  const [isPending, startToggle] = useTransition()

  // Solo se listan servicios activos; los inactivos no aparecen en el formulario.
  const linked = services.filter(s => station.service_ids.includes(s.id))

  /** Toggle con UI optimista y rollback si el servidor rechaza. */
  function toggle() {
    const next = !station.is_active
    onOptimistic({ ...station, is_active: next })
    startToggle(async () => {
      const result = await setWorkstationActive(station.id, next)
      if (result.error) {
        onOptimistic({ ...station, is_active: !next })
        onNotice({ type: 'error', text: result.error })
        return
      }
      onRefresh()
    })
  }

  return (
    <article
      className="rounded-xl p-5 flex flex-col gap-4 transition-opacity"
      style={{
        border: '1px solid var(--border-color)',
        background: 'var(--surface-color)',
        opacity: station.is_active ? 1 : 0.7,
      }}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="shrink-0 w-2 h-2 rounded-full"
            style={{ background: station.is_active ? 'var(--primary-color)' : 'var(--border-color, #333)' }}
          />
          <h3 className="font-semibold text-xinuco-text leading-tight truncate">{station.name}</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-xinuco-muted">{station.is_active ? 'Activa' : 'Inactiva'}</span>
          <button
            type="button"
            role="switch"
            aria-checked={station.is_active}
            aria-label={station.is_active ? 'Estación activa' : 'Estación inactiva'}
            onClick={toggle}
            disabled={isPending}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${isPending ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
            style={{
              backgroundColor: station.is_active ? 'var(--primary-color)' : 'var(--surface-color, #333)',
              border: '1px solid var(--border-color)',
              '--tw-ring-color': 'var(--primary-color)',
            } as React.CSSProperties}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                station.is_active ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </header>

      {/* Servicios que la necesitan */}
      <div className="flex flex-wrap gap-1.5">
        {linked.length === 0 ? (
          <span className="text-xs text-xinuco-muted">Ningún servicio la usa todavía</span>
        ) : (
          linked.map(s => (
            <span
              key={s.id}
              className="text-xs font-medium text-xinuco-text px-2.5 py-1 rounded-full"
              style={{ border: '1px solid var(--border-color)' }}
            >
              {s.name}{showAudience && audienceTag(s) ? ` · ${audienceTag(s)}` : ''}
            </span>
          ))
        )}
      </div>

      <p className="text-xs text-xinuco-muted">
        {station.in_use === 0
          ? 'Sin citas próximas'
          : `${station.in_use} ${station.in_use === 1 ? 'cita próxima la usa' : 'citas próximas la usan'}`}
      </p>

      <footer className="flex items-center gap-2 pt-1">
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-xinuco-text border transition-colors hover:bg-white/[0.04]"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <Pencil size={13} style={{ color: 'var(--primary-color)' }} />
          Editar
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 border transition-colors hover:bg-red-400/10"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <Trash2 size={13} />
          Eliminar
        </button>
      </footer>
    </article>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// CONFIRMACIÓN DE ELIMINAR (in-app)
// ════════════════════════════════════════════════════════════════════════════════

function ConfirmDelete({
  station, onCancel, onDeleted,
}: {
  station: WorkstationOverviewItem
  onCancel: () => void
  onDeleted: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isPending) onCancel() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel, isPending])

  function confirmDelete() {
    setError(null)
    startTransition(async () => {
      const result = await deleteWorkstation(station.id)
      if (result.error) { setError(result.error); return }
      onDeleted()
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget && !isPending) onCancel() }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ws-delete-title"
        className="w-full max-w-sm rounded-xl p-6 flex flex-col gap-4 animate-fade-in"
        style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}
      >
        <div className="flex flex-col gap-2">
          <h2 id="ws-delete-title" className="text-lg font-bold text-xinuco-text">
            ¿Eliminar &quot;{station.name}&quot;?
          </h2>
          <p className="text-sm text-xinuco-muted">
            Se quitará de los servicios que la usan. Las citas no cambian.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium text-xinuco-muted border transition-colors hover:text-xinuco-text hover:bg-white/[0.03]"
            style={{ borderColor: 'var(--border-color)' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={isPending}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isPending ? <><Loader2 size={15} className="animate-spin" />Eliminando…</> : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// SHEET PANEL — Crear / Editar estación
// ════════════════════════════════════════════════════════════════════════════════

function WorkstationSheet({
  station, services, showAudience, onClose, onSaved,
}: {
  station: WorkstationOverviewItem | null
  services: ServiceOption[]
  showAudience: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const isEditing = Boolean(station)
  const backdropRef = useRef<HTMLDivElement>(null)

  const [name, setName] = useState(station?.name ?? '')
  const [selected, setSelected] = useState<string[]>(station?.service_ids ?? [])
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Servicios ya vinculados que ya no están activos: se conservan al guardar.
  const activeIds = new Set(services.map(s => s.id))
  const hiddenLinked = (station?.service_ids ?? []).filter(id => !activeIds.has(id))

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const toggleService = (id: string) =>
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 40) {
      return setFormError('El nombre debe tener entre 2 y 40 caracteres.')
    }

    const payload = { name: trimmed, service_ids: [...selected, ...hiddenLinked] }
    startTransition(async () => {
      try {
        const result = station
          ? await updateWorkstation(station.id, payload)
          : await createWorkstation(payload)
        if (result.error) { setFormError(result.error); return }
        onSaved()
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : 'Error inesperado. Intenta de nuevo.')
      }
    })
  }

  const label = 'text-xs font-semibold text-xinuco-muted uppercase tracking-wider'

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        className="h-full overflow-y-auto animate-slide-in-right w-[95vw] sm:w-[420px]"
        style={{ background: 'var(--bg-color)', borderLeft: '1px solid var(--border-color)' }}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-5"
          style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-color)' }}
        >
          <div>
            <h2 className="text-lg font-bold text-xinuco-text">
              {isEditing ? 'Editar estación' : 'Nueva estación'}
            </h2>
            <p className="text-xs text-xinuco-muted mt-0.5">
              Un espacio que se comparte entre barberos.
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
            <label htmlFor="ws-name" className={label}>Nombre *</label>
            <input
              id="ws-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej: Lavacabezas"
              maxLength={40}
              required
              autoFocus
              className="input-base"
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className={`${label} mb-2`}>¿Qué servicios la necesitan?</legend>
            {services.length === 0 ? (
              <p className="text-xs text-xinuco-muted">
                Aún no tienes servicios activos. Crea uno en Servicios y vuelve aquí.
              </p>
            ) : (
              <div
                className="flex flex-col gap-1 rounded-lg p-2 max-h-72 overflow-y-auto"
                style={{ border: '1px solid var(--border-color)' }}
              >
                {services.map(s => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2.5 text-sm text-xinuco-text px-2 py-1.5 rounded-md hover:bg-white/[0.03] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(s.id)}
                      onChange={() => toggleService(s.id)}
                    />
                    <span className="flex-1">{s.name}</span>
                    {showAudience && audienceTag(s) && (
                      <span
                        className="text-[11px] text-xinuco-muted px-2 py-0.5 rounded-full"
                        style={{ border: '1px solid var(--border-color)' }}
                      >
                        {audienceTag(s)}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-xinuco-muted">
              Si marcas varias estaciones iguales para un servicio, se suma la capacidad.
            </p>
          </fieldset>

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
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-lg text-sm font-medium text-xinuco-muted border transition-colors hover:text-xinuco-text hover:bg-white/[0.03]"
              style={{ borderColor: 'var(--border-color)' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 btn-primary !py-3 flex items-center justify-center gap-2"
            >
              {isPending
                ? <><Loader2 size={15} className="animate-spin" />Guardando…</>
                : <><Save size={15} />{isEditing ? 'Actualizar' : 'Guardar'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
