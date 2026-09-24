'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import {
  Loader2, AlertCircle, CheckCircle2, UserPlus, Pencil, KeyRound, Power,
  Eye, EyeOff, X, RefreshCw,
} from 'lucide-react'
import {
  listBusinessUsers, createBusinessUser, updateBusinessUser,
  setBusinessUserActive, setBusinessUserPassword,
  type BusinessUser,
} from '@/actions/business-users'

// ────────────────────────────────────────────────────────────
// Config de roles
// ────────────────────────────────────────────────────────────
type AssignableRole = 'admin' | 'barber' | 'manicurist'

const ROLE_LABELS: Record<string, string> = {
  admin:      'Administrador',
  barber:     'Barbero',
  manicurist: 'Manicurista',
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border border-xinuco-border bg-xinuco-surface text-xinuco-text">
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
        active
          ? 'bg-green-500/10 text-green-400 border-green-500/20'
          : 'bg-red-500/10 text-red-400 border-red-500/20'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-400' : 'bg-red-400'}`} />
      {active ? 'Activo' : 'Inactivo'}
    </span>
  )
}

function formatLastSignIn(iso: string | null) {
  if (!iso) return 'Nunca'
  try {
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  } catch {
    return 'Nunca'
  }
}

// ────────────────────────────────────────────────────────────
// Primitivas de formulario (estilo local — sin importar de apps/web)
// ────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-medium text-xinuco-muted uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-xinuco-surface border border-xinuco-border rounded-lg px-3 py-2 text-xs text-xinuco-text outline-none focus:border-xinuco-primary ${props.className ?? ''}`}
    />
  )
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        minLength={8}
        className="pr-9"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-xinuco-muted hover:text-xinuco-text"
      >
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  )
}

function RoleSelect({ value, onChange }: { value: AssignableRole; onChange: (v: AssignableRole) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as AssignableRole)}
      className="w-full bg-xinuco-surface border border-xinuco-border rounded-lg px-3 py-2 text-xs text-xinuco-text outline-none focus:border-xinuco-primary cursor-pointer"
    >
      <option value="admin">Administrador</option>
      <option value="barber">Barbero</option>
      <option value="manicurist">Manicurista</option>
    </select>
  )
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
      <AlertCircle size={12} className="shrink-0" /> {msg}
    </p>
  )
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl bg-xinuco-bg border border-xinuco-border">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-xinuco-border">
          <h3 className="text-xs font-bold text-xinuco-text">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="w-6 h-6 flex items-center justify-center rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-xinuco-surface"
          >
            <X size={13} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

function SubmitButton({ isPending, label }: { isPending: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={isPending}
      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-60 hover:scale-[1.01] active:scale-95"
      style={{ background: 'var(--primary-color)', color: 'var(--bg-color)' }}
    >
      {isPending ? <><Loader2 size={13} className="animate-spin" /> Guardando...</> : label}
    </button>
  )
}

// ────────────────────────────────────────────────────────────
// Modal: Agregar usuario
// ────────────────────────────────────────────────────────────
function CreateUserModal({ businessId, onClose, onSuccess }: {
  businessId: string; onClose: () => void; onSuccess: () => void
}) {
  const [fullName, setFullName] = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [role,     setRole]     = useState<AssignableRole>('barber')
  const [error,    setError]    = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return }
    startTransition(async () => {
      const result = await createBusinessUser({ businessId, email, password, fullName, role })
      if (result.success) onSuccess()
      else setError(result.error ?? 'Error desconocido.')
    })
  }

  return (
    <ModalShell title="Agregar usuario" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Field label="Nombre completo">
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ej: Juan García" required />
        </Field>
        <Field label="Correo">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@ejemplo.com" required />
        </Field>
        <Field label="Contraseña">
          <PasswordInput value={password} onChange={setPassword} placeholder="Mínimo 8 caracteres" />
        </Field>
        <Field label="Rol">
          <RoleSelect value={role} onChange={setRole} />
        </Field>
        {error && <ErrorBox msg={error} />}
        <SubmitButton isPending={isPending} label="Crear usuario" />
      </form>
    </ModalShell>
  )
}

