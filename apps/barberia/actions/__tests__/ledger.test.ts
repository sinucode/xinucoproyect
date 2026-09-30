import {
  recordTeamMovement,
  getStaffAccount,
  getMyAccount,
  getTeamPaymentsOverview,
} from '../ledger'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

type Result = { data?: any; error?: any; count?: number | null }

/**
 * Fake de Supabase: cada `from(tabla)` consume el siguiente resultado encolado para esa tabla
 * (o `{ data: [] }`). El builder es encadenable y "thenable" y registra cada operación.
 */
function makeSupabase(role: string | null, queues: Record<string, Result[]> = {}) {
  const calls: { table: string; ops: { op: string; args: any[] }[] }[] = []

  const from = jest.fn((table: string) => {
    const call = { table, ops: [] as { op: string; args: any[] }[] }
    calls.push(call)
    const result: Result = queues[table]?.length ? queues[table].shift()! : { data: [], error: null }

    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result).then(res, rej)
        return (...args: any[]) => { call.ops.push({ op: prop, args }); return chain }
      },
    })
    return chain
  })

  const supabase = {
    from,
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: role === null ? null : { id: 'u1' } } }) },
  }
  if (role !== null && !queues.profiles) {
    // Varias llamadas por test: el perfil se consulta una vez por acción
    queues.profiles = Array.from({ length: 5 }, () => ({ data: { role, business_id: 'biz1' }, error: null }))
  }
  return { supabase, calls }
}

function setup(role: string | null, queues: Record<string, Result[]> = {}) {
  const m = makeSupabase(role, queues)
  ;(createClient as jest.Mock).mockResolvedValue(m.supabase)
  return m
}

type Calls = ReturnType<typeof makeSupabase>['calls']
const opsOf = (calls: Calls, table: string, op: string) =>
  calls.filter(c => c.table === table).flatMap(c => c.ops).filter(o => o.op === op)
const hasEq = (calls: Calls, table: string, col: string, val: unknown) =>
  opsOf(calls, table, 'eq').some(o => o.args[0] === col && o.args[1] === val)

const NOT_ADMIN = 'Solo un administrador puede gestionar los pagos al equipo.'
const NO_SHIFT = 'No hay caja abierta. Abre la caja o elige otro medio de pago.'
const NOT_ALLOWED = 'No tienes permiso para ver esta cuenta.'

const staffOk = { data: { id: 's1' }, error: null }
const bonus = { staffId: 's1', type: 'bonus' as const, amount: 5000, notes: 'Meta del mes' }
const payment = { staffId: 's1', type: 'payment' as const, amount: 10000, payment_method: 'transfer' as const }

