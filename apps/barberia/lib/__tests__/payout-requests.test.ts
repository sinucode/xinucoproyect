import {
  PAYOUT_MAX_AMOUNT,
  isPayoutKind,
  isPayoutStatus,
  mapPayoutRpcError,
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
    ['invalid_ledger_entry', /movimiento/],
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
