import { createService, updateService, deleteService, setServiceActive } from '../services'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

type Result = { data?: any; error?: any }

/**
 * Fake de Supabase: cada `from(tabla)` consume el siguiente resultado encolado
 * para esa tabla (o el default). El builder es encadenable y "thenable".
 */
function makeSupabase(role: string | null, queues: Record<string, Result[]> = {}) {
  const calls: { table: string; ops: { op: string; args: any[] }[] }[] = []

  const from = jest.fn((table: string) => {
    const call = { table, ops: [] as { op: string; args: any[] }[] }
    calls.push(call)
    const result: Result = queues[table]?.length ? queues[table].shift()! : { data: [], error: null }

    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result).then(res, rej)
        return (...args: any[]) => { call.ops.push({ op: prop, args }); return chain }
      },
    })
    return chain
  })

  const supabase = {
    from,
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: role === null ? null : { id: 'u1' } } }) },
  }
  if (role !== null && !queues.profiles) {
    queues.profiles = [{ data: { role, business_id: 'biz1' }, error: null }]
  }
  return { supabase, calls }
}

const validInput = {
  name: 'Corte Clásico',
  description: '',
  duration_minutes: 30,
  buffer_time_minutes: 5,
  price_cop: 25000,
  staff_ids: 'all' as const,
  workstation_ids: [] as string[],
}

function setup(role: string | null, queues: Record<string, Result[]> = {}) {
  const m = makeSupabase(role, queues)
  ;(createClient as jest.Mock).mockResolvedValue(m.supabase)
  return m
}

const NOT_ADMIN = 'Solo un administrador puede modificar servicios.'

