import { updateAppointmentStatus } from '../appointments'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { sendCancellationNotice } from '@/lib/email/notifications'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
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
      mockSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce({ data: [{ id: 'apt1' }], error: null }) }) })
      
      const result = await updateAppointmentStatus('apt1', 'in_progress')
      
      expect(result.success).toBe(true)
      expect(mockSupabase.update).toHaveBeenCalledWith({ status: 'in_progress', updated_at: expect.any(String) })
      expect(revalidatePath).toHaveBeenCalled()
    })

    it('sends cancellation notice when cancelled', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { status: 'scheduled', business_id: 'b1', staff_id: 's1' },
        error: null
      })
      mockSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce({ data: [{ id: 'apt1' }], error: null }) }) })
      
      const result = await updateAppointmentStatus('apt1', 'cancelled')
      
      expect(result.success).toBe(true)
      expect(mockSupabase.update).toHaveBeenCalledWith({
        status: 'cancelled',
        updated_at: expect.any(String),
        cancelled_by: 'business',
      })
      expect(sendCancellationNotice).toHaveBeenCalledWith({
        supabase: mockSupabase,
        businessId: 'b1',
        appointmentId: 'apt1'
      })
    })
  })

  describe('updateAppointmentStatus — reglas', () => {
    let mockSupabase: any
    beforeEach(() => {
      mockSupabase = {
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockReturnThis(),
      }
      ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
    })

    it('no deja completar a mano (se completa al cobrar)', async () => {
      mockSupabase.single.mockResolvedValueOnce({ data: { status: 'ready_to_pay', business_id: 'b1', staff_id: 's1' }, error: null })
      const result = await updateAppointmentStatus('apt1', 'completed')
      expect(result).toEqual({ error: 'La cita se completa al cobrarla.' })
      expect(mockSupabase.update).not.toHaveBeenCalled()
    })

    it('rechaza transiciones inválidas', async () => {
      mockSupabase.single.mockResolvedValueOnce({ data: { status: 'completed', business_id: 'b1', staff_id: 's1' }, error: null })
      const result = await updateAppointmentStatus('apt1', 'in_progress')
      expect(result.error).toMatch(/no está permitido/)
    })

    it('avisa cuando la RLS no deja cambiar la cita de otro profesional', async () => {
      mockSupabase.single.mockResolvedValueOnce({ data: { status: 'scheduled', business_id: 'b1', staff_id: 's2' }, error: null })
      mockSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce({ data: [], error: null }) }) })
      const result = await updateAppointmentStatus('apt1', 'in_progress')
      expect(result).toEqual({ error: 'Solo puedes cambiar tus propias citas.' })
    })
  })
})
