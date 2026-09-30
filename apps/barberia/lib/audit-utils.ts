// lib/audit-utils.ts — lógica PURA de la Auditoría (frases, categorías, fechas de Bogotá, alertas, detalle).
// Sin 'use client' ni 'use server': usable desde Server Actions y Client Components.

import type { AuditCategory, AuditLog } from '@xinuco/types'
import { addDaysToDateKey } from '@/lib/agenda-time'
import { formatMoney } from '@/lib/loyalty-utils'
import { bogotaDateKey, isRealDateKey } from '@/lib/team-payments'
import { DEFAULT_EXPENSE_CATEGORIES } from '@/lib/expense-utils'

export type { AuditCategory }

// ── Categorías ────────────────────────────────────────────────────────────────

export const AUDIT_CATEGORIES: { key: AuditCategory; label: string }[] = [
  { key: 'money',        label: 'Dinero' },
  { key: 'cash',         label: 'Caja' },
  { key: 'inventory',    label: 'Inventario' },
  { key: 'appointments', label: 'Citas' },
  { key: 'team',         label: 'Equipo' },
  { key: 'settings',     label: 'Configuración' },
  { key: 'customers',    label: 'Clientes' },
]

export const AUDIT_CATEGORY_LABEL: Record<AuditCategory, string> = Object.fromEntries(
  AUDIT_CATEGORIES.map(c => [c.key, c.label]),
) as Record<AuditCategory, string>

const VALID_CATEGORIES = new Set<string>(AUDIT_CATEGORIES.map(c => c.key))

export function isAuditCategory(value: unknown): value is AuditCategory {
  return typeof value === 'string' && VALID_CATEGORIES.has(value)
}

const PREFIX_CATEGORY: Record<string, AuditCategory> = {
  appointment:     'appointments',
  staff:           'team',
  shift:           'cash',
  inventory_item:  'inventory',
  product:         'inventory',
  inventory:       'inventory',
  fixed_asset:     'money',
  sale:            'money',
  ledger:          'money',
  expense:         'money',
  commission_rule: 'money',
  service:         'settings',
  business:        'settings',
  loyalty:         'customers',
  audit:           'settings',
}

/** Categoría del registro: la guardada o, en registros antiguos, la derivada del prefijo de la acción. */
export function auditCategoryOf(log: Pick<AuditLog, 'category' | 'action'>): AuditCategory {
  if (isAuditCategory(log.category)) return log.category
  const prefix = (log.action ?? '').split('.')[0]
  return PREFIX_CATEGORY[prefix] ?? 'settings'
}

// ── Frase ─────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  scheduled:       'agendada',
  payment_pending: 'pendiente de pago',
  in_progress:     'en atención',
  ready_to_pay:    'lista para cobrar',
  completed:       'completada',
  cancelled:       'cancelada',
  no_show:         'no asistió',
}

type Obj = Record<string, unknown>

function asObj(v: unknown): Obj | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

type SentenceLog = Pick<AuditLog, 'action' | 'summary' | 'old_value' | 'new_value'>

/** Frase en español SIN el actor ("anuló una venta de $35.000"). */
export function auditSentence(log: SentenceLog): string {
  const summary = str(log.summary)
  if (summary) return summary

  const oldV = asObj(log.old_value)
  const newV = asObj(log.new_value)
  const name = str(newV?.name) ?? str(newV?.full_name) ?? str(newV?.nombre)
    ?? str(oldV?.name) ?? str(oldV?.full_name) ?? str(oldV?.nombre)
  const quoted = name ? ` "${name}"` : ''

  switch (log.action) {
    case 'appointment.status_changed': {
      const before = str(oldV?.status)
      const after = str(newV?.status)
      if (before && after) {
        return `cambió el estado de una cita: ${STATUS_LABEL[before] ?? before} → ${STATUS_LABEL[after] ?? after}`
      }
      return 'cambió el estado de una cita'
    }
    case 'staff.created':
      return name ? `agregó a ${name} al equipo` : 'agregó un profesional al equipo'
    case 'staff.updated':
      return name ? `editó los datos de ${name}` : 'editó los datos de un profesional'
    case 'staff.services_changed':
      return name ? `cambió los servicios que hace ${name}` : 'cambió los servicios que hace un profesional'
    case 'shift.opened': {
      const base = num(newV?.opening_balance)
      return base !== null ? `abrió la caja con una base de ${formatMoney(base)}` : 'abrió la caja'
    }
    case 'shift.closed': {
      const counted = num(newV?.actual_closing_balance)
      return counted !== null ? `cerró la caja contando ${formatMoney(counted)}` : 'cerró la caja'
    }
    case 'inventory_item.created':
      return `creó el producto${quoted}`
    case 'inventory_item.updated':
      return `editó el producto${quoted}`
    case 'inventory_item.deactivated':
      return `desactivó el producto${quoted}`
    case 'fixed_asset.created':
      return `registró el activo fijo${quoted}`
    case 'fixed_asset.updated':
      return `editó el activo fijo${quoted}`
    case 'fixed_asset.disposed':
      return `dio de baja el equipo${quoted}`
    case 'fixed_asset.deactivated':
      return `dio de baja el activo fijo${quoted}`
    default:
      return 'realizó una acción en el sistema'
  }
}

