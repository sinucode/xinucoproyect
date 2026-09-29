import { cancelAppointmentByToken } from '../public-appointments'
import { createClient, createAdminClient } from '@xinuco/supabase/server'
import { sendCancellationNotice } from '@/lib/email/notifications'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

jest.mock('@/lib/email/notifications', () => ({
  sendCancellationNotice: jest.fn().mockResolvedValue(undefined),
}))

const TOKEN = '3f2b8c1e-5a4d-4e7b-9c60-1d2e3f4a5b6c'

describe('cancelAppointmentByToken', () => {
  let rpc: jest.Mock
  let adminRpc: jest.Mock
  let admin: any

  beforeEach(() => {
    jest.clearAllMocks()
    rpc = jest.fn()
    adminRpc = jest.fn().mockResolvedValue({ data: null, error: null })
    admin = { rpc: adminRpc }
    ;(createClient as jest.Mock).mockResolvedValue({ rpc })
    ;(createAdminClient as jest.Mock).mockResolvedValue(admin)
  })

  it('rejects an invalid token without calling the rpc', async () => {
    const result = await cancelAppointmentByToken('not-a-uuid')
    expect(result).toEqual({ error: 'Enlace inválido.' })
    expect(rpc).not.toHaveBeenCalled()
    expect(sendCancellationNotice).not.toHaveBeenCalled()
  })

  it('maps already_started to a friendly message', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'already_started' } })
    const result = await cancelAppointmentByToken(TOKEN)
    expect(result).toEqual({
      error: 'Esta cita ya pasó o está en curso; no se puede cancelar desde aquí.',
    })
    expect(sendCancellationNotice).not.toHaveBeenCalled()
  })

  it('sends the cancellation notice with the admin client on success', async () => {
    rpc.mockResolvedValueOnce({ data: { appointment_id: 'appt1', business_id: 'biz1' }, error: null })
    const result = await cancelAppointmentByToken(TOKEN)
    expect(result).toEqual({ success: true })
    expect(rpc).toHaveBeenCalledWith('cancel_appointment_by_token', { p_token: TOKEN, p_reason: null })
    expect(sendCancellationNotice).toHaveBeenCalledWith({
      supabase: admin,
      businessId: 'biz1',
      appointmentId: 'appt1',
      reason: null,
    })
  })

  it('passes the trimmed reason to the rpc, the email and the audit log', async () => {
    rpc.mockResolvedValueOnce({ data: { appointment_id: 'appt1', business_id: 'biz1' }, error: null })
    const result = await cancelAppointmentByToken(TOKEN, '  me surgió un imprevisto  ')
    expect(result).toEqual({ success: true })
    expect(rpc).toHaveBeenCalledWith('cancel_appointment_by_token', {
      p_token: TOKEN,
      p_reason: 'me surgió un imprevisto',
    })
    expect(sendCancellationNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'me surgió un imprevisto' }),
    )
    expect(adminRpc).toHaveBeenCalledWith(
      'log_action',
      expect.objectContaining({
        p_new_value: { status: 'cancelled', source: 'email_link', reason: 'me surgió un imprevisto' },
      }),
    )
  })

  it('truncates a reason longer than 300 characters', async () => {
    rpc.mockResolvedValueOnce({ data: { appointment_id: 'appt1', business_id: 'biz1' }, error: null })
    await cancelAppointmentByToken(TOKEN, 'a'.repeat(500))
    expect(rpc).toHaveBeenCalledWith('cancel_appointment_by_token', {
      p_token: TOKEN,
      p_reason: 'a'.repeat(300),
    })
  })

  it('sends null when the reason is empty or whitespace', async () => {
    rpc.mockResolvedValueOnce({ data: { appointment_id: 'appt1', business_id: 'biz1' }, error: null })
    await cancelAppointmentByToken(TOKEN, '   ')
    expect(rpc).toHaveBeenCalledWith('cancel_appointment_by_token', { p_token: TOKEN, p_reason: null })
  })

  it('still succeeds when the email fails', async () => {
    rpc.mockResolvedValueOnce({ data: { appointment_id: 'appt1', business_id: 'biz1' }, error: null })
    ;(sendCancellationNotice as jest.Mock).mockRejectedValueOnce(new Error('boom'))
    const result = await cancelAppointmentByToken(TOKEN)
    expect(result).toEqual({ success: true })
  })
})
