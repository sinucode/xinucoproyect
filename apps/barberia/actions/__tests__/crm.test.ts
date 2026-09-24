import { searchCustomers, addCustomerNote, updateCustomerTags } from '../crm'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

describe('CRM Server Actions', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  describe('searchCustomers', () => {
    it('returns empty array when no customers found', async () => {
      mockSupabase.limit.mockResolvedValueOnce({ data: [], error: null })
      const result = await searchCustomers('b1', 'John')
      expect(result).toEqual([])
    })

    it('returns customers with aggregated visit data', async () => {
      const mockCustomers = [{ id: 'c1', full_name: 'John Doe', phone: '123' }]
      const mockVisits = [{ customer_id: 'c1', created_at: '2023-01-01T10:00:00Z', status: 'completed' }]
      const mockTags = [{ customer_id: 'c1', tag: 'VIP' }]

      mockSupabase.limit.mockResolvedValueOnce({ data: mockCustomers, error: null })
      mockSupabase.in.mockReturnValueOnce({
        eq: jest.fn().mockReturnValueOnce({
          order: jest.fn().mockResolvedValueOnce({ data: mockVisits, error: null })
        })
      })
      mockSupabase.in.mockResolvedValueOnce({ data: mockTags, error: null })

      const result = await searchCustomers('b1', 'John')
      
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(expect.objectContaining({
        id: 'c1',
        full_name: 'John Doe',
        total_visits: 1,
        last_visit: '2023-01-01T10:00:00Z',
        tags: ['VIP']
      }))
    })
  })

  describe('addCustomerNote', () => {
    it('validates empty content', async () => {
      const result = await addCustomerNote('b1', 'c1', 's1', '   ')
      expect(result.error).toContain('no puede estar vacío')
    })

    it('adds note successfully', async () => {
      mockSupabase.single.mockResolvedValueOnce({ 
        data: { id: 'n1', content: 'Great client', staff: { full_name: 'Barber Bob' } }, 
        error: null 
      })

      const result = await addCustomerNote('b1', 'c1', 's1', 'Great client')
      expect(result.success).toBe(true)
      expect(result.note?.staff_name).toBe('Barber Bob')
      expect(revalidatePath).toHaveBeenCalled()
    })
  })

  describe('updateCustomerTags', () => {
    it('updates tags by deleting and re-inserting', async () => {
      // Mock delete
      mockSupabase.eq.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ error: null }) })
      // Mock insert
      mockSupabase.insert.mockResolvedValueOnce({ error: null })

      const result = await updateCustomerTags('b1', 'c1', ['VIP', 'Late'])
      
      expect(result.success).toBe(true)
      expect(mockSupabase.delete).toHaveBeenCalled()
      expect(mockSupabase.insert).toHaveBeenCalledWith([
        { business_id: 'b1', customer_id: 'c1', tag: 'VIP' },
        { business_id: 'b1', customer_id: 'c1', tag: 'Late' }
      ])
      expect(revalidatePath).toHaveBeenCalled()
    })
  })
})
