import { getAllBusinesses, applyPlan } from '../super-admin'
import { createClient, createAdminClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

describe('Super Admin Server Actions', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockSupabase = {
      auth: {
        getUser: jest.fn(),
      },
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
    ;(createAdminClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  describe('getAllBusinesses', () => {
    it('returns error if not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
      const result = await getAllBusinesses()
      expect(result).toEqual({ data: null, error: 'No autenticado.' })
    })

    it('returns error if not super_admin', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { app_metadata: { role: 'tenant_admin' } } },
      })
      const result = await getAllBusinesses()
      expect(result).toEqual({ data: null, error: 'Acceso denegado. Se requiere rol super_admin.' })
    })

    it('returns data if super_admin', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { app_metadata: { role: 'super_admin' } } },
      })
      const businesses = [{ id: '1', name: 'Barber' }]
      
      // select -> order
      mockSupabase.order.mockResolvedValueOnce({ data: businesses, error: null })

      const result = await getAllBusinesses()
      
      expect(result).toEqual({ data: businesses, error: null })
      expect(mockSupabase.from).toHaveBeenCalledWith('businesses')
    })
  })
})
