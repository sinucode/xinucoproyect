import {
  createInventoryItem,
  updateInventoryItem,
  deactivateInventoryItem,
  recordPurchase,
  recordCount,
  recordWaste,
  getMovementHistory,
  getLowStockItems,
} from '../inventory'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  weightedAverageCost,
  movementKind,
  signedQty,
  wasteNote,
} from '@/lib/inventory-utils'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

jest.mock('@/actions/audit', () => ({
  logAction: jest.fn().mockResolvedValue(undefined),
}))

type Result = { data?: any; error?: any }

/**
 * Fake de Supabase: cada `from(tabla)` consume el siguiente resultado encolado para esa
 * tabla (o uno vacío). El builder es encadenable y "thenable".
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
    rpc: jest.fn().mockResolvedValue({ data: { new_stock: 12, delta: 2, unit_cost: 13000 }, error: null }),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: role === null ? null : { id: 'u1', email: 'a@b.co' } } }) },
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

const NOT_ADMIN = 'Solo un administrador puede gestionar el inventario.'

const validItem = {
  name: 'Pomada matte',
  sku: 'POM-1',
  category: 'hair' as const,
  description: null,
  current_stock: 0,
  min_stock: 3,
  unit_price: 25000,
  unit_cost: null,
}

const validPurchase = { itemId: 'i1', quantity: 5, unitCost: 12000, supplier: 'Distri', paymentMethod: 'transfer' as const }

describe('Inventory Server Actions', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('permisos', () => {
    it.each(['barber', 'manicurist', 'cashier'])('rechaza el rol %s', async (role) => {
      const { supabase } = setup(role)
      expect(await createInventoryItem(validItem)).toEqual({ error: NOT_ADMIN })
      expect(await updateInventoryItem('i1', { name: 'Otro' })).toEqual({ error: NOT_ADMIN })
      expect(await deactivateInventoryItem('i1')).toEqual({ error: NOT_ADMIN })
      expect(await recordPurchase(validPurchase)).toEqual({ error: NOT_ADMIN })
      expect(await recordCount({ itemId: 'i1', counted: 3, reason: 'Conteo' })).toEqual({ error: NOT_ADMIN })
      expect(await recordWaste({ itemId: 'i1', quantity: 1, reason: 'Vencido' })).toEqual({ error: NOT_ADMIN })
      expect(await getMovementHistory('i1')).toEqual({ data: null, error: NOT_ADMIN })
      expect(await getLowStockItems()).toEqual({ data: null, error: NOT_ADMIN })
      expect(supabase.rpc).not.toHaveBeenCalled()
    })

    it('rechaza sin sesión', async () => {
      setup(null)
      expect(await recordPurchase(validPurchase)).toEqual({ error: NOT_ADMIN })
    })
  })

  describe('createInventoryItem', () => {
    it('sin stock inicial: inserta con stock 0, sin costo, y no llama al RPC', async () => {
      const { supabase, calls } = setup('admin', { inventory_items: [{ data: { id: 'new1' }, error: null }] })
      const res = await createInventoryItem(validItem)
      expect(res).toEqual({ success: true, id: 'new1' })
      const insert = opOf(calls, 'inventory_items', 'insert')!.args[0]
      expect(insert).toMatchObject({ business_id: 'biz1', current_stock: 0, unit_cost: null, name: 'Pomada matte' })
      expect(supabase.rpc).not.toHaveBeenCalled()
      expect(revalidatePath).toHaveBeenCalled()
    })

    it('con stock inicial: registra una compra "Stock inicial" vía RPC (el stock no se inserta directo)', async () => {
      const { supabase, calls } = setup('admin', { inventory_items: [{ data: { id: 'new1' }, error: null }] })
      const res = await createInventoryItem({ ...validItem, current_stock: 8, unit_cost: 11000 })
      expect(res).toEqual({ success: true, id: 'new1' })
      expect(opOf(calls, 'inventory_items', 'insert')!.args[0].current_stock).toBe(0)
      expect(supabase.rpc).toHaveBeenCalledWith('record_stock_movement', {
        p_item_id: 'new1',
        p_kind: 'purchase',
        p_quantity: 8,
        p_unit_cost: 11000,
        p_supplier: null,
        p_payment_method: 'other',
        p_notes: 'Stock inicial',
      })
    })

    it('stock inicial sin costo usa costo 0', async () => {
      const { supabase } = setup('admin', { inventory_items: [{ data: { id: 'new1' }, error: null }] })
      await createInventoryItem({ ...validItem, current_stock: 2 })
      expect((supabase.rpc.mock.calls[0][1] as any).p_unit_cost).toBe(0)
    })

    it('sin stock inicial pero con costo: lo guarda con un update', async () => {
      const { supabase, calls } = setup('admin', { inventory_items: [{ data: { id: 'new1' }, error: null }, { data: null, error: null }] })
      await createInventoryItem({ ...validItem, unit_cost: 9000 })
      expect(supabase.rpc).not.toHaveBeenCalled()
      expect(opOf(calls, 'inventory_items', 'update')!.args[0]).toEqual({ unit_cost: 9000 })
    })

    it('si falla el RPC del stock inicial avisa, con el id del producto creado', async () => {
      const { supabase } = setup('admin', { inventory_items: [{ data: { id: 'new1' }, error: null }] })
      supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'invalid_cost' } })
      const res = await createInventoryItem({ ...validItem, current_stock: 2, unit_cost: 5 })
      expect(res.id).toBe('new1')
      expect(res.error).toContain('no se pudo registrar el stock inicial')
    })

    it.each([
      ['nombre corto', { name: 'a' }],
      ['nombre largo', { name: 'x'.repeat(81) }],
      ['sku largo', { sku: 'x'.repeat(41) }],
      ['descripción larga', { description: 'x'.repeat(301) }],
      ['categoría inválida', { category: 'zzz' as any }],
      ['mínimo negativo', { min_stock: -1 }],
      ['mínimo decimal', { min_stock: 1.5 }],
      ['precio negativo', { unit_price: -5 }],
      ['precio decimal', { unit_price: 10.5 }],
      ['costo negativo', { unit_cost: -1 }],
      ['stock inicial negativo', { current_stock: -1 }],
      ['stock inicial decimal', { current_stock: 1.2 }],
    ])('valida: %s', async (_label, patch) => {
      const { supabase } = setup('admin')
      const res = await createInventoryItem({ ...validItem, ...patch })
      expect(res.error).toBeTruthy()
      expect(supabase.from).toHaveBeenCalledTimes(1) // solo el perfil: nada se inserta
    })
  })

  describe('updateInventoryItem', () => {
    it('no permite editar el stock directamente', async () => {
      const { calls } = setup('admin', { inventory_items: [{ data: null, error: null }] })
      await updateInventoryItem('i1', { name: 'Nuevo nombre', current_stock: 999 } as any)
      const payload = opOf(calls, 'inventory_items', 'update')!.args[0]
      expect(payload).toEqual({ name: 'Nuevo nombre' })
      expect(payload).not.toHaveProperty('current_stock')
    })

    it('filtra por el negocio del perfil', async () => {
      const { calls } = setup('admin', { inventory_items: [{ data: null, error: null }] })
      await updateInventoryItem('i1', { min_stock: 4 })
      const eqs = calls.filter(c => c.table === 'inventory_items').flatMap(c => c.ops).filter(o => o.op === 'eq')
      expect(eqs.map(o => o.args)).toEqual([['id', 'i1'], ['business_id', 'biz1']])
    })

    it('valida los campos enviados', async () => {
      setup('admin')
      expect((await updateInventoryItem('i1', { name: ' ' })).error).toBeTruthy()
      expect((await updateInventoryItem('i1', { unit_cost: -3 })).error).toBeTruthy()
    })
  })

  describe('recordPurchase', () => {
    it('llama al RPC con la compra y devuelve stock y costo nuevos', async () => {
      const { supabase } = setup('admin')
      const res = await recordPurchase({ ...validPurchase, supplier: '  Distri  ' })
      expect(supabase.rpc).toHaveBeenCalledWith('record_stock_movement', {
        p_item_id: 'i1',
        p_kind: 'purchase',
        p_quantity: 5,
        p_unit_cost: 12000,
        p_supplier: 'Distri',
        p_payment_method: 'transfer',
        p_notes: null,
      })
      expect(res).toEqual({ success: true, newStock: 12, delta: 2, unitCost: 13000 })
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/expenses', 'page')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard', 'layout')
    })

    it.each([
      ['cantidad 0', { quantity: 0 }],
      ['cantidad decimal', { quantity: 1.5 }],
      ['cantidad enorme', { quantity: 100001 }],
      ['costo negativo', { unitCost: -1 }],
      ['costo decimal', { unitCost: 10.5 }],
      ['costo enorme', { unitCost: 10_000_001 }],
      ['medio de pago inválido', { paymentMethod: 'card' as any }],
      ['proveedor largo', { supplier: 'x'.repeat(81) }],
    ])('valida: %s', async (_label, patch) => {
      const { supabase } = setup('admin')
      const res = await recordPurchase({ ...validPurchase, ...patch })
      expect(res.error).toBeTruthy()
      expect(supabase.rpc).not.toHaveBeenCalled()
    })

    it.each([
      ['shift_not_open', 'No hay caja abierta. Abre la caja o elige otro medio de pago.'],
      ['invalid_cost', 'El costo unitario no es válido.'],
      ['item_inactive', 'El producto está desactivado.'],
      ['forbidden', 'Solo un administrador puede gestionar el inventario.'],
    ])('mapea el error %s a español', async (code, text) => {
      const { supabase } = setup('admin')
      supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: code } })
      expect(await recordPurchase(validPurchase)).toEqual({ error: text })
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it('error desconocido → mensaje genérico (no filtra el error crudo)', async () => {
      const { supabase } = setup('admin')
      supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom pg detail' } })
      const res = await recordPurchase(validPurchase)
      expect(res.error).not.toContain('boom')
    })
  })

  describe('recordCount', () => {
    it('envía la cantidad contada y el motivo', async () => {
      const { supabase } = setup('admin')
      const res = await recordCount({ itemId: 'i1', counted: 10, reason: '  Conteo mensual ' })
      expect(supabase.rpc).toHaveBeenCalledWith('record_stock_movement', expect.objectContaining({
        p_kind: 'count', p_quantity: 10, p_notes: 'Conteo mensual', p_payment_method: null,
      }))
      expect(res.success).toBe(true)
    })

    it('permite contar 0', async () => {
      const { supabase } = setup('admin')
      expect((await recordCount({ itemId: 'i1', counted: 0, reason: 'Se acabó' })).success).toBe(true)
      expect(supabase.rpc).toHaveBeenCalled()
    })

    it.each([
      ['motivo vacío', { reason: '   ' }],
      ['motivo largo', { reason: 'x'.repeat(201) }],
      ['contado negativo', { counted: -1 }],
      ['contado decimal', { counted: 2.5 }],
    ])('valida: %s', async (_label, patch) => {
      const { supabase } = setup('admin')
      const res = await recordCount({ itemId: 'i1', counted: 3, reason: 'ok', ...patch })
      expect(res.error).toBeTruthy()
      expect(supabase.rpc).not.toHaveBeenCalled()
    })

    it('no_change → mensaje de que no hay nada que ajustar', async () => {
      const { supabase } = setup('admin')
      supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'no_change' } })
      expect(await recordCount({ itemId: 'i1', counted: 3, reason: 'ok' })).toEqual({
        error: 'El conteo es igual al stock actual; no hay nada que ajustar.',
      })
    })
  })

  describe('recordWaste', () => {
    it('envía cantidad y motivo', async () => {
      const { supabase } = setup('admin')
      await recordWaste({ itemId: 'i1', quantity: 2, reason: 'Vencido: lote viejo' })
      expect(supabase.rpc).toHaveBeenCalledWith('record_stock_movement', expect.objectContaining({
        p_kind: 'waste', p_quantity: 2, p_notes: 'Vencido: lote viejo',
      }))
    })

    it.each([
      ['cantidad 0', { quantity: 0 }],
      ['cantidad decimal', { quantity: 1.2 }],
      ['sin motivo', { reason: '' }],
    ])('valida: %s', async (_label, patch) => {
      const { supabase } = setup('admin')
      const res = await recordWaste({ itemId: 'i1', quantity: 1, reason: 'Dañado', ...patch })
      expect(res.error).toBeTruthy()
      expect(supabase.rpc).not.toHaveBeenCalled()
    })

    it('insufficient_stock → mensaje en español', async () => {
      const { supabase } = setup('admin')
      supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'insufficient_stock' } })
      expect((await recordWaste({ itemId: 'i1', quantity: 99, reason: 'Dañado' })).error).toBe(
        'No hay suficiente stock para esa cantidad.',
      )
    })
  })

  describe('getMovementHistory', () => {
    const mv = (id: string, extra: Record<string, unknown> = {}) => ({
      id, business_id: 'biz1', item_id: 'i1', quantity: 1, movement_type: 'purchase',
      reference_id: null, notes: null, created_by: 'u1', created_at: '2026-09-30T15:00:00Z', ...extra,
    })

    it('trae 50 por página, con quién lo hizo y el detalle de la venta', async () => {
      const { calls } = setup('admin', {
        inventory_movements: [{ data: [mv('m1'), mv('m2', { movement_type: 'sale', quantity: -1, reference_id: 's1' })], error: null }],
        profiles: [
          { data: { role: 'admin', business_id: 'biz1' }, error: null },
          { data: [{ id: 'u1', full_name: 'Ana Admin' }], error: null },
        ],
        sales: [{ data: [{ id: 's1', total_amount: 45000, customers: { full_name: 'Carlos' } }], error: null }],
      })
      const res = await getMovementHistory('i1', 1)
      expect(res.error).toBeNull()
      expect(res.data!.hasMore).toBe(false)
      expect(res.data!.rows[0].created_by_name).toBe('Ana Admin')
      expect(res.data!.rows[1].sale).toEqual({ total_amount: 45000, customer_name: 'Carlos' })
      expect(opOf(calls, 'inventory_movements', 'range')!.args).toEqual([50, 100])
      expect(opOf(calls, 'inventory_movements', 'eq', 0)!.args).toEqual(['business_id', 'biz1'])
    })

    it('hasMore cuando hay más de 50', async () => {
      const many = Array.from({ length: 51 }, (_, i) => mv(`m${i}`, { created_by: null }))
      setup('admin', { inventory_movements: [{ data: many, error: null }] })
      const res = await getMovementHistory('i1')
      expect(res.data!.rows).toHaveLength(50)
      expect(res.data!.hasMore).toBe(true)
    })
  })

  describe('getLowStockItems', () => {
    it('devuelve solo los items con stock <= mínimo', async () => {
      setup('admin', {
        inventory_items: [{
          data: [
            { id: 'a', current_stock: 0, min_stock: 2 },
            { id: 'b', current_stock: 2, min_stock: 2 },
            { id: 'c', current_stock: 9, min_stock: 2 },
          ],
          error: null,
        }],
      })
      const res = await getLowStockItems()
      expect(res.data!.map(i => i.id)).toEqual(['a', 'b'])
    })
  })
})

describe('lib/inventory-utils', () => {
  it('weightedAverageCost replica el cálculo del RPC', () => {
    // 10 uds a 12.000 + 10 uds a 14.000 → 13.000
    expect(weightedAverageCost(10, 12000, 10, 14000)).toBe(13000)
    expect(weightedAverageCost(0, null, 5, 8000)).toBe(8000)
    expect(weightedAverageCost(3, null, 3, 10000)).toBe(5000)
  })

  it('movementKind distingue venta de devolución por anulación', () => {
    expect(movementKind({ movement_type: 'sale', quantity: -2 })).toBe('sale')
    expect(movementKind({ movement_type: 'sale', quantity: 2 })).toBe('void_return')
    expect(movementKind({ movement_type: 'adjustment', quantity: -1 })).toBe('count')
    expect(movementKind({ movement_type: 'purchase', quantity: 4 })).toBe('purchase')
    expect(movementKind({ movement_type: 'waste', quantity: -1 })).toBe('waste')
  })

  it('signedQty y wasteNote', () => {
    expect(signedQty(3)).toBe('+3')
    expect(signedQty(-2)).toBe('−2')
    expect(wasteNote('Vencido', ' lote 3 ')).toBe('Vencido: lote 3')
    expect(wasteNote('Dañado', '')).toBe('Dañado')
  })
})
