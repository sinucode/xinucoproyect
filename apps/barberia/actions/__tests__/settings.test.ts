import { updateAvailability, getAvailability } from '../availability'
import { updateBusinessProfile, updateBusinessBranding, updateBookingSettings } from '../businesses'
import { closeHoliday, createCustomClosure, removeClosure } from '../closures'
import { getNotificationLog } from '../notifications'
import { runDailyTasks } from '../platform-settings'
import { createClient } from '@xinuco/supabase/server'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn(),
}))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/agenda-time', () => ({
  ...jest.requireActual('@/lib/agenda-time'),
  businessTodayISODate: () => '2026-09-30',
}))

type Result = { data?: any; error?: any }

/** Fake de Supabase: cada from(tabla) consume el siguiente resultado de esa tabla. */
function makeSupabase(opts: {
  role?: string | null
  businessId?: string | null
  appRole?: string
  queues?: Record<string, Result[]>
  rpc?: Result
}) {
  const calls: { table: string; ops: { op: string; args: any[] }[] }[] = []
  const queues = opts.queues ?? {}
  const profile = opts.role === null ? null : { role: opts.role ?? 'admin', business_id: opts.businessId === undefined ? 'biz1' : opts.businessId }

  const from = jest.fn((table: string) => {
    const call = { table, ops: [] as { op: string; args: any[] }[] }
    calls.push(call)
    const result: Result = table === 'profiles'
      ? { data: profile, error: null }
      : queues[table]?.length ? queues[table].shift()! : { data: [], error: null }
    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result).then(res, rej)
        return (...args: any[]) => { call.ops.push({ op: prop, args }); return chain }
      },
    })
    return chain
  })
  const rpc = jest.fn(async () => opts.rpc ?? { data: null, error: null })

  const supabase = {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1', app_metadata: { role: opts.appRole } } } })) },
    from,
    rpc,
  }
  ;(createClient as jest.Mock).mockResolvedValue(supabase)
  return { supabase, calls, rpc }
}

const day = (is_open: boolean) => ({ is_open, open_time: '09:00', close_time: '19:00' })
const hours = {
  monday: day(true), tuesday: day(true), wednesday: day(true), thursday: day(true),
  friday: day(true), saturday: day(true), sunday: day(false),
}
const profileInput = {
  name: 'Barbería El Patrón', address: 'Calle 1', city: 'Medellín', whatsapp: '+57 300 123 4567',
  phone: '', instagram: '@elpatron', maps_url: 'https://maps.app.goo.gl/x', tax_id: '900', legal_name: 'El Patrón SAS',
}

beforeEach(() => jest.clearAllMocks())

describe('requireAdmin (todas las acciones de configuración)', () => {
  it('un barbero no puede guardar nada', async () => {
    makeSupabase({ role: 'barber' })
    expect(await updateAvailability({ operating_hours: hours as any })).toEqual(expect.objectContaining({ error: expect.stringMatching(/administrador/) }))
    expect(await updateBusinessProfile(profileInput)).toEqual(expect.objectContaining({ error: expect.stringMatching(/administrador/) }))
    expect(await updateBusinessBranding({ primary_color: '#fff' })).toEqual(expect.objectContaining({ error: expect.stringMatching(/administrador/) }))
    expect(await closeHoliday('2026-10-12')).toEqual(expect.objectContaining({ error: expect.stringMatching(/administrador/) }))
    expect(await getAvailability()).toEqual(expect.objectContaining({ error: expect.any(String) }))
  })

  it('sin negocio en el perfil no hace nada', async () => {
    const { calls } = makeSupabase({ role: 'admin', businessId: null })
    const r = await updateBusinessProfile(profileInput)
    expect(r.error).toMatch(/administrador/)
    expect(calls.some(c => c.table === 'businesses')).toBe(false)
  })
})

describe('updateBusinessProfile', () => {
  it('guarda normalizado y usa el negocio del perfil', async () => {
    const { calls } = makeSupabase({ queues: { businesses: [{ data: [{ id: 'biz1' }], error: null }] } })
    const r = await updateBusinessProfile(profileInput)
    expect(r).toEqual({ success: true })
    const call = calls.find(c => c.table === 'businesses')!
    const update = call.ops.find(o => o.op === 'update')!.args[0]
    expect(update).toMatchObject({ whatsapp: '3001234567', instagram: 'elpatron', phone: null, name: 'Barbería El Patrón' })
    expect(call.ops.find(o => o.op === 'eq')!.args).toEqual(['id', 'biz1'])
  })

  it('0 filas actualizadas → mensaje de solo administrador', async () => {
    makeSupabase({ queues: { businesses: [{ data: [], error: null }] } })
    expect((await updateBusinessProfile(profileInput)).error).toBe('No se pudo guardar: solo un administrador puede cambiar esto.')
  })

  it('valida antes de tocar la base', async () => {
    const { calls } = makeSupabase({})
    const r = await updateBusinessProfile({ ...profileInput, maps_url: 'http://x.com' })
    expect(r.error).toMatch(/https/)
    expect(calls.some(c => c.table === 'businesses')).toBe(false)
  })
})

describe('updateAvailability', () => {
  it('guarda el horario válido', async () => {
    makeSupabase({ queues: { businesses: [{ data: [{ id: 'biz1' }], error: null }] } })
    expect(await updateAvailability({ operating_hours: hours as any })).toEqual({ success: true })
  })

  it('rechaza horario sin días abiertos y 0 filas', async () => {
    makeSupabase({})
    const closed = Object.fromEntries(Object.keys(hours).map(k => [k, day(false)]))
    expect((await updateAvailability({ operating_hours: closed as any })).error).toMatch(/al menos un día/)
    makeSupabase({ queues: { businesses: [{ data: [], error: null }] } })
    expect((await updateAvailability({ operating_hours: hours as any })).error).toMatch(/solo un administrador/)
  })
})

