'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, X } from 'lucide-react'
import { createCustomer, updateCustomer } from '@/actions/crm'
import { businessTodayISODate } from '@/lib/agenda-time'

export interface CustomerFormValues {
  full_name: string
  phone:     string
  email:     string
  birthday:  string
}

interface CustomerFormModalProps {
  /** Si viene, el formulario edita a ese cliente; si no, crea uno nuevo. */
  customerId?: string
  initial?:    Partial<CustomerFormValues>
  onClose:     () => void
  /** Se llama tras guardar con éxito (id solo al crear). */
  onSaved:     (customerId?: string) => void
}

const LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-xinuco-muted'

export function CustomerFormModal({ customerId, initial, onClose, onSaved }: CustomerFormModalProps) {
  const isEditing = !!customerId
  const [fullName, setFullName] = useState(initial?.full_name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [birthday, setBirthday] = useState(initial?.birthday ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, startSave] = useTransition()
  const backdropRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startSave(async () => {
      const payload = { full_name: fullName, phone, email, birthday }
      let newId: string | undefined
      let errorMsg: string | undefined
      if (isEditing) {
        errorMsg = (await updateCustomer(customerId as string, payload)).error
      } else {
        const res = await createCustomer(payload)
        errorMsg = res.error
        newId = res.customerId
      }
      if (errorMsg) {
        setError(errorMsg)
        return
      }
      onSaved(newId)
    })
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? 'Editar cliente' : 'Nuevo cliente'}
        className="w-full max-w-md rounded-2xl animate-fade-in"
        style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--border-color)' }}
        >
          <h2 className="text-base font-bold text-xinuco-text">
            {isEditing ? 'Editar cliente' : 'Nuevo cliente'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.05] transition-colors"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cust-name" className={LABEL}>Nombre</label>
            <input
              id="cust-name"
              ref={nameRef}
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={120}
              required
              className="input-base"
              placeholder="Nombre completo"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cust-phone" className={LABEL}>Teléfono</label>
            <input
              id="cust-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
              required
              className="input-base"
              placeholder="300 123 4567"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cust-email" className={LABEL}>Correo (opcional)</label>
            <input
              id="cust-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              className="input-base"
              placeholder="cliente@correo.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cust-birthday" className={LABEL}>Cumpleaños (opcional)</label>
            <input
              id="cust-birthday"
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              max={businessTodayISODate()}
              className="input-base"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={isSaving} className="btn-ghost !py-2 !px-4">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving || !fullName.trim() || !phone.trim()}
              className="btn-primary !py-2 !px-4"
            >
              {isSaving && <Loader2 size={14} className="animate-spin" />}
              {isEditing ? 'Guardar cambios' : 'Crear cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
