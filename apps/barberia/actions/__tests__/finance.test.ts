import { getShiftSummary, getActiveShiftDetails, openShift, closeShift, checkoutAppointment } from '../finance'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

jest.mock('@/lib/audit', () => ({
  logAction: jest.fn(),
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
        data: { total_sales: 300, cash_collected: 50, cash_expenses: 25, cash_team_payments: 17, cash_inventory_purchases: 9 },
        error: null,
      })

      const summary = await getShiftSummary('shift1')
      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_shift_cash_summary', { p_shift_id: 'shift1' })
      expect(summary).toEqual({
        totalSales: 300,
        totalCashCollected: 50,
        totalCashExpenses: 25,
        totalCashTeamPayments: 17,
        totalCashInventoryPurchases: 9,
        totalCashAssetPurchases: 0,
        totalCashAssetSales: 0,
        totalCashMovementsIn: 0,
        totalCashMovementsOut: 0,
      })
    })

    it('convierte a número los valores que llegan como texto (numeric de Postgres)', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { total_sales: '300.00', cash_collected: '50', cash_expenses: null, cash_team_payments: 'x' },
        error: null,
      })
      expect(await getShiftSummary('shift1')).toEqual({
        totalSales: 300, totalCashCollected: 50, totalCashExpenses: 0, totalCashTeamPayments: 0, totalCashInventoryPurchases: 0, totalCashAssetPurchases: 0, totalCashAssetSales: 0,
        totalCashMovementsIn: 0,
        totalCashMovementsOut: 0,
      })
    })

    it('si el RPC falla registra el error y devuelve ceros (no rompe el dashboard)', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'function does not exist' } })

      expect(await getShiftSummary('shift1')).toEqual({
        totalSales: 0, totalCashCollected: 0, totalCashExpenses: 0, totalCashTeamPayments: 0, totalCashInventoryPurchases: 0, totalCashAssetPurchases: 0, totalCashAssetSales: 0,
        totalCashMovementsIn: 0,
        totalCashMovementsOut: 0,
      })
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    it('getActiveShiftDetails resta gastos, pagos al equipo y compras de inventario del efectivo esperado', async () => {
      // Turno abierto (maybeSingle del getActiveShift)
      mockSupabase.maybeSingle.mockResolvedValueOnce({ data: { id: 'shift1', opening_balance: 100 }, error: null })
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { total_sales: 300, cash_collected: 50, cash_expenses: 20, cash_team_payments: 17, cash_inventory_purchases: 10 },
        error: null,
      })

      const details = await getActiveShiftDetails('b1')
      expect(details?.totalCashTeamPayments).toBe(17)
      expect(details?.totalCashInventoryPurchases).toBe(10)
      // 100 base + 50 cobros − 20 gastos − 17 equipo − 10 compras de inventario
      expect(details?.expectedCashBalance).toBe(103)
    })

    it('getActiveShiftDetails resta compras de equipos y suma ventas de equipos en efectivo', async () => {
      mockSupabase.maybeSingle.mockResolvedValueOnce({ data: { id: 'shift1', opening_balance: 100 }, error: null })
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { total_sales: 300, cash_collected: 50, cash_expenses: 0, cash_team_payments: 0, cash_inventory_purchases: 0, cash_asset_purchases: 40, cash_asset_sales: 15 },
        error: null,
      })

      const details = await getActiveShiftDetails('b1')
      expect(details?.totalCashAssetPurchases).toBe(40)
      expect(details?.totalCashAssetSales).toBe(15)
      // 100 base + 50 cobros − 40 compra de equipo + 15 venta de equipo
      expect(details?.expectedCashBalance).toBe(125)
    })

    it('getActiveShiftDetails suma los movimientos que entran a la caja y resta los que salen', async () => {
      mockSupabase.maybeSingle.mockResolvedValueOnce({ data: { id: 'shift1', opening_balance: 100 }, error: null })
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { total_sales: 300, cash_collected: 50, cash_expenses: 0, cash_team_payments: 0, cash_inventory_purchases: 0, cash_movements_in: 200, cash_movements_out: 30 },
        error: null,
      })

      const details = await getActiveShiftDetails('b1')
      expect(details?.totalCashMovementsIn).toBe(200)
      expect(details?.totalCashMovementsOut).toBe(30)
      // 100 base + 50 cobros + 200 aportes/traslados − 30 retiros/traslados
      expect(details?.expectedCashBalance).toBe(320)
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

    it('calls the checkout RPC; earning loyalty is the DB trigger, not the app', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: { success: true, sale_id: 'sale1' }, error: null })

      const result = await checkoutAppointment({
        appointmentId: 'apt1', businessId: 'b1', shiftId: 'sh1',
        paymentMethod: 'cash', receivedAmount: 100, tipAmount: 10, discountAmount: 0,
        items: [{ description: 'Haircut', quantity: 1, unitPrice: 100, itemType: 'service' }]
      })

      expect(result.success).toBe(true)
      expect(result.saleId).toBe('sale1')
      expect(result.loyalty).toBeUndefined()
      expect(mockSupabase.rpc).toHaveBeenCalledTimes(1)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('checkout_appointment_secure', expect.objectContaining({
        p_discount_amount: 0,
      }))
      // Sin canje solicitado no se toca la lealtad
      expect(mockSupabase.from).not.toHaveBeenCalledWith('appointments')
    })

    it('translates shift_not_open and appointment_not_found from the secure RPC', async () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const params = {
        appointmentId: 'apt1', businessId: 'b1', shiftId: 'sh1',
        paymentMethod: 'cash' as const, receivedAmount: 100, tipAmount: 0, discountAmount: 0,
        items: [{ description: 'Haircut', quantity: 1, unitPrice: 100, itemType: 'service' as const }]
      }

      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'shift_not_open' } })
      expect(await checkoutAppointment(params)).toEqual({ error: 'shift_not_open', message: 'No hay una caja abierta.' })

      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'appointment_not_found' } })
      expect(await checkoutAppointment(params)).toEqual({ error: 'appointment_not_found', message: 'No se encontró la cita.' })
      errSpy.mockRestore()
    })
  })

  describe('checkoutAppointment — canje de lealtad', () => {
    const pointsLoyalty = {
      enabled: true, mode: 'points', balance: 1240, expiring_30d: 0, point_value_cop: 50, value_cop: 62000,
      min_redeem: 100, stamps_required: 10, stamp_max_reward_cop: 0, can_redeem: true,
    }
    const stampsLoyalty = {
      enabled: true, mode: 'stamps', balance: 10, expiring_30d: 0, point_value_cop: 50, value_cop: null,
      min_redeem: 0, stamps_required: 10, stamp_max_reward_cop: 30000, can_redeem: true,
    }
    const base = {
      appointmentId: 'apt1', businessId: 'b1', shiftId: 'sh1',
      paymentMethod: 'cash' as const, receivedAmount: 100000, tipAmount: 0, discountAmount: 0,
      items: [{ description: 'Corte', quantity: 1, unitPrice: 45000, itemType: 'service' as const }],
    }

    let redeemResult: { data: any; error: any }
    const rpcNames = () => mockSupabase.rpc.mock.calls.map((c: any[]) => c[0])
    const rpcCall = (name: string) => mockSupabase.rpc.mock.calls.find((c: any[]) => c[0] === name)

    function setLoyalty(loyalty: any, customerId: string | null = 'c1') {
      mockSupabase.maybeSingle.mockResolvedValue({ data: customerId ? { customer_id: customerId } : null, error: null })
      mockSupabase.rpc.mockImplementation((fn: string) => {
        if (fn === 'get_customer_loyalty') return Promise.resolve({ data: loyalty, error: null })
        if (fn === 'checkout_appointment_secure') return Promise.resolve({ data: { success: true, sale_id: 'sale1' }, error: null })
        if (fn === 'redeem_loyalty_for_sale') return Promise.resolve(redeemResult)
        return Promise.resolve({ data: null, error: null })
      })
    }

    beforeEach(() => {
      redeemResult = { data: { redeemed: 500, balance: 740 }, error: null }
    })

    it('puntos: el descuento se calcula en el servidor y se registra el canje después del cobro', async () => {
      setLoyalty(pointsLoyalty)
      const result = await checkoutAppointment({ ...base, discountAmount: 1000, loyaltyRedeem: { units: 500 } })

      // 500 puntos × $50 = $25.000 (sumado al descuento manual de $1.000)
      expect(rpcCall('checkout_appointment_secure')[1].p_discount_amount).toBe(26000)
      expect(rpcCall('redeem_loyalty_for_sale')[1]).toEqual({ p_sale_id: 'sale1', p_units: 500, p_discount_cop: 25000 })
      expect(rpcNames().indexOf('redeem_loyalty_for_sale')).toBeGreaterThan(rpcNames().indexOf('checkout_appointment_secure'))
      expect(result.success).toBe(true)
      expect(result.loyalty).toEqual({ redeemed_units: 500, discount_cop: 25000 })
      expect(result.loyaltyWarning).toBeUndefined()
    })

    it('nunca confía en un monto de descuento que mande el cliente', async () => {
      setLoyalty(pointsLoyalty)
      await checkoutAppointment({ ...base, loyaltyRedeem: { units: 100, discountCop: 999999 } as any })
      expect(rpcCall('checkout_appointment_secure')[1].p_discount_amount).toBe(5000)
      expect(rpcCall('redeem_loyalty_for_sale')[1].p_discount_cop).toBe(5000)
    })

    it('puntos: el descuento se limita al total menos el descuento manual', async () => {
      setLoyalty({ ...pointsLoyalty, balance: 5000 })
      const result = await checkoutAppointment({ ...base, discountAmount: 5000, loyaltyRedeem: { units: 3000 } })
      // 3000 × 50 = 150.000, pero solo quedan 40.000 por pagar
      expect(rpcCall('checkout_appointment_secure')[1].p_discount_amount).toBe(45000)
      expect(result.loyalty).toEqual({ redeemed_units: 800, discount_cop: 40000 })   // solo se gastan los puntos que caben
    })

    it.each([
      ['cero', 0],
      ['negativas', -5],
      ['decimales', 150.5],
      ['menos del mínimo', 50],
      ['más que el saldo', 1241],
    ])('puntos: rechaza unidades %s sin cobrar', async (_label, units) => {
      setLoyalty(pointsLoyalty)
      const result = await checkoutAppointment({ ...base, loyaltyRedeem: { units } })
      expect(result.error).toBe('validation_error')
      expect(rpcNames()).not.toContain('checkout_appointment_secure')
      expect(rpcNames()).not.toContain('redeem_loyalty_for_sale')
    })

    it('sellos: servicio gratis con el tope del negocio', async () => {
      setLoyalty(stampsLoyalty)
      const result = await checkoutAppointment({
        ...base,
        items: [
          { description: 'Corte + barba', quantity: 1, unitPrice: 45000, itemType: 'service' },
          { description: 'Cera', quantity: 1, unitPrice: 20000, itemType: 'product' },
        ],
        loyaltyRedeem: { stamps: true },
      })
      // Precio del servicio $45.000 con tope $30.000
      expect(rpcCall('checkout_appointment_secure')[1].p_discount_amount).toBe(30000)
      expect(rpcCall('redeem_loyalty_for_sale')[1]).toEqual({ p_sale_id: 'sale1', p_units: 10, p_discount_cop: 30000 })
      expect(result.loyalty).toEqual({ redeemed_units: 10, discount_cop: 30000 })
    })

    it('sellos: rechaza si el cliente aún no completa los sellos', async () => {
      setLoyalty({ ...stampsLoyalty, balance: 7, can_redeem: false })
      const result = await checkoutAppointment({ ...base, loyaltyRedeem: { stamps: true } })
      expect(result.error).toBe('validation_error')
      expect(rpcNames()).not.toContain('checkout_appointment_secure')
    })

    it('rechaza canjear puntos si el negocio usa sellos (y al revés)', async () => {
      setLoyalty(stampsLoyalty)
      expect((await checkoutAppointment({ ...base, loyaltyRedeem: { units: 100 } })).error).toBe('validation_error')
      setLoyalty(pointsLoyalty)
      expect((await checkoutAppointment({ ...base, loyaltyRedeem: { stamps: true } })).error).toBe('validation_error')
      expect(rpcNames()).not.toContain('checkout_appointment_secure')
    })

    it('rechaza si la lealtad está desactivada o la cita no tiene cliente', async () => {
      setLoyalty({ ...pointsLoyalty, enabled: false })
      expect((await checkoutAppointment({ ...base, loyaltyRedeem: { units: 100 } })).error).toBe('validation_error')

      setLoyalty(pointsLoyalty, null)
      expect((await checkoutAppointment({ ...base, loyaltyRedeem: { units: 100 } })).error).toBe('validation_error')
      expect(rpcNames()).not.toContain('checkout_appointment_secure')
    })

    it('no permite canjear con MercadoPago', async () => {
      setLoyalty(pointsLoyalty)
      const result = await checkoutAppointment({ ...base, paymentMethod: 'mercadopago', loyaltyRedeem: { units: 100 } })
      expect(result.error).toBe('validation_error')
      expect(result.message).toMatch(/efectivo, tarjeta o transferencia/)
      expect(rpcNames()).not.toContain('checkout_appointment_secure')
    })

    it('si el canje falla después del cobro, la venta se queda y se devuelve un aviso', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
      redeemResult = { data: null, error: { message: 'insufficient_balance' } }
      setLoyalty(pointsLoyalty)
      const result = await checkoutAppointment({ ...base, loyaltyRedeem: { units: 100 } })

      expect(result.success).toBe(true)
      expect(result.saleId).toBe('sale1')
      expect(result.loyalty).toBeUndefined()
      expect(result.loyaltyWarning).toMatch(/lealtad/i)
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
  })
})
