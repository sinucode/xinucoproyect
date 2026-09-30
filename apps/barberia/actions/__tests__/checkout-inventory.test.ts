import { checkoutAppointment } from '../finance'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

jest.mock('../audit', () => ({
  logAction: jest.fn(),
}))

const baseParams = {
  appointmentId: 'apt1',
  businessId: 'b1',
  shiftId: 'sh1',
  paymentMethod: 'cash' as const,
  receivedAmount: 100000,
  tipAmount: 0,
  discountAmount: 0,
  items: [
    { description: 'Corte', quantity: 1, unitPrice: 30000, itemType: 'service' as const },
    { description: 'Cera', quantity: 2, unitPrice: 20000, itemType: 'product' as const, inventoryItemId: 'inv1' },
  ],
}

describe('checkoutAppointment — inventario', () => {
  let rpc: jest.Mock
  let stockResult: { data: any; error: any }
  let reservations: any[]
  let mockSupabase: any

  // rpc mock: get_inventory_reservations siempre responde; el resto lo decide `impl`
  // llamadas RPC que NO son la lectura de apartados (cobro / movimientos de inventario)
  const writeRpcCalls = () => rpc.mock.calls.filter((c) => c[0] !== 'get_inventory_reservations')

  const setRpc = (impl: (fn: string) => Promise<any>) =>
    rpc.mockImplementation((fn: string) =>
      fn === 'get_inventory_reservations'
        ? Promise.resolve({ data: reservations, error: null })
        : impl(fn)
    )

  beforeEach(() => {
    jest.clearAllMocks()
    stockResult = {
      data: [{ id: 'inv1', name: 'Cera', current_stock: 5, business_id: 'b1', is_active: true }],
      error: null,
    }
    reservations = []
    rpc = jest.fn()
    setRpc(() => Promise.resolve({ data: null, error: null }))
    const inBuilder = jest.fn().mockImplementation(() => Promise.resolve(stockResult))
    mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'inventory_items') {
          return { select: jest.fn().mockReturnValue({ in: inBuilder }) }
        }
        // appointments
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }
      }),
      rpc,
    }
    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  it('returns validation_error and does not call the checkout RPC when stock is insufficient', async () => {
    stockResult.data = [{ id: 'inv1', name: 'Cera', current_stock: 1, business_id: 'b1', is_active: true }]

    const result = await checkoutAppointment(baseParams)

    expect(result.error).toBe('validation_error')
    expect(result.message).toBe('Stock insuficiente de Cera (quedan 1).')
    expect(writeRpcCalls()).toEqual([])
  })

  it('blocks checkout when other appointments have reserved the stock', async () => {
    // 5 en inventario, 4 apartadas por OTRA cita → solo 1 libre, el ticket pide 2
    reservations = [
      { item_id: 'inv1', appointment_id: 'other1', quantity: 4, start_time: '2026-09-30T10:30:00Z',
        customer_name: 'Ana Pérez', customer_phone: '3001112233' },
    ]

    const result = await checkoutAppointment(baseParams)

    expect(result.error).toBe('validation_error')
    expect(result.message).toContain('Stock insuficiente de Cera: 5 en inventario, 4 apartada(s) para otras citas (Ana Pérez')
    expect(writeRpcCalls()).toEqual([])
  })

  it('does not count the appointment\'s own reservation against the stock', async () => {
    // 5 en inventario; 2 apartadas por ESTA cita (apt1) + 3 por otra → libres para apt1 = 2
    reservations = [
      { item_id: 'inv1', appointment_id: 'apt1', quantity: 2, start_time: '2026-09-30T10:30:00Z',
        customer_name: 'Cliente', customer_phone: null },
      { item_id: 'inv1', appointment_id: 'other1', quantity: 3, start_time: '2026-09-30T11:30:00Z',
        customer_name: 'Ana Pérez', customer_phone: '3001112233' },
    ]
    setRpc((fn: string) =>
      fn === 'checkout_appointment'
        ? Promise.resolve({ data: { success: true, sale_id: 'sale1' }, error: null })
        : Promise.resolve({ data: { item_id: 'inv1', new_stock: 3 }, error: null })
    )

    const result = await checkoutAppointment(baseParams)

    expect(result.success).toBe(true)
    expect(rpc).toHaveBeenCalledWith('checkout_appointment', expect.anything())
  })

  it('rejects inventory items from another business', async () => {
    stockResult.data = [{ id: 'inv1', name: 'Cera', current_stock: 9, business_id: 'other', is_active: true }]

    const result = await checkoutAppointment(baseParams)

    expect(result.error).toBe('validation_error')
    expect(writeRpcCalls()).toEqual([])
  })

  it('records a negative sale movement after a successful checkout', async () => {
    setRpc((fn: string) =>
      fn === 'checkout_appointment'
        ? Promise.resolve({ data: { success: true, sale_id: 'sale1' }, error: null })
        : Promise.resolve({ data: { item_id: 'inv1', new_stock: 3 }, error: null })
    )

    const result = await checkoutAppointment(baseParams)

    expect(result.success).toBe(true)
    // el RPC de cobro no recibe inventoryItemId
    const checkoutCall = rpc.mock.calls.find((c) => c[0] === 'checkout_appointment')!
    expect(JSON.stringify(checkoutCall[1].p_items)).not.toContain('inv1')
    expect(rpc).toHaveBeenCalledWith('record_inventory_movement', {
      p_business_id: 'b1',
      p_item_id: 'inv1',
      p_quantity: -2,
      p_type: 'sale',
      p_notes: 'Venta en cobro de cita',
      p_reference_id: 'sale1',
      p_user_id: 'u1',
    })
    expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/inventory', 'page')
  })

  it('still succeeds when the inventory movement fails', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    setRpc((fn: string) =>
      fn === 'checkout_appointment'
        ? Promise.resolve({ data: { success: true, sale_id: 'sale1' }, error: null })
        : Promise.resolve({ data: null, error: { message: 'boom' } })
    )

    const result = await checkoutAppointment(baseParams)

    expect(result.success).toBe(true)
    expect(result.saleId).toBe('sale1')
    expect(errSpy).toHaveBeenCalledWith('[checkout] inventory movement failed', expect.anything())
    errSpy.mockRestore()
  })
})
