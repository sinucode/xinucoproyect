import { teamPaymentReceiptEmail } from '../email/templates'
import { sendTeamPaymentReceipt, resolveStaffEmail } from '../email/notifications'
import { sendEmail } from '../email/resend'
import { createClient } from '@supabase/supabase-js'

jest.mock('../email/resend', () => ({ sendEmail: jest.fn() }))
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }))

describe('teamPaymentReceiptEmail', () => {
  const base = {
    businessName: 'Barbería <X>',
    staffName: 'Carlos <b>Ruiz</b>',
    amount: 26100,
    dateTime: '29 de septiembre de 2026, 3:45 p. m.',
    methodLabel: 'Transferencia',
    balanceAfter: 0,
    receiptNumber: 'ABCD1234',
  }

  it('comprobante de pago: período, desglose sin ceros, saldo y pie', () => {
    const html = teamPaymentReceiptEmail({
      ...base,
      kind: 'payment',
      notes: 'Liquidación',
      periodFrom: '2026-09-22',
      periodTo: '2026-09-29',
      lines: [
        { label: 'Comisiones servicios', amount: 32500 },
        { label: 'Propinas', amount: 0 },
        { label: 'Anticipos', amount: -10000 },
      ],
      adminName: 'Ana Admin',
    })
    expect(html).toContain('Comprobante de pago')
    expect(html).toContain('$26.100')
    expect(html).toContain('Del 22 de septiembre al 29 de septiembre')
    expect(html).toContain('Comisiones servicios')
    expect(html).toContain('−$10.000')
    expect(html).not.toContain('Propinas')
    expect(html).toContain('Saldo después de este movimiento')
    expect(html).toContain('cuenta al día')
    expect(html).toContain('Registrado por Ana Admin')
    expect(html).toContain('ABCD1234')
  })

  it('recibo de anticipo: sin período ni desglose, con saldo negativo = anticipo por descontar', () => {
    const advance = teamPaymentReceiptEmail({
      ...base, kind: 'advance', amount: 10000, notes: 'Adelanto de la quincena',
      periodFrom: '2026-09-22', periodTo: '2026-09-29', lines: [{ label: 'Comisiones servicios', amount: 5 }],
      balanceAfter: -10000,
    })
    expect(advance).toContain('Recibo de anticipo')
    expect(advance).toContain('Motivo')
    expect(advance).toContain('Adelanto de la quincena')
    expect(advance).not.toContain('Del 22')
    expect(advance).not.toContain('Comisiones servicios')
    expect(advance).toContain('−$10.000')
    expect(advance).toContain('anticipo por descontar')
  })

  it('saldo positivo = te debemos', () => {
    expect(teamPaymentReceiptEmail({ ...base, kind: 'advance', balanceAfter: 5000 })).toContain('te debemos')
  })

  it('escapa todo valor dinámico', () => {
    const html = teamPaymentReceiptEmail({
      ...base, kind: 'advance', notes: '<script>alert(1)</script>', adminName: '<img src=x>',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x>')
    expect(html).not.toContain('<b>Ruiz</b>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Barbería &lt;X&gt;')
  })
})

// ── Fake de Supabase (service role) ──────────────────────────────────────────

type Result = { data?: unknown; error?: unknown }

function fakeService(opts: {
  tables: Record<string, Result[]>
  users?: Record<string, string | null>
  emailEnabled?: boolean
  brand?: boolean
}) {
  const queues = { ...opts.tables }
  const service = {
    from: jest.fn((table: string) => {
      const result = queues[table]?.length ? queues[table].shift()! : { data: [], error: null }
      const chain: any = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result).then(res, rej)
          if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve(result)
          return () => chain
        },
      })
      return chain
    }),
    rpc: jest.fn(() => ({
      maybeSingle: () => Promise.resolve({
        data: {
          name: 'Barbería X', slug: 'barberia-x', email_notifications: opts.emailEnabled !== false,
          branding: { logo_url: null, primary_color: '#112233' }, brand_config: null,
        },
        error: null,
      }),
    })),
    auth: { admin: { getUserById: jest.fn(async (id: string) => ({ data: { user: { email: opts.users?.[id] ?? null } } })) } },
  }
  ;(createClient as jest.Mock).mockReturnValue(service)
  return service
}

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'abcdef12-0000', business_id: 'biz1', staff_id: 's1', entry_type: 'payment', amount: 26100,
  notes: 'Liquidación', payment_method: 'transfer', period_from: '2026-09-22', period_to: '2026-09-29',
  created_at: '2026-09-29T20:45:00Z', created_by: 'admin1', ...over,
})
const ledger = [
  { id: 'a1', entry_type: 'commission', amount: 32500, created_at: '2026-09-22T15:00:00Z', sale_item: { item_type: 'service' } },
  { id: 'a2', entry_type: 'advance', amount: 6400, created_at: '2026-09-23T15:00:00Z', sale_item: null },
  { id: 'abcdef12-0000', entry_type: 'payment', amount: 26100, created_at: '2026-09-29T20:45:00Z', sale_item: null },
]

