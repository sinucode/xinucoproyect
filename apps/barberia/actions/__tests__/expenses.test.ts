import {
  createExpense,
  updateExpense,
  deleteExpense,
  registerRecurring,
  getExpensesOverview,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  getExpenseCategoryUsage,
  getUpcomingFixedExpenses,
} from '../expenses'
import { DEFAULT_EXPENSE_CATEGORIES } from '@/lib/expense-utils'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { businessTodayISODate, addDaysToDateKey } from '@/lib/agenda-time'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

type Result = { data?: any; error?: any; count?: number | null }

const cat = (slug: string, name: string, extra: Record<string, unknown> = {}) => ({
  id: `id_${slug}`, business_id: 'biz1', slug, name, color: 'blue', is_hidden: false, sort_order: 1, created_at: 'x', ...extra,
})
const DEFAULT_CATS = DEFAULT_EXPENSE_CATEGORIES.map(c => cat(c.slug, c.name, { color: c.color, sort_order: c.sort_order }))

/**
 * Fake de Supabase: cada `from(tabla)` consume el siguiente resultado encolado
 * para esa tabla (o el default). El builder es encadenable y "thenable".
 */
function makeSupabase(role: string | null, queues: Record<string, Result[]> = {}) {
  const calls: { table: string; ops: { op: string; args: any[] }[] }[] = []

  const from = jest.fn((table: string) => {
    const call = { table, ops: [] as { op: string; args: any[] }[] }
    calls.push(call)
    // Sin resultado encolado: las categorías por defecto del negocio (el resto, vacío)
    const fallback: Result = table === 'expense_categories' ? { data: DEFAULT_CATS, error: null } : { data: [], error: null }
    const result: Result = queues[table]?.length ? queues[table].shift()! : fallback

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
      expect(await createExpenseCategory('Café')).toEqual({ error: NOT_ADMIN })
      expect(await updateExpenseCategory('c1', { name: 'X1' })).toEqual({ error: NOT_ADMIN })
      expect(await deleteExpenseCategory('c1')).toEqual({ error: NOT_ADMIN })
      expect(await getExpenseCategoryUsage()).toEqual({ error: NOT_ADMIN })
      expect(await getUpcomingFixedExpenses()).toEqual([])
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
  describe('categorías del negocio', () => {
    it('crea las 8 por defecto la primera vez y las devuelve en el resumen', async () => {
      const rows = DEFAULT_CATS
      const { calls } = setup('admin', {
        expense_categories: [
          { data: [], error: null },     // negocio sin categorías
          { data: null, error: null },   // upsert de las por defecto
          { data: rows, error: null },   // relectura
        ],
      })
      const res = await getExpensesOverview('2026-09')
      if ('error' in res) throw new Error('no debería fallar')
      const upsert = opOf(calls, 'expense_categories', 'upsert')
      expect(upsert.args[0]).toHaveLength(8)
      expect(upsert.args[0][0]).toMatchObject({ business_id: 'biz1', slug: 'rent', name: 'Arriendo', sort_order: 1 })
      expect(upsert.args[1]).toEqual({ onConflict: 'business_id,slug', ignoreDuplicates: true })
      expect(res.categories).toHaveLength(8)
    })

    it('no vuelve a insertar si el negocio ya tiene categorías', async () => {
      const { calls } = setup('admin', { expense_categories: [{ data: [cat('rent', 'Alquiler')], error: null }] })
      const res = await getExpensesOverview('2026-09')
      if ('error' in res) throw new Error('no debería fallar')
      expect(res.categories.map(c => c.name)).toEqual(['Alquiler'])
      expect(calls.flatMap(c => c.ops).some(o => o.op === 'upsert')).toBe(false)
    })

    it('las categorías se piden solo del negocio del perfil, ordenadas', async () => {
      const { calls } = setup('admin')
      await getExpensesOverview('2026-09')
      const call = calls.find(c => c.table === 'expense_categories')!
      expect(call.ops.find(o => o.op === 'eq')!.args).toEqual(['business_id', 'biz1'])
      expect(call.ops.filter(o => o.op === 'order').map(o => o.args[0])).toEqual(['sort_order', 'name'])
    })

    it('si la tabla no existe todavía usa las por defecto en memoria', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {})
      setup('admin', { expense_categories: [{ data: null, error: { message: 'relation does not exist' } }] })
      const res = await getExpensesOverview('2026-09')
      if ('error' in res) throw new Error('no debería fallar')
      expect(res.categories.map(c => c.slug)).toEqual(DEFAULT_EXPENSE_CATEGORIES.map(c => c.slug))
    })

    describe('validación de la categoría al crear/editar gastos', () => {
      it('acepta una categoría propia del negocio', async () => {
        setup('admin', {
          expense_categories: [{ data: [cat('c_cafe', 'Café')], error: null }],
          expenses: [{ data: { id: 'e1' }, error: null }],
        })
        expect((await createExpense({ ...validInput, category: 'c_cafe' })).success).toBe(true)
      })

      it('rechaza una categoría que no es del negocio (aunque sea una por defecto borrada)', async () => {
        const { calls } = setup('admin', { expense_categories: [{ data: [cat('c_cafe', 'Café')], error: null }] })
        expect(await createExpense({ ...validInput, category: 'rent' })).toEqual({ error: 'Elige una categoría válida.' })
        expect(calls.some(c => c.table === 'expenses')).toBe(false)
      })

      it('rechaza una categoría oculta al crear', async () => {
        const { calls } = setup('admin', { expense_categories: [{ data: [cat('rent', 'Arriendo', { is_hidden: true })], error: null }] })
        const res = await createExpense(validInput)
        expect(res.error).toBe('Esa categoría está oculta. Elige otra.')
        expect(calls.some(c => c.table === 'expenses')).toBe(false)
      })

      const existing = { id: 'e1', business_id: 'biz1', category: 'rent', amount: 1500000, payment_method: 'transfer', expense_date: today, shift_id: null }

      it('al editar, una categoría oculta vale si el gasto ya la tenía', async () => {
        setup('admin', {
          expense_categories: [{ data: [cat('rent', 'Arriendo', { is_hidden: true }), cat('other', 'Otros')], error: null }],
          expenses: [{ data: existing, error: null }, { data: { id: 'e1' }, error: null }],
        })
        expect((await updateExpense('e1', validInput)).success).toBe(true)
      })

      it('al editar, cambiar a otra categoría oculta se rechaza', async () => {
        setup('admin', {
          expense_categories: [{ data: [cat('rent', 'Arriendo'), cat('c_old', 'Vieja', { is_hidden: true })], error: null }],
          expenses: [{ data: existing, error: null }],
        })
        expect((await updateExpense('e1', { ...validInput, category: 'c_old' })).error).toBe('Esa categoría está oculta. Elige otra.')
      })

      it('al editar, una categoría desconocida se rechaza sin actualizar', async () => {
        const { calls } = setup('admin', { expenses: [{ data: existing, error: null }] })
        expect((await updateExpense('e1', { ...validInput, category: 'xyz' })).error).toBe('Elige una categoría válida.')
        expect(calls.flatMap(c => c.ops).some(o => o.op === 'update')).toBe(false)
      })

      it('registerRecurring acepta la categoría oculta de una plantilla, no una ajena', async () => {
        setup('admin', { expense_categories: [{ data: [cat('rent', 'Arriendo', { is_hidden: true })], error: null }] })
        const ok = await registerRecurring([{ category: 'rent', description: 'Arriendo', amount: 1000000, expense_date: today }])
        expect(ok).toEqual({ success: true, count: 1 })

        setup('admin', { expense_categories: [{ data: [cat('rent', 'Arriendo')], error: null }] })
        const bad = await registerRecurring([{ category: 'nada', description: 'Arriendo', amount: 1000000, expense_date: today }])
        expect(bad.error).toBe('Elige una categoría válida.')
      })
    })

    describe('createExpenseCategory', () => {
      it.each([['muy corto', 'a'], ['vacío', '   '], ['muy largo', 'x'.repeat(41)]])('rechaza un nombre %s', async (_n, name) => {
        const { calls } = setup('admin')
        expect((await createExpenseCategory(name)).error).toBe('El nombre debe tener entre 2 y 40 caracteres.')
        expect(calls.some(c => c.table === 'expense_categories')).toBe(false)
      })

      it('rechaza un color fuera de la paleta', async () => {
        setup('admin')
        expect((await createExpenseCategory('Café', '#ff0000')).error).toBe('Elige un color válido.')
      })

      it('rechaza un nombre repetido sin importar mayúsculas ni espacios', async () => {
        const { calls } = setup('admin')
        expect((await createExpenseCategory('  ARRIENDO ')).error).toBe('Ya existe una categoría con ese nombre.')
        expect(calls.flatMap(c => c.ops).some(o => o.op === 'insert')).toBe(false)
      })

      it('inserta con negocio del perfil, slug único, color y siguiente orden', async () => {
        const created = cat('c_cafe', 'Café')
        const { calls } = setup('admin', {
          expense_categories: [
            { data: [...DEFAULT_CATS, cat('c_otra', 'Otra', { sort_order: 9 })], error: null },
            { data: created, error: null },
          ],
        })
        const res = await createExpenseCategory('  Café  ', 'red')
        expect(res).toEqual({ success: true, category: created })
        expect(opOf(calls, 'expense_categories', 'insert').args[0]).toEqual({
          business_id: 'biz1', slug: 'c_cafe', name: 'Café', color: 'red', sort_order: 10,
        })
        expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/expenses', 'page')
      })

      it('si el slug ya existe agrega _2', async () => {
        const { calls } = setup('admin', {
          expense_categories: [
            { data: [...DEFAULT_CATS, cat('c_cafe', 'Café y bebidas', { sort_order: 9 })], error: null },
            { data: cat('c_cafe_2', 'Café'), error: null },
          ],
        })
        await createExpenseCategory('Café')
        expect(opOf(calls, 'expense_categories', 'insert').args[0].slug).toBe('c_cafe_2')
      })

      it('sin color elige uno de la paleta', async () => {
        const { calls } = setup('admin', { expense_categories: [{ data: DEFAULT_CATS, error: null }, { data: cat('c_x1', 'X1'), error: null }] })
        await createExpenseCategory('X1')
        expect(typeof opOf(calls, 'expense_categories', 'insert').args[0].color).toBe('string')
      })

      it('un conflicto único de la BD se traduce a mensaje claro', async () => {
        setup('admin', { expense_categories: [{ data: DEFAULT_CATS, error: null }, { data: null, error: { code: '23505', message: 'dup' } }] })
        expect((await createExpenseCategory('Café')).error).toBe('Ya existe una categoría con ese nombre.')
      })
    })

    describe('updateExpenseCategory', () => {
      const rows = [cat('rent', 'Arriendo'), cat('other', 'Otros', { is_hidden: true })]

      it('categoría inexistente', async () => {
        setup('admin', { expense_categories: [{ data: rows, error: null }] })
        expect(await updateExpenseCategory('nope', { name: 'Nuevo' })).toEqual({ error: 'Categoría no encontrada.' })
      })

      it('renombra filtrando por id y negocio', async () => {
        const updated = cat('rent', 'Alquiler')
        const { calls } = setup('admin', { expense_categories: [{ data: rows, error: null }, { data: updated, error: null }] })
        const res = await updateExpenseCategory('id_rent', { name: '  Alquiler ' })
        expect(res).toEqual({ success: true, category: updated })
        const updateCall = calls.filter(c => c.table === 'expense_categories')[1]
        expect(updateCall.ops.find(o => o.op === 'update')!.args[0]).toEqual({ name: 'Alquiler' })
        expect(updateCall.ops.filter(o => o.op === 'eq').map(o => o.args)).toEqual([['id', 'id_rent'], ['business_id', 'biz1']])
      })

      it('rechaza un nombre que ya usa otra categoría, pero permite conservar el propio', async () => {
        setup('admin', { expense_categories: [{ data: rows, error: null }] })
        expect((await updateExpenseCategory('id_rent', { name: 'otros' })).error).toBe('Ya existe una categoría con ese nombre.')

        setup('admin', { expense_categories: [{ data: rows, error: null }, { data: rows[0], error: null }] })
        expect((await updateExpenseCategory('id_rent', { name: 'ARRIENDO' })).success).toBe(true)
      })

      it('valida nombre y color', async () => {
        setup('admin', { expense_categories: [{ data: rows, error: null }] })
        expect((await updateExpenseCategory('id_rent', { name: 'x' })).error).toBe('El nombre debe tener entre 2 y 40 caracteres.')
        setup('admin', { expense_categories: [{ data: rows, error: null }] })
        expect((await updateExpenseCategory('id_rent', { color: 'fucsia' })).error).toBe('Elige un color válido.')
      })

      it('no se puede ocultar la última categoría visible', async () => {
        const { calls } = setup('admin', { expense_categories: [{ data: rows, error: null }] })
        expect(await updateExpenseCategory('id_rent', { is_hidden: true })).toEqual({ error: 'Debe quedar al menos una categoría visible.' })
        expect(calls.flatMap(c => c.ops).some(o => o.op === 'update')).toBe(false)
      })

      it('se puede ocultar si queda otra visible, y volver a mostrar', async () => {
        const two = [cat('rent', 'Arriendo'), cat('other', 'Otros')]
        setup('admin', { expense_categories: [{ data: two, error: null }, { data: { ...two[0], is_hidden: true }, error: null }] })
        expect((await updateExpenseCategory('id_rent', { is_hidden: true })).success).toBe(true)

        setup('admin', { expense_categories: [{ data: rows, error: null }, { data: { ...rows[1], is_hidden: false }, error: null }] })
        expect((await updateExpenseCategory('id_other', { is_hidden: false })).success).toBe(true)
      })

      it('un parche vacío no toca la BD', async () => {
        const { calls } = setup('admin', { expense_categories: [{ data: rows, error: null }] })
        expect((await updateExpenseCategory('id_rent', {})).success).toBe(true)
        expect(calls.flatMap(c => c.ops).some(o => o.op === 'update')).toBe(false)
      })
    })

    describe('deleteExpenseCategory', () => {
      const rows = [cat('rent', 'Arriendo'), cat('c_cafe', 'Café')]

      it('no borra si hay gastos con ese slug', async () => {
        const { calls } = setup('admin', {
          expense_categories: [{ data: rows, error: null }],
          expenses: [{ count: 3, error: null }],
        })
        const res = await deleteExpenseCategory('id_c_cafe')
        expect(res).toEqual({ error: 'Tiene gastos registrados: ocúltala en lugar de borrarla.' })
        expect(calls.flatMap(c => c.ops).some(o => o.op === 'delete')).toBe(false)
        const countCall = calls.find(c => c.table === 'expenses')!
        expect(countCall.ops.filter(o => o.op === 'eq').map(o => o.args)).toEqual([['business_id', 'biz1'], ['category', 'c_cafe']])
      })

      it('también aplica a las categorías por defecto', async () => {
        setup('admin', { expense_categories: [{ data: rows, error: null }], expenses: [{ count: 1, error: null }] })
        expect((await deleteExpenseCategory('id_rent')).error).toBe('Tiene gastos registrados: ocúltala en lugar de borrarla.')
      })

      it('borra una categoría sin gastos filtrando por negocio', async () => {
        const { calls } = setup('admin', {
          expense_categories: [{ data: rows, error: null }, { error: null }],
          expenses: [{ count: 0, error: null }],
        })
        expect(await deleteExpenseCategory('id_c_cafe')).toEqual({ success: true })
        const del = calls.filter(c => c.table === 'expense_categories')[1]
        expect(del.ops.map(o => o.op)).toContain('delete')
        expect(del.ops.filter(o => o.op === 'eq').map(o => o.args)).toEqual([['id', 'id_c_cafe'], ['business_id', 'biz1']])
      })

      it('categoría inexistente', async () => {
        setup('admin', { expense_categories: [{ data: rows, error: null }] })
        expect(await deleteExpenseCategory('nope')).toEqual({ error: 'Categoría no encontrada.' })
      })

      it('no borra la última categoría visible', async () => {
        setup('admin', {
          expense_categories: [{ data: [cat('rent', 'Arriendo'), cat('other', 'Otros', { is_hidden: true })], error: null }],
          expenses: [{ count: 0, error: null }],
        })
        expect(await deleteExpenseCategory('id_rent')).toEqual({ error: 'Debe quedar al menos una categoría visible.' })
      })
    })

    it('getExpenseCategoryUsage cuenta los gastos por categoría del negocio', async () => {
      const { calls } = setup('admin', {
        expenses: [{ data: [{ category: 'rent' }, { category: 'rent' }, { category: 'c_cafe' }], error: null }],
      })
      expect(await getExpenseCategoryUsage()).toEqual({ usage: { rent: 2, c_cafe: 1 } })
      expect(calls.find(c => c.table === 'expenses')!.ops.find(o => o.op === 'eq')!.args).toEqual(['business_id', 'biz1'])
    })
  })

  describe('getUpcomingFixedExpenses', () => {
    const tomorrow = addDaysToDateKey(today, 1)
    // plantilla del mes anterior con el día de mañana → vence mañana
    const template = (date: string, extra: Record<string, unknown> = {}) => ({
      id: 'h1', category: 'rent', description: 'Arriendo local', amount: 1500000,
      expense_date: date, is_recurring: true, ...extra,
    })
    const prevMonthDay = (key: string) => {
      const d = new Date(`${key.slice(0, 7)}-01T00:00:00Z`)
      d.setUTCMonth(d.getUTCMonth() - 1)
      return `${d.toISOString().slice(0, 7)}-${key.slice(8, 10)}`
    }

    it('devuelve los que vencen mañana (y hoy) sin registrar', async () => {
      setup('admin', {
        businesses: [{ data: { features_enabled: { expenses_pgl: true } }, error: null }],
        expenses: [{ data: [template(prevMonthDay(tomorrow)), template(prevMonthDay(today), { category: 'utilities', description: 'Internet', amount: 90000 })], error: null }],
      })
      const res = await getUpcomingFixedExpenses()
      expect(res.map(r => [r.description, r.due_date])).toEqual(expect.arrayContaining([['Arriendo local', tomorrow]]))
      expect(res.every(r => r.due_date === today || r.due_date === tomorrow)).toBe(true)
    })

    it('sin el módulo Gastos habilitado devuelve []', async () => {
      setup('admin', {
        businesses: [{ data: { features_enabled: {} }, error: null }],
        expenses: [{ data: [template(prevMonthDay(tomorrow))], error: null }],
      })
      expect(await getUpcomingFixedExpenses()).toEqual([])
    })

    it('si el gasto de este mes ya está registrado no aparece', async () => {
      setup('admin', {
        businesses: [{ data: { features_enabled: { expenses_pgl: true } }, error: null }],
        expenses: [{ data: [template(prevMonthDay(tomorrow)), template(tomorrow, { id: 'h2' })], error: null }],
      })
      expect(await getUpcomingFixedExpenses()).toEqual([])
    })

    it('un error devuelve [] sin lanzar', async () => {
      setup('admin', {
        businesses: [{ data: { features_enabled: { expenses_pgl: true } }, error: null }],
        expenses: [{ data: null, error: { message: 'boom' } }],
      })
      expect(await getUpcomingFixedExpenses()).toEqual([])
    })
  })
})
