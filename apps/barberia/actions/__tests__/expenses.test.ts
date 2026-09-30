import { createExpense, updateExpense, deleteExpense, registerRecurring, getExpensesOverview } from '../expenses'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { businessTodayISODate, addDaysToDateKey } from '@/lib/agenda-time'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

type Result = { data?: any; error?: any }

/**
 * Fake de Supabase: cada `from(tabla)` consume el siguiente resultado encolado
 * para esa tabla (o el default). El builder es encadenable y "thenable".
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
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: role === null ? null : { id: 'u1' } } }) },
  }
  if (role !== null && !queues.profiles) {
    queues.profiles = [{ data: { role, business_id: 'biz1' }, error: null }]
  }
  return { supabase, calls }
}

function setup(role: string | null, queues: Record<string, Result[]> = {}) {
  const m = makeSupabase(role, queues)
  ;(createClient as jest.Mock).mockResolvedValue(m.supabase)
  return m
}

const opOf = (calls: ReturnType<typeof makeSupabase>['calls'], table: string, op: string, nth = 0) =>
  calls.filter(c => c.table === table).flatMap(c => c.ops).filter(o => o.op === op)[nth]

const today = businessTodayISODate()

const validInput = {
  category: 'rent',
  description: 'Arriendo del local',
  amount: 1500000,
  expense_date: today,
  is_recurring: false,
  payment_method: 'transfer' as const,
}

const NOT_ADMIN = 'Solo un administrador puede gestionar gastos.'
const NO_SHIFT = 'No hay caja abierta. Abre la caja o elige otro medio de pago.'
const CLOSED = 'Este gasto ya se cuadró en un cierre de caja.'

describe('Expenses Server Actions', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('permisos', () => {
    it.each(['barber', 'manicurist', 'cashier'])('rechaza el rol %s', async (role) => {
      setup(role)
      expect(await createExpense(validInput)).toEqual({ error: NOT_ADMIN })
      expect(await updateExpense('e1', validInput)).toEqual({ error: NOT_ADMIN })
      expect(await deleteExpense('e1')).toEqual({ error: NOT_ADMIN })
      expect(await registerRecurring([validInput])).toEqual({ error: NOT_ADMIN })
      expect(await getExpensesOverview('2026-09')).toEqual({ error: NOT_ADMIN })
    })

    it('rechaza sin sesión', async () => {
      setup(null)
      expect(await createExpense(validInput)).toEqual({ error: NOT_ADMIN })
    })
  })

  describe('createExpense — validación', () => {
    it.each([
      ['categoría desconocida', { category: 'xyz' }],
      ['descripción corta', { description: 'a' }],
      ['descripción larga', { description: 'x'.repeat(121) }],
      ['monto cero', { amount: 0 }],
      ['monto decimal', { amount: 1500.5 }],
      ['monto excesivo', { amount: 100_000_001 }],
      ['fecha inválida', { expense_date: '2026-02-30' }],
      ['fecha con formato malo', { expense_date: '29/09/2026' }],
      ['fecha futura', { expense_date: addDaysToDateKey(today, 5) }],
      ['medio de pago inválido', { payment_method: 'bitcoin' as any }],
    ])('rechaza %s', async (_name, patch) => {
      const { calls } = setup('admin')
      const res = await createExpense({ ...validInput, ...patch })
      expect(res.error).toBeTruthy()
      expect(calls.some(c => c.table === 'expenses')).toBe(false)
    })

    it('acepta el borde de 1 día en el futuro', async () => {
      setup('admin', { expenses: [{ data: { id: 'e1' }, error: null }] })
      const res = await createExpense({ ...validInput, expense_date: addDaysToDateKey(today, 1) })
      expect(res.success).toBe(true)
    })
  })

  describe('createExpense — inserción', () => {
    it('usa el negocio y el usuario del perfil; transferencia sin turno', async () => {
      const { calls } = setup('admin', { expenses: [{ data: { id: 'e1' }, error: null }] })
      const res = await createExpense({ ...validInput, description: '  Arriendo del local  ' })
      expect(res.success).toBe(true)
      expect(opOf(calls, 'expenses', 'insert').args[0]).toMatchObject({
        business_id: 'biz1',
        created_by: 'u1',
        description: 'Arriendo del local',
        payment_method: 'transfer',
        shift_id: null,
      })
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/expenses', 'page')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard', 'layout')
    })

    it('efectivo de la caja sin turno abierto → error', async () => {
      const { calls } = setup('admin', { cash_register_shifts: [{ data: null, error: null }] })
      const res = await createExpense({ ...validInput, payment_method: 'cash_register' })
      expect(res).toEqual({ error: NO_SHIFT })
      expect(calls.some(c => c.table === 'expenses')).toBe(false)
    })

    it('efectivo de la caja con fecha distinta de hoy → error', async () => {
      setup('admin', { cash_register_shifts: [{ data: { id: 'sh1', opened_at: 'x' }, error: null }] })
      const res = await createExpense({
        ...validInput, payment_method: 'cash_register', expense_date: addDaysToDateKey(today, -1),
      })
      expect(res).toEqual({ error: 'Un gasto pagado con efectivo de la caja debe ser de hoy.' })
    })

    it('efectivo de la caja guarda el shift_id del turno abierto', async () => {
      const { calls } = setup('admin', {
        cash_register_shifts: [{ data: { id: 'sh1', opened_at: 'x' }, error: null }],
        expenses: [{ data: { id: 'e1' }, error: null }],
      })
      const res = await createExpense({ ...validInput, payment_method: 'cash_register' })
      expect(res.success).toBe(true)
      expect(opOf(calls, 'expenses', 'insert').args[0]).toMatchObject({
        payment_method: 'cash_register',
        shift_id: 'sh1',
        business_id: 'biz1',
      })
      // el turno se busca en el negocio del perfil, abierto
      expect(opOf(calls, 'cash_register_shifts', 'eq', 0).args).toEqual(['business_id', 'biz1'])
      expect(opOf(calls, 'cash_register_shifts', 'eq', 1).args).toEqual(['status', 'open'])
    })
  })

  describe('updateExpense', () => {
    const existing = {
      id: 'e1', business_id: 'biz1', amount: 1500000, payment_method: 'cash_register',
      expense_date: today, shift_id: 'sh1',
    }

    it('gasto no encontrado', async () => {
      setup('admin', { expenses: [{ data: null, error: null }] })
      expect(await updateExpense('e1', validInput)).toEqual({ error: 'Gasto no encontrado.' })
    })

    it('gasto de un turno cerrado: no se puede cambiar el monto', async () => {
      const { calls } = setup('admin', {
        expenses: [{ data: existing, error: null }],
        cash_register_shifts: [{ data: { id: 'sh1', status: 'closed' }, error: null }],
      })
      const res = await updateExpense('e1', { ...validInput, payment_method: 'cash_register', amount: 999 })
      expect(res).toEqual({ error: CLOSED })
      expect(calls.flatMap(c => c.ops).some(o => o.op === 'update')).toBe(false)
    })

    it('gasto de un turno cerrado: no se puede cambiar el medio de pago', async () => {
      setup('admin', {
        expenses: [{ data: existing, error: null }],
        cash_register_shifts: [{ data: { id: 'sh1', status: 'closed' }, error: null }],
      })
      const res = await updateExpense('e1', { ...validInput, payment_method: 'transfer' })
      expect(res).toEqual({ error: CLOSED })
    })

    it('gasto de un turno cerrado: sí se puede corregir la descripción y conserva el turno', async () => {
      const { calls } = setup('admin', {
        expenses: [{ data: existing, error: null }, { data: { id: 'e1' }, error: null }],
        cash_register_shifts: [{ data: { id: 'sh1', status: 'closed' }, error: null }],
      })
      const res = await updateExpense('e1', {
        ...validInput, payment_method: 'cash_register', description: 'Otro nombre',
      })
      expect(res.success).toBe(true)
      expect(opOf(calls, 'expenses', 'update').args[0]).toMatchObject({
        description: 'Otro nombre', shift_id: 'sh1',
      })
    })

    it('actualiza filtrando por negocio del perfil', async () => {
      const { calls } = setup('admin', {
        expenses: [
          { data: { ...existing, payment_method: 'transfer', shift_id: null }, error: null },
          { data: { id: 'e1' }, error: null },
        ],
      })
      const res = await updateExpense('e1', { ...validInput, amount: 2000000 })
      expect(res.success).toBe(true)
      const updateCall = calls.filter(c => c.table === 'expenses')[1]
      expect(updateCall.ops.filter(o => o.op === 'eq').map(o => o.args)).toEqual([
        ['id', 'e1'], ['business_id', 'biz1'],
      ])
    })
  })

  describe('deleteExpense', () => {
    it('rechaza un gasto de un turno cerrado', async () => {
      const { calls } = setup('admin', {
        expenses: [{ data: { id: 'e1', shift_id: 'sh1' }, error: null }],
        cash_register_shifts: [{ data: { id: 'sh1', status: 'closed' }, error: null }],
      })
      expect(await deleteExpense('e1')).toEqual({ error: CLOSED })
      expect(calls.flatMap(c => c.ops).some(o => o.op === 'delete')).toBe(false)
    })

    it('elimina un gasto normal filtrando por negocio', async () => {
      const { calls } = setup('admin', {
        expenses: [{ data: { id: 'e1', shift_id: null }, error: null }, { error: null }],
      })
      expect(await deleteExpense('e1')).toEqual({ success: true })
      const del = calls.filter(c => c.table === 'expenses')[1]
      expect(del.ops.map(o => o.op)).toContain('delete')
      expect(del.ops.filter(o => o.op === 'eq').map(o => o.args)).toContainEqual(['business_id', 'biz1'])
    })
  })

  describe('registerRecurring', () => {
    it('inserta como fijos con el negocio del perfil y transferencia por defecto', async () => {
      const { calls } = setup('admin')
      const res = await registerRecurring([
        { category: 'rent', description: 'Arriendo', amount: 1000000, expense_date: today },
        { category: 'utilities', description: 'Internet', amount: 90000, expense_date: today, payment_method: 'card' },
      ])
      expect(res).toEqual({ success: true, count: 2 })
      const rows = opOf(calls, 'expenses', 'insert').args[0]
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ business_id: 'biz1', is_recurring: true, payment_method: 'transfer', shift_id: null, created_by: 'u1' })
      expect(rows[1]).toMatchObject({ is_recurring: true, payment_method: 'card' })
    })

    it('nunca acepta efectivo de la caja', async () => {
      const { calls } = setup('admin')
      const res = await registerRecurring([
        { category: 'rent', description: 'Arriendo', amount: 1000000, expense_date: today, payment_method: 'cash_register' },
      ])
      expect(res.error).toBeTruthy()
      expect(calls.some(c => c.table === 'expenses')).toBe(false)
    })

    it('valida cada ítem y rechaza listas vacías', async () => {
      setup('admin')
      expect((await registerRecurring([])).error).toBeTruthy()
      expect((await registerRecurring([
        { category: 'rent', description: 'Arriendo', amount: 0, expense_date: today },
      ])).error).toBeTruthy()
    })
  })

  describe('getExpensesOverview', () => {
    it('devuelve mes, gastos, P&G, pendientes y turno activo', async () => {
      const m = setup('admin', {
        expenses: [
          { data: [{ id: 'e1', category: 'rent', description: 'Local', amount: 1, expense_date: today, is_recurring: false }], error: null },
          { data: [{ id: 'h1', category: 'utilities', description: 'Internet', amount: 90000, expense_date: '2020-01-05', is_recurring: true }], error: null },
        ],
        cash_register_shifts: [{ data: { id: 'sh1', opened_at: 'x' }, error: null }],
      })
      m.supabase.rpc.mockResolvedValue({ data: { net_profit: 5 }, error: null })
      const res = await getExpensesOverview()
      expect('error' in res).toBe(false)
      if ('error' in res) return
      expect(res.month.key).toBe(today.slice(0, 7))
      expect(res.expenses).toHaveLength(1)
      expect(res.pl).toEqual({ net_profit: 5 })
      expect(res.activeShift).toEqual({ id: 'sh1', opened_at: 'x' })
      expect(m.supabase.rpc).toHaveBeenCalledWith('get_profit_loss', expect.objectContaining({ p_business_id: 'biz1' }))
    })

    it('si el P&G falla devuelve plError sin romper la página', async () => {
      const m = setup('admin')
      m.supabase.rpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } })
      const res = await getExpensesOverview('2026-09')
      if ('error' in res) throw new Error('no debería fallar')
      expect(res.pl).toBeNull()
      expect(res.plError).toBeTruthy()
    })

    it('no sugiere gastos fijos en meses pasados', async () => {
      setup('admin', {
        expenses: [
          { data: [], error: null },
          { data: [{ id: 'h1', category: 'rent', description: 'Local', amount: 1, expense_date: '2020-01-05', is_recurring: true }], error: null },
        ],
      })
      const res = await getExpensesOverview('2020-03')
      if ('error' in res) throw new Error('no debería fallar')
      expect(res.pendingRecurring).toEqual([])
    })
  })
})