// ── Fechas de Bogotá ──────────────────────────────────────────────────────────

/**
 * Filtro por días de Colombia (UTC−5 fijo): `from` = inicio de ese día (inclusive),
 * `to` = inicio del día SIGUIENTE (exclusivo). Valores que no son fechas reales se ignoran.
 */
export function bogotaDayRange(from?: string | null, to?: string | null): { fromIso?: string; toIso?: string } {
  const out: { fromIso?: string; toIso?: string } = {}
  if (isRealDateKey(from)) out.fromIso = `${from}T00:00:00-05:00`
  if (isRealDateKey(to)) out.toIso = `${addDaysToDateKey(to, 1)}T00:00:00-05:00`
  return out
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

function bogotaParts(iso: string): { y: string; mo: number; d: string; hh: string; mm: string } | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return { y: get('year'), mo: Number(get('month')), d: get('day'), hh: get('hour').padStart(2, '0'), mm: get('minute') }
}

/** '2026-09-30T19:05:00Z' → '30 sep 2026 · 14:05' (hora de Colombia). */
export function formatAuditTime(iso: string): string {
  const p = bogotaParts(iso)
  if (!p) return ''
  return `${Number(p.d)} ${MONTHS[p.mo - 1]} ${p.y} · ${p.hh}:${p.mm}`
}

/** '2026-09-30T19:05:00Z' → '14:05' (hora de Colombia). */
export function formatAuditClock(iso: string): string {
  const p = bogotaParts(iso)
  return p ? `${p.hh}:${p.mm}` : ''
}

/** Día 'YYYY-MM-DD' en Colombia de un instante real. */
export function auditDayKey(iso: string): string {
  return bogotaDateKey(iso)
}

/** 'Hoy', 'Ayer' o 'lun 28 sep' (con el año si no es el actual). */
export function auditDayLabel(dayKey: string, todayKey: string): string {
  if (dayKey === todayKey) return 'Hoy'
  if (dayKey === addDaysToDateKey(todayKey, -1)) return 'Ayer'
  const [y, m, d] = dayKey.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  const year = String(y) === todayKey.slice(0, 4) ? '' : ` ${y}`
  return `${weekday} ${d} ${MONTHS[m - 1]}${year}`
}

// ── Filtro por quién ──────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 'id:<uuid>' | 'name:<texto>' → filtro estructurado (null si no es válido). */
export function parseActorFilter(value?: string | null): { id: string } | { name: string } | null {
  if (!value) return null
  if (value.startsWith('id:')) {
    const id = value.slice(3)
    return UUID_RE.test(id) ? { id } : null
  }
  if (value.startsWith('name:')) {
    const name = value.slice(5).trim()
    return name ? { name } : null
  }
  return null
}

export interface AuditActorOption {
  /** 'id:<uuid>' o 'name:<texto>' */
  value: string
  label: string
}

export interface AuditFilters {
  category?:     AuditCategory
  actor?:        string
  /** YYYY-MM-DD (día de Colombia) */
  from?:         string
  to?:           string
  onlyWarnings?: boolean
  /** Último registro ya cargado (created_at + id: varios registros pueden compartir la hora) */
  before?:       { createdAt: string; id: string }
}

// ── Alertas de los últimos 7 días ─────────────────────────────────────────────

export interface AuditAlertRow {
  action:   string
  amount:   number | null
  severity: string
}

