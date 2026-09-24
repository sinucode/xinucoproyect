import { getBusinessBySlug, updateBusinessTheme, toggleBusinessFeature } from '../businesses'
import { createClient, createAdminClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

describe('Businesses Server Actions', () => {
  let mockSupabase: any
  let mockAdminSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockSupabase = {
      auth: {
        getUser: jest.fn(),
      },
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
    }

    mockAdminSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
    ;(createAdminClient as jest.Mock).mockResolvedValue(mockAdminSupabase)
  })

  describe('getBusinessBySlug', () => {
    it('returns business data successfully', async () => {
      const mockBusiness = { id: '1', slug: 'test-barber', name: 'Test' }
      mockSupabase.single.mockResolvedValueOnce({ data: mockBusiness, error: null })

      const result = await getBusinessBySlug('test-barber')
      
      expect(result).toEqual(mockBusiness)
      expect(mockSupabase.from).toHaveBeenCalledWith('businesses')
      expect(mockSupabase.eq).toHaveBeenCalledWith('slug', 'test-barber')
    })
  })

  describe('updateBusinessTheme', () => {
    it('validates HEX colors before updating', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'user1' } } })
      
      const config = {
        primaryColor: 'invalid-color',
        secondaryColor: '#1A1A1A',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        fontFamily: 'Inter',
      }

      const result = await updateBusinessTheme('biz1', config)
      expect(result.error).toContain('Color inválido en "primaryColor"')
    })

    it('updates theme correctly', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'user1' } } })
      mockSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ error: null }) })
      
      const config = {
        primaryColor: '#C5A059',
        secondaryColor: '#1A1A1A',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        fontFamily: 'Inter',
      }

      const result = await updateBusinessTheme('biz1', config)
      
      expect(result.success).toBe(true)
      expect(revalidatePath).toHaveBeenCalledWith('/')
    })
  })

  describe('toggleBusinessFeature', () => {
    it('requires super_admin role', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({ 
        data: { user: { app_metadata: { role: 'tenant_admin' } } } 
      })

      const result = await toggleBusinessFeature('biz1', 'retail_sales', true)
      expect(result.error).toContain('Se requiere rol de super_admin')
    })

    it('toggles feature with adminClient', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({ 
        data: { user: { app_metadata: { role: 'super_admin' } } } 
      })
      
      mockAdminSupabase.single.mockResolvedValueOnce({
        data: { features_enabled: { retail_sales: false } },
        error: null
      })
      
      mockAdminSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ error: null }) })

      const result = await toggleBusinessFeature('biz1', 'retail_sales', true)
      
      expect(result.success).toBe(true)
      expect(mockAdminSupabase.update).toHaveBeenCalledWith({
        features_enabled: { retail_sales: true }
      })
      expect(revalidatePath).toHaveBeenCalledWith('/adminbarberia')
    })
  })
})
