import {
  MOVEMENT_KINDS,
  buildMovementPayload,
  formatMoney,
  formatSignedMoney,
  fundsShortfall,
  insufficientFunds,
  legacyMethodToAccount,
  mapAccountError,
  methodKindLabel,
  movementEnds,
  movementShape,
  moveInOrder,
  previewBalances,
  validateAccountForm,
  type MovementForm,
} from '../money-accounts'

const acc = (id: string, name: string, method_kind: 'cash' | 'transfer' | 'card' | 'mercadopago', balance = 0) => ({
  id, name, method_kind, is_cash_drawer: method_kind === 'cash', balance,
})
const ACCOUNTS = [
  acc('c', 'Efectivo', 'cash', 100_000),
  acc('t', 'Bancolombia', 'transfer', 50_000),
  acc('n', 'Nequi', 'transfer', 10_000),
  acc('d', 'Datáfono', 'card', 0),
]

describe('etiquetas', () => {
  it('describe los seis movimientos con una explicación', () => {
    expect(MOVEMENT_KINDS.map(k => k.label)).toEqual([
      'Aporte del dueño', 'Préstamo del dueño', 'Devolver préstamo',
      'Retiro del dueño', 'Traslado entre medios', 'Ajuste de saldo',
    ])
    expect(MOVEMENT_KINDS.every(k => k.hint.length > 10)).toBe(true)
    expect(MOVEMENT_KINDS[0].hint).toContain('No cuenta como venta')
    expect(MOVEMENT_KINDS[1].hint).toContain('deuda del negocio con el dueño')
  })

  it('traduce los tipos de medio', () => {
    expect(methodKindLabel('cash')).toBe('Efectivo')
    expect(methodKindLabel('transfer')).toBe('Transferencia / Banco')
    expect(methodKindLabel('card')).toBe('Tarjeta (datáfono)')
    expect(methodKindLabel('mercadopago')).toBe('Mercado Pago')
    expect(methodKindLabel('x')).toBe('Otro')
  })

  it('formatea plata con signo', () => {
    expect(formatMoney(1_200_000)).toBe('$1.200.000')
    expect(formatMoney(-50_000)).toBe('−$50.000')
    expect(formatSignedMoney(20_000)).toBe('+$20.000')
    expect(formatSignedMoney(-5_000)).toBe('−$5.000')
    expect(formatSignedMoney(0)).toBe('$0')
  })
})

describe('legacyMethodToAccount', () => {
  it('efectivo y efectivo de la caja van a la caja', () => {
    expect(legacyMethodToAccount('cash', ACCOUNTS)?.id).toBe('c')
    expect(legacyMethodToAccount('cash_register', ACCOUNTS)?.id).toBe('c')
  })

  it('transferencia va al primer medio que no es la caja', () => {
    expect(legacyMethodToAccount('transfer', ACCOUNTS)?.id).toBe('t')
  })

  it('prefiere un medio del mismo tipo', () => {
    expect(legacyMethodToAccount('card', ACCOUNTS)?.id).toBe('d')
    expect(legacyMethodToAccount('card', [ACCOUNTS[0], ACCOUNTS[1]])?.id).toBe('t')
  })

  it('mixto y Mercado Pago sin medio propio caen al primero que no es caja', () => {
    expect(legacyMethodToAccount('mixed', ACCOUNTS)?.id).toBe('t')
    expect(legacyMethodToAccount('mercadopago', ACCOUNTS)?.id).toBe('t')
  })

  it('otro, vacío o puntos quedan fuera de las cuentas', () => {
    expect(legacyMethodToAccount('other', ACCOUNTS)).toBeNull()
    expect(legacyMethodToAccount(null, ACCOUNTS)).toBeNull()
    expect(legacyMethodToAccount(undefined, ACCOUNTS)).toBeNull()
    expect(legacyMethodToAccount('loyalty_points', ACCOUNTS)).toBeNull()
  })

  it('sin medios que no sean la caja, transferir no tiene medio', () => {
    expect(legacyMethodToAccount('transfer', [ACCOUNTS[0]])).toBeNull()
    expect(legacyMethodToAccount('cash', [ACCOUNTS[1]])).toBeNull()
  })
})

describe('saldo suficiente', () => {
  it('avisa solo cuando el monto supera lo disponible', () => {
    expect(insufficientFunds(100, 100)).toBe(false)
    expect(insufficientFunds(100, 101)).toBe(true)
    expect(insufficientFunds(0, 0)).toBe(false)
    expect(insufficientFunds(0, NaN)).toBe(false)
    expect(insufficientFunds(-10, 1)).toBe(true)
  })

  it('calcula cuánto falta', () => {
    expect(fundsShortfall(100, 160)).toBe(60)
    expect(fundsShortfall(100, 100)).toBe(0)
    expect(fundsShortfall(-50, 100)).toBe(150)
  })
})

