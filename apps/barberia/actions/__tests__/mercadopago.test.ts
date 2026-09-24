import { createMPPreference, calculateFeePreview } from '../mercadopago'
import { createClient } from '@xinuco/supabase/server'
import { Preference } from 'mercadopago'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('mercadopago', () => ({
  Preference: jest.fn().mockImplementation(() => ({
    create: jest.fn().mockResolvedValue({
      id: 'pref_123',
      init_point: 'https://mp.com/pay',
      sandbox_init_point: 'https://sandbox.mp.com/pay'
    })
  })),
  PreApproval: jest.fn()
}))

jest.mock('@/lib/mercadopago/client', () => ({
  getMPClient: jest.fn(),
}))

describe('MercadoPago Server Actions', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.MP_ACCESS_TOKEN = 'TEST-token-123'

    mockSupabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({ 
          data: { user: { id: 'u1', app_metadata: { business_id: 'b1' } } } 
        }),
      },
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  describe('calculateFeePreview', () => {
    it('throws error if amount is invalid', async () => {
      await expect(calculateFeePreview(0, 'credit_card')).rejects.toThrow('entero positivo')
    })
  })

  describe('createMPPreference', () => {
    it('validates auth and business_id matching', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({ 
        data: { user: { id: 'u1', app_metadata: { business_id: 'other_biz' } } } 
      })

      const result = await createMPPreference({
        businessId: 'b1',
        items: [{ title: 'Haircut', quantity: 1, unit_price_cop: 20000 }],
        externalRef: 'ref_1'
      })

      expect((result as any).error).toContain('Acceso denegado')
    })

    it('creates preference successfully', async () => {
      mockSupabase.single.mockResolvedValueOnce({ data: { id: 'db_payment_1' }, error: null })

      const result = await createMPPreference({
        businessId: 'b1',
        items: [{ title: 'Haircut', quantity: 1, unit_price_cop: 20000 }],
        externalRef: 'ref_1'
      })

      const data = (result as any).data
      expect(data).toBeDefined()
      expect(data.preference_id).toBe('pref_123')
      expect(data.is_test_mode).toBe(true)
      expect(mockSupabase.insert).toHaveBeenCalled()
    })
  })
})
