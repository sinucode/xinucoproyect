import {
  ASSET_CATEGORIES,
  DISPOSAL_REASONS,
  SELECTABLE_CATEGORIES,
  addMonthsISO,
  categoryDefaultMonths,
  categoryLabel,
  disposalNeedsNote,
  disposalResult,
  estimateValue,
  firstMonthDepreciation,
  formatDateES,
  fullMonthsBetween,
  fullyDepreciatedOn,
  lifeLabel,
  mapAssetError,
  monthYearES,
  monthlyDepreciation,
  usedPercent,
  type AssetValueInput,
} from '../fixed-assets-utils'

const base: AssetValueInput = {
  purchase_date: '2026-01-15',
  purchase_price: 1_200_000,
  salvage_value: 0,
  useful_life_months: 12,
  depreciation_method: 'straight_line',
}

describe('categorías y etiquetas', () => {
  it('tiene las categorías con etiqueta y vida útil sugerida', () => {
    expect(ASSET_CATEGORIES.furniture).toMatchObject({ label: 'Mobiliario', defaultMonths: 120 })
    expect(ASSET_CATEGORIES.equipment).toMatchObject({ label: 'Máquinas y herramientas', defaultMonths: 36 })
    expect(ASSET_CATEGORIES.technology).toMatchObject({ label: 'Tecnología', defaultMonths: 60 })
    expect(ASSET_CATEGORIES.improvements).toMatchObject({ label: 'Adecuaciones', defaultMonths: 60 })
    expect(ASSET_CATEGORIES.vehicle).toMatchObject({ label: 'Vehículo', defaultMonths: 120 })
    expect(ASSET_CATEGORIES.other).toMatchObject({ label: 'Otros', defaultMonths: 60 })
  })

  it('no ofrece vehículo al crear, pero sí lo etiqueta', () => {
    expect(SELECTABLE_CATEGORIES).not.toContain('vehicle')
    expect(categoryLabel('vehicle')).toBe('Vehículo')
    expect(categoryLabel('desconocida')).toBe('Otros')
    expect(categoryDefaultMonths('equipment')).toBe(36)
    expect(categoryDefaultMonths('desconocida')).toBe(60)
  })

  it('motivos de baja', () => {
    expect(DISPOSAL_REASONS).toEqual({
      sold: 'Vendido', damaged: 'Dañado', stolen: 'Robado', donated: 'Regalado', other: 'Otro motivo',
    })
    expect(disposalNeedsNote('sold')).toBe(false)
    expect(disposalNeedsNote('donated')).toBe(false)
    expect(disposalNeedsNote('damaged')).toBe(true)
    expect(disposalNeedsNote('stolen')).toBe(true)
    expect(disposalNeedsNote('other')).toBe(true)
  })
})

describe('lifeLabel', () => {
  it('años, meses y mezcla', () => {
    expect(lifeLabel(120)).toBe('10 años')
    expect(lifeLabel(36)).toBe('3 años')
    expect(lifeLabel(12)).toBe('1 año')
    expect(lifeLabel(18)).toBe('18 meses')
    expect(lifeLabel(6)).toBe('6 meses')
    expect(lifeLabel(1)).toBe('1 mes')
    expect(lifeLabel(30)).toBe('2 años y 6 meses')
    expect(lifeLabel(25)).toBe('2 años y 1 mes')
  })
})