describe('updateBookingSettings', () => {
  const base = { booking_products_enabled: true, booking_max_product_units: 2, booking_max_open_with_products_per_phone: 1, appointment_interval_minutes: 20 }

  it('acepta 15/20/30/60 y rechaza otros intervalos', async () => {
    makeSupabase({ queues: { businesses: [{ data: [{ id: 'biz1' }], error: null }] } })
    expect(await updateBookingSettings(base)).toEqual({ success: true })
    makeSupabase({})
    expect((await updateBookingSettings({ ...base, appointment_interval_minutes: 25 })).error).toMatch(/15, 20, 30 o 60/)
  })

  it('detecta 0 filas', async () => {
    makeSupabase({ queues: { businesses: [{ data: [], error: null }] } })
    expect((await updateBookingSettings(base)).error).toMatch(/solo un administrador/)
  })
})

describe('closures', () => {
  it('closeHoliday usa el nombre oficial y llama la RPC', async () => {
    const { rpc } = makeSupabase({ rpc: { data: { id: 'c1', appointments_on_those_days: 2 }, error: null } })
    const r = await closeHoliday('2026-10-12')
    expect(r).toEqual({ success: true, id: 'c1', appointments: 2 })
    expect(rpc).toHaveBeenCalledWith('set_business_closure', {
      p_date_from: '2026-10-12', p_date_to: '2026-10-12', p_reason: 'Día de la Raza', p_kind: 'holiday',
    })
  })

  it('closeHoliday rechaza fechas que no son festivo o ya pasaron', async () => {
    const { rpc } = makeSupabase({})
    expect((await closeHoliday('2026-10-13')).error).toMatch(/no es un festivo/)
    expect((await closeHoliday('2026-08-17')).error).toMatch(/pasaron/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('createCustomClosure valida y traduce errores de la RPC', async () => {
    const { rpc } = makeSupabase({ rpc: { data: null, error: { message: 'overlaps' } } })
    expect((await createCustomClosure({ date_from: '2026-12-20', date_to: '2026-12-10', reason: 'Vacaciones' })).error).toMatch(/anterior/)
    expect(rpc).not.toHaveBeenCalled()
    const r = await createCustomClosure({ date_from: '2026-12-20', date_to: '2027-01-05', reason: ' Vacaciones ' })
    expect(r.error).toMatch(/se cruzan/)
    expect(rpc).toHaveBeenCalledWith('set_business_closure', expect.objectContaining({ p_reason: 'Vacaciones', p_kind: 'custom' }))
  })

  it('removeClosure valida el id y llama la RPC', async () => {
    const { rpc } = makeSupabase({})
    expect((await removeClosure('nope')).error).toMatch(/no válido/)
    expect(await removeClosure('123e4567-e89b-12d3-a456-426614174000')).toEqual({ success: true })
    expect(rpc).toHaveBeenCalledWith('remove_business_closure', { p_closure_id: '123e4567-e89b-12d3-a456-426614174000' })
  })
})

describe('getNotificationLog', () => {
  it('toma el negocio del perfil, nunca del cliente', async () => {
    const { calls } = makeSupabase({ queues: { notification_log: [{ data: [], error: null }] } })
    const r = await getNotificationLog(50)
    expect(r.error).toBeNull()
    const call = calls.find(c => c.table === 'notification_log')!
    expect(call.ops.find(o => o.op === 'eq')!.args).toEqual(['business_id', 'biz1'])
  })

  it('un barbero no ve el historial', async () => {
    makeSupabase({ role: 'barber' })
    expect((await getNotificationLog()).error).toBe('Acceso denegado.')
  })
})

describe('runDailyTasks', () => {
  it('solo el super_admin puede correrlas', async () => {
    makeSupabase({ appRole: 'admin' })
    const r = await runDailyTasks()
    expect(r.success).toBe(false)
  })

  it('sin CRON_SECRET avisa', async () => {
    makeSupabase({ appRole: 'super_admin' })
    const prev = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    const r = await runDailyTasks()
    process.env.CRON_SECRET = prev
    expect(r).toEqual({ success: false, error: expect.stringMatching(/CRON_SECRET/) })
  })

  it('resume la respuesta del cron', async () => {
    makeSupabase({ appRole: 'super_admin' })
    process.env.CRON_SECRET = 's3cret'
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true, processed: 4, sent: 3, skipped: 1, failed: 0,
        recurringExpenses: { registered: [{}], reminders: [{}, {}], errors: [] },
        auditPurge: { deleted: 7, retention_months: 36 },
      }),
    }))
    ;(global as any).fetch = fetchMock
    const r = await runDailyTasks()
    expect(r).toEqual({
      success: true,
      summary: {
        reminders: { processed: 4, sent: 3, skipped: 1, failed: 0 },
        fixedExpenses: { registered: 1, reminders: 2, errors: 0 },
        auditPurge: { deleted: 7, retentionMonths: 36 },
      },
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, any]
    expect(url).toMatch(/\/api\/cron\/send-reminders$/)
    expect(init.headers.Authorization).toBe('Bearer s3cret')
    delete process.env.CRON_SECRET
  })
})
