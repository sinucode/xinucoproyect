import { createWorkstation, toggleWorkstationStatus } from '../workstations'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

describe('Workstations Server Actions', () => {
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

  describe('createWorkstation', () => {
    it('handles duplicate workstation error', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key value' }
      })

      const result = await createWorkstation('biz1', { name: 'Silla 1' })
      expect(result.error).toContain('Ya existe una estación con ese nombre')
    })

    it('creates workstation successfully', async () => {
      const mockResult = { id: 'ws1', name: 'Silla 1' }
      mockSupabase.single.mockResolvedValueOnce({ data: mockResult, error: null })
      
      const result = await createWorkstation('biz1', { name: ' Silla 1 ' })
      
      expect(result.success).toBe(true)
      expect(result.data).toEqual(mockResult)
      expect(mockSupabase.insert).toHaveBeenCalledWith({
        business_id: 'biz1',
        name: 'Silla 1', // trimmed
        is_active: true
      })
      expect(revalidatePath).toHaveBeenCalled()
    })
  })

  describe('toggleWorkstationStatus', () => {
    it('toggles workstation status correctly', async () => {
      mockSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ error: null }) })

      const result = await toggleWorkstationStatus('ws1', false)
      
      expect(result.success).toBe(true)
      expect(mockSupabase.update).toHaveBeenCalledWith({ is_active: false })
      expect(revalidatePath).toHaveBeenCalled()
    })
  })
})
