import { createStaffMember, toggleStaffStatus } from '../staff'
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

describe('Staff Server Actions', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockSupabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  describe('createStaffMember', () => {
    it('handles unique constraint error gracefully', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key value' }
      })

      const result = await createStaffMember('biz1', { full_name: 'John', specialty_role: 'Barber' })
      expect(result.error).toContain('Ya existe un miembro del equipo')
    })

    it('creates staff and logs action successfully', async () => {
      const mockResult = { id: 'staff1', full_name: 'John' }
      mockSupabase.single.mockResolvedValueOnce({ data: mockResult, error: null })
      
      const result = await createStaffMember('biz1', { full_name: 'John', specialty_role: 'Barber' })
      
      expect(result.success).toBe(true)
      expect(result.data).toEqual(mockResult)
      expect(mockSupabase.insert).toHaveBeenCalledWith({
        business_id: 'biz1',
        full_name: 'John',
        specialty_role: 'Barber',
        is_active: true
      })
      expect(revalidatePath).toHaveBeenCalled()
    })
  })

  describe('toggleStaffStatus', () => {
    it('toggles staff status correctly', async () => {
      mockSupabase.single.mockResolvedValueOnce({ 
        data: { business_id: 'biz1', full_name: 'John', is_active: true } 
      })
      mockSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ error: null }) })

      const result = await toggleStaffStatus('staff1', false)
      
      expect(result.success).toBe(true)
      expect(mockSupabase.update).toHaveBeenCalledWith({ is_active: false })
      expect(revalidatePath).toHaveBeenCalled()
    })
  })
})
