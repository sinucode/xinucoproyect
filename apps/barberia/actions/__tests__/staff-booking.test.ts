import {
  createStaffAppointment,
  getQuickBookingContext,
  getQuickBookingOptions,
  searchQuickBookingCustomers,
} from '../staff-booking'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
// "Hoy" fijo: 2026-10-05, 10:15 (hora local del negocio)
jest.mock('@/lib/agenda-time', () => ({
  businessTodayISODate: () => '2026-10-05',
  businessNowHHMM: () => '10:15',
}))

const UID = {
  me: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  customer: '33333333-3333-4333-8333-333333333333',
  service: '44444444-4444-4444-8444-444444444444',
  service2: '55555555-5555-4555-8555-555555555555',
}

type Result = { data?: unknown; error?: { message: string } | null }

/** Constructor de consultas encadenable: cualquier cadena termina en el resultado de la tabla. */
function chain(result: Result) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'or', 'in']) b[m] = jest.fn(() => b)
  b.maybeSingle = jest.fn(() => Promise.resolve(result))
  b.single = jest.fn(() => Promise.resolve(result))
  b.then = (resolve: (v: Result) => unknown) => Promise.resolve(result).then(resolve)
  return b
}

interface Setup {
  user?: { id: string } | null
  role?: string
  businessId?: string | null
  staffByQuery?: Result // respuesta de la consulta a `staff`
  tables?: Record<string, Result>
  rpc?: jest.Mock
}

function setup({ user = { id: 'user-1' }, role = 'barber', businessId = 'biz-1', staffByQuery, tables = {}, rpc }: Setup = {}) {
  const rpcMock = rpc ?? jest.fn().mockResolvedValue({ data: null, error: null })
  const supabase = {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn((table: string) => {
      if (table === 'profiles') return chain({ data: businessId === null ? { role, business_id: null } : { role, business_id: businessId } })
      if (table === 'staff') return chain(staffByQuery ?? { data: { id: UID.me, full_name: 'Carlos' } })
      return chain(tables[table] ?? { data: [] })
    }),
    rpc: rpcMock,
  }
  ;(createClient as jest.Mock).mockResolvedValue(supabase)
  return { supabase, rpc: rpcMock }
}

const validInput = {
  customerId: UID.customer,
  serviceId: UID.service,
  date: '2026-10-06',
  time: '10:30',
  notes: ' viene con su hijo ',
}

beforeEach(() => jest.clearAllMocks())

