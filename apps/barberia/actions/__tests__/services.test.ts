import { createService, toggleServiceStatus } from '../services'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

describe('Services Server Actions', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  describe('createService', () => {
    it('handles duplicate service error', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key value' }
      })

      const result = await createService('biz1', { name: 'Haircut', duration_minutes: 30, price_cop: 20000 })
      expect(result.error).toContain('Ya existe un servicio con ese nombre')
    })

    it('creates service successfully', async () => {
      const mockResult = { id: 'svc1', name: 'Haircut' }
      mockSupabase.single.mockResolvedValueOnce({ data: mockResult, error: null })
      
      const result = await createService('biz1', { name: 'Haircut', duration_minutes: 30, price_cop: 20000 })
      
      expect(result.success).toBe(true)
      expect(result.data).toEqual(mockResult)
      expect(mockSupabase.insert).toHaveBeenCalledWith({
        business_id: 'biz1',
        name: 'Haircut',
        description: null,
        duration_minutes: 30,
        price_cop: 20000,
        is_active: true
      })
      expect(revalidatePath).toHaveBeenCalled()
    })
  })

  describe('toggleServiceStatus', () => {
    it('toggles service status correctly', async () => {
      mockSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ error: null }) })

      const result = await toggleServiceStatus('svc1', false)
      
      expect(result.success).toBe(true)
      expect(mockSupabase.update).toHaveBeenCalledWith({ is_active: false })
      expect(revalidatePath).toHaveBeenCalled()
    })
  })
})
