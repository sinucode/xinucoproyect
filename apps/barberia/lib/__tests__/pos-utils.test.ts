import {
  cartSubtotal,
  cashChange,
  computePosTotals,
  effectiveLoyaltyUnits,
  posSaleErrorMessage,
  receiptText,
  suggestedCashAmounts,
  voidSaleErrorMessage,
} from '../pos-utils'

describe('pos-utils', () => {
  describe('computePosTotals', () => {
    it('resta descuento y canje del subtotal', () => {
      expect(computePosTotals({ subtotal: 50000, discount: 5000, loyaltyUnits: 100, pointValueCop: 50 })).toEqual({
        subtotal: 50000, discount: 5000, loyaltyDiscount: 5000, total: 40000,
      })
    })

    it('el descuento no supera el subtotal ni el canje lo que queda', () => {
      expect(computePosTotals({ subtotal: 10000, discount: 99999, loyaltyUnits: 500, pointValueCop: 50 })).toEqual({
        subtotal: 10000, discount: 10000, loyaltyDiscount: 0, total: 0,
      })
      expect(computePosTotals({ subtotal: 10000, discount: 4000, loyaltyUnits: 500, pointValueCop: 50 }).total).toBe(0)
    })

    it('valores negativos o vacíos no dan totales negativos', () => {
      expect(computePosTotals({ subtotal: 8000, discount: -5, loyaltyUnits: -3, pointValueCop: 50 }).total).toBe(8000)
    })
  })

  describe('effectiveLoyaltyUnits', () => {
    const base = { balance: 300, pointValueCop: 50, minRedeem: 20, amountCop: 10000 }
    it('sin pedir cantidad usa el máximo (acotado por saldo y monto)', () => {
      expect(effectiveLoyaltyUnits({ ...base, requested: null })).toEqual({ max: 200, units: 200 })
      expect(effectiveLoyaltyUnits({ ...base, requested: null, balance: 80 })).toEqual({ max: 80, units: 80 })
    })
    it('acota lo pedido y respeta el mínimo', () => {
      expect(effectiveLoyaltyUnits({ ...base, requested: 500 }).units).toBe(200)
      expect(effectiveLoyaltyUnits({ ...base, requested: 10 })).toEqual({ max: 200, units: 0 })
    })
    it('sin nada por cubrir no hay canje', () => {
      expect(effectiveLoyaltyUnits({ ...base, requested: null, amountCop: 0 })).toEqual({ max: 0, units: 0 })
    })
  })

  it('cartSubtotal suma precio × cantidad', () => {
    expect(cartSubtotal([{ unit_price: 20000, quantity: 2 }, { unit_price: 5000, quantity: 1 }])).toBe(45000)
  })

  it('cashChange solo aplica a efectivo con monto suficiente', () => {
    expect(cashChange('cash', 50000, 42000)).toBe(8000)
    expect(cashChange('cash', 30000, 42000)).toBe(0)
    expect(cashChange('card', 50000, 42000)).toBe(0)
  })

  it('suggestedCashAmounts da múltiplos redondos mayores al total', () => {
    expect(suggestedCashAmounts(42000)).toEqual([45000, 50000, 60000])
    expect(suggestedCashAmounts(3000)).toEqual([5000, 10000, 20000])
  })

  describe('errores', () => {
    it('insufficient_stock lleva el nombre del producto', () => {
      expect(posSaleErrorMessage('insufficient_stock:Cera Mate'))
        .toBe('No hay suficiente "Cera Mate" disponible (hay unidades apartadas para reservas).')
    })
    it('mensaje desconocido → genérico', () => {
      expect(posSaleErrorMessage('boom')).toBe('No se pudo registrar la venta. Intenta de nuevo.')
      expect(posSaleErrorMessage(null)).toBe('No se pudo registrar la venta. Intenta de nuevo.')
      expect(voidSaleErrorMessage(undefined)).toBe('No se pudo anular la venta. Intenta de nuevo.')
    })
  })

  it('receiptText resume la venta', () => {
    const text = receiptText({
      lines: [{ name: 'Cera', quantity: 2, unit_price: 20000 }],
      subtotal: 40000, discount: 5000, loyaltyDiscount: 0, total: 35000,
      method: 'card', received: null, change: 0, customerName: 'Luis',
    })
    expect(text).toContain('Cliente: Luis')
    expect(text).toContain('• 2 × Cera: $40.000')
    expect(text).toContain('Descuento: -$5.000')
    expect(text).toContain('Total: $35.000 (Tarjeta)')
  })
})
