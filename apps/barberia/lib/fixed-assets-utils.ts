// lib/fixed-assets-utils.ts — lógica PURA de Activos fijos (categorías, vida útil, valor estimado, errores).
// Sin 'use client' ni 'use server': usable desde Server Actions y Client Components.
// `estimateValue` replica la función SQL `_asset_value_on` para mostrar una vista previa inmediata;
// los valores oficiales siempre salen de la base de datos.

import type {
  AssetPaymentMethod,
  DepreciationMethod,
  DisposalReason,
  FixedAssetCategory,
} from '@xinuco/types'

// ── Categorías ────────────────────────────────────────────────────────────────

export interface AssetCategoryInfo {
  label:         string
  hint:          string
  /** Vida útil sugerida, en meses. */
  defaultMonths: number
}

export const ASSET_CATEGORIES: Record<FixedAssetCategory, AssetCategoryInfo> = {
  furniture:    { label: 'Mobiliario',              hint: 'Sillas, espejos, lavacabezas, muebles',           defaultMonths: 120 },
  equipment:    { label: 'Máquinas y herramientas', hint: 'Patilleras, secadores, planchas, esterilizador',  defaultMonths: 36 },
  technology:   { label: 'Tecnología',              hint: 'Computador, tablet, datáfono, TV, sonido',        defaultMonths: 60 },
  improvements: { label: 'Adecuaciones',            hint: 'Remodelación, iluminación, pisos',                defaultMonths: 60 },
  vehicle:      { label: 'Vehículo',                hint: 'Activo anterior',                                 defaultMonths: 120 },
  other:        { label: 'Otros',                   hint: 'Cualquier otro equipo del negocio',               defaultMonths: 60 },
}

/** Categorías que se ofrecen al crear o editar (vehículo queda solo como etiqueta de activos antiguos). */
export const SELECTABLE_CATEGORIES: FixedAssetCategory[] = [
  'furniture', 'equipment', 'technology', 'improvements', 'other',
]

export function categoryLabel(category: string): string {
  return ASSET_CATEGORIES[category as FixedAssetCategory]?.label ?? 'Otros'
}

export function categoryDefaultMonths(category: string): number {
  return ASSET_CATEGORIES[category as FixedAssetCategory]?.defaultMonths ?? 60
}

// ── Etiquetas ─────────────────────────────────────────────────────────────────

export const DISPOSAL_REASONS: Record<DisposalReason, string> = {
  sold:    'Vendido',
  damaged: 'Dañado',
  stolen:  'Robado',
  donated: 'Regalado',
  other:   'Otro motivo',
}

export const DISPOSAL_REASON_ORDER: DisposalReason[] = ['sold', 'damaged', 'stolen', 'donated', 'other']

/** Motivos que exigen explicar qué pasó. */
export function disposalNeedsNote(reason: DisposalReason): boolean {
  return reason === 'damaged' || reason === 'stolen' || reason === 'other'
}

export const METHOD_LABELS: Record<DepreciationMethod, string> = {
  straight_line:     'Línea recta',
  declining_balance: 'Saldo decreciente',
}

export const METHOD_HINTS: Record<DepreciationMethod, string> = {
  straight_line:     'Se desgasta lo mismo cada mes.',
  declining_balance: 'Se desgasta más al principio y menos después.',
}

/** Cómo se pagó la compra del equipo. */
export const PURCHASE_PAYMENT_LABELS: Record<AssetPaymentMethod, string> = {
  cash_register: 'Efectivo de la caja',
  transfer:      'Transferencia',
  other:         'Otro',
}

/** Cómo se recibió el dinero de la venta del equipo. */
export const SALE_PAYMENT_LABELS: Record<AssetPaymentMethod, string> = {
  cash_register: 'Efectivo a la caja',
  transfer:      'Transferencia',
  other:         'Otro',
}

export const PAYMENT_ORDER: AssetPaymentMethod[] = ['transfer', 'cash_register', 'other']

// ── Límites (espejo de la base de datos) ──────────────────────────────────────

export const MAX_ASSET_PRICE = 2_000_000_000
export const MIN_ASSET_DATE = '2000-01-01'
export const MIN_LIFE_MONTHS = 1
export const MAX_LIFE_MONTHS = 600

// ── Formato ───────────────────────────────────────────────────────────────────

/** '10 años', '3 años', '18 meses', '2 años y 6 meses', '1 año', '1 mes'. */
export function lifeLabel(months: number): string {
  const m = Math.max(0, Math.round(Number.isFinite(months) ? months : 0))
  if (m < 12 || (m > 12 && m < 24)) return `${m} ${m === 1 ? 'mes' : 'meses'}`
  const years = Math.floor(m / 12)
  const rest = m % 12
  const y = `${years} ${years === 1 ? 'año' : 'años'}`
  return rest === 0 ? y : `${y} y ${rest} ${rest === 1 ? 'mes' : 'meses'}`
}

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTHS_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

interface YMD { y: number; m: number; d: number }

function parseISODate(iso: string): YMD | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { y, m, d }
}

/** '2026-09-30' → '30 sep 2026'. */
export function formatDateES(iso: string | null | undefined): string {
  const p = parseISODate(iso ?? '')
  return p ? `${p.d} ${MONTHS_SHORT[p.m - 1]} ${p.y}` : ''
}

/** '2026-09-30' → 'septiembre 2026'. */
export function monthYearES(iso: string | null | undefined): string {
  const p = parseISODate(iso ?? '')
  return p ? `${MONTHS_LONG[p.m - 1]} ${p.y}` : ''
}

