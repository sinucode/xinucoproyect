import {
  ENTRY_LABELS,
  ENTRY_SIGN,
  bogotaDateKey,
  bogotaDayRangeUTC,
  buildWhatsAppSettlementText,
  computeBalance,
  formatMoneyPlain,
  isRealDateKey,
  settlementSinceLastPayment,
  waLink,
  type LedgerEntryLike,
} from '../team-payments'

let n = 0
const e = (
  entry_type: LedgerEntryLike['entry_type'],
  amount: number,
  created_at: string,
  extra: Partial<LedgerEntryLike> = {},
): LedgerEntryLike => ({ id: `e${String(++n).padStart(3, '0')}`, entry_type, amount, created_at, ...extra })

describe('etiquetas y signos', () => {
  it('etiqueta cada tipo en español', () => {
    expect(ENTRY_LABELS).toEqual({
      commission: 'Comisión',
      tip: 'Propina',
      bonus: 'Bono / a favor',
      deduction: 'Descuento',
      advance: 'Anticipo',
      payment: 'Pago',
    })
  })

  it('suma comisión/propina/bono y resta descuento/anticipo/pago', () => {
    expect(ENTRY_SIGN.commission).toBe(1)
    expect(ENTRY_SIGN.tip).toBe(1)
    expect(ENTRY_SIGN.bonus).toBe(1)
    expect(ENTRY_SIGN.deduction).toBe(-1)
    expect(ENTRY_SIGN.advance).toBe(-1)
    expect(ENTRY_SIGN.payment).toBe(-1)
  })

  it('computeBalance aplica el signo', () => {
    expect(computeBalance([
      { entry_type: 'commission', amount: 100 },
      { entry_type: 'tip', amount: 20 },
      { entry_type: 'bonus', amount: 5 },
      { entry_type: 'advance', amount: 30 },
      { entry_type: 'payment', amount: 40 },
      { entry_type: 'deduction', amount: 10 },
    ])).toBe(45)
    expect(computeBalance([])).toBe(0)
  })
})

describe('settlementSinceLastPayment', () => {
  it('sin pagos previos cuenta todo y since es null', () => {
    const s = settlementSinceLastPayment([
      e('commission', 10000, '2026-09-01T15:00:00Z', { item_type: 'service' }),
      e('commission', 3600, '2026-09-02T15:00:00Z', { item_type: 'product' }),
      e('tip', 2000, '2026-09-02T16:00:00Z'),
      e('bonus', 1000, '2026-09-03T16:00:00Z'),
      e('deduction', 500, '2026-09-03T17:00:00Z'),
      e('advance', 4000, '2026-09-04T17:00:00Z'),
    ])
    expect(s).toEqual({
      since: null,
      services_commission: 10000,
      products_commission: 3600,
      tips: 2000,
      bonus: 1000,
      deductions: 500,
      advances: 4000,
      total_to_pay: 10000 + 3600 + 2000 + 1000 - 500 - 4000,
      count: 6,
      balance: 12100,
    })
  })

  it('solo considera lo posterior al ÚLTIMO pago (entradas en cualquier orden)', () => {
    const entries = [
      e('commission', 5000, '2026-09-20T15:00:00Z', { item_type: 'service' }),
      e('payment', 5000, '2026-09-21T15:00:00Z'),
      e('commission', 7000, '2026-09-22T15:00:00Z', { item_type: 'service' }),
      e('payment', 7000, '2026-09-23T15:00:00Z'),
      e('commission', 32500, '2026-09-24T15:00:00Z', { item_type: 'service' }),
      e('commission', 3600, '2026-09-25T15:00:00Z', { item_type: 'product' }),
      e('advance', 10000, '2026-09-26T15:00:00Z'),
    ]
    const s = settlementSinceLastPayment([...entries].reverse())
    expect(s.since).toBe('2026-09-23T15:00:00Z')
    expect(s.services_commission).toBe(32500)
    expect(s.products_commission).toBe(3600)
    expect(s.advances).toBe(10000)
    expect(s.total_to_pay).toBe(26100)
    expect(s.count).toBe(3)
    expect(s.balance).toBe(26100)
  })

  it('en empate de created_at desempata por id', () => {
    const ts = '2026-09-25T15:00:00Z'
    const before = { id: 'a1', entry_type: 'commission' as const, amount: 100, created_at: ts, item_type: 'service' as const }
    const pay    = { id: 'b1', entry_type: 'payment' as const,    amount: 100, created_at: ts }
    const after  = { id: 'c1', entry_type: 'commission' as const, amount: 50,  created_at: ts, item_type: 'service' as const }
    const s = settlementSinceLastPayment([after, pay, before])
    expect(s.services_commission).toBe(50)
    expect(s.count).toBe(1)
  })

  it('balance sobre TODO puede diferir de total_to_pay (pago que no saldó todo)', () => {
    const s = settlementSinceLastPayment([
      e('commission', 100000, '2026-09-01T15:00:00Z', { item_type: 'service' }),
      e('payment', 60000, '2026-09-02T15:00:00Z'), // solo se pagó una parte
      e('commission', 20000, '2026-09-03T15:00:00Z', { item_type: 'service' }),
    ])
    expect(s.total_to_pay).toBe(20000)
    expect(s.balance).toBe(60000)
  })

  it('un pago de más deja saldo negativo (anticipo por descontar)', () => {
    const s = settlementSinceLastPayment([
      e('commission', 10000, '2026-09-01T15:00:00Z', { item_type: 'service' }),
      e('payment', 15000, '2026-09-02T15:00:00Z'),
    ])
    expect(s.balance).toBe(-5000)
    expect(s.total_to_pay).toBe(0)
    expect(s.count).toBe(0)
  })

  it('una comisión sin item_type cuenta como servicio', () => {
    const s = settlementSinceLastPayment([e('commission', 900, '2026-09-01T15:00:00Z')])
    expect(s.services_commission).toBe(900)
    expect(s.products_commission).toBe(0)
  })

  it('lista vacía', () => {
    expect(settlementSinceLastPayment([])).toEqual({
      since: null, services_commission: 0, products_commission: 0, tips: 0, bonus: 0,
      deductions: 0, advances: 0, total_to_pay: 0, count: 0, balance: 0,
    })
  })
})

