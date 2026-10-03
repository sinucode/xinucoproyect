'use client'

import {
  useState,
  useTransition,
  useCallback,
  useRef,
  useEffect,
} from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Plus,
  X,
  Loader2,
  User,
  Phone,
  Mail,
  Cake,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Pencil,
  Send,
  ShoppingBag,
  Gift,
} from 'lucide-react'
import {
  getCustomerExpediente,
  addCustomerNote,
  updateCustomerTags,
  updateCustomerPreferences,
} from '@/actions/crm'
import type {
  CustomerListItem,
  CustomerExpediente,
  CustomerNoteWithAuthor,
} from '@/actions/crm'
import { getCustomerLoyalty } from '@/actions/loyalty'
import { useFeature } from '@/lib/features/context'
import { useIsAdmin } from '@/lib/features/role-context'
import { formatMoney, formatUnits, type CustomerLoyalty } from '@/lib/loyalty-utils'
import { StampDots } from '@/components/dashboard/loyalty/StampDots'
import { formatCOP } from '@xinuco/utils'
import { AdminPageHeader } from '@xinuco/ui'
import { CustomerFilters } from './CustomerFilters'
import { CustomerFormModal } from './CustomerFormModal'
import {
  CUSTOMERS_PAGE_SIZE,
  displayPhone,
  formatApptDateTime,
  formatApptDay,
  formatBirthday,
  formatInstantDay,
  getInitials,
  isBirthdayThisMonth,
  isPlaceholderPhone,
  joinParts,
  relativeVisitLabel,
  whatsappUrl,
  type CustomerFilter,
} from '@/lib/crm-utils'
import { customerSince, formatLongDate } from '@/lib/customer-utils'

// ── Etiquetas predefinidas ────────────────────────────────────────────────────

const PREDEFINED_TAGS = [
  'VIP',
  'Frecuente',
  'Alérgico',
  'Primera Visita',
  'Referido',
  'Cabello Fino',
  'Barba',
]

// ── Colores de etiquetas ──────────────────────────────────────────────────────

function getTagStyle(tag: string): string {
  switch (tag) {
    case 'VIP':
      return 'text-amber-400 bg-amber-400/10 border-amber-400/25'
    case 'Frecuente':
      return 'text-sky-400 bg-sky-400/10 border-sky-400/25'
    case 'Alérgico':
      return 'text-red-400 bg-red-400/10 border-red-400/25'
    default:
      return 'text-xinuco-muted bg-white/[0.04] border-white/10'
  }
}

// ── Badge de estado de cita ───────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    completed:       { label: 'Completada',   className: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
    cancelled:       { label: 'Cancelada',    className: 'text-red-400 bg-red-400/10 border-red-400/20' },
    no_show:         { label: 'No asistió',   className: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
    in_progress:     { label: 'En proceso',   className: 'text-sky-400 bg-sky-400/10 border-sky-400/20' },
    ready_to_pay:    { label: 'Por cobrar',   className: 'text-violet-400 bg-violet-400/10 border-violet-400/20' },
    payment_pending: { label: 'Pago pendiente', className: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
    scheduled:       { label: 'Agendada',     className: 'text-xinuco-muted bg-white/[0.04] border-white/10' },
  }
  const { label, className } = config[status] ?? { label: status, className: 'text-xinuco-muted bg-white/[0.04] border-white/10' }

  return (
    <span className={`inline-flex text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${className}`}>
      {label}
    </span>
  )
}

// ── Textos de estado vacío por filtro ─────────────────────────────────────────

