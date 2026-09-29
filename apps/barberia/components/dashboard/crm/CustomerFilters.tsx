'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Search, X } from 'lucide-react'
import {
  CUSTOMER_FILTERS,
  CUSTOMER_FILTER_LABELS,
  CUSTOMER_SORTS,
  CUSTOMER_SORT_LABELS,
  parseCustomerFilter,
  parseCustomerSort,
} from '@/lib/crm-utils'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-color)]'

function selectClass(active: boolean): string {
  return [
    'h-8 w-auto max-w-[13rem] truncate rounded-lg border px-2 text-xs bg-transparent cursor-pointer transition-colors',
    FOCUS_RING,
    active
      ? 'border-[var(--primary-color)] text-[var(--primary-color)]'
      : 'border-xinuco-border text-xinuco-muted hover:text-xinuco-text',
  ].join(' ')
}

/** Barra de filtros de una sola línea (mismo patrón que AgendaFilters). El estado vive en la URL. */
export function CustomerFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const urlQuery = searchParams.get('q') ?? ''
  const filter = parseCustomerFilter(searchParams.get('filter'))
  const sort = parseCustomerSort(searchParams.get('sort'))

  const [text, setText] = useState(urlQuery)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasFilters = urlQuery !== '' || text !== '' || filter !== 'all' || sort !== 'recent'

  const update = useCallback(
    (patch: { q?: string; filter?: string; sort?: string }) => {
      const params = new URLSearchParams(searchParams.toString())
      const apply = (key: string, value: string | undefined, defaultValue: string) => {
        if (value === undefined) return
        if (!value || value === defaultValue) params.delete(key)
        else params.set(key, value)
      }
      apply('q', patch.q?.trim(), '')
      apply('filter', patch.filter, 'all')
      apply('sort', patch.sort, 'recent')
      params.delete('page') // cualquier cambio vuelve a la primera página
      const qs = params.toString()
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      })
    },
    [router, pathname, searchParams],
  )

  function handleSearchChange(value: string) {
    setText(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => update({ q: value }), 300)
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function clearAll() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setText('')
    startTransition(() => {
      router.push(pathname, { scroll: false })
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filtros de clientes">
      <div className="relative min-w-[11rem] flex-1 max-w-xs">
        <Search
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xinuco-muted pointer-events-none"
        />
        <input
          type="text"
          value={text}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Buscar por nombre, teléfono o correo…"
          aria-label="Buscar cliente"
          maxLength={100}
          className={`h-8 w-full rounded-lg border border-xinuco-border bg-transparent pl-8 pr-8 text-xs text-xinuco-text placeholder:text-xinuco-muted transition-colors focus-visible:border-[var(--primary-color)] ${FOCUS_RING}`}
        />
        {isPending && (
          <Loader2
            size={13}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xinuco-muted animate-spin"
          />
        )}
      </div>

      <select
        aria-label="Mostrar clientes"
        value={filter}
        onChange={(e) => update({ q: text, filter: e.target.value })}
        className={selectClass(filter !== 'all')}
      >
        {CUSTOMER_FILTERS.map((f) => (
          <option key={f} value={f}>
            Mostrar: {CUSTOMER_FILTER_LABELS[f]}
          </option>
        ))}
      </select>

      <select
        aria-label="Ordenar clientes"
        value={sort}
        onChange={(e) => update({ q: text, sort: e.target.value })}
        className={selectClass(sort !== 'recent')}
      >
        {CUSTOMER_SORTS.map((s) => (
          <option key={s} value={s}>
            Ordenar: {CUSTOMER_SORT_LABELS[s]}
          </option>
        ))}
      </select>

      {hasFilters && (
        <button
          type="button"
          aria-label="Limpiar filtros"
          title="Limpiar filtros"
          onClick={clearAll}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-xinuco-muted hover:text-xinuco-text transition-colors ${FOCUS_RING}`}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
