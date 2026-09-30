'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, Search, UserPlus, X } from 'lucide-react'
import { findCustomerLoyalty } from '@/actions/loyalty'
import { quickCreateCustomer } from '@/actions/retail'
import type { CustomerLoyalty } from '@/lib/loyalty-utils'

export interface PosSelectedCustomer {
  id:        string
  full_name: string
  phone:     string
  /** Saldo de lealtad en el modo activo (null si no se pudo leer / cliente recién creado). */
  loyalty:   CustomerLoyalty | null
}

interface PosCustomerPickerProps {
  value:    PosSelectedCustomer | null
  onChange: (customer: PosSelectedCustomer | null) => void
  disabled?: boolean
}

const inputClass =
  'w-full text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-700'

/**
 * Cliente opcional de la venta: búsqueda por nombre o celular, o creación rápida (nombre + celular).
 * Un cliente permite ganar y canjear puntos de lealtad.
 */
export function PosCustomerPicker({ value, onChange, disabled }: PosCustomerPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PosSelectedCustomer[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const requestId = useRef(0)

  // Búsqueda con espera: solo se consulta si la persona dejó de escribir.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      requestId.current += 1
      setResults([])
      setSearched(false)
      setSearching(false)
      return
    }
    const id = ++requestId.current
    setSearching(true)
    const timer = setTimeout(async () => {
      const res = await findCustomerLoyalty(q)
      if (id !== requestId.current) return   // llegó una respuesta más nueva
      setResults(res.results.map((r) => ({ ...r.customer, loyalty: r.loyalty })))
      setError(res.error ?? null)
      setSearched(true)
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const select = (customer: PosSelectedCustomer) => {
    onChange(customer)
    setQuery('')
    setResults([])
    setSearched(false)
    setCreating(false)
    setError(null)
  }

  const handleCreate = () => {
    setError(null)
    startTransition(async () => {
      const res = await quickCreateCustomer({ full_name: newName, phone: newPhone })
      if (res.error || !res.customer) {
        setError(res.error ?? 'No se pudo crear el cliente.')
        return
      }
      // Si el celular ya existía se usa ese cliente; se lee su lealtad para no perder sus puntos.
      let loyalty: CustomerLoyalty | null = null
      if (res.existing) {
        const found = await findCustomerLoyalty(res.customer.phone)
        loyalty = found.results.find((r) => r.customer.id === res.customer!.id)?.loyalty ?? null
      }
      select({ ...res.customer, loyalty })
      setNewName('')
      setNewPhone('')
    })
  }

  if (value) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5"
        style={{ borderColor: 'var(--border-color)', background: 'var(--surface-color)' }}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-xinuco-text truncate">{value.full_name}</p>
          <p className="text-xs text-xinuco-muted">{value.phone}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label="Quitar cliente"
          className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-white/[0.05] transition-colors disabled:opacity-50"
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-500" />
        <input
          type="text"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o celular"
          aria-label="Buscar cliente"
          className={`${inputClass} pl-8`}
        />
        {searching && <Loader2 size={14} className="absolute right-2.5 top-2.5 animate-spin text-zinc-500" />}
      </div>

      {results.length > 0 && (
        <ul
          className="rounded-xl border divide-y overflow-hidden"
          style={{ borderColor: 'var(--border-color)' }}
        >
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => select(c)}
                className="w-full text-left px-3 py-2 hover:bg-white/[0.04] transition-colors"
              >
                <p className="text-sm font-medium text-xinuco-text">{c.full_name}</p>
                <p className="text-xs text-xinuco-muted">{c.phone}</p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {searched && results.length === 0 && !searching && (
        <p className="text-xs text-xinuco-muted">No encontramos clientes con esa búsqueda.</p>
      )}

      {!creating ? (
        <button
          type="button"
          onClick={() => { setCreating(true); setError(null) }}
          disabled={disabled}
          className="flex items-center gap-1.5 text-xs font-semibold text-[var(--primary-color)] hover:underline disabled:opacity-50"
        >
          <UserPlus size={13} /> Crear cliente
        </button>
      ) : (
        <div
          className="rounded-xl border p-3 space-y-2"
          style={{ borderColor: 'var(--border-color)', background: 'var(--surface-color)' }}
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nombre"
            aria-label="Nombre del cliente"
            maxLength={120}
            className={inputClass}
          />
          <input
            type="tel"
            inputMode="tel"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="Celular"
            aria-label="Celular del cliente"
            maxLength={20}
            className={inputClass}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending || newName.trim().length < 2 || newPhone.trim().length < 7}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2 rounded-lg bg-[var(--primary-color)] text-black hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending && <Loader2 size={13} className="animate-spin" />}
              Guardar cliente
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setError(null) }}
              disabled={isPending}
              className="px-3 text-xs font-semibold py-2 rounded-lg border border-zinc-800 text-zinc-300 hover:border-zinc-700"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