describe('movementShape', () => {
  it('pide los medios según el tipo', () => {
    expect(movementShape('owner_contribution')).toEqual({ from: false, to: true, noteRequired: false })
    expect(movementShape('owner_loan')).toEqual({ from: false, to: true, noteRequired: false })
    expect(movementShape('loan_repayment')).toEqual({ from: true, to: false, noteRequired: false })
    expect(movementShape('owner_withdrawal')).toEqual({ from: true, to: false, noteRequired: false })
    expect(movementShape('transfer')).toEqual({ from: true, to: true, noteRequired: false })
    expect(movementShape('adjustment').noteRequired).toBe(true)
  })
})

describe('buildMovementPayload', () => {
  const form = (over: Partial<MovementForm>): MovementForm => ({
    kind: 'owner_contribution', amount: 50_000, fromId: null, toId: 't', direction: 'up', adjustId: null, notes: '', ...over,
  })
  const ctx = { ownerLoansPending: 80_000 }

  it('aporte: solo "hacia"', () => {
    expect(buildMovementPayload(form({ fromId: 'c' }), ctx)).toEqual({
      payload: { kind: 'owner_contribution', amount: 50_000, from: null, to: 't', notes: null },
    })
  })

  it('exige monto entero mayor a cero', () => {
    expect(buildMovementPayload(form({ amount: 0 }), ctx)).toHaveProperty('error')
    expect(buildMovementPayload(form({ amount: 10.5 }), ctx)).toHaveProperty('error')
    expect(buildMovementPayload(form({ amount: NaN }), ctx)).toHaveProperty('error')
  })

  it('exige el medio', () => {
    expect(buildMovementPayload(form({ toId: null }), ctx)).toEqual({ error: 'Elige a qué medio entra la plata.' })
    expect(buildMovementPayload(form({ kind: 'owner_withdrawal', fromId: null }), ctx))
      .toEqual({ error: 'Elige de qué medio sale la plata.' })
  })

  it('traslado: dos medios distintos', () => {
    expect(buildMovementPayload(form({ kind: 'transfer', fromId: 'c', toId: 'c' }), ctx))
      .toHaveProperty('error')
    expect(buildMovementPayload(form({ kind: 'transfer', fromId: 'c', toId: 't' }), ctx))
      .toEqual({ payload: { kind: 'transfer', amount: 50_000, from: 'c', to: 't', notes: null } })
  })

  it('devolver préstamo no puede superar la deuda con el dueño', () => {
    const r = buildMovementPayload(form({ kind: 'loan_repayment', fromId: 'c', toId: null, amount: 90_000 }), ctx)
    expect(r).toEqual({ error: 'Solo le debes al dueño $80.000.' })
    expect(buildMovementPayload(form({ kind: 'loan_repayment', fromId: 'c', toId: null, amount: 80_000 }), ctx))
      .toHaveProperty('payload')
  })

  it('ajuste: subir va en "hacia", bajar en "desde", y la nota es obligatoria', () => {
    expect(buildMovementPayload(form({ kind: 'adjustment', adjustId: 't', notes: '' }), ctx))
      .toEqual({ error: 'Cuéntanos el motivo del ajuste.' })
    expect(buildMovementPayload(form({ kind: 'adjustment', adjustId: 't', direction: 'up', notes: 'Conté mal' }), ctx))
      .toEqual({ payload: { kind: 'adjustment', amount: 50_000, from: null, to: 't', notes: 'Conté mal' } })
    expect(buildMovementPayload(form({ kind: 'adjustment', adjustId: 't', direction: 'down', notes: 'Cobro del banco' }), ctx))
      .toEqual({ payload: { kind: 'adjustment', amount: 50_000, from: 't', to: null, notes: 'Cobro del banco' } })
    expect(buildMovementPayload(form({ kind: 'adjustment', adjustId: null, notes: 'x'.repeat(5) }), ctx))
      .toEqual({ error: 'Elige el medio que vas a ajustar.' })
  })

  it('recorta la nota y limita a 200 caracteres', () => {
    expect(buildMovementPayload(form({ notes: '  hola  ' }), ctx))
      .toMatchObject({ payload: { notes: 'hola' } })
    expect(buildMovementPayload(form({ notes: 'x'.repeat(201) }), ctx)).toHaveProperty('error')
  })
})

