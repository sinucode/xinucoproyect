import { getShiftSummary, getActiveShiftDetails, openShift, closeShift, checkoutAppointment } from '../finance'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAction } from '../audit'
import { earnPoints } from '../loyalty'

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

describe('Finance Server Actions', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockSupabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }),
      },
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      rpc: jest.fn(),
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  describe('getShiftSummary', () => {
    it('calculates total sales and cash correctly', async () => {
      // Mock sales sum
      mockSupabase.eq.mockResolvedValueOnce({ 
        data: [{ total_amount: 100 }, { total_amount: 200 }], error: null 
      })
      // Mock payments sum
      mockSupabase.eq.mockReturnValueOnce({ 
        eq: jest.fn().mockResolvedValueOnce({ data: [{ amount: 50 }], error: null }) 
      })

      // Mock gastos pagados con efectivo de la caja
      mockSupabase.eq.mockReturnValueOnce({
        eq: jest.fn().mockResolvedValueOnce({ data: [{ amount: 20 }, { amount: 5 }], error: null })
      })

      // Mock pagos y anticipos al equipo pagados con efectivo de la caja
      mockSupabase.eq.mockReturnValueOnce({
        eq: jest.fn().mockReturnValueOnce({
          in: jest.fn().mockResolvedValueOnce({ data: [{ amount: 10 }, { amount: 7 }], error: null }),
        }),
      })

      const summary = await getShiftSummary('shift1')
      expect(summary.totalSales).toBe(300)
      expect(summary.totalCashCollected).toBe(50)
      expect(summary.totalCashExpenses).toBe(25)
      expect(summary.totalCashTeamPayments).toBe(17)
      expect(mockSupabase.from).toHaveBeenCalledWith('expenses')
      expect(mockSupabase.from).toHaveBeenCalledWith('staff_ledger')
    })

    it('getActiveShiftDetails resta pagos al equipo del efectivo esperado', async () => {
      // Turno abierto (maybeSingle del getActiveShift)
      mockSupabase.maybeSingle.mockResolvedValueOnce({ data: { id: 'shift1', opening_balance: 100 }, error: null })
      // los dos .eq() de getActiveShift encadenan
      mockSupabase.eq.mockReturnValueOnce(mockSupabase).mockReturnValueOnce(mockSupabase)
      // ventas del turno
      mockSupabase.eq.mockResolvedValueOnce({ data: [{ total_amount: 300 }], error: null })
      // cobros en efectivo = 50
      mockSupabase.eq.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ data: [{ amount: 50 }], error: null }) })
      // gastos de la caja = 20
      mockSupabase.eq.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ data: [{ amount: 20 }], error: null }) })
      // pagos al equipo desde la caja = 17
      mockSupabase.eq.mockReturnValueOnce({
        eq: jest.fn().mockReturnValueOnce({ in: jest.fn().mockResolvedValueOnce({ data: [{ amount: 17 }], error: null }) }),
      })

      const details = await getActiveShiftDetails('b1')
      expect(details?.totalCashTeamPayments).toBe(17)
      // 100 base + 50 cobros − 20 gastos − 17 equipo
      expect(details?.expectedCashBalance).toBe(113)
    })
  })

  describe('openShift', () => {
    it('prevents opening if one already exists', async () => {
      mockSupabase.maybeSingle.mockResolvedValueOnce({ data: { id: 'shift1' }, error: null })
      const result = await openShift('b1', 100000)
      expect(result.error).toContain('Ya existe un turno')
    })

    it('opens shift successfully', async () => {
      mockSupabase.maybeSingle.mockResolvedValueOnce({ data: null, error: null }) // no active shift
      mockSupabase.insert.mockResolvedValueOnce({ error: null })
      
      const result = await openShift('b1', 100000)
      expect(result.success).toBe(true)
      expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
        status: 'open',
        opening_balance: 100000
      }))
    })
  })

  describe('closeShift', () => {
    it('prevents closing if appointments are in progress', async () => {
      mockSupabase.eq.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ count: 1, error: null }) })
      const result = await closeShift('b1', 'shift1', 200000)
      expect(result.error).toBe('integrity_error')
    })

    it('closes shift successfully', async () => {
      mockSupabase.eq.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ count: 0, error: null }) })
      mockSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ error: null }) })

      const result = await closeShift('b1', 'shift1', 200000)
      expect(result.success).toBe(true)
      expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({
        status: 'closed',
        actual_closing_balance: 200000
      }))
    })
  })

  describe('checkoutAppointment', () => {
    it('validates missing payment method', async () => {
      const result = await checkoutAppointment({
        appointmentId: 'apt1', businessId: 'b1', shiftId: 'sh1',
        paymentMethod: '' as any, receivedAmount: 0, tipAmount: 0, discountAmount: 0, items: []
      })
      expect(result.error).toBe('validation_error')
    })

    it('calls the RPC and awards loyalty points if successful', async () => {
      // Mock RPC success
      mockSupabase.rpc.mockResolvedValueOnce({ data: { success: true, sale_id: 'sale1' }, error: null })
      // Mock getting customer id for loyalty
      mockSupabase.maybeSingle.mockResolvedValueOnce({ data: { customer_id: 'c1' }, error: null })

      const result = await checkoutAppointment({
        appointmentId: 'apt1', businessId: 'b1', shiftId: 'sh1',
        paymentMethod: 'cash', receivedAmount: 100, tipAmount: 10, discountAmount: 0,
        items: [{ description: 'Haircut', quantity: 1, unitPrice: 100, itemType: 'service' }]
      })

      expect(result.success).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('checkout_appointment', expect.any(Object))
      expect(earnPoints).toHaveBeenCalledWith('b1', 'c1', 110, 'sale1') // 100 (subtotal) + 10 (tip) - 0
    })
  })
})
