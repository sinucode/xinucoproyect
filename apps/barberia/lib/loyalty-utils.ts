// lib/loyalty-utils.ts
// Lealtad v2 — tipos y helpers PUROS (sin Supabase, sin React) compartidos por
// las server actions, el modal de cobro, la configuración y el panel.

export type LoyaltyMode = 'points' | 'stamps'

/** Configuración del programa: columnas loyalty_* de `businesses`. */
export interface LoyaltyConfig {
  loyalty_mode:                 LoyaltyMode
  /** Gana 1 punto por cada $X pagados (100–1.000.000). */
  loyalty_earn_per_cop:         number
  /** Valor de 1 punto AL CANJEAR. */
  loyalty_point_value_cop:      number
  /** Mínimo de puntos para canjear (0 = sin mínimo). */
  loyalty_min_redeem_points:    number
  /** Meses de vigencia de los puntos (1–60). */
  loyalty_expiry_months:        number
  /** Sellos para un servicio gratis (2–50). */
  loyalty_stamps_required:      number
  /** Tope del servicio gratis en COP (0 = sin tope). */
  loyalty_stamp_max_reward_cop: number
}

export interface LoyaltySettings extends LoyaltyConfig {
  /** features_enabled.loyalty del negocio. */
  enabled: boolean
}

/** Respuesta del RPC get_customer_loyalty (saldo en el modo activo del negocio). */
export interface CustomerLoyalty {
  enabled:              boolean
  mode:                 LoyaltyMode
  balance:              number
  expiring_30d:         number
  point_value_cop:      number
  value_cop:            number | null
  min_redeem:           number
  stamps_required:      number
  stamp_max_reward_cop: number
  can_redeem:           boolean
}

/** Respuesta del RPC get_loyalty_summary. */
export interface LoyaltySummary {
  mode:                   LoyaltyMode
  customers_with_balance: number
  total_balance:          number
  customers_ready:        number
  redeemed_total:         number
  discount_given_cop:     number
}

export type LoyaltyEntryType = 'earn' | 'redeem' | 'adjust'

export interface LoyaltyMovement {
  id:           string
  customer:     { id: string; full_name: string; phone: string } | null
  entry_type:   LoyaltyEntryType
  /** Unidades con signo: + gana / ajuste positivo, − canje / ajuste negativo. */
  units:        number
  discount_cop: number | null
  notes:        string | null
  sale_id:      string | null
  created_at:   string
}

export const LOYALTY_LIMITS = {
  earnPerMin:      100,
  earnPerMax:      1_000_000,
  minRedeemMax:    1_000_000,
  expiryMin:       1,
  expiryMax:       60,
  stampsMin:       2,
  stampsMax:       50,
  stampCapMax:     10_000_000,
} as const

export const CASHBACK_WARN_PERCENT = 20

export const POINT_VALUE_TOO_HIGH =
  'El valor del punto al canjear debe ser menor que lo que se gasta para ganarlo; si no, devuelves el 100% o más.'

// ── Formato ───────────────────────────────────────────────────────────────────

/** 1240 → '1.240' (determinista: no depende del ICU del entorno). */
export function formatUnits(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0)
  const sign = v < 0 ? '-' : ''
  return sign + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** 62000 → '$62.000' */
export function formatMoney(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0)
  return v < 0 ? `-$${formatUnits(-v)}` : `$${formatUnits(v)}`
}

// ── Cálculos ──────────────────────────────────────────────────────────────────

/**
 * Porcentaje que devuelve el programa de puntos: valor del punto / lo que se gasta
 * para ganarlo. 1000 / 50 → 5. Un decimal como máximo.
 */
export function cashbackPercent(earnPerCop: number, pointValueCop: number): number {
  if (!(earnPerCop > 0) || !(pointValueCop > 0)) return 0
  return Math.round((pointValueCop / earnPerCop) * 1000) / 10
}

/**
 * Puntos que se pueden canjear ahora: el mayor entero con puntos × valor ≤ monto
 * a cubrir, acotado por el saldo. Si no alcanza el mínimo, 0.
 */
export function maxRedeemablePoints(
  balance:       number,
  pointValueCop: number,
  amountCop:     number,
  minRedeem:     number,
): number {
  if (!(pointValueCop > 0) || !(balance > 0) || !(amountCop > 0)) return 0
  const byAmount = Math.floor(amountCop / pointValueCop)
  const points = Math.min(Math.floor(balance), byAmount)
  if (points <= 0 || points < (minRedeem || 0)) return 0
  return points
}

/** Valor del servicio gratis con sellos: el precio del servicio, con tope opcional (0 = sin tope). */
export function stampRewardCop(servicePriceCop: number, capCop: number): number {
  const price = Math.max(0, Math.floor(servicePriceCop || 0))
  if (price === 0) return 0
  return capCop > 0 ? Math.min(price, Math.floor(capCop)) : price
}

/** 5 → '5', 2.5 → '2,5' */
function formatPercent(p: number): string {
  return String(p).replace('.', ',')
}

