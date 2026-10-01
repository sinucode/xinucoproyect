import {
  getPosCatalog,
  createPosSale,
  getShiftSales,
  voidSale,
  quickCreateCustomer,
} from '../retail'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

type Result = { data?: any; error?: any }
type RpcResults = Record<string, Result>

const ITEM = '11111111-1111-4111-8111-111111111111'
const ITEM2 = '22222222-2222-4222-8222-222222222222'
const CUSTOMER = '33333333-3333-4333-8333-333333333333'
const SELLER = '44444444-4444-4444-8444-444444444444'
const SALE = '55555555-5555-4555-8555-555555555555'

/**
 * Fake de Supabase: cada `from(tabla)` consume el siguiente resultado encolado
 * para esa tabla (o el default). El builder es encadenable y "thenable".
 */
function makeSupabase(role: string | null, queues: Record<string, Result[]> = {}, rpcResults: RpcResults = {}) {
  const calls: { table: string; ops: { op: string; args: any[] }[] }[] = []

  const from = jest.fn((table: string) => {
    const call = { table, ops: [] as { op: string; args: any[] }[] }
    calls.push(call)
    // El perfil se consulta en cada acción: no se consume de la cola.
    const result: Result = table === 'profiles' && queues.profiles?.length
      ? queues.profiles[0]
      : queues[table]?.length ? queues[table].shift()! : { data: [], error: null }

    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result).then(res, rej)
        if (prop === 'maybeSingle' || prop === 'single') {
          return () => { call.ops.push({ op: prop, args: [] }); return Promise.resolve(result) }
        }
        return (...args: any[]) => { call.ops.push({ op: prop, args }); return chain }
      },
    })
    return chain
  })

  const rpc = jest.fn((fn: string, _args?: any) =>
    Promise.resolve(rpcResults[fn] ?? { data: null, error: null }))

  if (role !== null && !queues.profiles) {
    queues.profiles = [{ data: { role, business_id: 'biz1' }, error: null }]
  }
  const supabase = {
    from,
    rpc,
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: role === null ? null : { id: 'u1' } } }) },
  }
  return { supabase, calls, rpc }
}

function setup(role: string | null, queues: Record<string, Result[]> = {}, rpcResults: RpcResults = {}) {
  const m = makeSupabase(role, queues, rpcResults)
  ;(createClient as jest.Mock).mockResolvedValue(m.supabase)
  return m
}

// Función: la cola se consume, no debe compartirse entre tests
const openShift = () => ({ cash_register_shifts: [{ data: { id: 'shift1' }, error: null }] })
const NOT_ADMIN = 'Solo un administrador puede usar el punto de venta.'

const baseSale = {
  paymentMethod: 'cash' as const,
  discount: 0,
  items: [{ itemId: ITEM, quantity: 2 }],
}

const okSaleRpc = {
  create_pos_sale: {
    data: { sale_id: SALE, subtotal: 40000, discount: 0, loyalty_discount: 0, loyalty_units: 0, total: 40000 },
    error: null,
  },
}

