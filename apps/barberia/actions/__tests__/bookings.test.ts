import { createBooking } from '../bookings'
import { createClient, createAdminClient } from '@xinuco/supabase/server'
import { sendBookingConfirmation } from '@/lib/email/notifications'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn(),
}))

jest.mock('@/lib/email/notifications', () => ({
  sendBookingConfirmation: jest.fn().mockResolvedValue(true),
}))

jest.mock('@/lib/mercadopago/client', () => ({
  getMPClient: jest.fn(),
}))

describe('Bookings Server Actions', () => {
  let mockSupabase: any
  let mockAdmin: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockSupabase = {
      rpc: jest.fn(),
    }
    mockAdmin = { from: jest.fn() }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
    ;(createAdminClient as jest.Mock).mockResolvedValue(mockAdmin)
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

    it('creates booking successfully via create_public_booking RPC', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { appointment_id: 'apt1', customer_id: 'cust1', staff_id: 'st1' },
        error: null,
      })

      const result = await createBooking({
        full_name: 'John Doe',
        phone: '1234567890',
        email: 'john@example.com',
        service_id: 's1',
        staff_id: 'st1',
        start_time: '2023-10-10T10:00:00Z',
        business_id: 'b1'
      })

      expect(mockSupabase.rpc).toHaveBeenCalledWith('create_public_booking', {
        p_business_id: 'b1',
        p_service_id: 's1',
        p_staff_id: 'st1',
        p_start_time: '2023-10-10T10:00:00Z',
        p_full_name: 'John Doe',
        p_phone: '1234567890',
        p_email: 'john@example.com',
        p_status: 'scheduled',
        p_products: [],
      })
      expect(result).toEqual({ success: true, appointment_id: 'apt1', customer_id: 'cust1' })
      // El correo se envía con el cliente service-role (anon no puede leer bajo RLS)
      expect(sendBookingConfirmation).toHaveBeenCalledWith({
        supabase: mockAdmin,
        businessId: 'b1',
        appointmentId: 'apt1',
        customerId: 'cust1'
      })
    })

    it('maps staff_id "any" to null and empty email to null', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { appointment_id: 'apt1', customer_id: 'cust1', staff_id: 'st9' },
        error: null,
      })

      const result = await createBooking({
        full_name: 'John Doe',
        phone: '1234567890',
        email: '',
        service_id: 's1',
        staff_id: 'any',
        start_time: '2023-10-10T10:00:00Z',
        business_id: 'b1'
      })

      expect(result.success).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('create_public_booking', expect.objectContaining({
        p_staff_id: null,
        p_email: null,
      }))
    })

    it('maps slot_unavailable to a friendly message and sends no email', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'slot_unavailable' } })

      const result = await createBooking({
        full_name: 'John Doe',
        phone: '1234567890',
        service_id: 's1',
        staff_id: 'st1',
        start_time: '2023-10-10T10:00:00Z',
        business_id: 'b1'
      })

      expect(result.error).toBe('slot_unavailable')
      expect(result.message).toBe('Ese horario ya no está disponible. Elige otro.')
      expect(sendBookingConfirmation).not.toHaveBeenCalled()
    })

    it('forwards reserved products as p_products', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { appointment_id: 'apt1', customer_id: 'cust1', staff_id: 'st1' },
        error: null,
      })

      const result = await createBooking({
        full_name: 'John Doe',
        phone: '1234567890',
        service_id: 's1',
        staff_id: 'st1',
        start_time: '2023-10-10T10:00:00Z',
        business_id: 'b1',
        products: [{ item_id: 'inv1', quantity: 2 }],
      })

      expect(result.success).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('create_public_booking', expect.objectContaining({
        p_products: [{ item_id: 'inv1', quantity: 2 }],
      }))
    })

    it('maps product_unavailable to a friendly message', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'product_unavailable' } })

      const result = await createBooking({
        full_name: 'John Doe',
        phone: '1234567890',
        service_id: 's1',
        staff_id: 'st1',
        start_time: '2023-10-10T10:00:00Z',
        business_id: 'b1',
        products: [{ item_id: 'inv1', quantity: 1 }],
      })

      expect(result.error).toBe('product_unavailable')
      expect(result.message).toBe('Uno de los productos ya no está disponible. Quítalo o elige otro.')
      expect(sendBookingConfirmation).not.toHaveBeenCalled()
    })

    it('returns a generic message for unknown RPC errors', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })

      const result = await createBooking({
        full_name: 'John Doe',
        phone: '1234567890',
        service_id: 's1',
        staff_id: 'st1',
        start_time: '2023-10-10T10:00:00Z',
        business_id: 'b1'
      })

      expect(result.error).toBe('db_error')
      expect(result.message).toBe('No pudimos crear la cita. Inténtalo de nuevo.')
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    it('does not fail the booking when the confirmation email throws', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { appointment_id: 'apt1', customer_id: 'cust1', staff_id: 'st1' },
        error: null,
      })
      ;(sendBookingConfirmation as jest.Mock).mockRejectedValueOnce(new Error('smtp down'))

      const result = await createBooking({
        full_name: 'John Doe',
        phone: '1234567890',
        service_id: 's1',
        staff_id: 'st1',
        start_time: '2023-10-10T10:00:00Z',
        business_id: 'b1'
      })

      expect(result.success).toBe(true)
    })
  })
})