describe('previewBalances', () => {
  it('traslado: baja el origen y sube el destino', () => {
    expect(previewBalances({ amount: 30_000, from: 'c', to: 't' }, ACCOUNTS)).toEqual([
      { id: 'c', name: 'Efectivo', before: 100_000, after: 70_000 },
      { id: 't', name: 'Bancolombia', before: 50_000, after: 80_000 },
    ])
  })

  it('aporte: solo sube el destino; un medio desconocido se ignora', () => {
    expect(previewBalances({ amount: 5, from: null, to: 'n' }, ACCOUNTS))
      .toEqual([{ id: 'n', name: 'Nequi', before: 10_000, after: 10_005 }])
    expect(previewBalances({ amount: 5, from: 'zzz', to: null }, ACCOUNTS)).toEqual([])
  })
})

describe('validateAccountForm', () => {
  const ok = { name: 'Nequi', kind: 'transfer' as const, openingBalance: 0, openingDate: '2026-10-01', today: '2026-10-01' }

  it('acepta un medio válido', () => {
    expect(validateAccountForm(ok, { isCashDrawer: false })).toBeNull()
  })
  it('valida el nombre', () => {
    expect(validateAccountForm({ ...ok, name: ' a ' }, { isCashDrawer: false })).toContain('nombre')
    expect(validateAccountForm({ ...ok, name: 'x'.repeat(41) }, { isCashDrawer: false })).toContain('nombre')
  })
  it('no deja elegir Efectivo como tipo de un medio nuevo', () => {
    expect(validateAccountForm({ ...ok, kind: 'cash' }, { isCashDrawer: false })).toBe('Elige un tipo de medio.')
  })
  it('exige un saldo entero desde $0', () => {
    expect(validateAccountForm({ ...ok, openingBalance: -1 }, { isCashDrawer: false })).toContain('desde $0')
    expect(validateAccountForm({ ...ok, openingBalance: NaN }, { isCashDrawer: false })).toContain('desde $0')
  })
  it('la fecha no puede ser futura', () => {
    expect(validateAccountForm({ ...ok, openingDate: '2026-10-02' }, { isCashDrawer: false })).toBe('La fecha no puede ser futura.')
  })
  it('Efectivo solo valida nombre y fecha (el saldo lo maneja la caja)', () => {
    expect(validateAccountForm({ ...ok, kind: 'cash', openingBalance: NaN }, { isCashDrawer: true })).toBeNull()
  })
})

describe('moveInOrder', () => {
  it('sube y baja un puesto, sin salirse de la lista', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveInOrder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moveInOrder(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveInOrder(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
    expect(moveInOrder(['a', 'b'], 'z', 1)).toEqual(['a', 'b'])
  })
})

describe('mapAccountError', () => {
  it.each([
    ['forbidden', 'administrador'],
    ['invalid_name', '2 y 40'],
    ['invalid_date', 'futura'],
    ['cash_required', 'caja'],
    ['duplicate_name', 'con ese nombre'],
    ['exceeds_loan', 'debe al dueño'],
    ['reason_required', 'motivo'],
    ['invalid_accounts', 'distintos'],
    ['invalid_account', 'activo'],
    ['not_found', 'No encontramos'],
  ])('%s', (code, fragment) => {
    expect(mapAccountError(`error: ${code}`)).toContain(fragment)
  })

  it('invalid_accounts no se confunde con invalid_account', () => {
    expect(mapAccountError('invalid_accounts')).not.toBe(mapAccountError('invalid_account'))
  })
  it('un código desconocido da un mensaje genérico', () => {
    expect(mapAccountError('boom')).toBe('No se pudo completar la acción. Intenta de nuevo.')
    expect(mapAccountError(null)).toBe('No se pudo completar la acción. Intenta de nuevo.')
  })
})

describe('movementEnds', () => {
  const base = { kind: 'transfer' as const, fromId: 'c', toId: 't', direction: 'up' as const, adjustId: 'n' }
  it('traslado usa los dos medios', () => {
    expect(movementEnds(base)).toEqual({ from: 'c', to: 't' })
  })
  it('aporte ignora "desde" y retiro ignora "hacia"', () => {
    expect(movementEnds({ ...base, kind: 'owner_contribution' })).toEqual({ from: null, to: 't' })
    expect(movementEnds({ ...base, kind: 'owner_withdrawal' })).toEqual({ from: 'c', to: null })
  })
  it('ajuste: subir entra, bajar sale', () => {
    expect(movementEnds({ ...base, kind: 'adjustment' })).toEqual({ from: null, to: 'n' })
    expect(movementEnds({ ...base, kind: 'adjustment', direction: 'down' })).toEqual({ from: 'n', to: null })
  })
})