function emptyMessage(filter: CustomerFilter, hasQuery: boolean): string {
  if (hasQuery) return 'No se encontraron clientes con estos criterios.'
  switch (filter) {
    case 'frequent': return 'Aún no hay clientes frecuentes (3 o más visitas en 90 días).'
    case 'inactive': return 'No hay clientes que no vengan hace más de 30 días 🎉'
    case 'new':      return 'Aún no hay clientes nuevos este mes.'
    case 'birthday': return 'Nadie cumple años este mes.'
    case 'mine':     return 'Aún no tienes clientes con citas contigo.'
    default:         return 'No hay clientes aún. Crea el primero con «Nuevo cliente».'
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Props del componente principal
// ════════════════════════════════════════════════════════════════════════════

interface CustomerCRMProps {
  customers:  CustomerListItem[]
  total:      number
  page:       number
  query:      string
  filter:     CustomerFilter
  /** Hoy en la zona del negocio ('YYYY-MM-DD'), calculado en el servidor. */
  todayKey:   string
  loadError?: string
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL — CustomerCRM
// ════════════════════════════════════════════════════════════════════════════

export function CustomerCRM({
  customers,
  total,
  page,
  query,
  filter,
  todayKey,
  loadError,
}: CustomerCRMProps) {
  const router = useRouter()
  const [view, setView] = useState<'list' | 'expediente'>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expediente, setExpediente] = useState<CustomerExpediente | null>(null)
  const [isLoadingExp, startLoadExp] = useTransition()
  const [showCreate, setShowCreate] = useState(false)

  // ── Abrir expediente ──────────────────────────────────────────────────────

  const openExpediente = useCallback((customerId: string) => {
    setSelectedId(customerId)
    startLoadExp(async () => {
      const data = await getCustomerExpediente(customerId)
      setExpediente(data)
      setView('expediente')
    })
  }, [])

  // ── Volver a la lista ─────────────────────────────────────────────────────

  function goBack() {
    setView('list')
    setSelectedId(null)
    setExpediente(null)
    router.refresh() // la lista pudo cambiar (edición, notas, etiquetas)
  }

  // ── Actualizar expediente tras una mutación ───────────────────────────────

  const refreshExpediente = useCallback(() => {
    if (!selectedId) return
    startLoadExp(async () => {
      const data = await getCustomerExpediente(selectedId)
      setExpediente(data)
    })
  }, [selectedId])

  // ── Render ────────────────────────────────────────────────────────────────

  if (view === 'expediente' && selectedId) {
    return (
      <ExpedienteView
        expediente={expediente}
        isLoading={isLoadingExp}
        onBack={goBack}
        onRefresh={refreshExpediente}
      />
    )
  }

  return (
    <>
      <AdminPageHeader
        title="Clientes"
        subtitle={`${total} ${total === 1 ? 'cliente' : 'clientes'}`}
        hasData={true}
        actionButton={
          <button type="button" onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={16} />
            Nuevo cliente
          </button>
        }
      />

      <CustomerFilters />

      {loadError && (
        <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          No se pudo cargar la lista: {loadError}
        </p>
      )}

      {/* Lista de clientes */}
      <section
        aria-label="Clientes"
        className={customers.length === 0 ? 'flex flex-col gap-2' : 'grid grid-cols-1 gap-2 xl:grid-cols-2'}
      >
        {customers.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-16 text-center rounded-xl"
            style={{ border: '1px dashed var(--border-color)' }}
          >
            <User size={32} className="text-xinuco-muted mb-3 opacity-40" />
            <p className="text-sm text-xinuco-muted">{emptyMessage(filter, query.trim() !== '')}</p>
          </div>
        ) : (
          customers.map(c => (
            <CustomerCard
              key={c.id}
              customer={c}
              todayKey={todayKey}
              onSelect={() => openExpediente(c.id)}
            />
          ))
        )}
      </section>

      <Pagination page={page} total={total} />

      {showCreate && (
        <CustomerFormModal
          onClose={() => setShowCreate(false)}
          onSaved={(id) => {
            setShowCreate(false)
            router.refresh()
            if (id) openExpediente(id)
          }}
        />
      )}
    </>
  )
}

// ── Paginación ────────────────────────────────────────────────────────────────

function Pagination({ page, total }: { page: number; total: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  if (total <= CUSTOMERS_PAGE_SIZE) return null

  const totalPages = Math.ceil(total / CUSTOMERS_PAGE_SIZE)

  function go(target: number) {
    const params = new URLSearchParams(searchParams.toString())
    if (target <= 0) params.delete('page')
    else params.set('page', String(target))
    const qs = params.toString()
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: true })
    })
  }

  const btn =
    'inline-flex h-8 items-center gap-1 rounded-lg border border-xinuco-border px-3 text-xs text-xinuco-muted hover:text-xinuco-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <nav className="flex items-center justify-between pt-2" aria-label="Paginación">
      <button type="button" className={btn} disabled={page <= 0 || isPending} onClick={() => go(page - 1)}>
        Anterior
      </button>
      <span className="text-xs text-xinuco-muted tabular-nums">
        Página {page + 1} de {totalPages}
      </span>
      <button type="button" className={btn} disabled={page + 1 >= totalPages || isPending} onClick={() => go(page + 1)}>
        Siguiente
      </button>
    </nav>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// TARJETA DE CLIENTE — Vista de lista
