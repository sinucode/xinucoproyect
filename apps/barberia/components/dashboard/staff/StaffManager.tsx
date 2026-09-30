'use client'

// StaffManager — Página "Equipo": tarjetas de profesionales con estado ahora, horario,
// servicios, actividad del mes y próxima cita. Alta/edición en un sheet; horario, descansos
// y permisos en StaffScheduleSheet.

import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, X, Loader2, Users, Scissors, Clock, CalendarCheck, CalendarClock,
  Pencil, CalendarDays, AlertTriangle, UserCheck, UserX, Mail, Phone,
} from 'lucide-react'
import { createStaffMember, updateStaffMember, toggleStaffStatus } from '@/actions/staff'
import type { TeamMember, TeamOverview, LinkableUser } from '@/actions/staff'
import { StaffScheduleSheet } from './StaffScheduleSheet'
import { AdminPageHeader } from '@xinuco/ui'
import { AdminEmptyState } from '@xinuco/ui'
import { formatApptTime, apptDateKey, dayLabel } from '@/lib/agenda-time'
import { AUDIENCE_LABELS } from '@/lib/service-audience'
import {
  SPECIALTY_OPTIONS,
  STAFF_STATUS_LABELS,
  DEFAULT_END_TIME,
  DEFAULT_START_TIME,
  DEFAULT_WORK_DAYS,
  applyQuickSchedule,
  mostCommonSchedule,
  normalizeStaffEmail,
  normalizeStaffPhone,
  scheduleRowsToState,
  specialtyLabel,
  stateToScheduleRows,
  summarizeSchedule,
  validateWeeklySchedule,
  type WeeklyScheduleState,
} from '@/lib/team-utils'
import { WeeklyScheduleEditor } from './WeeklyScheduleEditor'

type TeamService = TeamOverview['services'][number]

// ════════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL — StaffManager
// ════════════════════════════════════════════════════════════════════════════════

interface StaffManagerProps {
  businessId: string
  members: TeamMember[]
  services: TeamService[]
  todayKey: string
  linkableUsers: LinkableUser[]
}

type SheetState = { mode: 'create' } | { mode: 'edit'; memberId: string } | null

