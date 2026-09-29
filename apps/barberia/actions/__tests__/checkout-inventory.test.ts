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

jest.mock('../loyalty', () => ({
  earnPoints: jest.fn().mockResolvedValue(true),
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
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()
    stockResult = {
      data: [{ id: 'inv1', name: 'Cera', current_stock: 5, business_id: 'b1', is_active: true }],
      error: null,
    }
    rpc = jest.fn()
    const inBuilder = jest.fn().mockImplementation(() => Promise.resolve(stockResult))
    mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'inventory_items') {
          return { select: jest.fn().mockReturnValue({ in: inBuilder }) }
        }
        // appointments (lealtad)
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

  it('returns validation_error and does not call any RPC when stock is insufficient', async () => {
    stockResult.data = [{ id: 'inv1', name: 'Cera', current_stock: 1, business_id: 'b1', is_active: true }]

    const result = await checkoutAppointment(baseParams)

    expect(result.error).toBe('validation_error')
    expect(result.message).toBe('Stock insuficiente de Cera (quedan 1).')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects inventory items from another business', async () => {
    stockResult.data = [{ id: 'inv1', name: 'Cera', current_stock: 9, business_id: 'other', is_active: true }]

    const result = await checkoutAppointment(baseParams)

    expect(result.error).toBe('validation_error')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('records a negative sale movement after a successful checkout', async () => {
    rpc.mockImplementation((fn: string) =>
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
    rpc.mockImplementation((fn: string) =>
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
