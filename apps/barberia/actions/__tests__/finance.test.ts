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
    it('mapea el resumen del RPC get_shift_cash_summary', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { total_sales: 300, cash_collected: 50, cash_expenses: 25, cash_team_payments: 17 },
        error: null,
      })

      const summary = await getShiftSummary('shift1')
      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_shift_cash_summary', { p_shift_id: 'shift1' })
      expect(summary).toEqual({
        totalSales: 300,
        totalCashCollected: 50,
        totalCashExpenses: 25,
        totalCashTeamPayments: 17,
      })
    })

    it('convierte a número los valores que llegan como texto (numeric de Postgres)', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { total_sales: '300.00', cash_collected: '50', cash_expenses: null, cash_team_payments: 'x' },
        error: null,
      })
      expect(await getShiftSummary('shift1')).toEqual({
        totalSales: 300, totalCashCollected: 50, totalCashExpenses: 0, totalCashTeamPayments: 0,
      })
    })

    it('si el RPC falla registra el error y devuelve ceros (no rompe el dashboard)', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'function does not exist' } })

      expect(await getShiftSummary('shift1')).toEqual({
        totalSales: 0, totalCashCollected: 0, totalCashExpenses: 0, totalCashTeamPayments: 0,
      })
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    it('getActiveShiftDetails resta gastos y pagos al equipo del efectivo esperado', async () => {
      // Turno abierto (maybeSingle del getActiveShift)
      mockSupabase.maybeSingle.mockResolvedValueOnce({ data: { id: 'shift1', opening_balance: 100 }, error: null })
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { total_sales: 300, cash_collected: 50, cash_expenses: 20, cash_team_payments: 17 },
        error: null,
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
