import {
  addWalkIn, updateWalkInStatus, startWalkIn, reserveWalkIn, releaseWalkIn,
  suggestWalkInStaff, removeFromQueue, setWalkInService,
} from '../walk-ins'
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

  describe('reserveWalkIn', () => {
    beforeEach(() => {
      mockSupabase.rpc = jest.fn()
    })

    it('calls reserve_walk_in and returns the reserved slot', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { appointment_id: 'appt1', staff_id: 'staff1', start_time: '2026-09-29T15:00:00+00:00' },
        error: null,
      })

      const result = await reserveWalkIn('wi1', 'staff1')

      expect(mockSupabase.rpc).toHaveBeenCalledWith('reserve_walk_in', { p_walk_in_id: 'wi1', p_staff_id: 'staff1' })
      expect(result).toEqual({ success: true, staffId: 'staff1', startTime: '2026-09-29T15:00:00+00:00' })
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/walk-ins', 'page')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/appointments', 'page')
    })

    it('passes a null staff to let the DB pick the best barber', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { appointment_id: 'a', staff_id: 's9', start_time: '2026-09-29T15:00:00+00:00' },
        error: null,
      })
      await reserveWalkIn('wi1', null)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('reserve_walk_in', { p_walk_in_id: 'wi1', p_staff_id: null })
    })

    it('maps no_availability_today depending on whether a barber was chosen', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'no_availability_today' } })
      expect(await reserveWalkIn('wi1', 'staff1')).toEqual({ error: 'Ese barbero no tiene espacio libre hoy.' })

      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'no_availability_today' } })
      expect(await reserveWalkIn('wi1', null)).toEqual({ error: 'Ningún barbero tiene espacio libre hoy.' })
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it('maps the other RPC errors to Spanish messages', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'service_required' } })
      expect(await reserveWalkIn('wi1', 'staff1')).toEqual({ error: 'Elige el servicio para apartar el turno.' })

      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'walk_in_not_waiting' } })
      expect(await reserveWalkIn('wi1', 'staff1')).toEqual({ error: 'Este turno ya no está en espera.' })

      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'staff_not_found' } })
      expect(await reserveWalkIn('wi1', 'staff1')).toEqual({ error: 'Elige un barbero válido.' })

      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      expect((await reserveWalkIn('wi1', 'staff1')).error).toBeTruthy()
    })
  })

  describe('releaseWalkIn', () => {
    beforeEach(() => {
      mockSupabase.rpc = jest.fn()
    })

    it('releases without cancelling by default', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null })
      const result = await releaseWalkIn('wi1')
      expect(mockSupabase.rpc).toHaveBeenCalledWith('release_walk_in', { p_walk_in_id: 'wi1', p_cancel: false })
      expect(result).toEqual({ success: true })
    })

    it('returns a Spanish error when the turn is no longer waiting', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'walk_in_not_waiting' } })
      expect(await releaseWalkIn('wi1')).toEqual({ error: 'Este turno ya no está en espera.' })
    })
  })

  describe('suggestWalkInStaff', () => {
    beforeEach(() => {
      mockSupabase.rpc = jest.fn()
    })

    it('returns the suggestions from the RPC', async () => {
      const list = [{ staff_id: 's1', full_name: 'Ana', next_slot: '2026-09-29T15:00:00+00:00', minutes_from_now: 0 }]
      mockSupabase.rpc.mockResolvedValueOnce({ data: list, error: null })
      expect(await suggestWalkInStaff('wi1')).toEqual(list)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('suggest_walk_in_staff', { p_walk_in_id: 'wi1' })
    })

    it('returns [] on error', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } })
      expect(await suggestWalkInStaff('wi1')).toEqual([])
    })
  })

  describe('removeFromQueue', () => {
    beforeEach(() => {
      mockSupabase.rpc = jest.fn()
    })

    it('releases the reserved slot and cancels a waiting turn (p_cancel true)', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null })
      const result = await removeFromQueue('wi1')
      expect(mockSupabase.rpc).toHaveBeenCalledWith('release_walk_in', { p_walk_in_id: 'wi1', p_cancel: true })
      expect(mockSupabase.update).not.toHaveBeenCalled()
      expect(result).toEqual({ success: true })
    })

    it('falls back to a plain cancel when the turn is not waiting', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'walk_in_not_waiting' } })
      mockSupabase.update.mockReturnValueOnce({ eq: jest.fn().mockResolvedValueOnce({ error: null }) })
      const result = await removeFromQueue('wi1')
      expect(mockSupabase.update).toHaveBeenCalledWith({ status: 'cancelled' })
      expect(result).toEqual({ success: true })
    })
  })

  describe('setWalkInService', () => {
    it('updates the service only while the turn is waiting', async () => {
      const eq2 = jest.fn().mockResolvedValueOnce({ error: null })
      const eq1 = jest.fn().mockReturnValueOnce({ eq: eq2 })
      mockSupabase.update.mockReturnValueOnce({ eq: eq1 })

      const result = await setWalkInService('wi1', 'svc1')

      expect(mockSupabase.update).toHaveBeenCalledWith({ service_id: 'svc1' })
      expect(eq1).toHaveBeenCalledWith('id', 'wi1')
      expect(eq2).toHaveBeenCalledWith('status', 'waiting')
      expect(result).toEqual({ success: true })
    })
  })

  describe('startWalkIn', () => {
    beforeEach(() => {
      mockSupabase.auth = { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) }
      mockSupabase.rpc = jest.fn()
    })

    it('calls the RPC and returns the appointment id', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: { appointment_id: 'appt1', customer_id: 'c1' }, error: null })

      const result = await startWalkIn('wi1', 'staff1', 'svc1')

      expect(mockSupabase.rpc).toHaveBeenCalledWith('start_walk_in', {
        p_walk_in_id: 'wi1',
        p_staff_id:   'staff1',
        p_service_id: 'svc1',
      })
      expect(result).toEqual({ success: true, appointmentId: 'appt1' })
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/walk-ins', 'page')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/appointments', 'page')
    })

    it('maps RPC errors to Spanish messages', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'walk_in_not_waiting' } })
      expect(await startWalkIn('wi1', 'staff1')).toEqual({ error: 'Este turno ya no está en espera.' })

      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'service_required' } })
      expect(await startWalkIn('wi1', 'staff1')).toEqual({ error: 'Elige el servicio para atender.' })
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it('requires a session', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
      const result = await startWalkIn('wi1', 'staff1')
      expect(result.error).toBeTruthy()
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
    })
  })
})
