import {
  addWalkIn, updateWalkInStatus, startWalkIn, reserveWalkIn, releaseWalkIn,
  suggestWalkInStaff, removeFromQueue, setWalkInService, closeStaleWalkIns,
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
  // Quién ejecuta la acción: por defecto admin. Los tests de barbero lo cambian.
  let actor: { role: string; staffId: string | null; entry: { staff_id: string | null; appointment_id: string | null } | null }

  beforeEach(() => {
    jest.clearAllMocks()
    actor = { role: 'admin', staffId: null, entry: null }

    mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: jest.fn((table: string) => { mockSupabase._table = table; return mockSupabase }),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      // Lecturas del actor (profiles → staff) y del turno (walk_ins); los tests pueden pisarlas con *Once
      maybeSingle: jest.fn(async () => {
        if (mockSupabase._table === 'profiles') return { data: { role: actor.role, business_id: 'b1' }, error: null }
        if (mockSupabase._table === 'staff')    return { data: actor.staffId ? { id: actor.staffId } : null, error: null }
        if (mockSupabase._table === 'walk_ins') return { data: actor.entry, error: null }
        return { data: null, error: null }
      }),
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

      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'station_busy' } })
      expect(await startWalkIn('wi1', 'staff1')).toEqual({
        error: 'La estación que necesita este servicio está ocupada ahora. Espera a que se libere o elige otro servicio.',
      })
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it('requires a session', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
      const result = await startWalkIn('wi1', 'staff1')
      expect(result.error).toBeTruthy()
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
    })
  })

  describe('reglas de barbero', () => {
    beforeEach(() => {
      mockSupabase.rpc = jest.fn()
      actor = { role: 'barber', staffId: 'me', entry: { staff_id: null, appointment_id: null } }
    })

    it('startWalkIn: puede atender un turno sin barbero asignado, a nombre propio', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: { appointment_id: 'a1' }, error: null })
      const res = await startWalkIn('wi1', 'me', 'svc1')
      expect(res).toEqual({ success: true, appointmentId: 'a1' })
      expect(mockSupabase.rpc).toHaveBeenCalledWith('start_walk_in', expect.objectContaining({ p_staff_id: 'me' }))
    })

    it('startWalkIn: puede atender un turno reservado para él', async () => {
      actor.entry = { staff_id: 'me', appointment_id: 'ap1' }
      mockSupabase.rpc.mockResolvedValueOnce({ data: { appointment_id: 'ap1' }, error: null })
      expect((await startWalkIn('wi1', 'me')).success).toBe(true)
    })

    it('startWalkIn: NO puede atender un turno reservado o pedido con otro profesional', async () => {
      actor.entry = { staff_id: 'other', appointment_id: 'ap1' }
      const res = await startWalkIn('wi1', 'me')
      expect(res.error).toMatch(/otro profesional/)
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
    })

    it('startWalkIn: NO puede atender a nombre de otro profesional', async () => {
      const res = await startWalkIn('wi1', 'other')
      expect(res.error).toMatch(/otro profesional/)
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
    })

    it('startWalkIn: un barbero sin profesional ligado no atiende', async () => {
      actor.staffId = null
      const res = await startWalkIn('wi1', 'me')
      expect(res.error).toBeTruthy()
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
    })

    it('startWalkIn: el admin atiende cualquiera', async () => {
      actor = { role: 'admin', staffId: null, entry: { staff_id: 'other', appointment_id: 'ap1' } }
      mockSupabase.rpc.mockResolvedValueOnce({ data: { appointment_id: 'a1' }, error: null })
      expect((await startWalkIn('wi1', 'someone')).success).toBe(true)
    })

    it('reserveWalkIn: aparta para sí mismo un turno libre', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { staff_id: 'me', start_time: '2026-10-02T15:00:00+00:00' }, error: null,
      })
      expect((await reserveWalkIn('wi1', 'me')).success).toBe(true)
    })

    it('reserveWalkIn: NO puede apartar un turno libre para otro, ni dejar que el DB elija', async () => {
      expect((await reserveWalkIn('wi1', 'other')).error).toMatch(/otro profesional/)
      expect((await reserveWalkIn('wi1', null)).error).toMatch(/otro profesional/)
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
    })

    it('reserveWalkIn: NO puede cambiar el barbero de un turno reservado para otro', async () => {
      actor.entry = { staff_id: 'other', appointment_id: 'ap1' }
      expect((await reserveWalkIn('wi1', 'me')).error).toMatch(/otro profesional/)
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
    })

    it('reserveWalkIn: puede traspasar un turno que es suyo', async () => {
      actor.entry = { staff_id: 'me', appointment_id: 'ap1' }
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { staff_id: 'other', start_time: '2026-10-02T15:00:00+00:00' }, error: null,
      })
      expect((await reserveWalkIn('wi1', 'other')).success).toBe(true)
    })

    it('releaseWalkIn: libera lo suyo; NO el hueco de otro', async () => {
      actor.entry = { staff_id: 'me', appointment_id: 'ap1' }
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null })
      expect(await releaseWalkIn('wi1')).toEqual({ success: true })

      actor.entry = { staff_id: 'other', appointment_id: 'ap1' }
      expect((await releaseWalkIn('wi1')).error).toMatch(/otro profesional/)
      expect(mockSupabase.rpc).toHaveBeenCalledTimes(1)
    })

    it('removeFromQueue: no saca de la fila el hueco apartado de otro, pero sí un turno sin hueco', async () => {
      actor.entry = { staff_id: 'other', appointment_id: 'ap1' }
      expect((await removeFromQueue('wi1')).error).toMatch(/otro profesional/)
      expect(mockSupabase.rpc).not.toHaveBeenCalled()

      actor.entry = { staff_id: 'other', appointment_id: null }
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null })
      expect(await removeFromQueue('wi1')).toEqual({ success: true })
    })

    it('traduce el error walk_in_not_yours que lanza la BD (defensa en profundidad)', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'walk_in_not_yours' } })
      expect((await startWalkIn('wi1', 'me')).error).toMatch(/otro profesional/)
    })
  })

  describe('closeStaleWalkIns', () => {
    it('llama al RPC y devuelve cuántos cerró', async () => {
      mockSupabase.rpc = jest.fn().mockResolvedValueOnce({ data: 3, error: null })
      expect(await closeStaleWalkIns('b1')).toBe(3)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('close_stale_walk_ins', { p_business_id: 'b1' })
    })

    it('es de mejor esfuerzo: ignora errores y excepciones', async () => {
      mockSupabase.rpc = jest.fn().mockResolvedValueOnce({ data: null, error: { message: 'x' } })
      expect(await closeStaleWalkIns('b1')).toBe(0)
      mockSupabase.rpc = jest.fn().mockRejectedValueOnce(new Error('boom'))
      expect(await closeStaleWalkIns('b1')).toBe(0)
    })
  })
})