describe('Services Server Actions', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('permisos', () => {
    it.each(['barber', 'manicurist', 'cashier'])('rechaza el rol %s', async (role) => {
      setup(role)
      expect(await createService(validInput)).toEqual({ error: NOT_ADMIN })
      expect(await updateService('s1', validInput)).toEqual({ error: NOT_ADMIN })
      expect(await setServiceActive('s1', false)).toEqual({ error: NOT_ADMIN })
      expect(await deleteService('s1')).toEqual({ error: NOT_ADMIN })
    })

    it('rechaza sin sesión', async () => {
      setup(null)
      expect(await createService(validInput)).toEqual({ error: NOT_ADMIN })
    })

    it('rechaza un perfil sin business_id', async () => {
      setup('admin', { profiles: [{ data: { role: 'admin', business_id: null }, error: null }] })
      expect(await deleteService('s1')).toEqual({ error: NOT_ADMIN })
    })

    it('no escribe nada cuando el rol no es admin', async () => {
      const { calls } = setup('barber')
      await createService(validInput)
      expect(calls.map(c => c.table)).toEqual(['profiles'])
    })
  })

  describe('validación', () => {
    const cases: [string, Partial<typeof validInput>, RegExp][] = [
      ['nombre muy corto', { name: 'a' }, /nombre/i],
      ['nombre muy largo', { name: 'x'.repeat(81) }, /nombre/i],
      ['descripción larga', { description: 'x'.repeat(301) }, /descripción/i],
      ['duración < 5', { duration_minutes: 4 }, /duración/i],
      ['duración > 480', { duration_minutes: 481 }, /duración/i],
      ['duración decimal', { duration_minutes: 30.5 }, /duración/i],
      ['limpieza negativa', { buffer_time_minutes: -1 }, /limpieza/i],
      ['limpieza > 60', { buffer_time_minutes: 61 }, /limpieza/i],
      ['precio 0', { price_cop: 0 }, /precio/i],
      ['precio > 10.000.000', { price_cop: 10_000_001 }, /precio/i],
      ['precio decimal', { price_cop: 100.5 }, /precio/i],
    ]

    it.each(cases)('%s', async (_label, patch, re) => {
      const { calls } = setup('admin')
      const r = await createService({ ...validInput, ...patch })
      expect(r.error).toMatch(re)
      expect(calls.map(c => c.table)).toEqual(['profiles']) // no llega a escribir
    })

    it('rechaza nombre duplicado (sin distinguir mayúsculas)', async () => {
      setup('admin', { services: [{ data: [{ id: 'x', name: 'corte clásico' }], error: null }] })
      const r = await createService(validInput)
      expect(r.error).toBe('Ya existe un servicio con ese nombre.')
    })

    it('rechaza "solo algunos" sin ningún barbero', async () => {
      setup('admin')
      const r = await createService({ ...validInput, staff_ids: [] })
      expect(r.error).toMatch(/al menos un barbero/i)
    })
  })

  describe('createService', () => {
    it('crea el servicio usando el business_id del perfil', async () => {
      const created = { id: 'svc1', name: 'Corte Clásico' }
      const { calls } = setup('admin', {
        services: [
          { data: [], error: null },      // pre-chequeo de duplicados
          { data: [{ id: 'sX' }], error: null }, // servicios activos (plan)
          { data: created, error: null }, // insert
        ],
        staff: [{ data: [{ id: 'b1', full_name: 'Ana' }], error: null }],
      })
      const r = await createService(validInput)
      expect(r.success).toBe(true)
      expect(r.data).toEqual(created)
      const insert = calls.flatMap(c => c.ops.map(o => ({ t: c.table, ...o }))).find(o => o.t === 'services' && o.op === 'insert')
      expect(insert!.args[0]).toMatchObject({ business_id: 'biz1', name: 'Corte Clásico', buffer_time_minutes: 5, is_active: true })
      expect(revalidatePath).toHaveBeenCalled()
    })
  })

  describe('deleteService', () => {
    it('archiva (is_active=false) cuando el servicio tiene citas', async () => {
      const { calls } = setup('admin', {
        services: [
          { data: { id: 's1' }, error: null }, // existe
          { data: null, error: null },         // update is_active=false
        ],
        appointments: [{ data: [{ id: 'a1' }], error: null }],
      })
      const r = await deleteService('s1')
      expect(r).toEqual({
        success: true,
        archived: true,
        message: 'El servicio tiene historial, así que se archivó (quedó inactivo) en lugar de borrarse.',
      })
      const ops = calls.flatMap(c => c.ops.map(o => ({ t: c.table, ...o })))
      expect(ops.find(o => o.t === 'services' && o.op === 'update')!.args[0]).toEqual({ is_active: false })
      expect(ops.some(o => o.op === 'delete')).toBe(false)
      expect(revalidatePath).toHaveBeenCalled()
    })

    it('borra asignaciones y servicio cuando no hay citas', async () => {
      const { calls } = setup('admin', {
        services: [
          { data: { id: 's1' }, error: null }, // existe
          { data: null, error: null },         // delete
        ],
        appointments: [{ data: [], error: null }],
      })
      const r = await deleteService('s1')
      expect(r).toEqual({ success: true, deleted: true })
      const deleted = calls.filter(c => c.ops.some(o => o.op === 'delete')).map(c => c.table)
      expect(deleted).toEqual(['staff_services', 'service_workstations', 'services'])
    })

    it('archiva si el borrado falla por llave foránea (23503)', async () => {
      setup('admin', {
        services: [
          { data: { id: 's1' }, error: null },
          { data: null, error: { code: '23503', message: 'fk' } }, // delete
          { data: null, error: null },                              // update
        ],
        appointments: [{ data: [], error: null }],
      })
      const r = await deleteService('s1')
      expect(r.archived).toBe(true)
    })

    it('devuelve error si el servicio no es del negocio', async () => {
      setup('admin', { services: [{ data: null, error: null }] })
      expect((await deleteService('otro')).error).toBe('Servicio no encontrado.')
    })
  })

  describe('setServiceActive', () => {
    it('actualiza is_active filtrando por id y business_id', async () => {
      const { calls } = setup('admin', { services: [{ data: null, error: null }] })
      const r = await setServiceActive('s1', false)
      expect(r.success).toBe(true)
      const svc = calls.find(c => c.table === 'services')!
      expect(svc.ops).toEqual(expect.arrayContaining([
        { op: 'update', args: [{ is_active: false }] },
        { op: 'eq', args: ['id', 's1'] },
        { op: 'eq', args: ['business_id', 'biz1'] },
      ]))
    })
  })
})
