import { createTenant, toggleTenantStatus } from '../admin'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

describe('Admin Server Actions', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockSupabase = {
      auth: {
        getUser: jest.fn(),
      },
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  describe('createTenant', () => {
    it('returns error if not authenticated or not super_admin', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { app_metadata: { role: 'tenant_admin' } } },
      })
      const formData = new FormData()
      const result = await createTenant(formData)
      expect(result).toEqual({ success: false, error: 'Acceso denegado. Se requieren privilegios de super_admin.' })
    })

    it('returns error on invalid slug or name', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { app_metadata: { role: 'super_admin' } } },
      })
      const formData = new FormData()
      formData.append('name', 'a')
      formData.append('slug', 'invalid slug')

      const result = await createTenant(formData)
      expect(result.success).toBe(false)
      expect(result.error).toContain('El nombre debe tener al menos 2 caracteres.')
    })

    it('creates tenant successfully if super_admin', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { app_metadata: { role: 'super_admin' } } },
      })
      const formData = new FormData()
      formData.append('name', 'My Barber')
      formData.append('slug', 'my-barber')

      mockSupabase.insert.mockResolvedValueOnce({ error: null })

      const result = await createTenant(formData)

      expect(result).toEqual({ success: true })
      expect(mockSupabase.from).toHaveBeenCalledWith('businesses')
      expect(revalidatePath).toHaveBeenCalledWith('/adminbarberia')
    })
  })

  describe('toggleTenantStatus', () => {
    it('returns error if not super_admin', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
      })
      const result = await toggleTenantStatus('123', true)
      expect(result.success).toBe(false)
    })

    it('toggles tenant successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { app_metadata: { role: 'super_admin' } } },
      })
      mockSupabase.eq.mockResolvedValueOnce({ error: null })

      const result = await toggleTenantStatus('123', true)
      expect(result.success).toBe(true)
      expect(mockSupabase.from).toHaveBeenCalledWith('businesses')
      expect(mockSupabase.update).toHaveBeenCalledWith({ is_active: false })
      expect(mockSupabase.eq).toHaveBeenCalledWith('id', '123')
    })
  })
})