// ── Valor estimado ────────────────────────────────────────────────────────────

export interface AssetValueInput {
  purchase_date:       string
  purchase_price:      number
  salvage_value:       number
  useful_life_months:  number
  depreciation_method: DepreciationMethod
  disposed_at?:        string | null
}

/** Meses completos entre dos fechas (como AGE de Postgres: si aún no llega el día del mes, no cuenta ese mes). */
export function fullMonthsBetween(fromISO: string, toISO: string): number {
  const a = parseISODate(fromISO)
  const b = parseISODate(toISO)
  if (!a || !b) return 0
  let months = (b.y - a.y) * 12 + (b.m - a.m)
  if (b.d < a.d) months -= 1
  return Math.max(months, 0)
}

/** Suma meses a una fecha ISO (el día se recorta al último del mes si hace falta). */
export function addMonthsISO(iso: string, months: number): string {
  const p = parseISODate(iso)
  if (!p) return iso
  const total = p.y * 12 + (p.m - 1) + months
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const d = Math.min(p.d, lastDay)
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Valor del equipo en una fecha (COP). Replica `_asset_value_on` de la base:
 * meses completos desde la compra (tope: vida útil) y, si ya se dio de baja, congelado en ese día.
 */
export function estimateValue(asset: AssetValueInput, onDateISO: string): number {
  let on = onDateISO
  if (asset.disposed_at && on > asset.disposed_at) on = asset.disposed_at
  if (on <= asset.purchase_date) return asset.purchase_price

  const life = asset.useful_life_months
  if (!(life >= 1)) return asset.purchase_price
  const months = Math.min(Math.max(fullMonthsBetween(asset.purchase_date, on), 0), life)

  if (asset.depreciation_method === 'declining_balance') {
    const rate = (2 / (life / 12)) / 12
    let value = asset.purchase_price
    for (let i = 0; i < months; i++) {
      value = Math.max(Math.floor(value * (1 - rate)), asset.salvage_value)
    }
    if (months >= life) value = asset.salvage_value
    return value
  }

  return asset.purchase_price - Math.floor(((asset.purchase_price - asset.salvage_value) * months) / life)
}

/** Desgaste mensual en línea recta: floor((precio − residual) / vida). */
export function monthlyDepreciation(price: number, salvage: number, lifeMonths: number): number {
  if (!(lifeMonths >= 1)) return 0
  return Math.max(Math.floor((price - salvage) / lifeMonths), 0)
}

/** Desgaste del primer mes (en saldo decreciente es el mayor; en línea recta es el de todos). */
export function firstMonthDepreciation(asset: AssetValueInput): number {
  return Math.max(
    asset.purchase_price - estimateValue({ ...asset, disposed_at: null }, addMonthsISO(asset.purchase_date, 1)),
    0,
  )
}

/** Fecha en que termina de desgastarse (compra + vida útil). */
export function fullyDepreciatedOn(asset: Pick<AssetValueInput, 'purchase_date' | 'useful_life_months'>): string {
  return addMonthsISO(asset.purchase_date, asset.useful_life_months)
}

/** % ya desgastado (0–100) de lo que se puede desgastar (precio − valor residual). */
export function usedPercent(
  asset: Pick<AssetValueInput, 'purchase_price' | 'salvage_value'>,
  value: number,
): number {
  const depreciable = asset.purchase_price - asset.salvage_value
  if (!(depreciable > 0)) return 0
  const pct = ((asset.purchase_price - value) / depreciable) * 100
  return Math.min(Math.max(Math.round(pct), 0), 100)
}

/** Resultado de dar de baja: lo recibido − lo que valía (positivo = ganancia). */
export function disposalResult(price: number | null | undefined, bookValue: number): number {
  return (price ?? 0) - bookValue
}

// ── Errores ───────────────────────────────────────────────────────────────────

const ERROR_TABLE: [string, string][] = [
  ['forbidden_field',       'Ese dato no se puede cambiar desde aquí.'],
  ['asset_disposed',        'Este equipo ya fue dado de baja y no se puede editar.'],
  ['already_disposed',      'Este equipo ya fue dado de baja.'],
  ['forbidden',             'Solo un administrador puede manejar los activos fijos.'],
  ['name_required',         'Escribe el nombre del equipo.'],
  ['invalid_category',      'Elige una categoría válida.'],
  ['invalid_date',          'La fecha no es válida: no puede ser futura, anterior al 2000 ni anterior a la compra.'],
  ['invalid_price',         'El precio no es válido.'],
  ['invalid_salvage',       'El valor residual debe ser menor que el precio.'],
  ['invalid_life',          'La vida útil debe estar entre 1 mes y 50 años.'],
  ['invalid_method',        'El método de desgaste no es válido.'],
  ['invalid_payment_method', 'Elige cómo se pagó.'],
  ['invalid_account',        'Elige un medio de pago activo.'],
  ['invalid_reason',        'Elige el motivo de la baja.'],
  ['reason_required',       'Cuéntanos qué pasó con el equipo.'],
  ['shift_not_open',        'No hay una caja abierta. Abre la caja o elige otro medio de pago.'],
  ['not_found',             'No encontramos ese equipo.'],
]

/** Traduce un código de error de la base (o un mensaje que lo contenga) a un texto en español. */
export function mapAssetError(code: string | null | undefined): string {
  const msg = code ?? ''
  for (const [key, text] of ERROR_TABLE) {
    if (msg.includes(key)) return text
  }
  return 'No se pudo completar la acción. Intenta de nuevo.'
}