// ────────────────────────────────────────────────────────────
// Modal: Editar usuario
// ────────────────────────────────────────────────────────────
function EditUserModal({ businessId, user, onClose, onSuccess }: {
  businessId: string; user: BusinessUser; onClose: () => void; onSuccess: () => void
}) {
  const [fullName, setFullName] = useState(user.full_name)
  const [email,    setEmail]    = useState(user.email ?? '')
  const [role,     setRole]     = useState<AssignableRole>(
    (['admin', 'barber', 'manicurist'].includes(user.role) ? user.role : 'barber') as AssignableRole
  )
  const [error,    setError]    = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await updateBusinessUser(businessId, user.id, { fullName, email, role })
      if (result.success) onSuccess()
      else setError(result.error ?? 'Error desconocido.')
    })
  }

  return (
    <ModalShell title="Editar usuario" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Field label="Nombre completo">
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>
        <Field label="Correo">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Rol">
          <RoleSelect value={role} onChange={setRole} />
        </Field>
        {error && <ErrorBox msg={error} />}
        <SubmitButton isPending={isPending} label="Guardar cambios" />
      </form>
    </ModalShell>
  )
}

// ────────────────────────────────────────────────────────────
// Modal: Cambiar contraseña
// ────────────────────────────────────────────────────────────
function PasswordModal({ businessId, user, onClose, onSuccess }: {
  businessId: string; user: BusinessUser; onClose: () => void; onSuccess: () => void
}) {
  const [password,        setPassword]        = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error,           setError]           = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8)          { setError('La contraseña debe tener al menos 8 caracteres.'); return }
    if (password !== confirmPassword) { setError('Las contraseñas no coinciden.'); return }
    startTransition(async () => {
      const result = await setBusinessUserPassword(businessId, user.id, password)
      if (result.success) onSuccess()
      else setError(result.error ?? 'Error desconocido.')
    })
  }

  return (
    <ModalShell title="Cambiar contraseña" onClose={onClose}>
      <p className="text-xs text-xinuco-muted mb-3">
        Usuario: <span className="text-xinuco-text font-semibold">{user.full_name}</span>
        {user.email && <span className="text-xinuco-muted"> · {user.email}</span>}
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Field label="Nueva contraseña">
          <PasswordInput value={password} onChange={setPassword} placeholder="Mínimo 8 caracteres" />
        </Field>
        <Field label="Confirmar contraseña">
          <PasswordInput value={confirmPassword} onChange={setConfirmPassword} placeholder="Repite la contraseña" />
        </Field>
        {error && <ErrorBox msg={error} />}
        <SubmitButton isPending={isPending} label="Actualizar contraseña" />
      </form>
    </ModalShell>
  )
}

// ────────────────────────────────────────────────────────────
// Modal: Confirmar desactivación
// ────────────────────────────────────────────────────────────
function DeactivateConfirmModal({ businessId, user, onClose, onSuccess }: {
  businessId: string; user: BusinessUser; onClose: () => void; onSuccess: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await setBusinessUserActive(businessId, user.id, false)
      if (result.success) onSuccess()
      else setError(result.error ?? 'Error desconocido.')
    })
  }

  return (
    <ModalShell title="Desactivar usuario" onClose={onClose}>
      <p className="text-xs text-xinuco-muted leading-relaxed mb-4">
        <span className="text-xinuco-text font-semibold">{user.full_name}</span> no podrá iniciar sesión hasta que lo reactives.
      </p>
      {error && <div className="mb-3"><ErrorBox msg={error} /></div>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="px-3.5 py-2 rounded-lg text-xs font-medium border border-xinuco-border text-xinuco-muted hover:text-xinuco-text disabled:opacity-40"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending}
          className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 disabled:opacity-40"
        >
          {isPending ? 'Procesando...' : 'Desactivar'}
        </button>
      </div>
    </ModalShell>
  )
}

