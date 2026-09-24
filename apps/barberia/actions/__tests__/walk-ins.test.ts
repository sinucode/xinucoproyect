import { addWalkIn, updateWalkInStatus, assignStaff } from '../walk-ins'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

describe('Walk-ins Server Actions', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockReturnThis(),
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  describe('addWalkIn', () => {
    it('calculates the next position and inserts walk-in', async () => {
      // Mock the max position calculation
      mockSupabase.maybeSingle.mockResolvedValueOnce({ data: { position: 3 }, error: null })
      
      mockSupabase.insert.mockResolvedValueOnce({ error: null })

      const result = await addWalkIn('biz1', {
        customer_name: 'Jane Doe',
      })

      expect(result.success).toBe(true)
      expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
        business_id: 'biz1',
        customer_name: 'Jane Doe',
        position: 4, // 3 + 1
        status: 'waiting'
      }))
      expect(revalidatePath).toHaveBeenCalled()
    })
  })

  describe('updateWalkInStatus', () => {
    it('sets served_at automatically when status is completed', async () => {
      mockSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ error: null }) })

      const result = await updateWalkInStatus('wi1', 'completed')
      
      expect(result.success).toBe(true)
      expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({
        status: 'completed',
        served_at: expect.any(String) // should be set automatically
      }))
    })

    it('updates status without served_at for other statuses', async () => {
      mockSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ error: null }) })

      const result = await updateWalkInStatus('wi1', 'in_progress')
      
      expect(result.success).toBe(true)
      expect(mockSupabase.update).toHaveBeenCalledWith({
        status: 'in_progress'
      }) // served_at should NOT be present
    })
  })

  describe('assignStaff', () => {
    it('assigns staff correctly', async () => {
      mockSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ error: null }) })

      const result = await assignStaff('wi1', 'staff1')
      
      expect(result.success).toBe(true)
      expect(mockSupabase.update).toHaveBeenCalledWith({ staff_id: 'staff1' })
    })
  })
})
