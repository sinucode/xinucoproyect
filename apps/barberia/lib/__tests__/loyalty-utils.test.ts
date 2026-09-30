import {
  cashbackPercent,
  maxRedeemablePoints,
  stampRewardCop,
  describeRule,
  formatMoney,
  formatUnits,
  validateLoyaltyConfig,
  loyaltyErrorMessage,
  POINT_VALUE_TOO_HIGH,
} from '../loyalty-utils'

const valid = {
  loyalty_mode: 'points' as const,
  loyalty_earn_per_cop: 1000,
  loyalty_point_value_cop: 50,
  loyalty_min_redeem_points: 0,
  loyalty_expiry_months: 12,
  loyalty_stamps_required: 10,
  loyalty_stamp_max_reward_cop: 0,
}

describe('formato', () => {
  it('formatUnits agrupa miles con punto', () => {
    expect(formatUnits(0)).toBe('0')
    expect(formatUnits(999)).toBe('999')
    expect(formatUnits(1000)).toBe('1.000')
    expect(formatUnits(1240)).toBe('1.240')
    expect(formatUnits(1234567)).toBe('1.234.567')
    expect(formatUnits(-1500)).toBe('-1.500')
  })

  it('formatMoney antepone $ sin espacio', () => {
    expect(formatMoney(62000)).toBe('$62.000')
    expect(formatMoney(50)).toBe('$50')
    expect(formatMoney(-2500)).toBe('-$2.500')
  })
})

describe('cashbackPercent', () => {
  it('1000 / 50 → 5%', () => expect(cashbackPercent(1000, 50)).toBe(5))
  it('un decimal como máximo', () => expect(cashbackPercent(2000, 50)).toBe(2.5))
  it('100% cuando valen igual', () => expect(cashbackPercent(1000, 1000)).toBe(100))
  it('entradas inválidas → 0', () => {
    expect(cashbackPercent(0, 50)).toBe(0)
    expect(cashbackPercent(1000, 0)).toBe(0)
  })
})

describe('maxRedeemablePoints', () => {
  it('limita por saldo', () => expect(maxRedeemablePoints(100, 50, 100000, 0)).toBe(100))
  it('limita por monto (floor) para que puntos × valor ≤ monto', () => {
    const pts = maxRedeemablePoints(1240, 50, 25025, 0)
    expect(pts).toBe(500)
    expect(pts * 50).toBeLessThanOrEqual(25025)
  })
  it('0 si no alcanza el mínimo', () => {
    expect(maxRedeemablePoints(80, 50, 100000, 100)).toBe(0)
    expect(maxRedeemablePoints(500, 50, 2000, 100)).toBe(0) // monto solo da 40 pts
  })
  it('0 sin saldo, sin monto o sin valor', () => {
    expect(maxRedeemablePoints(0, 50, 1000, 0)).toBe(0)
    expect(maxRedeemablePoints(100, 50, 0, 0)).toBe(0)
    expect(maxRedeemablePoints(100, 0, 1000, 0)).toBe(0)
  })
})

describe('stampRewardCop', () => {
  it('sin tope (0) → el precio completo', () => expect(stampRewardCop(25000, 0)).toBe(25000))
  it('con tope → el menor', () => {
    expect(stampRewardCop(45000, 30000)).toBe(30000)
    expect(stampRewardCop(20000, 30000)).toBe(20000)
  })
  it('precio 0 → 0', () => expect(stampRewardCop(0, 30000)).toBe(0))
})

describe('describeRule', () => {
  it('puntos', () => {
    expect(describeRule(valid)).toBe(
      '1 punto por cada $1.000 · cada punto vale $50 · devuelves el 5%',
    )
  })
  it('puntos con decimales usa coma', () => {
    expect(describeRule({ ...valid, loyalty_earn_per_cop: 2000 })).toContain('devuelves el 2,5%')
  })
  it('sellos con tope', () => {
    expect(describeRule({ ...valid, loyalty_mode: 'stamps', loyalty_stamp_max_reward_cop: 30000 })).toBe(
      'Cada 10 visitas, el siguiente servicio gratis (hasta $30.000)',
    )
  })
  it('sellos sin tope', () => {
    expect(describeRule({ ...valid, loyalty_mode: 'stamps', loyalty_stamps_required: 8 })).toBe(
      'Cada 8 visitas, el siguiente servicio gratis',
    )
  })
})

describe('validateLoyaltyConfig', () => {
  it('acepta una configuración válida', () => {
    expect(validateLoyaltyConfig(valid)).toEqual({ value: valid })
  })

  it('rechaza el modo desconocido', () => {
    expect(validateLoyaltyConfig({ ...valid, loyalty_mode: 'gold' })).toHaveProperty('error')
  })

  it('regla del 100%: en puntos el valor debe ser menor que lo que se gasta', () => {
    expect(validateLoyaltyConfig({ ...valid, loyalty_point_value_cop: 1000 })).toEqual({ error: POINT_VALUE_TOO_HIGH })
    expect(validateLoyaltyConfig({ ...valid, loyalty_point_value_cop: 1500 })).toEqual({ error: POINT_VALUE_TOO_HIGH })
    expect(validateLoyaltyConfig({ ...valid, loyalty_point_value_cop: 999 })).toHaveProperty('value')
  })

  it('en sellos la regla del 100% no aplica', () => {
    expect(
      validateLoyaltyConfig({ ...valid, loyalty_mode: 'stamps', loyalty_point_value_cop: 5000 }),
    ).toHaveProperty('value')
  })

  it.each([
    ['loyalty_earn_per_cop', 99],
    ['loyalty_earn_per_cop', 1_000_001],
    ['loyalty_earn_per_cop', 1000.5],
    ['loyalty_point_value_cop', 0],
    ['loyalty_min_redeem_points', -1],
    ['loyalty_min_redeem_points', 1_000_001],
    ['loyalty_expiry_months', 0],
    ['loyalty_expiry_months', 61],
    ['loyalty_stamps_required', 1],
    ['loyalty_stamps_required', 51],
    ['loyalty_stamp_max_reward_cop', -1],
    ['loyalty_stamp_max_reward_cop', 10_000_001],
  ])('rechaza %s = %p', (field, value) => {
    expect(validateLoyaltyConfig({ ...valid, [field]: value })).toHaveProperty('error')
  })

  it('rechaza valores que no son números', () => {
    expect(validateLoyaltyConfig({ ...valid, loyalty_expiry_months: '12' })).toHaveProperty('error')
    expect(validateLoyaltyConfig(null)).toHaveProperty('error')
  })
})

describe('loyaltyErrorMessage', () => {
  it('traduce los errores del RPC', () => {
    expect(loyaltyErrorMessage('insufficient_balance')).toMatch(/saldo/)
    expect(loyaltyErrorMessage('P0001: below_minimum')).toMatch(/mínimo/)
    expect(loyaltyErrorMessage('forbidden')).toMatch(/administrador/)
  })
  it('usa el mensaje por defecto si no lo conoce', () => {
    expect(loyaltyErrorMessage('boom', 'X')).toBe('X')
  })
})