describe('sendTeamPaymentReceipt', () => {
  const OLD_ENV = process.env
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...OLD_ENV, NEXT_PUBLIC_SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' }
    ;(sendEmail as jest.Mock).mockResolvedValue({ success: true })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterAll(() => { process.env = OLD_ENV })

  it('sin variables de entorno responde error y no lanza', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(await sendTeamPaymentReceipt({ entryId: 'x' })).toEqual({ sent: false, reason: 'error' })
  })

  it('envía al correo del profesional con asunto, recibo y desglose; devuelve el correo enmascarado', async () => {
    fakeService({
      tables: {
        staff_ledger: [{ data: entry() }, { data: ledger }],
        staff: [{ data: { id: 's1', full_name: 'Carlos Ruiz', email: 'carlos@gmail.com', user_id: null } }],
        profiles: [{ data: { full_name: 'Ana Admin' } }],
      },
    })
    const r = await sendTeamPaymentReceipt({ entryId: 'abcdef12-0000', businessId: 'biz1' })
    expect(r).toEqual({ sent: true, to: 'c***s@gmail.com' })

    const mail = (sendEmail as jest.Mock).mock.calls[0][0]
    expect(mail.to).toBe('carlos@gmail.com')
    expect(mail.subject).toBe('Comprobante de pago · $26.100 · Barbería X')
    expect(mail.html).toContain('ABCDEF12')
    expect(mail.html).toContain('Comisiones servicios')
    expect(mail.html).toContain('Registrado por Ana Admin')
    expect(mail.html).toContain('Del 22 de septiembre al 29 de septiembre')
  })

  it('sin correo propio usa el del usuario vinculado', async () => {
    const svc = fakeService({
      tables: {
        staff_ledger: [{ data: entry({ entry_type: 'advance', amount: 10000 }) }, { data: ledger }],
        staff: [{ data: { id: 's1', full_name: 'Carlos Ruiz', email: null, user_id: 'u9' } }],
      },
      users: { u9: 'login@correo.com' },
    })
    const r = await sendTeamPaymentReceipt({ entryId: 'abcdef12-0000' })
    expect(svc.auth.admin.getUserById).toHaveBeenCalledWith('u9')
    expect(r).toEqual({ sent: true, to: 'l***n@correo.com' })
    expect((sendEmail as jest.Mock).mock.calls[0][0].subject).toBe('Recibo de anticipo · $10.000 · Barbería X')
  })

  it('sin ningún correo → no_email y no envía', async () => {
    fakeService({
      tables: {
        staff_ledger: [{ data: entry() }],
        staff: [{ data: { id: 's1', full_name: 'Carlos Ruiz', email: null, user_id: null } }],
      },
    })
    expect(await sendTeamPaymentReceipt({ entryId: 'abcdef12-0000' })).toEqual({ sent: false, reason: 'no_email' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('correos deshabilitados en el negocio → email_disabled', async () => {
    fakeService({
      emailEnabled: false,
      tables: {
        staff_ledger: [{ data: entry() }],
        staff: [{ data: { id: 's1', full_name: 'C', email: 'c@x.co', user_id: null } }],
      },
    })
    expect(await sendTeamPaymentReceipt({ entryId: 'abcdef12-0000' })).toEqual({ sent: false, reason: 'email_disabled' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('falla de Resend → error; nunca lanza', async () => {
    fakeService({
      tables: {
        staff_ledger: [{ data: entry() }, { data: ledger }],
        staff: [{ data: { id: 's1', full_name: 'Carlos', email: 'carlos@gmail.com', user_id: null } }],
      },
    })
    ;(sendEmail as jest.Mock).mockResolvedValueOnce({ success: false, error: 'boom' })
    expect(await sendTeamPaymentReceipt({ entryId: 'abcdef12-0000' })).toEqual({ sent: false, reason: 'error' })

    ;(createClient as jest.Mock).mockImplementation(() => { throw new Error('explota') })
    expect(await sendTeamPaymentReceipt({ entryId: 'abcdef12-0000' })).toEqual({ sent: false, reason: 'error' })
  })

  it('rechaza un movimiento de otro negocio, que no existe o que no es anticipo/pago', async () => {
    fakeService({ tables: { staff_ledger: [{ data: entry() }] } })
    expect(await sendTeamPaymentReceipt({ entryId: 'abcdef12-0000', businessId: 'otro' })).toEqual({ sent: false, reason: 'error' })

    fakeService({ tables: { staff_ledger: [{ data: null }] } })
    expect(await sendTeamPaymentReceipt({ entryId: 'nope' })).toEqual({ sent: false, reason: 'error' })

    fakeService({ tables: { staff_ledger: [{ data: entry({ entry_type: 'bonus' }) }] } })
    expect(await sendTeamPaymentReceipt({ entryId: 'abcdef12-0000' })).toEqual({ sent: false, reason: 'error' })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('resolveStaffEmail', () => {
  it('prefiere el correo del profesional y no consulta Auth', async () => {
    const svc = fakeService({ tables: {} })
    expect(await resolveStaffEmail(svc as never, { email: ' a@b.co ', user_id: 'u1' })).toBe('a@b.co')
    expect(svc.auth.admin.getUserById).not.toHaveBeenCalled()
  })

  it('sin correo ni usuario → null; si Auth falla → null', async () => {
    const svc = fakeService({ tables: {} })
    expect(await resolveStaffEmail(svc as never, {})).toBeNull()
    svc.auth.admin.getUserById.mockRejectedValueOnce(new Error('x'))
    expect(await resolveStaffEmail(svc as never, { user_id: 'u1' })).toBeNull()
  })
})