describe('fechas', () => {
  it('formatea', () => {
    expect(formatDateES('2026-09-30')).toBe('30 sep 2026')
    expect(formatDateES('2026-01-05')).toBe('5 ene 2026')
    expect(formatDateES('')).toBe('')
    expect(monthYearES('2026-09-30')).toBe('septiembre 2026')
  })

  it('addMonthsISO recorta el día al fin de mes', () => {
    expect(addMonthsISO('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsISO('2026-01-15', 12)).toBe('2027-01-15')
    expect(addMonthsISO('2026-11-10', 3)).toBe('2027-02-10')
  })

  it('fullMonthsBetween cuenta solo meses completos', () => {
    expect(fullMonthsBetween('2026-01-15', '2026-02-14')).toBe(0)
    expect(fullMonthsBetween('2026-01-15', '2026-02-15')).toBe(1)
    expect(fullMonthsBetween('2026-01-15', '2027-01-15')).toBe(12)
    expect(fullMonthsBetween('2026-03-01', '2026-01-01')).toBe(0)
  })

  it('fullyDepreciatedOn', () => {
    expect(fullyDepreciatedOn(base)).toBe('2027-01-15')
  })
})

describe('monthlyDepreciation', () => {
  it('floor((precio − residual) / vida)', () => {
    expect(monthlyDepreciation(1_200_000, 0, 12)).toBe(100_000)
    expect(monthlyDepreciation(1_000_000, 100_000, 7)).toBe(128_571)
    expect(monthlyDepreciation(1_000, 0, 0)).toBe(0)
    expect(monthlyDepreciation(100, 200, 10)).toBe(0)
  })
})

describe('estimateValue — línea recta', () => {
  it('antes y el día de la compra vale el precio', () => {
    expect(estimateValue(base, '2026-01-15')).toBe(1_200_000)
    expect(estimateValue(base, '2025-12-01')).toBe(1_200_000)
  })

  it('baja por meses completos', () => {
    expect(estimateValue(base, '2026-02-14')).toBe(1_200_000)
    expect(estimateValue(base, '2026-02-15')).toBe(1_100_000)
    expect(estimateValue(base, '2026-07-15')).toBe(600_000)
  })

  it('se detiene en el valor residual al terminar la vida útil', () => {
    const a = { ...base, salvage_value: 200_000 }
    expect(estimateValue(a, '2027-01-15')).toBe(200_000)
    expect(estimateValue(a, '2040-01-01')).toBe(200_000)
  })

  it('redondea el desgaste hacia abajo como la base', () => {
    const a = { ...base, purchase_price: 1_000_000, useful_life_months: 7 }
    // floor(1_000_000 * 3 / 7) = 428_571
    expect(estimateValue(a, '2026-04-15')).toBe(1_000_000 - 428_571)
  })

  it('congela el valor en el día de la baja', () => {
    const a = { ...base, disposed_at: '2026-04-15' }
    expect(estimateValue(a, '2026-04-15')).toBe(900_000)
    expect(estimateValue(a, '2027-06-01')).toBe(900_000)
  })
})

describe('estimateValue — saldo decreciente', () => {
  const dec: AssetValueInput = { ...base, depreciation_method: 'declining_balance', useful_life_months: 60, purchase_price: 1_000_000 }

  it('baja más al principio', () => {
    // tasa mensual = (2 / 5) / 12 = 0.0333…
    const m1 = estimateValue(dec, '2026-02-15')
    const m2 = estimateValue(dec, '2026-03-15')
    expect(m1).toBe(966_666)
    expect(1_000_000 - m1).toBeGreaterThan(m1 - m2)
  })

  it('no baja del valor residual y termina en él', () => {
    const a = { ...dec, salvage_value: 100_000 }
    expect(estimateValue(a, '2031-01-15')).toBe(100_000)
    expect(estimateValue(a, '2030-06-15')).toBeGreaterThanOrEqual(100_000)
  })

  it('firstMonthDepreciation', () => {
    expect(firstMonthDepreciation(base)).toBe(100_000)
    expect(firstMonthDepreciation(dec)).toBe(1_000_000 - 966_666)
  })
})

describe('usedPercent', () => {
  it('porcentaje sobre lo que se puede desgastar', () => {
    expect(usedPercent(base, 1_200_000)).toBe(0)
    expect(usedPercent(base, 600_000)).toBe(50)
    expect(usedPercent(base, 0)).toBe(100)
    expect(usedPercent({ purchase_price: 1_000, salvage_value: 200 }, 200)).toBe(100)
    expect(usedPercent({ purchase_price: 1_000, salvage_value: 200 }, 600)).toBe(50)
  })

  it('valores raros quedan entre 0 y 100', () => {
    expect(usedPercent(base, 2_000_000)).toBe(0)
    expect(usedPercent(base, -5)).toBe(100)
    expect(usedPercent({ purchase_price: 100, salvage_value: 100 }, 100)).toBe(0)
  })
})

describe('disposalResult', () => {
  it('ganancia o pérdida', () => {
    expect(disposalResult(500_000, 400_000)).toBe(100_000)
    expect(disposalResult(300_000, 400_000)).toBe(-100_000)
    expect(disposalResult(null, 400_000)).toBe(-400_000)
    expect(disposalResult(0, 0)).toBe(0)
  })
})

describe('mapAssetError', () => {
  it('traduce todos los códigos', () => {
    const codes = [
      'forbidden', 'name_required', 'invalid_category', 'invalid_date', 'invalid_price', 'invalid_salvage',
      'invalid_life', 'invalid_method', 'invalid_payment_method', 'shift_not_open', 'invalid_reason',
      'reason_required', 'already_disposed', 'not_found', 'forbidden_field', 'asset_disposed',
    ]
    const generic = mapAssetError('algo raro')
    const seen = new Set<string>()
    for (const code of codes) {
      const text = mapAssetError(code)
      expect(text).not.toBe(generic)
      expect(text).not.toContain('_')
      seen.add(text)
    }
    expect(seen.size).toBe(codes.length)
  })

  it('mensajes clave', () => {
    expect(mapAssetError('shift_not_open')).toBe('No hay una caja abierta. Abre la caja o elige otro medio de pago.')
    expect(mapAssetError('P0001: forbidden_field')).toBe('Ese dato no se puede cambiar desde aquí.')
    expect(mapAssetError('forbidden')).toContain('administrador')
  })

  it('genérico si no se conoce', () => {
    expect(mapAssetError(null)).toBe('No se pudo completar la acción. Intenta de nuevo.')
    expect(mapAssetError(undefined)).toBe('No se pudo completar la acción. Intenta de nuevo.')
  })
})