describe('createStaffAppointment', () => {
  it('barbero: agenda para SÍ MISMO (ignora el staffId enviado) y manda la hora local como UTC', async () => {
    const { rpc } = setup({ rpc: jest.fn().mockResolvedValue({ data: { appointment_id: 'appt-1' }, error: null }) })

    const res = await createStaffAppointment({ ...validInput, staffId: UID.other })

    expect(res).toEqual({ success: true, appointmentId: 'appt-1' })
    expect(rpc).toHaveBeenCalledWith('create_staff_appointment', {
      p_business_id: 'biz-1',        // del perfil, no del cliente
      p_staff_id: UID.me,            // su propia ficha
      p_customer_id: UID.customer,
      p_service_id: UID.service,
      p_start: '2026-10-06T10:30:00Z',
      p_notes: 'viene con su hijo',
    })
    expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/appointments', 'page')
    expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard', 'page')
  })

  it('admin: usa el profesional elegido', async () => {
    const { rpc } = setup({
      role: 'admin',
      staffByQuery: { data: { id: UID.other, full_name: 'Luis' } },
      rpc: jest.fn().mockResolvedValue({ data: { appointment_id: 'appt-2' }, error: null }),
    })

    const res = await createStaffAppointment({ ...validInput, staffId: UID.other, notes: '' })

    expect(res).toEqual({ success: true, appointmentId: 'appt-2' })
    expect(rpc).toHaveBeenCalledWith('create_staff_appointment', expect.objectContaining({ p_staff_id: UID.other, p_notes: null }))
  })

  it('admin sin profesional → pide elegirlo y no llama a la RPC', async () => {
    const { rpc } = setup({ role: 'admin' })
    const res = await createStaffAppointment({ ...validInput })
    expect(res).toEqual({ error: 'Elige el profesional.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('admin con un profesional que no es del negocio / inactivo → error y sin RPC', async () => {
    const { rpc } = setup({ role: 'admin', staffByQuery: { data: null } })
    const res = await createStaffAppointment({ ...validInput, staffId: UID.other })
    expect(res).toEqual({ error: 'No se encontró al profesional.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('barbero sin ficha vinculada → mensaje claro', async () => {
    const { rpc } = setup({ staffByQuery: { data: null } })
    const res = await createStaffAppointment({ ...validInput })
    expect(res).toMatchObject({ error: expect.stringMatching(/no está vinculado a un profesional/i) })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['slot_taken', /ya fue tomado/i],
    ['outside_schedule', /fuera del horario/i],
    ['service_not_offered', /no hace este servicio/i],
    ['customer_not_found', /no se encontró al cliente/i],
    ['in_the_past', /ya pasó/i],
    ['slot_unavailable', /no está disponible/i],
  ])('la RPC devuelve {error: %s} → mensaje en español y sin revalidar', async (code, pattern) => {
    setup({ rpc: jest.fn().mockResolvedValue({ data: { error: code }, error: null }) })
    const res = await createStaffAppointment({ ...validInput })
    expect(res).toMatchObject({ error: expect.stringMatching(pattern) })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('RAISE EXCEPTION forbidden de la RPC → "no tienes permiso"', async () => {
    setup({ rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'forbidden' } }) })
    const res = await createStaffAppointment({ ...validInput })
    expect(res).toMatchObject({ error: expect.stringMatching(/no tienes permiso/i) })
  })

  it('error desconocido de la BD → mensaje genérico (no filtra texto técnico)', async () => {
    setup({ rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'relation "x" does not exist' } }) })
    const res = await createStaffAppointment({ ...validInput })
    expect(res).toEqual({ error: 'No se pudo agendar la cita. Intenta de nuevo.' })
  })

  it('valida la entrada antes de tocar la BD', async () => {
    const { rpc } = setup()
    expect(await createStaffAppointment({ ...validInput, customerId: 'x' })).toEqual({ error: 'Elige el cliente.' })
    expect(await createStaffAppointment({ ...validInput, serviceId: '' })).toEqual({ error: 'Elige el servicio.' })
    expect(await createStaffAppointment({ ...validInput, time: '25:00' })).toMatchObject({ error: expect.stringMatching(/no es válida/i) })
    expect(await createStaffAppointment({ ...validInput, date: '2026-13-01' })).toMatchObject({ error: expect.stringMatching(/no es válida/i) })
    expect(await createStaffAppointment({ ...validInput, notes: 'x'.repeat(501) })).toMatchObject({ error: expect.stringMatching(/nota/i) })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sin sesión → No autenticado', async () => {
    const { rpc } = setup({ user: null })
    expect(await createStaffAppointment({ ...validInput })).toEqual({ error: 'No autenticado.' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('getQuickBookingOptions', () => {
  const services = [
    { id: UID.service, name: 'Corte', duration_minutes: 30, price_cop: 20000 },
    { id: UID.service2, name: 'Barba', duration_minutes: 20, price_cop: 12000 },
  ]

  it('rechaza fechas pasadas o inválidas', async () => {
    setup()
    expect(await getQuickBookingOptions('2026-10-04')).toEqual({ error: 'No se puede agendar en una fecha pasada.' })
    expect(await getQuickBookingOptions('hoy')).toEqual({ error: 'La fecha no es válida.' })
  })

  it('sin filas en staff_services el profesional hace todos los servicios', async () => {
    setup({ tables: { services: { data: services }, staff_services: { data: [] } } })
    const res = await getQuickBookingOptions('2026-10-06')
    expect(res).toEqual({ services, slots: [] })
  })

  it('con filas en staff_services solo ofrece esos servicios', async () => {
    setup({ tables: { services: { data: services }, staff_services: { data: [{ service_id: UID.service2 }] } } })
    const res = await getQuickBookingOptions('2026-10-06')
    expect(res).toEqual({ services: [services[1]], slots: [] })
  })

  it('horarios: salen de get_available_slots_v2 y hoy solo quedan los futuros', async () => {
    const { rpc } = setup({
      tables: { services: { data: services }, staff_services: { data: [] } },
      rpc: jest.fn().mockResolvedValue({ data: ['09:00', '10:00', '10:30', '11:00'], error: null }),
    })

    const today = await getQuickBookingOptions('2026-10-05', undefined, UID.service)
    expect(rpc).toHaveBeenCalledWith('get_available_slots_v2', expect.objectContaining({
      p_business_id: 'biz-1', p_staff_id: UID.me, p_service_id: UID.service, p_date: '2026-10-05',
    }))
    expect(today).toMatchObject({ slots: ['10:30', '11:00'] }) // ahora son las 10:15

    const tomorrow = await getQuickBookingOptions('2026-10-06', undefined, UID.service)
    expect(tomorrow).toMatchObject({ slots: ['09:00', '10:00', '10:30', '11:00'] })
  })

  it('un servicio que el profesional no ofrece no devuelve horarios (ni llama a la RPC)', async () => {
    const { rpc } = setup({ tables: { services: { data: services }, staff_services: { data: [{ service_id: UID.service2 }] } } })
    const res = await getQuickBookingOptions('2026-10-06', undefined, UID.service)
    expect(res).toMatchObject({ slots: [] })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('error de la RPC de horarios → mensaje claro', async () => {
    setup({
      tables: { services: { data: services }, staff_services: { data: [] } },
      rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
    })
    expect(await getQuickBookingOptions('2026-10-06', undefined, UID.service)).toEqual({ error: 'No se pudieron calcular los horarios libres.' })
  })
})

describe('getQuickBookingContext', () => {
  it('barbero: solo él mismo', async () => {
    setup()
    expect(await getQuickBookingContext()).toEqual({
      isAdmin: false,
      staff: [{ id: UID.me, full_name: 'Carlos' }],
      selfStaffId: UID.me,
    })
  })

  it('admin: lista de profesionales activos', async () => {
    setup({ role: 'admin', staffByQuery: { data: [{ id: UID.me, full_name: 'Carlos' }, { id: UID.other, full_name: 'Luis' }] } })
    expect(await getQuickBookingContext()).toEqual({
      isAdmin: true,
      staff: [{ id: UID.me, full_name: 'Carlos' }, { id: UID.other, full_name: 'Luis' }],
      selfStaffId: null,
    })
  })
})

describe('searchQuickBookingCustomers', () => {
  it('menos de 2 caracteres no consulta', async () => {
    const { supabase } = setup()
    expect(await searchQuickBookingCustomers('a')).toEqual({ customers: [] })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('busca solo en el negocio del perfil, con columnas explícitas y límite 8', async () => {
    const rows = [{ id: UID.customer, full_name: 'Ana Pérez', phone: '3001234567' }]
    const { supabase } = setup({ tables: { customers: { data: rows } } })
    const res = await searchQuickBookingCustomers('Ana,')
    expect(res).toEqual({ customers: rows })

    const customersCall = (supabase.from as jest.Mock).mock.results
      .map((r, i) => ({ table: (supabase.from as jest.Mock).mock.calls[i][0], builder: r.value }))
      .find((c) => c.table === 'customers')!
    expect(customersCall.builder.select).toHaveBeenCalledWith('id, full_name, phone')
    expect(customersCall.builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(customersCall.builder.or).toHaveBeenCalledWith('full_name.ilike.%Ana%,phone.ilike.%Ana%') // coma saneada
    expect(customersCall.builder.limit).toHaveBeenCalledWith(8)
  })
})