export interface AuditAlertItem {
  key:     string
  label:   string
  count:   number
  amount?: number
  tone:    'warning' | 'info'
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function summarizeAlerts(rows: AuditAlertRow[]): AuditAlertItem[] {
  const acc = {
    voided:   { count: 0, sum: 0 },
    discount: { count: 0, sum: 0 },
    shortfall: { count: 0, sum: 0 },
    advance:  { count: 0, sum: 0 },
    expenseDeleted: 0,
    priceChange: 0,
    commission: 0,
    purged: 0,
  }

  for (const r of rows) {
    const amount = typeof r.amount === 'number' ? r.amount : 0
    if (r.action === 'sale.voided') { acc.voided.count++; acc.voided.sum += amount }
    else if (r.action === 'sale.discount') { acc.discount.count++; acc.discount.sum += amount }
    else if (r.action === 'shift.closed' && amount < 0) { acc.shortfall.count++; acc.shortfall.sum += -amount }
    else if (r.action === 'ledger.advance') { acc.advance.count++; acc.advance.sum += amount }
    else if (r.action === 'expense.deleted') acc.expenseDeleted++
    else if (r.action === 'service.price_changed' || r.action === 'product.price_changed') acc.priceChange++
    else if (r.action.startsWith('commission_rule.')) acc.commission++
    else if (r.action === 'audit.purged') acc.purged++
  }

  const items: AuditAlertItem[] = []
  const withMoney = (label: string, sum: number) => (sum > 0 ? `${label} · ${formatMoney(sum)}` : label)

  if (acc.voided.count > 0) {
    items.push({
      key: 'voided', count: acc.voided.count, amount: acc.voided.sum, tone: 'warning',
      label: withMoney(plural(acc.voided.count, 'anulación', 'anulaciones'), acc.voided.sum),
    })
  }
  if (acc.discount.count > 0) {
    items.push({
      key: 'discount', count: acc.discount.count, amount: acc.discount.sum, tone: 'info',
      label: withMoney(plural(acc.discount.count, 'descuento', 'descuentos'), acc.discount.sum),
    })
  }
  if (acc.shortfall.count > 0) {
    items.push({
      key: 'shortfall', count: acc.shortfall.count, amount: acc.shortfall.sum, tone: 'warning',
      label: withMoney(plural(acc.shortfall.count, 'cierre con faltante', 'cierres con faltante'), acc.shortfall.sum),
    })
  }
  if (acc.advance.count > 0) {
    items.push({
      key: 'advance', count: acc.advance.count, amount: acc.advance.sum, tone: 'warning',
      label: withMoney(plural(acc.advance.count, 'anticipo', 'anticipos'), acc.advance.sum),
    })
  }
  if (acc.expenseDeleted > 0) {
    items.push({
      key: 'expense_deleted', count: acc.expenseDeleted, tone: 'warning',
      label: plural(acc.expenseDeleted, 'gasto eliminado', 'gastos eliminados'),
    })
  }
  if (acc.priceChange > 0) {
    items.push({
      key: 'price_change', count: acc.priceChange, tone: 'warning',
      label: plural(acc.priceChange, 'cambio de precio', 'cambios de precio'),
    })
  }
  if (acc.commission > 0) {
    items.push({
      key: 'commission', count: acc.commission, tone: 'warning',
      label: plural(acc.commission, 'cambio de comisiones', 'cambios de comisiones'),
    })
  }
  if (acc.purged > 0) {
    items.push({
      key: 'audit_purged', count: acc.purged, tone: 'warning',
      label: plural(acc.purged, 'borrado de auditoría', 'borrados de auditoría'),
    })
  }
  return items
}

// ── "Ver detalle": antes / después ────────────────────────────────────────────

export interface DiffRow {
  campo:   string
  antes:   string
  despues: string
}

const FIELD_LABEL: Record<string, string> = {
  precio: 'Precio',
  monto: 'Monto',
  estado: 'Estado',
  nombre: 'Nombre',
  duracion: 'Duración (min)',
  descripcion: 'Descripción',
  fecha: 'Fecha',
  categoria: 'Categoría',
  esperado: 'Esperado',
  contado: 'Contado',
  diferencia: 'Diferencia',
  subtotal: 'Subtotal',
  descuento: 'Descuento',
  total: 'Total',
  motivo: 'Motivo',
  tipo: 'Tipo',
  cantidad: 'Cantidad',
  costo_total: 'Costo total',
  nota: 'Nota',
  cambio: 'Cambio',
  commission_percentage: 'Comisión %',
  fixed_amount: 'Monto fijo',
  product_percentage: 'Comisión productos %',
  opening_balance: 'Base',
  actual_closing_balance: 'Contado',
  status: 'Estado',
  full_name: 'Nombre',
  name: 'Nombre',
  purchase_price: 'Precio de compra',
  salvage_value: 'Valor de rescate',
  unit_price: 'Precio de venta',
  unit_cost: 'Costo',
  amount: 'Monto',
  description: 'Descripción',
  category: 'Categoría',
  expense_date: 'Fecha',
  payment_method: 'Medio de pago',
  specialty_role: 'Especialidad',
  servicios: 'Servicios',
  is_recurring: 'Gasto fijo mensual',
  auto_registered: 'Registrado automáticamente',
  notes: 'Nota',
  duration_minutes: 'Duración (min)',
  price_cop: 'Precio',
  is_active: 'Activo',
  vida_util_meses: 'Vida útil (meses)',
  medio_de_pago: 'Medio de pago',
  valor_residual: 'Valor residual',
  metodo: 'Método',
  valor_en_libros: 'Valor en libros',
}

const MONEY_KEYS = new Set([
  'precio', 'monto', 'esperado', 'contado', 'diferencia', 'subtotal', 'descuento', 'total', 'costo_total',
  'fixed_amount', 'opening_balance', 'actual_closing_balance', 'purchase_price', 'salvage_value',
  'unit_price', 'unit_cost', 'amount', 'valor_residual', 'valor_en_libros',
])

const VALUE_LABEL: Record<string, string> = {
  ...STATUS_LABEL,
  open: 'abierta', closed: 'cerrada', voided: 'anulada',
  advance: 'anticipo', payment: 'pago', bonus: 'bono', deduction: 'descuento',
  purchase: 'compra', waste: 'merma', count: 'conteo', adjustment: 'ajuste', adjust: 'ajuste',
  stamps: 'sellos', points: 'puntos',
  cash: 'efectivo', cash_register: 'efectivo de la caja', transfer: 'transferencia', other: 'otro',
  todos: 'todos',
  straight_line: 'Línea recta', declining_balance: 'Saldo decreciente',
}

// Categorías de gasto por defecto: slug → nombre (las propias del negocio se muestran tal cual)
const EXPENSE_CATEGORY_NAME: Record<string, string> = Object.fromEntries(
  DEFAULT_EXPENSE_CATEGORIES.map(c => [c.slug, c.name]),
)

const TRANSLATED_VALUE_KEYS = new Set(['estado', 'status', 'tipo', 'payment_method', 'medio_de_pago', 'metodo'])

function isHiddenKey(key: string): boolean {
  return key === 'id' || key === 'business_id' || key.endsWith('_id') || key.endsWith('_at')
}

function isHiddenValue(v: unknown): boolean {
  return typeof v === 'string' && UUID_RE.test(v)
}

function humanizeKey(key: string): string {
  const s = key.replace(/_/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (MONEY_KEYS.has(key)) {
    const n = num(v)
    if (n !== null) return formatMoney(n)
  }
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (typeof v === 'string') {
    if (key === 'categoria' || key === 'category') return EXPENSE_CATEGORY_NAME[v] ?? v
    return TRANSLATED_VALUE_KEYS.has(key) ? (VALUE_LABEL[v] ?? v) : v
  }
  if (typeof v === 'number') return String(v)
  return JSON.stringify(v)
}

/** Filas "Campo / Antes / Después". Omite ids, marcas de tiempo, valores tipo uuid y lo que no cambió. */
export function diffRows(oldValue: unknown, newValue: unknown): DiffRow[] {
  const o = asObj(oldValue)
  const n = asObj(newValue)
  if (!o && !n) return []
  const keys = Array.from(new Set([...Object.keys(o ?? {}), ...Object.keys(n ?? {})]))
  const rows: DiffRow[] = []
  for (const key of keys) {
    if (isHiddenKey(key)) continue
    const ov = o?.[key]
    const nv = n?.[key]
    if (isHiddenValue(ov) || isHiddenValue(nv)) continue
    if (o && n && key in o && key in n && JSON.stringify(ov) === JSON.stringify(nv)) continue
    rows.push({
      campo:   FIELD_LABEL[key] ?? humanizeKey(key),
      antes:   formatValue(key, ov),
      despues: formatValue(key, nv),
    })
  }
  return rows
}