describe('buildWhatsAppSettlementText', () => {
  it('arma el mensaje y omite las líneas en cero (menos el total)', () => {
    const text = buildWhatsAppSettlementText({
      businessName: 'Barbería X',
      staffName: 'Carlos Ramírez',
      fromLabel: '22 sept',
      toLabel: '29 sept',
      lines: [
        { label: 'Comisiones servicios', amount: 32500 },
        { label: 'Comisiones productos', amount: 3600 },
        { label: 'Propinas', amount: 0 },
        { label: 'Anticipos', amount: -10000 },
      ],
      total: 26100,
      method: 'transfer',
    })
    expect(text).toBe(
      [
        'Hola Carlos 👋',
        'Tu liquidación en Barbería X (22 sept – 29 sept):',
        '• Comisiones servicios: $32.500',
        '• Comisiones productos: $3.600',
        '• Anticipos: −$10.000',
        'Total pagado: $26.100 (Transferencia)',
        '¡Gracias por tu trabajo!',
      ].join('\n'),
    )
  })

  it('sin período ni medio de pago', () => {
    const text = buildWhatsAppSettlementText({
      businessName: 'Barbería X', staffName: 'Ana', lines: [], total: 0,
    })
    expect(text).toBe('Hola Ana 👋\nTu liquidación en Barbería X:\nTotal pagado: $0\n¡Gracias por tu trabajo!')
  })

  it('nombra el efectivo', () => {
    expect(buildWhatsAppSettlementText({
      businessName: 'B', staffName: 'Ana', lines: [], total: 1500, method: 'cash_register',
    })).toContain('Total pagado: $1.500 (Efectivo)')
  })
})

describe('waLink', () => {
  it('sin teléfono usa la forma sin número y codifica el texto', () => {
    expect(waLink(null, 'Hola Ana 👋\nTotal: $1.500'))
      .toBe(`https://wa.me/?text=${encodeURIComponent('Hola Ana 👋\nTotal: $1.500')}`)
  })

  it('con teléfono deja solo los dígitos', () => {
    expect(waLink('+57 300 123 4567', 'x')).toBe('https://wa.me/573001234567?text=x')
  })
})

describe('fechas de Colombia', () => {
  it('formatMoneyPlain agrupa miles con punto', () => {
    expect(formatMoneyPlain(1500)).toBe('$1.500')
    expect(formatMoneyPlain(50000000)).toBe('$50.000.000')
    expect(formatMoneyPlain(-999)).toBe('$999')
  })

  it('el día local D es [D 05:00Z, D+1 05:00Z)', () => {
    expect(bogotaDayRangeUTC('2026-09-29', '2026-09-30')).toEqual({
      start: '2026-09-29T05:00:00Z',
      end:   '2026-10-01T05:00:00Z',
    })
    expect(bogotaDayRangeUTC('2026-12-31', '2026-12-31').end).toBe('2027-01-01T05:00:00Z')
  })

  it('bogotaDateKey convierte un instante real a día local', () => {
    expect(bogotaDateKey('2026-09-30T03:00:00Z')).toBe('2026-09-29') // 22:00 del 29 en Bogotá
    expect(bogotaDateKey('2026-09-30T05:00:00Z')).toBe('2026-09-30')
  })

  it('isRealDateKey valida el calendario', () => {
    expect(isRealDateKey('2026-09-29')).toBe(true)
    expect(isRealDateKey('2026-02-30')).toBe(false)
    expect(isRealDateKey('29/09/2026')).toBe(false)
    expect(isRealDateKey(undefined)).toBe(false)
  })
})