describe('Pagos al equipo — recordTeamMovement', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('permisos', () => {
    it.each(['barber', 'manicurist', 'cashier'])('el rol %s no puede registrar', async (role) => {
      const { calls } = setup(role)
      expect(await recordTeamMovement(bonus)).toEqual({ error: NOT_ADMIN })
      expect(opsOf(calls, 'staff_ledger', 'insert')).toHaveLength(0)
    })

    it('rechaza sin sesión', async () => {
      setup(null)
      expect(await recordTeamMovement(bonus)).toEqual({ error: NOT_ADMIN })
    })

    it('rechaza a un profesional de otro negocio (no aparece con el business_id del perfil)', async () => {
      const { calls } = setup('admin', { staff: [{ data: null, error: null }] })
      expect(await recordTeamMovement({ ...bonus, staffId: 'staff-ajeno' })).toEqual({ error: 'Profesional no encontrado.' })
      expect(hasEq(calls, 'staff', 'business_id', 'biz1')).toBe(true)
      expect(hasEq(calls, 'staff', 'id', 'staff-ajeno')).toBe(true)
      expect(opsOf(calls, 'staff_ledger', 'insert')).toHaveLength(0)
    })
  })

  describe('validación', () => {
    it.each([
      ['monto cero', { amount: 0 }],
      ['monto decimal', { amount: 10.5 }],
      ['monto excesivo', { amount: 50_000_001 }],
    ])('rechaza %s', async (_n, patch) => {
      const { calls } = setup('admin', { staff: [staffOk] })
      const r = await recordTeamMovement({ ...bonus, ...patch })
      expect(r.error).toBe('El monto debe ser un entero entre $1 y $50.000.000.')
      expect(opsOf(calls, 'staff_ledger', 'insert')).toHaveLength(0)
    })

    it.each(['bonus', 'deduction', 'advance'] as const)('exige motivo (3–200) en %s', async (type) => {
      const base = { staffId: 's1', type, amount: 1000, payment_method: 'transfer' as const }
      setup('admin', { staff: [staffOk, staffOk, staffOk] })
      expect((await recordTeamMovement({ ...base, notes: '' })).error).toBe('El motivo debe tener entre 3 y 200 caracteres.')
      expect((await recordTeamMovement({ ...base, notes: ' ab ' })).error).toBe('El motivo debe tener entre 3 y 200 caracteres.')
      expect((await recordTeamMovement({ ...base, notes: 'x'.repeat(201) })).error).toBe('El motivo debe tener entre 3 y 200 caracteres.')
    })

    it('anticipo y pago exigen medio de pago válido', async () => {
      setup('admin', { staff: [staffOk, staffOk] })
      expect((await recordTeamMovement({ staffId: 's1', type: 'advance', amount: 1000, notes: 'Adelanto' })).error).toBe('Elige cómo se pagó.')
      expect((await recordTeamMovement({ ...payment, payment_method: 'bitcoin' as any })).error).toBe('Elige cómo se pagó.')
    })

    it('valida el período del pago', async () => {
      setup('admin', { staff: [staffOk, staffOk, staffOk] })
      const bad = { ...payment, allowOverpay: true }
      expect((await recordTeamMovement({ ...bad, period_from: '2026-02-30', period_to: '2026-03-01' })).error)
        .toBe('Las fechas del período no son válidas.')
      expect((await recordTeamMovement({ ...bad, period_from: '2026-09-29', period_to: '2026-09-22' })).error)
        .toBe('El inicio del período no puede ser posterior a su final.')
      expect((await recordTeamMovement({ ...bad, period_from: '2026-09-22' })).error)
        .toBe('Las fechas del período no son válidas.')
    })

    it('rechaza un tipo desconocido', async () => {
      setup('admin')
      expect((await recordTeamMovement({ ...bonus, type: 'commission' as any })).error).toBe('Elige el tipo de movimiento.')
    })
  })

  describe('caja', () => {
    it('efectivo de la caja sin turno abierto se rechaza', async () => {
      const { calls } = setup('admin', {
        staff: [staffOk],
        cash_register_shifts: [{ data: null, error: null }],
      })
      const r = await recordTeamMovement({ staffId: 's1', type: 'advance', amount: 20000, notes: 'Adelanto', payment_method: 'cash_register' })
      expect(r).toEqual({ error: NO_SHIFT })
      expect(hasEq(calls, 'cash_register_shifts', 'business_id', 'biz1')).toBe(true)
      expect(hasEq(calls, 'cash_register_shifts', 'status', 'open')).toBe(true)
      expect(opsOf(calls, 'staff_ledger', 'insert')).toHaveLength(0)
    })

    it('efectivo de la caja guarda el shift_id, el creador y el business_id del perfil', async () => {
      const created = { id: 'l1', entry_type: 'advance', amount: 20000 }
      const { calls } = setup('admin', {
        staff: [staffOk],
        cash_register_shifts: [{ data: { id: 'shift9' }, error: null }],
        staff_ledger: [{ data: created, error: null }],
      })
      const r = await recordTeamMovement({ staffId: 's1', type: 'advance', amount: 20000, notes: ' Adelanto ', payment_method: 'cash_register' })

      expect(r).toEqual({ success: true, entry: created })
      expect(opsOf(calls, 'staff_ledger', 'insert')[0].args[0]).toEqual({
        business_id: 'biz1',
        staff_id: 's1',
        entry_type: 'advance',
        amount: 20000,
        notes: 'Adelanto',
        reference_id: null,
        payment_method: 'cash_register',
        shift_id: 'shift9',
        created_by: 'u1',
        period_from: null,
        period_to: null,
      })
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/ledger', 'page')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard', 'layout')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/commissions', 'page')
    })

    it('transferencia no necesita turno y no guarda shift_id', async () => {
      const { calls } = setup('admin', {
        staff: [staffOk],
        staff_ledger: [{ data: { id: 'l1' }, error: null }],
        staff_ledger_balances: [{ data: { current_balance: 10000 }, error: null }],
      })
      const r = await recordTeamMovement(payment)
      expect(r.success).toBe(true)
      expect(calls.some(c => c.table === 'cash_register_shifts')).toBe(false)
      const row = opsOf(calls, 'staff_ledger', 'insert')[0].args[0]
      expect(row.shift_id).toBeNull()
      expect(row.notes).toBe('Liquidación')
      expect(row.payment_method).toBe('transfer')
    })
  })

  describe('bono y descuento', () => {
    it('no llevan medio de pago ni turno, aunque el cliente los envíe', async () => {
      const { calls } = setup('admin', {
        staff: [staffOk],
        staff_ledger: [{ data: { id: 'l1' }, error: null }],
      })
      const r = await recordTeamMovement({ ...bonus, type: 'deduction', payment_method: 'cash_register', period_from: '2026-09-01', period_to: '2026-09-02' })
      expect(r.success).toBe(true)
      expect(calls.some(c => c.table === 'cash_register_shifts')).toBe(false)
      const row = opsOf(calls, 'staff_ledger', 'insert')[0].args[0]
      expect(row).toMatchObject({ entry_type: 'deduction', payment_method: null, shift_id: null, period_from: null, period_to: null })
    })
  })

  describe('pago mayor al saldo', () => {
    it('sin allowOverpay pide confirmación y no inserta', async () => {
      const { calls } = setup('admin', {
        staff: [staffOk],
        staff_ledger_balances: [{ data: { current_balance: 10000 }, error: null }],
      })
      const r = await recordTeamMovement({ ...payment, amount: 20000 })
      expect(r.success).toBeUndefined()
      expect(r.error).toBe('El pago supera el saldo ($10.000). La diferencia quedará como anticipo.')
      expect(r.overpay).toEqual({ balance: 10000 })
      expect(hasEq(calls, 'staff_ledger_balances', 'business_id', 'biz1')).toBe(true)
      expect(opsOf(calls, 'staff_ledger', 'insert')).toHaveLength(0)
    })

    it('con allowOverpay lo registra', async () => {
      const { calls } = setup('admin', {
        staff: [staffOk],
        staff_ledger: [{ data: { id: 'l1' }, error: null }],
      })
      const r = await recordTeamMovement({ ...payment, amount: 20000, allowOverpay: true })
      expect(r.success).toBe(true)
      expect(opsOf(calls, 'staff_ledger', 'insert')).toHaveLength(1)
    })

    it('un saldo negativo o cero también cuenta como pago de más', async () => {
      setup('admin', {
        staff: [staffOk],
        staff_ledger_balances: [{ data: null, error: null }], // sin movimientos → saldo 0
      })
      const r = await recordTeamMovement(payment)
      expect(r.overpay).toEqual({ balance: 0 })
    })

    it('el anticipo no pasa por la validación de saldo', async () => {
      const { calls } = setup('admin', {
        staff: [staffOk],
        staff_ledger: [{ data: { id: 'l1' }, error: null }],
      })
      const r = await recordTeamMovement({ staffId: 's1', type: 'advance', amount: 99000, notes: 'Adelanto', payment_method: 'transfer' })
      expect(r.success).toBe(true)
      expect(calls.some(c => c.table === 'staff_ledger_balances')).toBe(false)
    })
  })

  it('propaga el error de la base', async () => {
    setup('admin', {
      staff: [staffOk],
      staff_ledger: [{ data: null, error: { message: 'boom' } }],
    })
    expect(await recordTeamMovement(bonus)).toEqual({ error: 'boom' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('Pagos al equipo — lectura', () => {
  beforeEach(() => jest.clearAllMocks())

  const entriesAll = [
    { id: 'a', entry_type: 'commission', amount: 10000, created_at: '2026-09-20T15:00:00Z', sale_item: { item_type: 'service' } },
    { id: 'b', entry_type: 'payment', amount: 10000, created_at: '2026-09-21T15:00:00Z', sale_item: null },
    { id: 'c', entry_type: 'commission', amount: 3600, created_at: '2026-09-22T15:00:00Z', sale_item: [{ item_type: 'product' }] },
    { id: 'd', entry_type: 'commission', amount: 32500, created_at: '2026-09-23T15:00:00Z', sale_item: { item_type: 'service' } },
  ]
  const staffRow = { id: 's1', full_name: 'Carlos', specialty_role: 'Barbero', is_active: true, user_id: 'u1' }

  describe('getStaffAccount', () => {
    it('un no-admin solo ve a su propio profesional (filtra por user_id)', async () => {
      const { calls } = setup('barber', { staff: [{ data: null, error: null }] })
      expect(await getStaffAccount('s-de-otro')).toEqual({ error: NOT_ALLOWED })
      expect(hasEq(calls, 'staff', 'business_id', 'biz1')).toBe(true)
      expect(hasEq(calls, 'staff', 'user_id', 'u1')).toBe(true)
      expect(calls.some(c => c.table === 'staff_ledger')).toBe(false)
    })

    it('un admin no filtra por user_id y si no existe en el negocio da error', async () => {
      const { calls } = setup('admin', { staff: [{ data: null, error: null }] })
      expect(await getStaffAccount('s-ajeno')).toEqual({ error: 'Profesional no encontrado.' })
      expect(hasEq(calls, 'staff', 'user_id', 'u1')).toBe(false)
      expect(hasEq(calls, 'staff', 'business_id', 'biz1')).toBe(true)
    })

    it('rechaza sin sesión', async () => {
      setup(null)
      expect(await getStaffAccount('s1')).toEqual({ error: NOT_ALLOWED })
    })

    it('devuelve saldo, liquidación desde el último pago y la página filtrada (fechas en hora de Colombia)', async () => {
      const page = [{ ...entriesAll[3], business_id: 'biz1', staff_id: 's1' }]
      const { calls } = setup('admin', {
        staff: [{ data: staffRow, error: null }],
        staff_ledger: [{ data: entriesAll, error: null }, { data: page, error: null, count: 60 }],
      })
      const r = await getStaffAccount('s1', { type: 'commission', from: '2026-09-22', to: '2026-09-23', page: 1 })
      if ('error' in r) throw new Error(r.error)

      expect(r.balance).toBe(36100)
      expect(r.settlement.since).toBe('2026-09-21T15:00:00Z')
      expect(r.settlement.services_commission).toBe(32500)
      expect(r.settlement.products_commission).toBe(3600)
      expect(r.settlement.total_to_pay).toBe(36100)
      expect(r.entries).toHaveLength(1)
      expect(r.entries[0].item_type).toBe('service')
      expect(r.total).toBe(60)
      expect(r.hasMore).toBe(true)
      expect(r.suggestedPeriod.from).toBe('2026-09-22') // día siguiente al último pago (Colombia)

      const staffLedgerOps = calls.filter(c => c.table === 'staff_ledger')
      const filtered = staffLedgerOps[1].ops
      expect(filtered.find(o => o.op === 'eq' && o.args[0] === 'entry_type')?.args[1]).toBe('commission')
      expect(filtered.find(o => o.op === 'gte')?.args).toEqual(['created_at', '2026-09-22T05:00:00Z'])
      expect(filtered.find(o => o.op === 'lt')?.args).toEqual(['created_at', '2026-09-24T05:00:00Z'])
      expect(filtered.find(o => o.op === 'range')?.args).toEqual([0, 49])
      // Todos los queries van acotados al negocio del perfil
      expect(staffLedgerOps.every(c => c.ops.some(o => o.op === 'eq' && o.args[0] === 'business_id' && o.args[1] === 'biz1'))).toBe(true)
    })

    it('ignora filtros inválidos y "Ver más" agranda el rango', async () => {
      const { calls } = setup('admin', {
        staff: [{ data: staffRow, error: null }],
        staff_ledger: [{ data: [], error: null }, { data: [], error: null, count: 0 }],
      })
      const r = await getStaffAccount('s1', { type: 'nope' as any, from: 'ayer', to: '2026-13-01', page: 3 })
      if ('error' in r) throw new Error(r.error)
      const filtered = calls.filter(c => c.table === 'staff_ledger')[1].ops
      expect(filtered.some(o => o.op === 'gte' || o.op === 'lt')).toBe(false)
      expect(filtered.some(o => o.op === 'eq' && o.args[0] === 'entry_type')).toBe(false)
      expect(filtered.find(o => o.op === 'range')?.args).toEqual([0, 149])
      expect(r.hasMore).toBe(false)
      expect(r.balance).toBe(0)
    })
  })

  describe('getMyAccount', () => {
    it('sin profesional vinculado devuelve notLinked', async () => {
      const { calls } = setup('barber', { staff: [{ data: null, error: null }] })
      expect(await getMyAccount()).toEqual({ notLinked: true })
      expect(hasEq(calls, 'staff', 'user_id', 'u1')).toBe(true)
      expect(hasEq(calls, 'staff', 'business_id', 'biz1')).toBe(true)
    })

    it('con profesional vinculado devuelve su cuenta', async () => {
      setup('manicurist', {
        staff: [{ data: staffRow, error: null }],
        staff_ledger: [{ data: entriesAll, error: null }, { data: [], error: null, count: 4 }],
      })
      const r = await getMyAccount()
      if ('error' in r || 'notLinked' in r) throw new Error('inesperado')
      expect(r.staff.id).toBe('s1')
      expect(r.balance).toBe(36100)
    })

    it('rechaza sin sesión', async () => {
      setup(null)
      expect(await getMyAccount()).toEqual({ error: NOT_ALLOWED })
    })
  })

  describe('getTeamPaymentsOverview', () => {
    it('un no-admin no puede ver el resumen del equipo', async () => {
      setup('barber')
      expect(await getTeamPaymentsOverview()).toEqual({ error: NOT_ADMIN })
    })

    it('suma lo que se debe y los anticipos; oculta inactivos sin saldo', async () => {
      setup('admin', {
        staff: [{
          data: [
            { id: 's1', full_name: 'Ana', specialty_role: 'Barbero', is_active: true, user_id: null },
            { id: 's2', full_name: 'Beto', specialty_role: 'Barbero', is_active: true, user_id: 'u2' },
            { id: 's3', full_name: 'Cami', specialty_role: 'Barbero', is_active: false, user_id: null },
            { id: 's4', full_name: 'Dani', specialty_role: 'Barbero', is_active: false, user_id: null },
          ],
          error: null,
        }],
        staff_ledger_balances: [{
          data: [
            { staff_id: 's1', total_earned: 50000, total_advances: 0, total_paid_out: 0, total_bonus: 0, total_deductions: 0, current_balance: 50000 },
            { staff_id: 's2', total_earned: 0, total_advances: 8000, total_paid_out: 0, total_bonus: 0, total_deductions: 0, current_balance: -8000 },
            { staff_id: 's4', total_earned: 100, total_advances: 0, total_paid_out: 100, total_bonus: 0, total_deductions: 0, current_balance: 0 },
          ],
          error: null,
        }],
        businesses: [{ data: { name: 'Barbería X' }, error: null }],
        cash_register_shifts: [{ data: { id: 'shift1' }, error: null }],
        staff_ledger: [{ data: [{ staff_id: 's1', created_at: '2026-09-25T00:00:00Z' }, { staff_id: 's1', created_at: '2026-09-01T00:00:00Z' }], error: null }],
      })
      const r = await getTeamPaymentsOverview()
      if ('error' in r) throw new Error(r.error)

      expect(r.members.map(m => m.staff.id)).toEqual(['s1', 's2']) // s3 y s4 inactivos con saldo 0
      expect(r.totals).toEqual({ owed: 50000, advances_outstanding: 8000 })
      expect(r.activeShift).toEqual({ id: 'shift1' })
      expect(r.businessName).toBe('Barbería X')
      expect(r.members[0].last_payment_at).toBe('2026-09-25T00:00:00Z')
      expect(r.members[1].last_payment_at).toBeNull()
    })

    it('incluye a un inactivo con saldo distinto de cero', async () => {
      setup('admin', {
        staff: [{ data: [{ id: 's3', full_name: 'Cami', specialty_role: 'Barbero', is_active: false, user_id: null }], error: null }],
        staff_ledger_balances: [{ data: [{ staff_id: 's3', total_earned: 9000, total_advances: 0, total_paid_out: 0, current_balance: 9000 }], error: null }],
      })
      const r = await getTeamPaymentsOverview()
      if ('error' in r) throw new Error(r.error)
      expect(r.members.map(m => m.staff.id)).toEqual(['s3'])
      expect(r.activeShift).toBeNull()
    })
  })
})