export function StaffManager({ businessId, members, services, todayKey, linkableUsers }: StaffManagerProps) {
  const router = useRouter()
  const [list, setList] = useState<TeamMember[]>(members)
  const [sheet, setSheet] = useState<SheetState>(null)
  const [scheduleMemberId, setScheduleMemberId] = useState<string | null>(null)
  const [confirmMember, setConfirmMember] = useState<TeamMember | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [toggleErrors, setToggleErrors] = useState<Record<string, string>>({})

  // Tras router.refresh() llegan datos frescos del servidor
  useEffect(() => { setList(members) }, [members])

  const scheduleMember = scheduleMemberId ? list.find(m => m.id === scheduleMemberId) ?? null : null
  const editMember = sheet?.mode === 'edit' ? list.find(m => m.id === sheet.memberId) ?? null : null

  // Activar/desactivar con UI optimista y rollback si falla
  async function applyToggle(member: TeamMember, next: boolean) {
    setToggleErrors(prev => { const { [member.id]: _omit, ...rest } = prev; return rest })
    setPendingId(member.id)
    setList(prev => prev.map(m => (m.id === member.id ? { ...m, is_active: next, status: next ? m.status : null } : m)))

    try {
      const result = await toggleStaffStatus(member.id, next)
      if (result.error) {
        setList(prev => prev.map(m => (m.id === member.id ? { ...m, is_active: member.is_active, status: member.status } : m)))
        setToggleErrors(prev => ({ ...prev, [member.id]: result.error as string }))
      } else {
        router.refresh()
      }
    } catch {
      setList(prev => prev.map(m => (m.id === member.id ? { ...m, is_active: member.is_active, status: member.status } : m)))
      setToggleErrors(prev => ({ ...prev, [member.id]: 'No se pudo actualizar. Intenta de nuevo.' }))
    } finally {
      setPendingId(null)
    }
  }

  function requestToggle(member: TeamMember) {
    const next = !member.is_active
    // Desactivar a alguien con citas próximas pide confirmación
    if (!next && member.upcoming_count > 0) {
      setConfirmMember(member)
      return
    }
    void applyToggle(member, next)
  }

  return (
    <>
      <AdminPageHeader
        title="Tu equipo"
        subtitle="Profesionales, horarios y lo que hace cada uno"
        hasData={list.length > 0}
        actionButton={
          <button
            onClick={() => setSheet({ mode: 'create' })}
            className="btn-primary flex items-center justify-center gap-2"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span className="hidden sm:inline">Añadir profesional</span>
            <span className="sm:hidden">Añadir</span>
          </button>
        }
      />

      <section aria-label="Lista del equipo" className="mt-6">
        {list.length === 0 ? (
          <AdminEmptyState
            icon={Users}
            title="Aún no tienes a nadie en tu equipo"
            description="Añade a tu primer profesional para asignarle horarios y servicios."
            actionLabel="Añadir profesional"
            onAction={() => setSheet({ mode: 'create' })}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {list.map((member) => (
              <StaffCard
                key={member.id}
                member={member}
                services={services}
                todayKey={todayKey}
                isPending={pendingId === member.id}
                error={toggleErrors[member.id] ?? null}
                onToggle={() => requestToggle(member)}
                onEdit={() => setSheet({ mode: 'edit', memberId: member.id })}
                onOpenSchedule={() => setScheduleMemberId(member.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Sheet de alta / edición */}
      {sheet && (sheet.mode === 'create' || editMember) && (
        <StaffSheet
          mode={sheet.mode}
          businessId={businessId}
          member={editMember}
          services={services}
          members={list}
          linkableUsers={linkableUsers}
          onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); router.refresh() }}
        />
      )}

      {/* Sheet de horario, descansos y permisos */}
      {scheduleMember && (
        <StaffScheduleSheet
          businessId={businessId}
          staffId={scheduleMember.id}
          staffName={scheduleMember.full_name}
          schedules={scheduleMember.schedules}
          teamMembers={list.map(m => ({ id: m.id, full_name: m.full_name, is_active: m.is_active, schedules: m.schedules }))}
          todayKey={todayKey}
          onClose={() => setScheduleMemberId(null)}
        />
      )}

      {/* Confirmación al desactivar con citas próximas */}
      {confirmMember && (
        <ConfirmDeactivate
          member={confirmMember}
          onCancel={() => setConfirmMember(null)}
          onConfirm={() => {
            const m = confirmMember
            setConfirmMember(null)
            void applyToggle(m, false)
          }}
        />
      )}
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// TARJETA DE PROFESIONAL (StaffCard)
// ════════════════════════════════════════════════════════════════════════════════

const STATUS_STYLES: Record<NonNullable<TeamMember['status']>, string> = {
  free:     'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  busy:     'bg-amber-500/15 text-amber-400 border-amber-500/30',
  break:    'bg-sky-500/15 text-sky-400 border-sky-500/30',
  time_off: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  off:      'bg-white/5 text-xinuco-muted border-white/10',
}

function StatusPill({ member }: { member: TeamMember }) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border w-fit'

  if (!member.is_active) {
    return <span className={`${base} ${STATUS_STYLES.off}`}>Inactivo</span>
  }
  if (!member.status) return null

  let text: string = STAFF_STATUS_LABELS[member.status]
  if (member.status === 'busy' && member.busy_until) {
    text = `${text} · hasta ${formatApptTime(member.busy_until)}`
  }
  const title = member.status === 'busy' && member.customer_name ? `Con ${member.customer_name}` : undefined

  return <span className={`${base} ${STATUS_STYLES[member.status]}`} title={title}>{text}</span>
}

function StaffCard({
  member,
  services,
  todayKey,
  isPending,
  error,
  onToggle,
  onEdit,
  onOpenSchedule,
}: {
  member: TeamMember
  services: TeamService[]
  todayKey: string
  isPending: boolean
  error: string | null
  onToggle: () => void
  onEdit: () => void
  onOpenSchedule: () => void
}) {
  const initials = member.full_name
    .split(' ')
    .filter(Boolean)
    .map(n => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase()

  // Solo cuentan los servicios activos del negocio
  const activeIds = new Set(services.map(s => s.id))
  const serviceCount = member.service_ids.filter(id => activeIds.has(id)).length
  const servicesText = member.does_all_services
    ? 'Todos los servicios'
    : `${serviceCount} ${serviceCount === 1 ? 'servicio' : 'servicios'}`

  const monthText = `Este mes: ${member.month_completed} ${member.month_completed === 1 ? 'cita' : 'citas'}`
  const nextText = member.next_appointment
    ? `Próxima: ${dayLabel(apptDateKey(member.next_appointment), todayKey)} ${formatApptTime(member.next_appointment)}`
    : 'Sin citas próximas'

  return (
    <div
      className={`card flex flex-col gap-4 transition-all duration-300 ${!member.is_active ? 'opacity-60' : ''} ${isPending ? 'cursor-wait' : ''}`}
    >
      {/* Top: avatar, nombre, cargo y switch */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3.5 min-w-0">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 font-bold text-sm tracking-widest shadow-inner"
            style={{
              background: 'color-mix(in srgb, var(--primary-color) 15%, transparent)',
              color: 'var(--primary-color)',
            }}
          >
            {initials}
          </div>

          <div className="flex flex-col min-w-0">
            <h3 className="font-bold text-xinuco-text text-base leading-tight break-words">
              {member.full_name}
            </h3>
            <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border bg-white/5 border-white/10 text-xinuco-muted w-fit">
              <Scissors size={10} />
              {specialtyLabel(member.specialty_role)}
            </span>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={member.is_active}
          aria-label={member.is_active ? `Desactivar a ${member.full_name}` : `Activar a ${member.full_name}`}
          onClick={onToggle}
          disabled={isPending}
          className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed"
          style={{
            backgroundColor: member.is_active ? 'var(--primary-color)' : 'var(--surface-color, #333)',
          }}
          title={member.is_active ? 'Desactivar profesional' : 'Activar profesional'}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
              member.is_active ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
          {isPending && (
            <span className="absolute inset-0 flex items-center justify-center">
              <Loader2 size={12} className="animate-spin text-white/70" />
            </span>
          )}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusPill member={member} />
        <span
          className="inline-flex items-center gap-1 text-[11px] text-xinuco-muted"
          title={member.user_id ? 'Puede ver su cuenta en "Mi cuenta"' : 'Aún no puede ver su cuenta: vincúlale un usuario al editarlo'}
        >
          {member.user_id ? <UserCheck size={11} /> : <UserX size={11} />}
          {member.user_id ? 'Tiene usuario' : 'Sin usuario'}
        </span>
        {member.email && (
          <span className="inline-flex items-center text-xinuco-muted" title={`Correo: ${member.email}`} aria-label={`Correo: ${member.email}`}>
            <Mail size={11} />
          </span>
        )}
        {member.phone && (
          <span className="inline-flex items-center text-xinuco-muted" title={`WhatsApp: ${member.phone}`} aria-label={`WhatsApp: ${member.phone}`}>
            <Phone size={11} />
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Información */}
      <ul className="flex flex-col gap-2 text-xs text-xinuco-muted">
        <InfoLine icon={<Clock size={13} />} text={summarizeSchedule(member.schedules)} />
        <InfoLine icon={<Scissors size={13} />} text={servicesText} />
        <InfoLine icon={<CalendarCheck size={13} />} text={monthText} />
        <InfoLine icon={<CalendarClock size={13} />} text={nextText} />
      </ul>

      <div className="h-px w-full" style={{ background: 'var(--border-color)' }} />

      {/* Acciones */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex-1 btn-ghost !py-2 !px-3 text-xs flex items-center justify-center gap-2"
          onClick={onEdit}
        >
          <Pencil size={14} />
          Editar
        </button>
        <button
          type="button"
          className="flex-1 btn-ghost !py-2 !px-3 text-xs flex items-center justify-center gap-2"
          onClick={onOpenSchedule}
        >
          <CalendarDays size={14} />
          Horario
        </button>
      </div>
    </div>
  )
}

function InfoLine({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-px shrink-0" aria-hidden="true">{icon}</span>
      <span className="min-w-0 break-words">{text}</span>
    </li>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// DIÁLOGO — confirmar desactivación
// ════════════════════════════════════════════════════════════════════════════════

function ConfirmDeactivate({
  member,
  onCancel,
  onConfirm,
}: {
  member: TeamMember
  onCancel: () => void
  onConfirm: () => void
}) {
  const n = member.upcoming_count

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="deactivate-title"
        aria-describedby="deactivate-desc"
        className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-4 animate-fade-in"
        style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}
      >
        <div className="flex items-start gap-3">
          <span className="p-2 rounded-full bg-red-500/10 text-red-400 shrink-0">
            <AlertTriangle size={18} />
          </span>
          <div className="flex flex-col gap-2">
            <h2 id="deactivate-title" className="text-lg font-bold text-xinuco-text">
              ¿Desactivar a {member.full_name}?
            </h2>
            <p id="deactivate-desc" className="text-sm text-xinuco-muted">
              Tiene {n} {n === 1 ? 'cita próxima' : 'citas próximas'}. Desactivarlo no {n === 1 ? 'la cancela' : 'las cancela'}:
              reasígnalas o cancélalas desde la Agenda. Tampoco aparecerá en la reserva en línea ni en la Fila de espera.
            </p>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="flex-1 py-2.5 rounded-lg text-sm font-medium text-xinuco-muted border transition-colors hover:text-xinuco-text hover:bg-white/[0.03]"
            style={{ borderColor: 'var(--border-color)' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors"
          >
            Desactivar
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// SHEET PANEL — CREAR / EDITAR PROFESIONAL
// ════════════════════════════════════════════════════════════════════════════════

const ROLE_OTHER = '__other__'

function initialRoleState(member: TeamMember | null): { choice: string; other: string } {
  if (!member) return { choice: '', other: '' }
  const label = specialtyLabel(member.specialty_role)
  if ((SPECIALTY_OPTIONS as readonly string[]).includes(label)) return { choice: label, other: '' }
  return { choice: ROLE_OTHER, other: member.specialty_role?.trim() ?? '' }
}

function StaffSheet({
  mode,
  businessId,
  member,
  services,
  members,
  linkableUsers,
  onClose,
  onDone,
}: {
  mode: 'create' | 'edit'
  businessId: string
  member: TeamMember | null
  services: TeamService[]
  members: TeamMember[]
  linkableUsers: LinkableUser[]
  onClose: () => void
  onDone: () => void
}) {
  const backdropRef = useRef<HTMLDivElement>(null)

  const initialRole = initialRoleState(member)
  const activeIds = new Set(services.map(s => s.id))

  const [name, setName] = useState(member?.full_name ?? '')
  const [roleChoice, setRoleChoice] = useState(initialRole.choice)
  const [roleOther, setRoleOther] = useState(initialRole.other)
  const [servicesMode, setServicesMode] = useState<'all' | 'some'>(
    member && !member.does_all_services ? 'some' : 'all',
  )
  const [selected, setSelected] = useState<Set<string>>(
    new Set((member?.service_ids ?? []).filter(id => activeIds.has(id))),
  )
  // Horario (solo al crear): el más común del equipo activo, o Lun–Sáb 9:00–19:00
  const [scheduleState, setScheduleState] = useState<WeeklyScheduleState>(() => {
    const common = mostCommonSchedule(members)
    return common
      ? scheduleRowsToState(common)
      : applyQuickSchedule(scheduleRowsToState([]), DEFAULT_WORK_DAYS, DEFAULT_START_TIME, DEFAULT_END_TIME)
  })
  const [copyFrom, setCopyFrom] = useState('')
  // Usuario para iniciar sesión ('' = sin usuario). Solo al editar.
  const [userId, setUserId] = useState(member?.user_id ?? '')
  // Contacto opcional: el correo recibe los recibos de anticipos y pagos; el celular abre su WhatsApp
  const [email, setEmail] = useState(member?.email ?? '')
  const [phone, setPhone] = useState(member?.phone ?? '')
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Libres o el ya vinculado a este profesional
  const userOptions = linkableUsers.filter(u => !u.linked_staff_id || u.linked_staff_id === member?.id)

  // Etiqueta de público solo si hay más de uno entre los servicios
  const showAudience = new Set(services.map(s => s.audience)).size > 1

  // Cerrar con ESC
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Bloquear scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  function toggleService(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const fullName = name.trim()
    const role = (roleChoice === ROLE_OTHER ? roleOther : roleChoice).trim()

    if (fullName.length < 2 || fullName.length > 80) return setFormError('El nombre debe tener entre 2 y 80 caracteres.')
    if (!roleChoice) return setFormError('Elige un cargo.')
    if (role.length < 2 || role.length > 40) return setFormError('El cargo debe tener entre 2 y 40 caracteres.')
    if (servicesMode === 'some' && selected.size === 0) {
      return setFormError('Elige al menos un servicio o "Todos los servicios".')
    }

    const emailResult = normalizeStaffEmail(email)
    if ('error' in emailResult) return setFormError(emailResult.error)
    const phoneResult = normalizeStaffPhone(phone)
    if ('error' in phoneResult) return setFormError(phoneResult.error)

    const serviceIds: string[] | 'all' = servicesMode === 'all' ? 'all' : Array.from(selected)

    const scheduleRows = stateToScheduleRows(scheduleState)
    if (mode === 'create') {
      const scheduleError = validateWeeklySchedule(scheduleRows)
      if (scheduleError) return setFormError(scheduleError)
    }

    startTransition(async () => {
      try {
        const result = mode === 'edit' && member
          ? await updateStaffMember(member.id, {
              full_name: fullName,
              specialty_role: role,
              service_ids: serviceIds,
              email: emailResult.value,
              phone: phoneResult.value,
              // Solo se envía si cambió: así editar el nombre no toca el vínculo
              ...((member.user_id ?? '') !== userId ? { user_id: userId || null } : {}),
            })
          : await createStaffMember(businessId, {
              full_name: fullName, specialty_role: role, email: emailResult.value, phone: phoneResult.value,
              service_ids: serviceIds, schedules: scheduleRows,
            })

        if (result.error) {
          setFormError(result.error)
          return
        }
        onDone()
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : 'Error inesperado al guardar.')
      }
    })
  }

  const title = mode === 'edit' ? 'Editar profesional' : 'Añadir profesional'

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        className="h-full overflow-y-auto animate-slide-in-right w-[95vw] sm:w-[450px]"
        style={{ background: 'var(--bg-color)', borderLeft: '1px solid var(--border-color)' }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-color)' }}>
          <div>
            <h2 className="text-lg font-bold text-xinuco-text">{title}</h2>
            <p className="text-xs text-xinuco-muted mt-0.5">
              {mode === 'edit' ? 'Actualiza sus datos y lo que hace.' : 'Registra a una nueva persona en tu equipo.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-2 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.05] transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-6">
          {/* Nombre */}
          <div className="flex flex-col gap-2">
            <label htmlFor="staff-name" className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
              Nombre completo *
            </label>
            <input
              id="staff-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Carlos Ramírez"
              maxLength={80}
              required
              autoFocus
              className="input-base"
            />
          </div>

          {/* Cargo */}
          <div className="flex flex-col gap-2">
            <label htmlFor="staff-role" className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
              Cargo *
            </label>
            <select
              id="staff-role"
              value={roleChoice}
              onChange={(e) => setRoleChoice(e.target.value)}
              required
              className="input-base"
            >
              <option value="" disabled>Selecciona un cargo…</option>
              {SPECIALTY_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
              <option value={ROLE_OTHER}>Otro…</option>
            </select>
            {roleChoice === ROLE_OTHER && (
              <input
                id="staff-role-other"
                type="text"
                value={roleOther}
                onChange={(e) => setRoleOther(e.target.value)}
                placeholder="Ej: Maquilladora"
                maxLength={40}
                aria-label="Otro cargo"
                className="input-base"
              />
            )}
          </div>

          {/* Contacto (opcional) */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="staff-email" className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
                Correo
              </label>
              <input
                id="staff-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Ej: carlos@correo.com"
                maxLength={254}
                className="input-base"
              />
              <p className="text-xs text-xinuco-muted">
                Opcional. Aquí le llegan los recibos de sus anticipos y pagos.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="staff-phone" className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
                WhatsApp / celular
              </label>
              <input
                id="staff-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ej: 300 123 4567"
                maxLength={24}
                className="input-base"
              />
              <p className="text-xs text-xinuco-muted">
                Opcional. Se usa para enviarle su liquidación directo por WhatsApp.
              </p>
            </div>
          </div>

          {/* Servicios */}
          <fieldset className="flex flex-col gap-3">
            <legend className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider mb-1">
              ¿Qué servicios hace?
            </legend>

            <label className="flex items-center gap-2 text-sm text-xinuco-text cursor-pointer">
              <input
                type="radio"
                name="services-mode"
                checked={servicesMode === 'all'}
                onChange={() => setServicesMode('all')}
              />
              Todos los servicios
            </label>
            <label className="flex items-center gap-2 text-sm text-xinuco-text cursor-pointer">
              <input
                type="radio"
                name="services-mode"
                checked={servicesMode === 'some'}
                onChange={() => setServicesMode('some')}
              />
              Solo algunos
            </label>

            {servicesMode === 'some' && (
              services.length === 0 ? (
                <p className="text-xs text-xinuco-muted">Aún no tienes servicios activos.</p>
              ) : (
                <div
                  className="flex flex-col rounded-xl overflow-hidden max-h-64 overflow-y-auto"
                  style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.02))' }}
                >
                  {services.map((svc, idx) => (
                    <label
                      key={svc.id}
                      className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-xinuco-text cursor-pointer hover:bg-white/[0.03]"
                      style={{ borderBottom: idx === services.length - 1 ? 'none' : '1px solid var(--border-color)' }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(svc.id)}
                        onChange={() => toggleService(svc.id)}
                      />
                      <span className="flex-1 min-w-0 break-words">{svc.name}</span>
                      {showAudience && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-white/5 border-white/10 text-xinuco-muted">
                          {svc.audience === 'all' ? 'Unisex' : AUDIENCE_LABELS[svc.audience].singular}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )
            )}
          </fieldset>

          {/* Usuario para iniciar sesión (solo al editar) */}
          {mode === 'edit' && (
            <div className="flex flex-col gap-2">
              <label htmlFor="staff-user" className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
                Usuario para iniciar sesión
              </label>
              <select
                id="staff-user"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="input-base"
              >
                <option value="">Sin usuario</option>
                {userOptions.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
              <p className="text-xs text-xinuco-muted">
                Así podrá ver su cuenta en ‘Mi cuenta’. Los usuarios los crea el administrador de Xinuco.
              </p>
            </div>
          )}

          {/* Horario (solo al crear; al editar vive en el sheet Horario) */}
          {mode === 'create' && (
            <fieldset className="flex flex-col gap-3">
              <legend className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider mb-1">
                Horario
              </legend>

              {members.length > 0 && (
                <div className="flex flex-col gap-2">
                  <label htmlFor="staff-copy-from" className="text-xs text-xinuco-muted">
                    Copiar de…
                  </label>
                  <select
                    id="staff-copy-from"
                    value={copyFrom}
                    onChange={(e) => {
                      setCopyFrom(e.target.value)
                      const source = members.find(m => m.id === e.target.value)
                      if (source) setScheduleState(scheduleRowsToState(source.schedules))
                    }}
                    className="input-base"
                  >
                    <option value="" disabled>Elige a alguien del equipo…</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.full_name} — {summarizeSchedule(m.schedules)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <WeeklyScheduleEditor value={scheduleState} onChange={setScheduleState} disabled={isPending} />
            </fieldset>
          )}

          {formError && (
            <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5 animate-fade-in">
              {formError}
            </p>
          )}

          <div className="flex gap-3 pt-4 mt-auto">
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
              {isPending ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Guardando…
                </>
              ) : (
                'Guardar'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
