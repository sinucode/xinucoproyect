import { createBooking } from '../bookings'
import { createClient } from '@xinuco/supabase/server'
import { sendBookingConfirmation } from '@/lib/email/notifications'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('@/lib/email/notifications', () => ({
  sendBookingConfirmation: jest.fn().mockResolvedValue(true),
}))

jest.mock('@/lib/mercadopago/client', () => ({
  getMPClient: jest.fn(),
}))

describe('Bookings Server Actions', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  describe('createBooking', () => {
    it('validates phone presence', async () => {
      const result = await createBooking({
        full_name: 'John Doe',
        phone: '',
        service_id: 's1',
        staff_id: 'st1',
        start_time: '2023-10-10T10:00:00Z',
        business_id: 'b1'
      })
      expect(result.error).toBe('validation_error')
      expect(result.message).toContain('teléfono es requerido')
    })

    it('validates start_time format', async () => {
      const result = await createBooking({
        full_name: 'John Doe',
        phone: '1234567890',
        service_id: 's1',
        staff_id: 'st1',
        start_time: 'invalid-date',
        business_id: 'b1'
      })
      expect(result.error).toBe('validation_error')
      expect(result.message).toContain('fecha/hora de inicio no es válida')
    })

    it('creates booking successfully', async () => {
      // Mock Customer upsert
      mockSupabase.single.mockResolvedValueOnce({ data: { id: 'cust1' }, error: null })
      // Mock Appointment insert
      mockSupabase.single.mockResolvedValueOnce({ data: { id: 'apt1' }, error: null })

      const result = await createBooking({
        full_name: 'John Doe',
        phone: '1234567890',
        service_id: 's1',
        staff_id: 'st1',
        start_time: '2023-10-10T10:00:00Z',
        business_id: 'b1'
      })

      expect(result.success).toBe(true)
      expect(result.appointment_id).toBe('apt1')
      expect(sendBookingConfirmation).toHaveBeenCalledWith({
        supabase: mockSupabase,
        businessId: 'b1',
        appointmentId: 'apt1',
        customerId: 'cust1'
      })
    })

    it('handles any staff_id correctly', async () => {
      // Mock Customer upsert
      mockSupabase.single.mockResolvedValueOnce({ data: { id: 'cust1' }, error: null })
      // Mock Appointment insert
      mockSupabase.single.mockResolvedValueOnce({ data: { id: 'apt1' }, error: null })

      const result = await createBooking({
        full_name: 'John Doe',
        phone: '1234567890',
        service_id: 's1',
        staff_id: 'any',
        start_time: '2023-10-10T10:00:00Z',
        business_id: 'b1'
      })

      expect(result.success).toBe(true)
      // Assert that staff_id was mapped to null when 'any'
      expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
        staff_id: null
      }))
    })
  })
})
