import { createMPPreference, calculateFeePreview, createMPSaaSSubscription, getMPSubscriptionStatus } from '../mercadopago'
import { createClient, createAdminClient } from '@xinuco/supabase/server'
import { Preference } from 'mercadopago'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn(),
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
  let mockAdmin: any
  // Perfil de la sesión (lo lee el chequeo de admin): por defecto, admin del negocio b1
  let profile: { role: string; business_id: string | null } | null

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.MP_ACCESS_TOKEN = 'TEST-token-123'
    profile = { role: 'admin', business_id: 'b1' }

    // Cliente del usuario (RLS): solo lee el perfil / mp_subscriptions
    mockSupabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'u1', app_metadata: { business_id: 'b1' } } }
        }),
      },
      from: jest.fn((table: string) =>
        table === 'profiles'
          ? { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: profile, error: null }) }) }) }
          : mockSupabase,
      ),
      insert: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockResolvedValue({ error: null }),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    }

    // Cliente service role: único que escribe mp_payments / mp_subscriptions
    mockAdmin = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockResolvedValue({ error: null }),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'db_payment_1' }, error: null }),
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
    ;(createAdminClient as jest.Mock).mockResolvedValue(mockAdmin)
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

    it('solo el administrador crea preferencias: el barbero es rechazado antes de llamar a MP', async () => {
      profile = { role: 'barber', business_id: 'b1' }

      const result = await createMPPreference({
        businessId: 'b1',
        items: [{ title: 'Haircut', quantity: 1, unit_price_cop: 20000 }],
        externalRef: 'ref_1'
      })

      expect((result as any).error).toMatch(/administrador/)
      expect(Preference).not.toHaveBeenCalled()
      expect(mockAdmin.insert).not.toHaveBeenCalled()
    })

    it.each(['booking_123', 'saas_b1_pro'])('rechaza la referencia reservada del servidor %s', async (ref) => {
      const result = await createMPPreference({
        businessId: 'b1',
        items: [{ title: 'Haircut', quantity: 1, unit_price_cop: 20000 }],
        externalRef: ref,
      })

      expect((result as any).error).toBe('Referencia de pago inválida.')
      expect(Preference).not.toHaveBeenCalled()
      expect(mockAdmin.insert).not.toHaveBeenCalled()
    })

    it('creates preference successfully', async () => {
      const result = await createMPPreference({
        businessId: 'b1',
        items: [{ title: 'Haircut', quantity: 1, unit_price_cop: 20000 }],
        externalRef: 'ref_1'
      })

      const data = (result as any).data
      expect(data).toBeDefined()
      expect(data.preference_id).toBe('pref_123')
      expect(data.is_test_mode).toBe(true)
      // El registro pendiente se escribe con service role y el business_id validado (no con el cliente del usuario)
      expect(mockAdmin.insert).toHaveBeenCalledWith(expect.objectContaining({ business_id: 'b1', mp_status: 'pending' }))
      expect(mockSupabase.insert).not.toHaveBeenCalled()
    })
  })

  describe('createMPSaaSSubscription', () => {
    it('el barbero no puede contratar un plan', async () => {
      profile = { role: 'barber', business_id: 'b1' }
      const result = await createMPSaaSSubscription({ businessId: 'b1', planId: 'profesional', payerEmail: 'a@b.co', slug: 'x' })
      expect((result as any).error).toMatch(/administrador/)
      expect(mockAdmin.upsert).not.toHaveBeenCalled()
    })

    it('rechaza un businessId distinto al del JWT', async () => {
      const result = await createMPSaaSSubscription({ businessId: 'otro', planId: 'profesional', payerEmail: 'a@b.co', slug: 'x' })
      expect((result as any).error).toContain('Acceso denegado')
    })
  })

  describe('getMPSubscriptionStatus', () => {
    it('sin sesión o con un negocio distinto al del JWT devuelve null sin consultar', async () => {
      expect(await getMPSubscriptionStatus('otro')).toBeNull()
      mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
      expect(await getMPSubscriptionStatus('b1')).toBeNull()
      expect(mockSupabase.maybeSingle).not.toHaveBeenCalled()
    })

    it('devuelve la suscripción del propio negocio', async () => {
      mockSupabase.maybeSingle.mockResolvedValueOnce({ data: { plan_id: 'elite', status: 'active' }, error: null })
      expect(await getMPSubscriptionStatus('b1')).toEqual({ plan_id: 'elite', status: 'active' })
    })
  })
})