// ════════════════════════════════════════════════════════════════════════════

function CustomerCard({
  customer,
  todayKey,
  onSelect,
}: {
  customer: CustomerListItem
  todayKey: string
  onSelect: () => void
}) {
  const since = customerSince(customer.created_at)
  const birthdayMonth = isBirthdayThisMonth(customer.birthday, todayKey)
  const lastVisitText = customer.last_visit
    ? `Última visita: ${relativeVisitLabel(customer.last_visit, todayKey)}`
    : 'Sin visitas aún'

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left flex items-center gap-4 p-4 rounded-xl transition-all duration-200 hover:bg-white/[0.04] active:scale-[0.99]"
      style={{ border: '1px solid var(--border-color)' }}
    >
      {/* Avatar con iniciales */}
      <div
        className="w-11 h-11 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold"
        style={{ backgroundColor: 'rgba(197,160,89,0.18)', color: 'var(--primary-color)' }}
        aria-hidden="true"
      >
        {getInitials(customer.full_name)}
      </div>

      {/* Info principal */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-semibold text-sm text-xinuco-text truncate">
            {customer.full_name}
          </span>
          {customer.tags.slice(0, 3).map(tag => (
            <span
              key={tag}
              className={`inline-flex text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${getTagStyle(tag)}`}
            >
              {tag}
            </span>
          ))}
          {customer.tags.length > 3 && (
            <span className="text-[10px] text-xinuco-muted">+{customer.tags.length - 3}</span>
          )}
        </div>

        <div className="flex items-center gap-x-3 gap-y-0.5 mt-0.5 flex-wrap">
          <span className={`text-xs tabular-nums ${isPlaceholderPhone(customer.phone) ? 'text-xinuco-muted/60 italic' : 'text-xinuco-muted'}`}>
            {displayPhone(customer.phone)}
          </span>
          {/* El separador solo aparece si hay un segundo valor (no queda un "·" colgando) */}
          {lastVisitText && (
            <>
              <span className="text-xinuco-muted/40" aria-hidden="true">·</span>
              <span className="text-xs text-xinuco-muted">{lastVisitText}</span>
            </>
          )}
        </div>

        {(since.label || customer.next_appointment || birthdayMonth) && (
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {customer.next_appointment && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border text-sky-400 bg-sky-400/10 border-sky-400/25">
                <CalendarClock size={10} />
                Próxima cita: {formatApptDateTime(customer.next_appointment)}
              </span>
            )}
            {birthdayMonth && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border text-amber-400 bg-amber-400/10 border-amber-400/25">
                🎂 Cumple este mes
              </span>
            )}
            {since.label && (
              <span className="text-[10px] text-xinuco-muted/70">
                {joinParts([since.label, since.age])}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Estadística derecha */}
      <div className="text-right flex-shrink-0">
        {/* El gasto llega null para el barbero: solo se muestra el número de visitas */}
        {customer.total_spent !== null && (
          <div className="text-sm font-bold tabular-nums" style={{ color: 'var(--primary-color)' }}>
            {formatCOP(customer.total_spent)}
          </div>
        )}
        <div className="text-[10px] text-xinuco-muted tabular-nums">
          {customer.visits} {customer.visits === 1 ? 'visita' : 'visitas'}
        </div>
      </div>
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// EXPEDIENTE DEL CLIENTE — Vista de detalle
// ════════════════════════════════════════════════════════════════════════════

const CARD_STYLE = { border: '1px solid var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.02))' }

function ExpedienteView({
  expediente,
  isLoading,
  onBack,
  onRefresh,
}: {
  expediente: CustomerExpediente | null
  isLoading:  boolean
  onBack:     () => void
  onRefresh:  () => void
}) {
  if (isLoading && !expediente) {
    return (
      <div className="flex flex-col gap-4 animate-pulse">
        <div className="h-8 w-32 rounded" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
        <div className="h-24 w-full rounded-xl" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
        <div className="h-32 w-full rounded-xl" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
        <div className="h-48 w-full rounded-xl" style={{ background: 'var(--surface-color, #1a1a1a)' }} />
      </div>
    )
  }

  if (!expediente) {
    return (
      <div className="text-center py-16">
        <p className="text-xinuco-muted text-sm">No se encontró el expediente.</p>
        <button type="button" onClick={onBack} className="mt-4 btn-ghost text-sm">
          Volver
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Botón volver */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-xinuco-muted hover:text-xinuco-text transition-colors self-start"
      >
        <ArrowLeft size={16} />
        Clientes
      </button>

      <CustomerHeader expediente={expediente} onRefresh={onRefresh} />

      <StatsRow expediente={expediente} />

      <LoyaltyLine customerId={expediente.customer.id} />

      {expediente.upcoming.length > 0 && <UpcomingAppointments expediente={expediente} />}

      <PreferredBarberSelector expediente={expediente} onRefresh={onRefresh} />

      <TeamNotes expediente={expediente} onRefresh={onRefresh} />

      {expediente.purchased_products.length > 0 && <PurchasedProducts expediente={expediente} />}

      <VisitHistory expediente={expediente} />
    </div>
  )
}

// ── Lealtad del cliente (línea liviana; solo si el negocio tiene la función) ──

function LoyaltyLine({ customerId }: { customerId: string }) {
  const enabled = useFeature('loyalty')
  const isAdmin = useIsAdmin()
  const [loyalty, setLoyalty] = useState<CustomerLoyalty | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoyalty(null)
    getCustomerLoyalty(customerId)
      .then(({ loyalty: data }) => {
        if (!cancelled && data?.enabled) setLoyalty(data)
      })
      .catch(() => { /* sin lealtad: no se muestra nada */ })
    return () => { cancelled = true }
  }, [enabled, customerId])

  if (!enabled || !loyalty) return null

  return (
    <div className="flex items-center gap-2 flex-wrap text-sm text-xinuco-text -mt-2">
      <Gift size={14} className="shrink-0" style={{ color: 'var(--primary-color)' }} />
      {loyalty.mode === 'points' ? (
        <span>
          Lealtad: <span className="font-semibold tabular-nums">{formatUnits(loyalty.balance)}</span>{' '}
          {loyalty.balance === 1 ? 'punto' : 'puntos'}{' '}
          {/* El valor en pesos de los puntos es dinero: solo el admin lo ve */}
          {isAdmin && (
            <span className="text-xinuco-muted">
              ({formatMoney(loyalty.value_cop ?? loyalty.balance * loyalty.point_value_cop)})
            </span>
          )}
        </span>
      ) : (
        <>
          <span>
            Lealtad: <span className="font-semibold tabular-nums">{loyalty.balance}/{loyalty.stamps_required}</span> sellos
          </span>
          <StampDots balance={loyalty.balance} required={loyalty.stamps_required} size={8} />
          {loyalty.can_redeem && <span className="text-xs text-emerald-400">· servicio gratis listo</span>}
        </>
      )}
    </div>
  )
}

// ── Header del cliente ────────────────────────────────────────────────────────

function CustomerHeader({
  expediente,
  onRefresh,
}: {
  expediente: CustomerExpediente
  onRefresh:  () => void
}) {
  const { customer } = expediente
  const [tags, setTags] = useState<string[]>(expediente.tags)
  const [showTagInput, setShowTagInput] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [isSavingTags, startSaveTags] = useTransition()
  const [showEdit, setShowEdit] = useState(false)
  const customInputRef = useRef<HTMLInputElement>(null)

  const noPhone = isPlaceholderPhone(customer.phone)
  const wa = whatsappUrl(customer.phone)
  const birthday = formatBirthday(customer.birthday)

  // Sincronizar si el expediente se refresca externamente
  useEffect(() => {
    setTags(expediente.tags)
  }, [expediente.tags])

  function handleAddTag(tag: string) {
    const trimmed = tag.trim()
    if (!trimmed || tags.includes(trimmed)) {
      setShowTagInput(false)
      setNewTag('')
      return
    }
    const newTags = [...tags, trimmed]
    setTags(newTags)
    startSaveTags(async () => {
      await updateCustomerTags(customer.id, newTags)
      onRefresh()
    })
    setShowTagInput(false)
    setNewTag('')
  }

  function handleRemoveTag(tag: string) {
    const newTags = tags.filter(t => t !== tag)
    setTags(newTags)
    startSaveTags(async () => {
      await updateCustomerTags(customer.id, newTags)
      onRefresh()
    })
  }

  useEffect(() => {
    if (showTagInput && newTag === '__custom') customInputRef.current?.focus()
  }, [showTagInput, newTag])

  return (
    <div className="p-5 rounded-2xl flex flex-col gap-4" style={CARD_STYLE}>
      {/* Avatar + datos básicos; las acciones van debajo en móvil y a la derecha desde sm */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        <div className="flex items-start gap-3 sm:gap-4 min-w-0 sm:flex-1">
          <div
            className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl flex-shrink-0 flex items-center justify-center text-lg sm:text-xl font-bold"
            style={{ backgroundColor: 'rgba(197,160,89,0.2)', color: 'var(--primary-color)' }}
          >
            {getInitials(customer.full_name)}
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-xinuco-text leading-tight break-words">
              {customer.full_name}
            </h2>
            <div className="flex flex-col gap-1 mt-1.5">
              <span className="flex items-center gap-2 text-xs text-xinuco-muted">
                <Phone size={12} className="text-xinuco-muted/60 shrink-0" />
                <span className={noPhone ? 'italic text-xinuco-muted/60' : 'tabular-nums'}>
                  {displayPhone(customer.phone)}
                </span>
              </span>
              {customer.email && (
                <span className="flex items-center gap-2 text-xs text-xinuco-muted min-w-0">
                  <Mail size={12} className="text-xinuco-muted/60 shrink-0" />
                  <span className="break-all">{customer.email}</span>
                </span>
              )}
              {birthday && (
                <span className="flex items-center gap-2 text-xs text-xinuco-muted">
                  <Cake size={12} className="text-xinuco-muted/60 shrink-0" />
                  Cumpleaños: {birthday}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:flex-shrink-0">
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost !py-2 !px-3 text-xs flex-1 sm:flex-none justify-center min-h-10"
              aria-label="Abrir WhatsApp en una pestaña nueva"
            >
              WhatsApp
            </a>
          )}
          <button
            type="button"
            onClick={() => setShowEdit(true)}
            className="btn-ghost !py-2 !px-3 text-xs flex-1 sm:flex-none justify-center min-h-10"
          >
            <Pencil size={13} />
            Editar
          </button>
        </div>
      </div>

      {/* Etiquetas editables */}
      <div className="flex flex-wrap gap-2 items-center">
        {tags.map(tag => (
          <span
            key={tag}
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${getTagStyle(tag)}`}
          >
            {tag}
            <button
              type="button"
              onClick={() => handleRemoveTag(tag)}
              disabled={isSavingTags}
              className="hover:opacity-70 transition-opacity"
              aria-label={`Eliminar etiqueta ${tag}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}

        {/* Añadir tag */}
        {showTagInput ? (
          <div className="flex items-center gap-1.5">
            <select
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              className="h-10 text-xs rounded-lg border px-2 bg-transparent text-xinuco-text outline-none"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <option value="">Elegir…</option>
              {PREDEFINED_TAGS.filter(t => !tags.includes(t)).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
              <option value="__custom">Personalizada…</option>
            </select>
            {newTag === '__custom' && (
              <input
                ref={customInputRef}
                type="text"
                placeholder="Nueva etiqueta"
                maxLength={40}
                className="h-10 text-xs rounded-lg border px-2 bg-transparent text-xinuco-text outline-none w-28"
                style={{ borderColor: 'var(--border-color)' }}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddTag((e.target as HTMLInputElement).value)
                  if (e.key === 'Escape') { setShowTagInput(false); setNewTag('') }
                }}
              />
            )}
            <button
              type="button"
              onClick={() => handleAddTag(
                newTag === '__custom'
                  ? (customInputRef.current?.value ?? '')
                  : newTag
              )}
              disabled={!newTag}
              className="h-10 px-3 text-xs rounded-lg font-medium transition-colors disabled:opacity-40"
              style={{ background: 'var(--primary-color)', color: '#080808' }}
            >
              OK
            </button>
            <button
              type="button"
              onClick={() => { setShowTagInput(false); setNewTag('') }}
              className="h-10 px-3 text-xs rounded-lg text-xinuco-muted hover:text-xinuco-text transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowTagInput(true)}
            disabled={isSavingTags}
            className="inline-flex items-center gap-1 text-xs text-xinuco-muted hover:text-xinuco-text border border-dashed rounded-full px-3 min-h-10 transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--border-color)' }}
          >
            {isSavingTags ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Plus size={10} />
            )}
            Etiqueta
          </button>
        )}
      </div>

      {showEdit && (
        <CustomerFormModal
          customerId={customer.id}
          initial={{
            full_name: customer.full_name,
            phone:     noPhone ? '' : customer.phone,
            email:     customer.email ?? '',
            birthday:  customer.birthday ?? '',
          }}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false)
            onRefresh()
          }}
        />
      )}
    </div>
  )
}