describe('retail (Punto de Venta)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    ;(console.error as jest.Mock).mockRestore?.()
  })

  describe('autorización', () => {
    it.each(['barber', 'receptionist', 'customer'])('rechaza el rol %s', async (role) => {
      const { rpc } = setup(role)
      expect(await getPosCatalog()).toEqual({ error: NOT_ADMIN })
      expect(await createPosSale(baseSale)).toEqual({ error: NOT_ADMIN })
      expect(await getShiftSales()).toEqual({ sales: [], error: NOT_ADMIN })
      expect(await voidSale(SALE, 'Error de digitación')).toEqual({ error: NOT_ADMIN })
      expect(await quickCreateCustomer({ full_name: 'Ana', phone: '3001234567' })).toEqual({ error: NOT_ADMIN })
      expect(rpc).not.toHaveBeenCalled()
    })

    it('rechaza sin sesión', async () => {
      setup(null)
      expect(await createPosSale(baseSale)).toEqual({ error: NOT_ADMIN })
    })

    it('rechaza un perfil sin business_id', async () => {
      const { rpc } = setup('admin', { profiles: [{ data: { role: 'admin', business_id: null }, error: null }] })
      expect(await createPosSale(baseSale)).toEqual({ error: NOT_ADMIN })
      expect(rpc).not.toHaveBeenCalled()
    })
  })

  describe('getPosCatalog', () => {
    it('calcula lo disponible restando lo apartado y trae equipo, caja y lealtad', async () => {
      const { calls } = setup('admin', {
        inventory_items: [{ data: [
          { id: ITEM, name: 'Cera', category: 'hair', unit_price: 20000, current_stock: 5 },
          { id: ITEM2, name: 'Aceite', category: null, unit_price: null, current_stock: 2 },
        ], error: null }],
        staff: [{ data: [{ id: SELLER, full_name: 'Ana' }], error: null }],
        businesses: [{ data: {
          features_enabled: { loyalty: true }, loyalty_mode: 'points',
          loyalty_point_value_cop: 50, loyalty_min_redeem_points: 10,
        }, error: null }],
        ...openShift(),
      }, {
        get_inventory_reservations: { data: [
          { item_id: ITEM, appointment_id: 'a1', quantity: 2, start_time: 'x', customer_name: null, customer_phone: null },
          { item_id: ITEM, appointment_id: 'a2', quantity: 1, start_time: 'x', customer_name: null, customer_phone: null },
        ], error: null },
      })

      const r = await getPosCatalog()
      if ('error' in r) throw new Error(r.error)
      expect(r.products).toEqual([
        { id: ITEM, name: 'Cera', category: 'hair', unit_price: 20000, current_stock: 5, reserved: 3, available: 2 },
        { id: ITEM2, name: 'Aceite', category: 'general', unit_price: 0, current_stock: 2, reserved: 0, available: 2 },
      ])
      expect(r.staff).toEqual([{ id: SELLER, full_name: 'Ana' }])
      expect(r.shiftId).toBe('shift1')
      expect(r.loyalty).toEqual({ enabled: true, mode: 'points', point_value_cop: 50, min_redeem: 10 })
      // todo se filtra por el negocio del perfil
      const invEq = calls.find(c => c.table === 'inventory_items')!.ops.filter(o => o.op === 'eq').map(o => o.args)
      expect(invEq).toContainEqual(['business_id', 'biz1'])
      expect(invEq).toContainEqual(['is_active', true])
    })

    it('sin caja abierta devuelve shiftId null', async () => {
      setup('admin', { cash_register_shifts: [{ data: null, error: null }] })
      const r = await getPosCatalog()
      if ('error' in r) throw new Error(r.error)
      expect(r.shiftId).toBeNull()
    })
  })

  describe('createPosSale', () => {
    it('sin caja abierta no llama al RPC', async () => {
      const { rpc } = setup('admin', { cash_register_shifts: [{ data: null, error: null }] })
      expect(await createPosSale(baseSale)).toEqual({ error: 'Abre la caja para vender.' })
      expect(rpc).not.toHaveBeenCalled()
    })

    it('usa el negocio del perfil y la caja abierta resuelta en el servidor', async () => {
      const { rpc } = setup('admin', { ...openShift() }, okSaleRpc)
      const r = await createPosSale({
        ...baseSale,
        customerId: CUSTOMER,
        sellerStaffId: SELLER,
        discount: 1000,
        loyaltyUnits: 20,
        receivedAmount: 50000,
        // el cliente no puede mandar negocio ni caja: se ignoran
        ...({ businessId: 'otro', shiftId: 'otra' } as object),
      })
      expect(rpc).toHaveBeenCalledWith('create_pos_sale', {
        p_business_id:     'biz1',
        p_shift_id:        'shift1',
        p_customer_id:     CUSTOMER,
        p_seller_staff_id: SELLER,
        p_payment_method:  'cash',
        p_discount:        1000,
        p_items:           [{ item_id: ITEM, quantity: 2 }],
        p_loyalty_units:   20,
      })
      expect(r).toMatchObject({ success: true, saleId: SALE, total: 40000, change: 10000 })
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/retail', 'page')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard', 'layout')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/inventory', 'page')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/commissions', 'page')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/loyalty', 'page')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/expenses', 'page')
    })

    it('sin cliente ni vendedor manda null y el cambio solo aplica a efectivo', async () => {
      const { rpc } = setup('admin', { ...openShift() }, okSaleRpc)
      const r = await createPosSale({ ...baseSale, paymentMethod: 'card', receivedAmount: 90000 })
      expect(rpc.mock.calls[0][1]).toMatchObject({ p_customer_id: null, p_seller_staff_id: null, p_payment_method: 'card' })
      expect(r.change).toBe(0)
    })

    it('envía p_account_id con el medio elegido', async () => {
      const ACCOUNT = '33333333-3333-4333-8333-333333333333'
      const { rpc } = setup('admin', { ...openShift() }, okSaleRpc)
      await createPosSale({ ...baseSale, paymentMethod: 'transfer', accountId: ACCOUNT })
      expect(rpc.mock.calls[0][1]).toMatchObject({ p_payment_method: 'transfer', p_account_id: ACCOUNT })
    })

    it('sin medio no manda p_account_id y un medio mal formado se rechaza', async () => {
      const { rpc } = setup('admin', { ...openShift() }, okSaleRpc)
      await createPosSale(baseSale)
      expect('p_account_id' in rpc.mock.calls[0][1]).toBe(false)
      rpc.mockClear()
      expect(await createPosSale({ ...baseSale, accountId: 'no-uuid' })).toEqual({ error: 'Elige un medio de pago activo.' })
      expect(rpc).not.toHaveBeenCalled()
    })

    const invalid: [string, Record<string, unknown>][] = [
      ['método de pago inválido', { paymentMethod: 'mercadopago' }],
      ['carrito vacío', { items: [] }],
      ['más de 50 productos', { items: Array.from({ length: 51 }, () => ({ itemId: ITEM, quantity: 1 })) }],
      ['cantidad 0', { items: [{ itemId: ITEM, quantity: 0 }] }],
      ['cantidad decimal', { items: [{ itemId: ITEM, quantity: 1.5 }] }],
      ['cantidad > 999', { items: [{ itemId: ITEM, quantity: 1000 }] }],
      ['producto sin uuid', { items: [{ itemId: 'x', quantity: 1 }] }],
      ['descuento negativo', { discount: -1 }],
      ['descuento decimal', { discount: 10.5 }],
      ['puntos negativos', { loyaltyUnits: -3 }],
      ['cliente inválido', { customerId: 'nope' }],
    ]
    it.each(invalid)('valida la entrada: %s', async (_label, patch) => {
      const { rpc } = setup('admin', { ...openShift() })
      const r = await createPosSale({ ...baseSale, ...patch } as any)
      expect(r.error).toEqual(expect.any(String))
      expect(r.success).toBeUndefined()
      expect(rpc).not.toHaveBeenCalled()
    })

    const errors: [string, string][] = [
      ['insufficient_stock:Cera Mate', 'No hay suficiente "Cera Mate" disponible (hay unidades apartadas para reservas).'],
      ['item_without_price:Aceite', '"Aceite" no tiene precio de venta. Defínelo en Inventario.'],
      ['shift_not_open', 'No hay una caja abierta. Ábrela desde el inicio para vender.'],
      ['customer_not_found', 'El cliente no existe en este negocio.'],
      ['staff_not_found', 'El profesional que vendió no está disponible.'],
      ['empty_cart', 'Agrega al menos un producto a la venta.'],
      ['too_many_items', 'Una venta admite hasta 50 productos distintos.'],
      ['invalid_quantity', 'La cantidad de cada producto debe ser entre 1 y 999.'],
      ['item_not_found', 'Un producto ya no está disponible en el inventario.'],
      ['discount_too_high', 'El descuento no puede superar el subtotal.'],
      ['loyalty_requires_customer', 'Para usar puntos elige primero al cliente.'],
      ['loyalty_not_available', 'La lealtad por puntos no está activa en este negocio.'],
      ['loyalty_below_minimum', 'El cliente no alcanza el mínimo de puntos para canjear.'],
      ['invalid_payment_method', 'Elige cómo paga el cliente.'],
      ['forbidden', 'Solo un administrador puede hacer esto.'],
      ['algo raro de postgres', 'No se pudo registrar la venta. Intenta de nuevo.'],
    ]
    it.each(errors)('mapea el error del RPC %s', async (raw, message) => {
      setup('admin', { ...openShift() }, { create_pos_sale: { data: null, error: { message: raw } } })
      expect(await createPosSale(baseSale)).toEqual({ error: message })
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  })

  describe('getShiftSales', () => {
    it('sin caja abierta no hay ventas', async () => {
      setup('admin', { cash_register_shifts: [{ data: null, error: null }] })
      expect(await getShiftSales()).toEqual({ sales: [] })
    })

    it('normaliza ventas de mostrador, de cita y anuladas', async () => {
      const { calls } = setup('admin', {
        ...openShift(),
        sales: [{ data: [
          { id: 's1', created_at: '2026-09-30T15:00:00Z', total_amount: 40000, status: 'paid', void_reason: null,
            appointment_id: null, customer: { full_name: 'Luis' }, seller: [{ full_name: 'Ana' }],
            sale_items: [{ description: 'Cera', quantity: 2 }], payments: [{ payment_method: 'cash' }] },
          { id: 's2', created_at: '2026-09-30T14:00:00Z', total_amount: 25000, status: 'voided', void_reason: 'Error de precio',
            appointment_id: 'a1', customer: null, seller: null,
            sale_items: [{ description: 'Corte', quantity: 1 }], payments: [] },
        ], error: null }],
      })
      const r = await getShiftSales()
      expect(r.sales).toEqual([
        { id: 's1', createdAt: '2026-09-30T15:00:00Z', customerName: 'Luis', sellerName: 'Ana',
          items: [{ description: 'Cera', quantity: 2 }], paymentMethod: 'cash', total: 40000,
          status: 'paid', voidReason: null, source: 'pos' },
        { id: 's2', createdAt: '2026-09-30T14:00:00Z', customerName: null, sellerName: null,
          items: [{ description: 'Corte', quantity: 1 }], paymentMethod: null, total: 25000,
          status: 'voided', voidReason: 'Error de precio', source: 'appointment' },
      ])
      const eqs = calls.find(c => c.table === 'sales')!.ops.filter(o => o.op === 'eq').map(o => o.args)
      expect(eqs).toContainEqual(['business_id', 'biz1'])
      expect(eqs).toContainEqual(['shift_id', 'shift1'])
    })

    it('un error de consulta devuelve mensaje en español', async () => {
      setup('admin', { ...openShift(), sales: [{ data: null, error: { message: 'boom' } }] })
      expect(await getShiftSales()).toEqual({ sales: [], error: 'No se pudieron cargar las ventas del turno.' })
    })
  })

  describe('voidSale', () => {
    it('anula con el motivo recortado y revalida las páginas de dinero', async () => {
      const { rpc } = setup('admin', {}, { void_sale: { data: { sale_id: SALE }, error: null } })
      expect(await voidSale(SALE, '  Cobro duplicado  ')).toEqual({ success: true })
      expect(rpc).toHaveBeenCalledWith('void_sale', { p_sale_id: SALE, p_reason: 'Cobro duplicado' })
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard', 'layout')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/commissions', 'page')
    })

    it.each([
      ['motivo corto', SALE, 'ab'],
      ['motivo vacío', SALE, '   '],
      ['motivo > 200', SALE, 'x'.repeat(201)],
      ['venta inválida', 'nope', 'Motivo válido'],
    ])('valida la entrada: %s', async (_l, id, reason) => {
      const { rpc } = setup('admin')
      const r = await voidSale(id, reason)
      expect(r.error).toEqual(expect.any(String))
      expect(rpc).not.toHaveBeenCalled()
    })

    it.each([
      ['shift_closed', 'Esa venta es de una caja ya cerrada; no se puede anular.'],
      ['not_paid', 'Esa venta ya estaba anulada o no está pagada.'],
      ['reason_required', 'Escribe el motivo de la anulación (mínimo 3 letras).'],
      ['forbidden', 'Solo un administrador puede anular ventas.'],
      ['not_found', 'No se encontró la venta.'],
      ['otra cosa', 'No se pudo anular la venta. Intenta de nuevo.'],
    ])('mapea el error del RPC %s', async (raw, message) => {
      setup('admin', {}, { void_sale: { data: null, error: { message: raw } } })
      expect(await voidSale(SALE, 'Motivo válido')).toEqual({ error: message })
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  })

  describe('quickCreateCustomer', () => {
    it('valida nombre y celular', async () => {
      const { calls } = setup('admin')
      expect((await quickCreateCustomer({ full_name: 'A', phone: '3001234567' })).error).toMatch(/nombre/i)
      expect((await quickCreateCustomer({ full_name: 'Ana', phone: '12' })).error).toMatch(/tel[eé]fono/i)
      expect(calls.filter(c => c.table === 'customers')).toHaveLength(0)
    })

    it('si el celular ya existe en el negocio devuelve ese cliente sin duplicar', async () => {
      const existing = { id: CUSTOMER, full_name: 'Ana Pérez', phone: '3001234567' }
      const { calls } = setup('admin', { customers: [{ data: existing, error: null }] })
      const r = await quickCreateCustomer({ full_name: 'Ana', phone: '300 123 4567' })
      expect(r).toEqual({ customer: existing, existing: true })
      const customerCalls = calls.filter(c => c.table === 'customers')
      expect(customerCalls).toHaveLength(1)
      expect(customerCalls[0].ops.filter(o => o.op === 'eq').map(o => o.args)).toEqual([
        ['business_id', 'biz1'], ['phone', '3001234567'],
      ])
    })

    it('crea el cliente en el negocio del perfil', async () => {
      const created = { id: CUSTOMER, full_name: 'Ana Pérez', phone: '3001234567' }
      const { calls } = setup('admin', { customers: [{ data: null, error: null }, { data: created, error: null }] })
      const r = await quickCreateCustomer({ full_name: '  Ana   Pérez ', phone: '3001234567' })
      expect(r).toEqual({ customer: created, existing: false })
      const insert = calls.flatMap(c => c.ops).find(o => o.op === 'insert')!
      expect(insert.args[0]).toMatchObject({ business_id: 'biz1', full_name: 'Ana Pérez', phone: '3001234567' })
    })
  })
})
