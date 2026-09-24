import { updateAppointmentStatus } from '../appointments'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAction } from '../audit'
import { sendCancellationNotice } from '@/lib/email/notifications'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

jest.mock('../audit', () => ({
  logAction: jest.fn(),
}))

jest.mock('@/lib/email/notifications', () => ({
  sendCancellationNotice: jest.fn().mockResolvedValue(true),
}))

describe('Appointments Server Actions', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockSupabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }),
      },
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
  })

  describe('updateAppointmentStatus', () => {
    it('requires authentication', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
      
      const result = await updateAppointmentStatus('apt1', 'completed')
      expect(result.error).toBe('No autenticado.')
    })

    it('updates status and logs action', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { status: 'scheduled', business_id: 'b1', staff_id: 's1' },
        error: null
      })
      mockSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ error: null }) })
      
      const result = await updateAppointmentStatus('apt1', 'completed')
      
      expect(result.success).toBe(true)
      expect(mockSupabase.update).toHaveBeenCalledWith({ status: 'completed' })
      expect(logAction).toHaveBeenCalledWith(expect.objectContaining({
        action: 'appointment.status_changed',
        newValue: { status: 'completed' }
      }))
      expect(revalidatePath).toHaveBeenCalled()
    })

    it('sends cancellation notice when cancelled', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { status: 'scheduled', business_id: 'b1', staff_id: 's1' },
        error: null
      })
      mockSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ error: null }) })
      
      const result = await updateAppointmentStatus('apt1', 'cancelled')
      
      expect(result.success).toBe(true)
      expect(sendCancellationNotice).toHaveBeenCalledWith({
        supabase: mockSupabase,
        businessId: 'b1',
        appointmentId: 'apt1'
      })
    })
  })
})