// ── Fila de estadísticas ──────────────────────────────────────────────────────

function StatsRow({ expediente }: { expediente: CustomerExpediente }) {
  const since = customerSince(expediente.customer.created_at)

  // Los montos llegan null para el barbero: esas tarjetas no se muestran
  const showMoney = expediente.total_spent !== null

  const stats: { label: string; value: string; sub?: string }[] = [
    { label: 'Visitas',         value: String(expediente.total_visits) },
    ...(showMoney
      ? [
          { label: 'Total gastado',   value: formatCOP(expediente.total_spent ?? 0) },
          { label: 'Ticket promedio', value: (expediente.paid_sales ?? 0) > 0 ? formatCOP(expediente.avg_ticket ?? 0) : '—' },
        ]
      : []),
    { label: 'Última visita',   value: formatApptDay(expediente.last_visit) },
    {
      label: 'Cliente desde',
      value: formatLongDate(expediente.customer.created_at),
      sub:   since.age || (since.label === 'Nuevo este mes' ? since.label : undefined),
    },
  ]

  return (
    <div
      className={`grid grid-cols-2 gap-px rounded-xl overflow-hidden ${showMoney ? 'sm:grid-cols-5' : 'sm:grid-cols-3'}`}
      style={{ border: '1px solid var(--border-color)', background: 'var(--border-color)' }}
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={`flex flex-col items-center justify-center text-center py-4 px-2 gap-1 ${i === stats.length - 1 ? 'col-span-2 sm:col-span-1' : ''}`}
          style={{ background: 'var(--bg-color)' }}
        >
          <span
            className="text-base sm:text-sm lg:text-base font-bold tabular-nums leading-tight"
            style={{ color: 'var(--primary-color)' }}
          >
            {s.value}
          </span>
          {s.sub && <span className="text-[11px] text-xinuco-muted">{s.sub}</span>}
          <span className="text-[10px] uppercase tracking-wider text-xinuco-muted">
            {s.label}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Próximas citas ────────────────────────────────────────────────────────────

function UpcomingAppointments({ expediente }: { expediente: CustomerExpediente }) {
  return (
    <section className="p-5 rounded-2xl flex flex-col gap-3" style={CARD_STYLE}>
      <h3 className="text-sm font-semibold text-xinuco-text flex items-center gap-2">
        <CalendarClock size={15} style={{ color: 'var(--primary-color)' }} />
        Próximas citas
      </h3>
      <div className="flex flex-col">
        {expediente.upcoming.map((a, idx) => (
          <div
            key={a.id}
            className="flex items-start justify-between gap-3 py-3"
            style={{ borderTop: idx === 0 ? undefined : '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-xinuco-text">{a.service_name}</span>
                <StatusBadge status={a.status} />
              </div>
              {a.staff_name && <p className="text-xs text-xinuco-muted mt-0.5">{a.staff_name}</p>}
              {a.products.length > 0 && (
                <p className="text-xs text-xinuco-muted mt-1 flex items-center gap-1.5 flex-wrap">
                  <ShoppingBag size={11} className="text-xinuco-muted/60" />
                  Productos apartados:{' '}
                  {a.products.map(p => `${p.name} ×${p.quantity}`).join(', ')}
                </p>
              )}
            </div>
            <span className="text-xs font-semibold tabular-nums flex-shrink-0" style={{ color: 'var(--primary-color)' }}>
              {formatApptDateTime(a.start_time)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Selector de barbero preferido ─────────────────────────────────────────────

function PreferredBarberSelector({
  expediente,
  onRefresh,
}: {
  expediente: CustomerExpediente
  onRefresh:  () => void
}) {
  const isAdmin = useIsAdmin()
  const [value, setValue] = useState(expediente.customer.preferred_staff_id ?? '')
  const [isSaving, startSave] = useTransition()
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setValue(expediente.customer.preferred_staff_id ?? '')
  }, [expediente.customer.preferred_staff_id])

  function handleChange(staffId: string) {
    const previous = value
    setValue(staffId)
    setSaveError(null)
    startSave(async () => {
      const res = await updateCustomerPreferences(expediente.customer.id, {
        preferred_staff_id: staffId || null,
      })
      if (res.error) {
        setValue(previous)
        setSaveError(res.error)
      }
      onRefresh()
    })
  }

  // Solo el administrador cambia el barbero preferido; el profesional lo ve en solo lectura
  if (!isAdmin) {
    const preferred = expediente.staff_list.find(s => s.id === expediente.customer.preferred_staff_id)
    return (
      <div className="p-4 rounded-xl" style={CARD_STYLE}>
        <p className="text-sm text-xinuco-text">
          <span className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">Barbero preferido</span>
          <span className="block mt-1">{preferred ? preferred.full_name : 'Sin preferencia'}</span>
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 rounded-xl flex flex-wrap items-center gap-4" style={CARD_STYLE}>
      <div className="flex-1">
        <label
          htmlFor="preferred-barber"
          className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider"
        >
          Barbero preferido
        </label>
        <select
          id="preferred-barber"
          value={value}
          onChange={e => handleChange(e.target.value)}
          disabled={isSaving}
          className="mt-1.5 input-base w-full disabled:opacity-60"
        >
          <option value="">Sin preferencia</option>
          {expediente.staff_list.map(s => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </select>
      </div>
      {isSaving && <Loader2 size={16} className="animate-spin text-xinuco-muted flex-shrink-0" />}
      {saveError && (
        <p role="alert" className="text-xs text-red-400 basis-full">{saveError}</p>
      )}
    </div>
  )
}

// ── Notas del equipo ──────────────────────────────────────────────────────────

const NOTE_MAX = 1000

function TeamNotes({
  expediente,
  onRefresh,
}: {
  expediente: CustomerExpediente
  onRefresh:  () => void
}) {
  const [notes, setNotes] = useState<CustomerNoteWithAuthor[]>(expediente.notes)
  const [content, setContent] = useState('')
  const [isAdding, startAdd] = useTransition()
  const [addError, setAddError] = useState<string | null>(null)

  useEffect(() => {
    setNotes(expediente.notes)
  }, [expediente.notes])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setAddError(null)
    startAdd(async () => {
      const result = await addCustomerNote(expediente.customer.id, content)
      if (result.error) {
        setAddError(result.error)
        return
      }
      if (result.note) {
        setNotes(prev => [result.note as CustomerNoteWithAuthor, ...prev])
      }
      setContent('')
      onRefresh()
    })
  }

  return (
    <section className="p-5 rounded-2xl flex flex-col gap-4" style={CARD_STYLE}>
      <h3 className="text-sm font-semibold text-xinuco-text">Notas del Equipo</h3>

      {/* Timeline de notas */}
      <div className="flex flex-col gap-0">
        {notes.length === 0 ? (
          <p className="text-xs text-xinuco-muted py-3 text-center">
            Sin notas aún. Agrega la primera nota después de la visita.
          </p>
        ) : (
          notes.map((note, idx) => (
            <div key={note.id} className="flex gap-3">
              {/* Línea vertical del timeline */}
              <div className="flex flex-col items-center flex-shrink-0 pt-1">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: 'var(--primary-color)' }}
                />
                {idx < notes.length - 1 && (
                  <div
                    className="w-px flex-1 mt-1 min-h-[1rem]"
                    style={{ background: 'var(--border-color)' }}
                  />
                )}
              </div>

              {/* Contenido de la nota */}
              <div className="pb-4 flex-1 min-w-0">
                <p className="text-sm text-xinuco-text leading-relaxed whitespace-pre-wrap break-words">
                  {note.content}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-xinuco-muted">
                    {note.author_name || note.staff_name || 'Equipo'}
                  </span>
                  <span className="text-xinuco-muted/30">·</span>
                  <span className="text-[10px] text-xinuco-muted tabular-nums">
                    {formatInstantDay(note.created_at)}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Formulario de nueva nota */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2"
        style={{ borderTop: notes.length > 0 ? '1px solid var(--border-color)' : undefined, paddingTop: notes.length > 0 ? '1rem' : undefined }}
      >
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Agregar nota técnica (textura del cabello, alergias, preferencias de corte…)"
          rows={3}
          maxLength={NOTE_MAX}
          disabled={isAdding}
          className="input-base resize-none text-sm disabled:opacity-60"
        />
        {addError && (
          <p
            role="alert"
            className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 animate-fade-in"
          >
            {addError}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] text-xinuco-muted tabular-nums">
            {content.length}/{NOTE_MAX}
          </span>
          <button
            type="submit"
            disabled={isAdding || !content.trim()}
            className="flex items-center gap-2 btn-primary !py-2 !px-4 text-sm disabled:opacity-40"
          >
            {isAdding ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Agregar nota
          </button>
        </div>
      </form>
    </section>
  )
}

// ── Productos comprados ───────────────────────────────────────────────────────

function PurchasedProducts({ expediente }: { expediente: CustomerExpediente }) {
  return (
    <section className="p-5 rounded-2xl flex flex-col gap-3" style={CARD_STYLE}>
      <h3 className="text-sm font-semibold text-xinuco-text flex items-center gap-2">
        <ShoppingBag size={15} style={{ color: 'var(--primary-color)' }} />
        Productos comprados
      </h3>
      <div className="flex flex-col">
        {expediente.purchased_products.map((p, idx) => (
          <div
            key={`${p.created_at}-${idx}`}
            className="flex items-center justify-between gap-3 py-2.5"
            style={{ borderTop: idx === 0 ? undefined : '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="min-w-0">
              <p className="text-sm text-xinuco-text truncate">
                {p.description}
                {p.quantity > 1 && <span className="text-xinuco-muted"> ×{p.quantity}</span>}
              </p>
              <p className="text-[10px] text-xinuco-muted tabular-nums">{formatInstantDay(p.created_at)}</p>
            </div>
            {p.total_price !== null && (
              <span className="text-sm font-semibold tabular-nums flex-shrink-0" style={{ color: 'var(--primary-color)' }}>
                {formatCOP(p.total_price)}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Historial de visitas ──────────────────────────────────────────────────────

function VisitHistory({ expediente }: { expediente: CustomerExpediente }) {
  const [expanded, setExpanded] = useState(true)
  const [showAll, setShowAll] = useState(false)
  // Sin montos (barbero): el historial muestra solo fecha, servicio y barbero
  const showMoney = expediente.total_spent !== null

  const visitsToShow = showAll
    ? expediente.visits
    : expediente.visits.slice(0, 10)

  return (
    <section
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid var(--border-color)' }}
    >
      {/* Accordion header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
        style={{ background: 'var(--surface-color, rgba(255,255,255,0.02))' }}
      >
        <span className="text-sm font-semibold text-xinuco-text">
          Historial de Visitas
          {expediente.visits.length > 0 && (
            <span className="ml-2 text-xs text-xinuco-muted font-normal">
              ({expediente.visits.length})
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp size={16} className="text-xinuco-muted" />
        ) : (
          <ChevronDown size={16} className="text-xinuco-muted" />
        )}
      </button>

      {/* Lista de visitas */}
      {expanded && (
        <div className="flex flex-col">
          {expediente.visits.length === 0 ? (
            <p className="text-xs text-xinuco-muted px-5 py-6 text-center">
              Sin visitas registradas.
            </p>
          ) : (
            <>
              {visitsToShow.map((v, idx) => (
                <div
                  key={v.id}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.02] transition-colors"
                  style={{
                    borderTop: idx === 0 ? '1px solid var(--border-color)' : '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  {/* Dot de color */}
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor:
                        v.status === 'completed'
                          ? '#34d399'
                          : v.status === 'cancelled'
                          ? '#f87171'
                          : 'rgba(255,255,255,0.2)',
                    }}
                  />

                  {/* Servicio + barbero */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-xinuco-text font-medium">
                        {v.service_name}
                      </span>
                      <StatusBadge status={v.status} />
                    </div>
                    {v.staff_name && (
                      <span className="text-xs text-xinuco-muted">
                        {v.staff_name}
                      </span>
                    )}
                  </div>

                  {/* Fecha (start_time) + monto pagado real */}
                  <div className="text-right flex-shrink-0">
                    {showMoney && (
                      <div
                        className="text-sm font-bold tabular-nums"
                        style={{ color: v.amount_paid != null ? 'var(--primary-color)' : 'var(--text-muted)' }}
                      >
                        {v.amount_paid != null ? formatCOP(v.amount_paid) : '—'}
                      </div>
                    )}
                    <div className="text-[10px] text-xinuco-muted tabular-nums">
                      {formatApptDay(v.start_time)}
                    </div>
                  </div>
                </div>
              ))}

              {/* Ver más */}
              {!showAll && expediente.visits.length > 10 && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="w-full text-center text-xs text-xinuco-muted hover:text-xinuco-text py-3 transition-colors"
                  style={{ borderTop: '1px solid var(--border-color)' }}
                >
                  Ver más ({expediente.visits.length - 10} restantes)
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