/** Regla del programa en una línea legible. */
export function describeRule(
  s: Pick<LoyaltyConfig,
    'loyalty_mode' | 'loyalty_earn_per_cop' | 'loyalty_point_value_cop' | 'loyalty_stamps_required' | 'loyalty_stamp_max_reward_cop'>,
): string {
  if (s.loyalty_mode === 'stamps') {
    const cap = s.loyalty_stamp_max_reward_cop > 0
      ? ` (hasta ${formatMoney(s.loyalty_stamp_max_reward_cop)})`
      : ''
    return `Cada ${s.loyalty_stamps_required} visitas, el siguiente servicio gratis${cap}`
  }
  const pct = cashbackPercent(s.loyalty_earn_per_cop, s.loyalty_point_value_cop)
  return (
    `1 punto por cada ${formatMoney(s.loyalty_earn_per_cop)} · ` +
    `cada punto vale ${formatMoney(s.loyalty_point_value_cop)} · ` +
    `devuelves el ${formatPercent(pct)}%`
  )
}

// ── Validación de la configuración (espejo de los CHECK de la BD) ─────────────

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

export function validateLoyaltyConfig(
  input: unknown,
): { value: LoyaltyConfig } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'Configuración de lealtad inválida.' }
  const i = input as Record<string, unknown>
  const L = LOYALTY_LIMITS

  if (i.loyalty_mode !== 'points' && i.loyalty_mode !== 'stamps') {
    return { error: 'Elige si tu programa es de puntos o de sellos.' }
  }
  const mode = i.loyalty_mode

  if (!isInt(i.loyalty_earn_per_cop) || i.loyalty_earn_per_cop < L.earnPerMin || i.loyalty_earn_per_cop > L.earnPerMax) {
    return { error: `Lo que se gasta para ganar 1 punto debe estar entre ${formatMoney(L.earnPerMin)} y ${formatMoney(L.earnPerMax)}.` }
  }
  if (!isInt(i.loyalty_point_value_cop) || i.loyalty_point_value_cop < 1) {
    return { error: 'El valor del punto debe ser un entero mayor a 0.' }
  }
  if (mode === 'points' && i.loyalty_point_value_cop >= i.loyalty_earn_per_cop) {
    return { error: POINT_VALUE_TOO_HIGH }
  }
  if (!isInt(i.loyalty_min_redeem_points) || i.loyalty_min_redeem_points < 0 || i.loyalty_min_redeem_points > L.minRedeemMax) {
    return { error: `El mínimo para canjear debe estar entre 0 y ${formatUnits(L.minRedeemMax)} puntos.` }
  }
  if (!isInt(i.loyalty_expiry_months) || i.loyalty_expiry_months < L.expiryMin || i.loyalty_expiry_months > L.expiryMax) {
    return { error: `Los meses de vencimiento deben estar entre ${L.expiryMin} y ${L.expiryMax}.` }
  }
  if (!isInt(i.loyalty_stamps_required) || i.loyalty_stamps_required < L.stampsMin || i.loyalty_stamps_required > L.stampsMax) {
    return { error: `Los sellos para un servicio gratis deben estar entre ${L.stampsMin} y ${L.stampsMax}.` }
  }
  if (!isInt(i.loyalty_stamp_max_reward_cop) || i.loyalty_stamp_max_reward_cop < 0 || i.loyalty_stamp_max_reward_cop > L.stampCapMax) {
    return { error: `El tope del servicio gratis debe estar entre $0 y ${formatMoney(L.stampCapMax)} (0 = sin tope).` }
  }

  return {
    value: {
      loyalty_mode:                 mode,
      loyalty_earn_per_cop:         i.loyalty_earn_per_cop,
      loyalty_point_value_cop:      i.loyalty_point_value_cop,
      loyalty_min_redeem_points:    i.loyalty_min_redeem_points,
      loyalty_expiry_months:        i.loyalty_expiry_months,
      loyalty_stamps_required:      i.loyalty_stamps_required,
      loyalty_stamp_max_reward_cop: i.loyalty_stamp_max_reward_cop,
    },
  }
}

// ── Errores de los RPC → español ──────────────────────────────────────────────

const RPC_ERRORS: [string, string][] = [
  ['insufficient_balance', 'El cliente no tiene saldo suficiente.'],
  ['below_minimum',        'No alcanza el mínimo de puntos para canjear.'],
  ['already_redeemed',     'Esta venta ya tiene un canje de lealtad.'],
  ['loyalty_disabled',     'La lealtad no está activa en este negocio.'],
  ['no_customer',          'La venta no tiene un cliente asociado.'],
  ['invalid_units',        'La cantidad de puntos no es válida.'],
  ['invalid_delta',        'El ajuste debe ser un número entero distinto de 0.'],
  ['reason_required',      'Escribe el motivo del ajuste (mínimo 3 letras).'],
  ['sale_not_paid',        'La venta aún no está pagada.'],
  ['forbidden',            'Solo un administrador puede hacer esto.'],
  ['not_found',            'No se encontró el registro.'],
]

/** Traduce el mensaje de una excepción del RPC (p. ej. 'insufficient_balance'). */
export function loyaltyErrorMessage(raw: string | null | undefined, fallback = 'No se pudo completar la operación.'): string {
  const text = raw ?? ''
  for (const [code, message] of RPC_ERRORS) {
    if (text.includes(code)) return message
  }
  return fallback
}
