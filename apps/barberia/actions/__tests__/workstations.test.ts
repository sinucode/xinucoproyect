import {
  createWorkstation, updateWorkstation, setWorkstationActive, deleteWorkstation,
  getWorkstationsOverview,
} from '../workstations'
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

function setup(role: string | null, queues: Record<string, Result[]> = {}) {
  const m = makeSupabase(role, queues)
  ;(createClient as jest.Mock).mockResolvedValue(m.supabase)
  return m
}

const NOT_ADMIN = 'Solo un administrador puede modificar las estaciones.'
const input = { name: '  Lavacabezas ', service_ids: ['s1', 's2'] }

/** Secuencia "tabla.operación" de las llamadas, sin la consulta del perfil. */
function sequence(calls: { table: string; ops: { op: string }[] }[]) {
  return calls.slice(1).map(c => {
    const write = c.ops.find(o => ['insert', 'update', 'delete'].includes(o.op))
    return `${c.table}.${write?.op ?? 'select'}`
  })
}

describe('Workstations Server Actions', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('permisos', () => {
    it.each(['barber', 'manicurist', 'cashier'])('rechaza el rol %s', async (role) => {
      setup(role)
      expect(await createWorkstation(input)).toEqual({ error: NOT_ADMIN })
      expect(await updateWorkstation('w1', input)).toEqual({ error: NOT_ADMIN })
      expect(await setWorkstationActive('w1', false)).toEqual({ error: NOT_ADMIN })
      expect(await deleteWorkstation('w1')).toEqual({ error: NOT_ADMIN })
      expect(await getWorkstationsOverview()).toEqual({ error: NOT_ADMIN })
    })

    it('rechaza sin sesión', async () => {
      setup(null)
      expect(await createWorkstation(input)).toEqual({ error: NOT_ADMIN })
    })

    it('no escribe nada cuando el rol no es admin', async () => {
      const { calls } = setup('barber')
      await createWorkstation(input)
      expect(calls.map(c => c.table)).toEqual(['profiles'])
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  })

  describe('validación', () => {
    it.each([
      ['nombre muy corto', { name: 'a', service_ids: [] }],
      ['nombre muy largo', { name: 'x'.repeat(41), service_ids: [] }],
      ['nombre vacío', { name: '   ', service_ids: [] }],
    ])('rechaza %s', async (_label, bad) => {
      const { calls } = setup('admin')
      const result = await createWorkstation(bad)
      expect(result.error).toMatch(/nombre/i)
      expect(calls.map(c => c.table)).toEqual(['profiles'])
    })

    it('rechaza service_ids que no es lista', async () => {
      setup('admin')
      const result = await createWorkstation({ name: 'Lavacabezas', service_ids: 'x' as any })
      expect(result.error).toMatch(/servicios/i)
    })

    it('rechaza un nombre duplicado sin distinguir mayúsculas', async () => {
      const { calls } = setup('admin', {
        workstations: [{ data: [{ id: 'w9', name: 'LAVACABEZAS' }], error: null }],
      })
      const result = await createWorkstation(input)
      expect(result.error).toBe('Ya existe una estación con ese nombre.')
      expect(sequence(calls)).toEqual(['workstations.select'])
    })

    it('permite conservar el propio nombre al editar', async () => {
      const { calls } = setup('admin', {
        workstations: [
          { data: [{ id: 'w1', name: 'Lavacabezas' }], error: null }, // pre-check
          { data: null, error: null },                                // update
        ],
        services: [{ data: [{ id: 's1' }, { id: 's2' }], error: null }],
        service_workstations: [{ data: [], error: null }, { data: null, error: null }],
      })
      expect(await updateWorkstation('w1', input)).toEqual({ success: true })
      expect(calls.some(c => c.table === 'workstations' && c.ops.some(o => o.op === 'update'))).toBe(true)
    })

    it('traduce 23505 al mensaje de nombre duplicado', async () => {
      setup('admin', {
        workstations: [
          { data: [], error: null },
          { data: null, error: { code: '23505', message: 'duplicate key' } },
        ],
        services: [{ data: [{ id: 's1' }, { id: 's2' }], error: null }],
      })
      expect((await createWorkstation(input)).error).toBe('Ya existe una estación con ese nombre.')
    })

    it('rechaza servicios de otro negocio y no escribe', async () => {
      const { calls } = setup('admin', {
        workstations: [{ data: [], error: null }],
        services: [{ data: [{ id: 's1' }], error: null }], // s2 no pertenece
      })
      const result = await createWorkstation(input)
      expect(result.error).toMatch(/servicios elegidos no es válido/i)
      expect(calls.some(c => c.ops.some(o => ['insert', 'update', 'delete'].includes(o.op)))).toBe(false)
      // la validación filtra por el negocio del perfil
      const svc = calls.find(c => c.table === 'services')!
      expect(svc.ops).toContainEqual({ op: 'eq', args: ['business_id', 'biz1'] })
    })
  })

  describe('createWorkstation', () => {
    it('crea la estación y luego sus vínculos, siempre con business_id del perfil', async () => {
      const { calls } = setup('admin', {
        workstations: [
          { data: [], error: null },
          { data: { id: 'w1' }, error: null },
        ],
        services: [{ data: [{ id: 's1' }, { id: 's2' }], error: null }],
        service_workstations: [{ data: [], error: null }, { data: null, error: null }],
      })

      expect(await createWorkstation(input)).toEqual({ success: true })

      expect(sequence(calls)).toEqual([
        'workstations.select',
        'services.select',
        'workstations.insert',
        'service_workstations.select',
        'service_workstations.insert',
      ])
      const ins = calls.find(c => c.table === 'workstations' && c.ops.some(o => o.op === 'insert'))!
      expect(ins.ops.find(o => o.op === 'insert')!.args[0])
        .toEqual({ business_id: 'biz1', name: 'Lavacabezas', is_active: true })
      const links = calls.filter(c => c.table === 'service_workstations').pop()!
      expect(links.ops.find(o => o.op === 'insert')!.args[0]).toEqual([
        { service_id: 's1', workstation_id: 'w1', business_id: 'biz1' },
        { service_id: 's2', workstation_id: 'w1', business_id: 'biz1' },
      ])
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/workstations', 'page')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/services', 'page')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/book', 'page')
    })
  })

  describe('updateWorkstation — reemplazo de vínculos', () => {
    it('inserta los que faltan primero y borra los sobrantes después', async () => {
      const { calls } = setup('admin', {
        workstations: [{ data: [], error: null }, { data: null, error: null }],
        services: [{ data: [{ id: 's1' }, { id: 's2' }], error: null }],
        // actualmente vinculada a s1 y s3 → agregar s2, quitar s3
        service_workstations: [
          { data: [{ service_id: 's1' }, { service_id: 's3' }], error: null },
          { data: null, error: null },
          { data: null, error: null },
        ],
      })

      expect(await updateWorkstation('w1', input)).toEqual({ success: true })

      const seq = sequence(calls).filter(s => s.startsWith('service_workstations'))
      expect(seq).toEqual([
        'service_workstations.select',
        'service_workstations.insert',
        'service_workstations.delete',
      ])
      const sw = calls.filter(c => c.table === 'service_workstations')
      expect(sw[1].ops.find(o => o.op === 'insert')!.args[0]).toEqual([
        { service_id: 's2', workstation_id: 'w1', business_id: 'biz1' },
      ])
      expect(sw[2].ops).toEqual(expect.arrayContaining([
        { op: 'eq', args: ['business_id', 'biz1'] },
        { op: 'eq', args: ['workstation_id', 'w1'] },
        { op: 'eq', args: ['service_id', 's3'] },
      ]))
      // el update de la estación también va acotado al negocio
      const upd = calls.find(c => c.table === 'workstations' && c.ops.some(o => o.op === 'update'))!
      expect(upd.ops).toContainEqual({ op: 'eq', args: ['business_id', 'biz1'] })
      expect(upd.ops).toContainEqual({ op: 'eq', args: ['id', 'w1'] })
    })

    it('sin cambios de vínculos no inserta ni borra', async () => {
      const { calls } = setup('admin', {
        workstations: [{ data: [], error: null }, { data: null, error: null }],
        services: [{ data: [{ id: 's1' }, { id: 's2' }], error: null }],
        service_workstations: [{ data: [{ service_id: 's1' }, { service_id: 's2' }], error: null }],
      })
      expect(await updateWorkstation('w1', input)).toEqual({ success: true })
      const sw = calls.filter(c => c.table === 'service_workstations')
      expect(sw).toHaveLength(1)
    })
  })

  describe('setWorkstationActive', () => {
    it('activa/desactiva acotado al negocio', async () => {
      const { calls } = setup('admin')
      expect(await setWorkstationActive('w1', false)).toEqual({ success: true })
      const upd = calls[1]
      expect(upd.ops.find(o => o.op === 'update')!.args[0]).toEqual({ is_active: false })
      expect(upd.ops).toContainEqual({ op: 'eq', args: ['business_id', 'biz1'] })
      expect(revalidatePath).toHaveBeenCalled()
    })
  })

  describe('deleteWorkstation', () => {
    it('borra primero los vínculos y luego la estación', async () => {
      const { calls } = setup('admin')
      expect(await deleteWorkstation('w1')).toEqual({ success: true })
      expect(sequence(calls)).toEqual(['service_workstations.delete', 'workstations.delete'])
      expect(calls[1].ops).toContainEqual({ op: 'eq', args: ['business_id', 'biz1'] })
      expect(calls[2].ops).toContainEqual({ op: 'eq', args: ['business_id', 'biz1'] })
      expect(calls[2].ops).toContainEqual({ op: 'eq', args: ['id', 'w1'] })
    })

    it('no borra la estación si falló quitar los vínculos', async () => {
      const { calls } = setup('admin', {
        service_workstations: [{ data: null, error: { message: 'boom' } }],
      })
      expect(await deleteWorkstation('w1')).toEqual({ error: 'boom' })
      expect(calls.some(c => c.table === 'workstations')).toBe(false)
    })
  })

  describe('getWorkstationsOverview', () => {
    it('arma service_ids e in_use por estación', async () => {
      setup('admin', {
        workstations: [{ data: [
          { id: 'w1', name: 'Lavacabezas', is_active: true, created_at: 'x' },
          { id: 'w2', name: 'Silla niños', is_active: true, created_at: 'x' },
        ], error: null }],
        service_workstations: [{ data: [
          { service_id: 's1', workstation_id: 'w1' },
          { service_id: 's2', workstation_id: 'w1' },
          { service_id: 's2', workstation_id: 'w2' },
        ], error: null }],
        services: [{ data: [
          { id: 's1', name: 'Lavado', audience: 'all' },
          { id: 's2', name: 'Corte niño', audience: 'kids' },
        ], error: null }],
        businesses: [{ data: { service_audiences: ['men', 'kids'] }, error: null }],
        appointments: [{ data: [
          { id: 'a1', service_id: 's1' },
          { id: 'a2', service_id: 's2' },
          { id: 'a3', service_id: 's2' },
        ], error: null }],
      })

      const result = await getWorkstationsOverview()
      if ('error' in result) throw new Error(result.error)
      expect(result.audiences).toEqual(['men', 'kids'])
      expect(result.services).toHaveLength(2)
      const w1 = result.workstations.find(w => w.id === 'w1')!
      const w2 = result.workstations.find(w => w.id === 'w2')!
      expect(w1.service_ids).toEqual(['s1', 's2'])
      expect(w1.in_use).toBe(3)
      expect(w2.service_ids).toEqual(['s2'])
      expect(w2.in_use).toBe(2)
    })
  })
})