// ────────────────────────────────────────────────────────────
// Tarjeta de usuario
// ────────────────────────────────────────────────────────────
function UserCard({ user, onEdit, onChangePassword, onToggleActive, isTogglePending }: {
  user: BusinessUser
  onEdit: () => void
  onChangePassword: () => void
  onToggleActive: () => void
  isTogglePending: boolean
}) {
  return (
    <div className="rounded-xl border border-xinuco-border bg-xinuco-surface p-3.5 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-xinuco-text truncate">{user.full_name}</p>
          <p className="text-[11px] text-xinuco-muted truncate">{user.email ?? '—'}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <RoleBadge role={user.role} />
          <StatusBadge active={user.is_active} />
        </div>
      </div>

      <p className="text-[10px] text-xinuco-muted">
        Último acceso: {formatLastSignIn(user.last_sign_in_at)}
      </p>

      <div className="flex items-center gap-1.5 pt-1">
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium border border-xinuco-border text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.03]"
        >
          <Pencil size={11} /> Editar
        </button>
        <button
          type="button"
          onClick={onChangePassword}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium border border-xinuco-border text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.03]"
        >
          <KeyRound size={11} /> Cambiar clave
        </button>
        <button
          type="button"
          onClick={onToggleActive}
          disabled={isTogglePending}
          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium border disabled:opacity-50 ${
            user.is_active
              ? 'border-red-500/25 text-red-400 hover:bg-red-500/10'
              : 'border-green-500/25 text-green-400 hover:bg-green-500/10'
          }`}
        >
          <Power size={11} /> {user.is_active ? 'Desactivar' : 'Activar'}
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Panel principal
// ────────────────────────────────────────────────────────────
export function BusinessUsersPanel({ businessId }: { businessId: string }) {
  const [users, setUsers] = useState<BusinessUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<BusinessUser | null>(null)
  const [passwordTarget, setPasswordTarget] = useState<BusinessUser | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<BusinessUser | null>(null)

  const fetchUsers = useCallback(() => {
    setError(null)
    startTransition(async () => {
      const res = await listBusinessUsers(businessId)
      if (res.error) setError(res.error)
      else setUsers(res.data)
      setInitialLoading(false)
    })
  }, [businessId])

  useEffect(() => {
    setUsers(null)
    setInitialLoading(true)
    fetchUsers()
  }, [fetchUsers])

  function handleSuccess(message: string) {
    setShowCreate(false)
    setEditTarget(null)
    setPasswordTarget(null)
    setDeactivateTarget(null)
    setNotice(message)
    fetchUsers()
    setTimeout(() => setNotice(null), 2500)
  }

  function handleActivate(user: BusinessUser) {
    setActivatingId(user.id)
    startTransition(async () => {
      const result = await setBusinessUserActive(businessId, user.id, true)
      setActivatingId(null)
      if (result.success) handleSuccess('Usuario activado.')
      else setError(result.error ?? 'Error desconocido.')
    })
  }

  // ── Loading (sin datos aún) ──
  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-xinuco-muted">
        <Loader2 size={18} className="animate-spin mr-2" /> Cargando usuarios...
      </div>
    )
  }

  // ── Error ──
  if (users === null && error) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center px-4">
        <AlertCircle size={20} className="text-red-400" />
        <p className="text-xs text-xinuco-muted">{error}</p>
        <button
          type="button"
          onClick={fetchUsers}
          className="flex items-center gap-1.5 text-xs font-medium text-xinuco-text hover:opacity-80"
        >
          <RefreshCw size={12} /> Reintentar
        </button>
      </div>
    )
  }

  const list = users ?? []

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-xinuco-text flex items-center gap-1.5">
          Usuarios ({list.length})
          {isPending && <Loader2 size={11} className="animate-spin text-xinuco-muted" />}
        </p>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-60"
          style={{ background: 'var(--primary-color)', color: 'var(--bg-color)' }}
        >
          <UserPlus size={13} /> Agregar
        </button>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
          <CheckCircle2 size={12} /> {notice}
        </div>
      )}

      {error && (
        <ErrorBox msg={error} />
      )}

      {/* Empty state */}
      {list.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-xs text-xinuco-muted">Este negocio aún no tiene usuarios.</p>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 text-xs font-medium hover:opacity-80"
            style={{ color: 'var(--primary-color)' }}
          >
            <UserPlus size={13} /> Agregar el primer usuario
          </button>
        </div>
      )}

      {/* Lista */}
      <div className="space-y-2.5">
        {list.map((user) => (
          <UserCard
            key={user.id}
            user={user}
            onEdit={() => setEditTarget(user)}
            onChangePassword={() => setPasswordTarget(user)}
            onToggleActive={() => (user.is_active ? setDeactivateTarget(user) : handleActivate(user))}
            isTogglePending={activatingId === user.id}
          />
        ))}
      </div>

      {/* Modales */}
      {showCreate && (
        <CreateUserModal
          businessId={businessId}
          onClose={() => setShowCreate(false)}
          onSuccess={() => handleSuccess('Usuario creado.')}
        />
      )}
      {editTarget && (
        <EditUserModal
          businessId={businessId}
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={() => handleSuccess('Cambios guardados.')}
        />
      )}
      {passwordTarget && (
        <PasswordModal
          businessId={businessId}
          user={passwordTarget}
          onClose={() => setPasswordTarget(null)}
          onSuccess={() => handleSuccess('Contraseña actualizada.')}
        />
      )}
      {deactivateTarget && (
        <DeactivateConfirmModal
          businessId={businessId}
          user={deactivateTarget}
          onClose={() => setDeactivateTarget(null)}
          onSuccess={() => handleSuccess('Usuario desactivado.')}
        />
      )}
    </div>
  )
}
