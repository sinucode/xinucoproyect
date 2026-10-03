import {
  PAYOUT_MAX_AMOUNT,
  isPayoutKind,
  isPayoutStatus,
  mapPayoutLedgerError,
  mapPayoutRpcError,
  paidDifferenceLabel,
  payoutUpdateMessage,
  suggestedPayAmount,
  validatePayoutRequestInput,
  validateRejectReason,
} from '../payout-requests'

describe('validatePayoutRequestInput', () => {
  it('acepta un pago o un anticipo válido y limpia la nota', () => {
    expect(validatePayoutRequestInput({ kind: 'advance', amount: 50000, note: '  Para el arriendo  ' }))
      .toEqual({ value: { kind: 'advance', amount: 50000, note: 'Para el arriendo' } })
    expect(validatePayoutRequestInput({ kind: 'payout', amount: 1 }))
      .toEqual({ value: { kind: 'payout', amount: 1, note: null } })
    expect(validatePayoutRequestInput({ kind: 'payout', amount: PAYOUT_MAX_AMOUNT, note: '   ' }))
      .toEqual({ value: { kind: 'payout', amount: PAYOUT_MAX_AMOUNT, note: null } })
  })

  it.each([0, -5, 1.5, NaN, PAYOUT_MAX_AMOUNT + 1])('rechaza el monto %p', (amount) => {
    expect(validatePayoutRequestInput({ kind: 'advance', amount })).toHaveProperty('error')
  })

  it('rechaza un tipo inválido y una nota larga', () => {
    expect(validatePayoutRequestInput({ kind: 'bonus' as never, amount: 1000 })).toHaveProperty('error')
    expect(validatePayoutRequestInput({ kind: 'advance', amount: 1000, note: 'x'.repeat(201) })).toHaveProperty('error')
    expect(validatePayoutRequestInput(null as never)).toEqual({ error: 'Datos inválidos.' })
  })
})

describe('validateRejectReason', () => {
  it('exige un motivo de 3 a 200 caracteres', () => {
    expect(validateRejectReason('  Se paga el viernes ')).toEqual({ value: 'Se paga el viernes' })
    expect(validateRejectReason('')).toHaveProperty('error')
    expect(validateRejectReason('ab')).toHaveProperty('error')
    expect(validateRejectReason(undefined)).toHaveProperty('error')
    expect(validateRejectReason('x'.repeat(201))).toHaveProperty('error')
  })
})

describe('mapPayoutRpcError', () => {
  it.each([
    ['pending_exists', /solicitud pendiente/],
    ['not_linked', /vinculado/],
    ['not_pending', /ya no está pendiente/],
    ['note_required', /motivo/],
    ['invalid_amount', /entero entre \$1 y \$50\.000\.000/],
    ['forbidden', /permiso/],
    ['not_found', /No encontramos/],
    ['use_payment_flow', /Pagos al equipo/],
  ])('%s → mensaje en español', (code, pattern) => {
    expect(mapPayoutRpcError(code)).toMatch(pattern)
  })

  it('exceeds_balance usa el saldo del detalle', () => {
    expect(mapPayoutRpcError('exceeds_balance', '120000')).toContain('$120.000')
    expect(mapPayoutRpcError('exceeds_balance', null)).toMatch(/lo que se te debe/)
  })

  it('un error desconocido (p. ej. migración pendiente) cae en el genérico', () => {
    expect(mapPayoutRpcError('function request_payout does not exist')).toBe(
      'No se pudo completar la acción. Intenta de nuevo.',
    )
    expect(mapPayoutRpcError(undefined)).toBe('No se pudo completar la acción. Intenta de nuevo.')
  })
})

describe('guardas de tipo', () => {
  it('kind y status', () => {
    expect(isPayoutKind('payout')).toBe(true)
    expect(isPayoutKind('advance')).toBe(true)
    expect(isPayoutKind('bonus')).toBe(false)
    expect(isPayoutStatus('pending')).toBe(true)
    expect(isPayoutStatus('cancelled')).toBe(true)
    expect(isPayoutStatus('done')).toBe(false)
  })
})

describe('suggestedPayAmount', () => {
  it('un pago precarga lo pedido sin pasar del saldo actual', () => {
    expect(suggestedPayAmount({ kind: 'payout', amount: 90000 }, 60000)).toBe(60000)
    expect(suggestedPayAmount({ kind: 'payout', amount: 40000 }, 60000)).toBe(40000)
  })
  it('sin saldo positivo no precarga (0)', () => {
    expect(suggestedPayAmount({ kind: 'payout', amount: 40000 }, 0)).toBe(0)
    expect(suggestedPayAmount({ kind: 'payout', amount: 40000 }, -5000)).toBe(0)
  })
  it('un anticipo precarga lo pedido (no depende del saldo)', () => {
    expect(suggestedPayAmount({ kind: 'advance', amount: 50000 }, 0)).toBe(50000)
  })
})

describe('paidDifferenceLabel', () => {
  it('avisa cuando lo pagado difiere de lo pedido', () => {
    expect(paidDifferenceLabel({ status: 'paid', amount: 100000, paid_amount: 80000 }))
      .toBe('Pagada $80.000 de $100.000 solicitados')
  })
  it('null si coincide, no está pagada o no hay monto pagado', () => {
    expect(paidDifferenceLabel({ status: 'paid', amount: 100000, paid_amount: 100000 })).toBeNull()
    expect(paidDifferenceLabel({ status: 'rejected', amount: 100000, paid_amount: null })).toBeNull()
    expect(paidDifferenceLabel({ status: 'paid', amount: 100000, paid_amount: null })).toBeNull()
  })
})

describe('mapPayoutLedgerError', () => {
  it('traduce los errores del trigger de staff_ledger', () => {
    expect(mapPayoutLedgerError('payout_request_not_pending')).toMatch(/ya fue pagada, cancelada o rechazada/)
    expect(mapPayoutLedgerError('payout_request_invalid')).toMatch(/ya fue pagada/)
    expect(mapPayoutLedgerError('payout_request_mismatch')).toMatch(/no corresponde a este profesional o tipo de pago/)
  })
  it('null para cualquier otro error', () => {
    expect(mapPayoutLedgerError('duplicate key')).toBeNull()
    expect(mapPayoutLedgerError(undefined)).toBeNull()
  })
})

describe('payoutUpdateMessage', () => {
  const base = { kind: 'advance' as const, amount: 10000, paid_amount: null, resolution_note: null }

  it('pagada completa', () => {
    expect(payoutUpdateMessage({ ...base, status: 'paid', paid_amount: 10000 })).toBe('Te pagaron el anticipo de $10.000')
  })
  it('pagada parcial', () => {
    expect(payoutUpdateMessage({ ...base, status: 'paid', paid_amount: 8000 })).toBe('Te pagaron $8.000 de los $10.000 que pediste')
  })
  it('rechazada con y sin motivo', () => {
    expect(payoutUpdateMessage({ ...base, status: 'rejected', resolution_note: 'No hay caja' })).toBe('Tu solicitud de anticipo de $10.000 fue rechazada: No hay caja')
    expect(payoutUpdateMessage({ ...base, kind: 'payout', status: 'rejected' })).toBe('Tu solicitud de pago de $10.000 fue rechazada.')
  })
})
