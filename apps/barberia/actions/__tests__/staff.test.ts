import {
  createStaffMember,
  updateStaffMember,
  toggleStaffStatus,
  saveStaffSchedulesBatch,
  saveStaffSchedulesForMany,
} from '../staff'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAction } from '../audit'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

jest.mock('../audit', () => ({
  logAction: jest.fn(),
}))

interface Op {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  payload?: any
  filters: [string, ...any[]][]
}

type Result = { data?: any; error?: any }
type Handler = Result | Result[] | ((op: Op) => Result)

interface Setup {
  role?: string | null
  businessId?: string | null
  user?: { id: string } | null
  /** Resultados por `${tabla}.${operación}`. Un arreglo se consume en orden (el último se repite). */
  handlers?: Record<string, Handler>
}

/** Builder encadenable y "thenable" que registra cada operación. */
function makeSupabase({ role = 'admin', businessId = 'biz1', user = { id: 'user1' }, handlers = {} }: Setup = {}) {
  const ops: Op[] = []
  const counters: Record<string, number> = {}

  const resolve = (op: Op): Result => {
    ops.push(op)
    const key = `${op.table}.${op.op}`
    if (op.table === 'profiles') {
      return { data: role ? { role, business_id: businessId, full_name: 'Admin' } : null, error: null }
    }
    const h = handlers[key]
    if (!h) return { data: op.op === 'select' ? [] : null, error: null }
    if (typeof h === 'function') return h(op)
    if (Array.isArray(h)) {
      const i = Math.min(counters[key] ?? 0, h.length - 1)
      counters[key] = (counters[key] ?? 0) + 1
      return h[i]
    }
    return h
  }

  const from = jest.fn((table: string) => {
    const state: Op = { table, op: 'select', filters: [] }
    const builder: any = {
      select: jest.fn(() => builder),
      insert: jest.fn((payload: any) => { state.op = 'insert'; state.payload = payload; return builder }),
      update: jest.fn((payload: any) => { state.op = 'update'; state.payload = payload; return builder }),
      delete: jest.fn(() => { state.op = 'delete'; return builder }),
      eq: jest.fn((...args: any[]) => { state.filters.push(['eq', ...args]); return builder }),
      in: jest.fn((...args: any[]) => { state.filters.push(['in', ...args]); return builder }),
      single: jest.fn(async () => resolve({ ...state })),
      maybeSingle: jest.fn(async () => resolve({ ...state })),
      then: (ok: any, fail: any) => Promise.resolve(resolve({ ...state })).then(ok, fail),
    }
    return builder
  })

  const supabase = {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from,
  }
  return { supabase, ops }
}

const find = (ops: Op[], table: string, op: Op['op']) => ops.filter(o => o.table === table && o.op === op)
const hasFilter = (o: Op, col: string, val: any) => o.filters.some(f => f[0] === 'eq' && f[1] === col && f[2] === val)

describe('Staff Server Actions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const use = (setup?: Setup) => {
    const m = makeSupabase(setup)
    ;(createClient as jest.Mock).mockResolvedValue(m.supabase)
    return m
  }

  const STAFF_ROW = { id: 'staff1', full_name: 'John', specialty_role: 'Barbero', is_active: true }

  describe('createStaffMember', () => {
    it('rechaza a quien no es administrador', async () => {
      const { ops } = use({ role: 'barber' })
      const result = await createStaffMember('biz1', { full_name: 'John Doe', specialty_role: 'Barbero' })
      expect(result.error).toBe('Solo un administrador puede gestionar el equipo.')
      expect(find(ops, 'staff', 'insert')).toHaveLength(0)
    })

    it('rechaza si no hay sesión', async () => {
      use({ user: null })
      const result = await createStaffMember('biz1', { full_name: 'John Doe', specialty_role: 'Barbero' })
      expect(result.error).toBe('Solo un administrador puede gestionar el equipo.')
    })

    it('rechaza si el businessId no coincide con el del perfil', async () => {
      const { ops } = use()
      const result = await createStaffMember('otro-negocio', { full_name: 'John Doe', specialty_role: 'Barbero' })
      expect(result.error).toBe('Autorización denegada.')
      expect(find(ops, 'staff', 'insert')).toHaveLength(0)
    })

    it('valida nombre y cargo', async () => {
      use()
      expect((await createStaffMember('biz1', { full_name: 'J', specialty_role: 'Barbero' })).error)
        .toBe('El nombre debe tener entre 2 y 80 caracteres.')
      expect((await createStaffMember('biz1', { full_name: 'John Doe', specialty_role: ' x ' })).error)
        .toBe('El cargo debe tener entre 2 y 40 caracteres.')
    })

    it('maneja el error de unicidad', async () => {
      use({ handlers: { 'staff.insert': { data: null, error: { code: '23505', message: 'duplicate key value' } } } })
      const result = await createStaffMember('biz1', { full_name: 'John Doe', specialty_role: 'Barbero' })
      expect(result.error).toContain('Ya existe un miembro del equipo')
    })

    it('crea con el business_id del perfil, sin servicios (hace todo) y registra auditoría', async () => {
      const created = { id: 'staff1', full_name: 'John Doe' }
      const { ops } = use({ handlers: { 'staff.insert': { data: created, error: null } } })

      const result = await createStaffMember('biz1', { full_name: '  John Doe ', specialty_role: ' Barbero ', service_ids: 'all' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual(created)
      expect(find(ops, 'staff', 'insert')[0].payload).toEqual({
        business_id: 'biz1',
        full_name: 'John Doe',
        specialty_role: 'Barbero',
        is_active: true,
      })
      expect(find(ops, 'staff_services', 'insert')).toHaveLength(0)
      expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff.created', businessId: 'biz1' }))
      expect(revalidatePath).toHaveBeenCalled()
    })

    it('inserta staff_services cuando se eligen servicios', async () => {
      const { ops } = use({
        handlers: {
          'services.select': { data: [{ id: 's1' }, { id: 's2' }], error: null },
          'staff.insert': { data: { id: 'staff1' }, error: null },
        },
      })
      const result = await createStaffMember('biz1', {
        full_name: 'John Doe', specialty_role: 'Barbero', service_ids: ['s1', 's2', 's1'],
      })
      expect(result.success).toBe(true)
      expect(find(ops, 'staff_services', 'insert')[0].payload).toEqual([
        { business_id: 'biz1', staff_id: 'staff1', service_id: 's1' },
        { business_id: 'biz1', staff_id: 'staff1', service_id: 's2' },
      ])
    })

    it('rechaza servicios que no son del negocio', async () => {
      const { ops } = use({ handlers: { 'services.select': { data: [{ id: 's1' }], error: null } } })
      const result = await createStaffMember('biz1', {
        full_name: 'John Doe', specialty_role: 'Barbero', service_ids: ['s1', 'ajeno'],
      })
      expect(result.error).toBe('Algún servicio elegido no es válido.')
      expect(find(ops, 'staff', 'insert')).toHaveLength(0)
    })
    describe('con horario', () => {
      const schedules = [
        { day_of_week: 1, start_time: '09:00', end_time: '19:00' },
        { day_of_week: 2, start_time: '09:00', end_time: '19:00' },
      ]
      const base = { full_name: 'John Doe', specialty_role: 'Barbero' }

      it('inserta el horario con business_id y staff_id del servidor', async () => {
        const { ops } = use({ handlers: { 'staff.insert': { data: { id: 'staff1' }, error: null } } })
        const result = await createStaffMember('biz1', {
          ...base,
          schedules: [{ ...schedules[0], business_id: 'hack', staff_id: 'hack' } as any, schedules[1]],
        })
        expect(result.success).toBe(true)
        expect(find(ops, 'staff_schedules', 'insert')[0].payload).toEqual([
          { business_id: 'biz1', staff_id: 'staff1', day_of_week: 1, start_time: '09:00', end_time: '19:00' },
          { business_id: 'biz1', staff_id: 'staff1', day_of_week: 2, start_time: '09:00', end_time: '19:00' },
        ])
      })

      it('sin horario (omitido o vacío) no inserta filas', async () => {
        const { ops } = use({ handlers: { 'staff.insert': { data: { id: 'staff1' }, error: null } } })
        expect((await createStaffMember('biz1', base)).success).toBe(true)
        expect((await createStaffMember('biz1', { ...base, schedules: [] })).success).toBe(true)
        expect(find(ops, 'staff_schedules', 'insert')).toHaveLength(0)
      })

      it('si el horario es inválido no crea nada', async () => {
        const { ops } = use({ handlers: { 'staff.insert': { data: { id: 'staff1' }, error: null } } })
        const result = await createStaffMember('biz1', {
          ...base,
          schedules: [{ day_of_week: 1, start_time: '19:00', end_time: '09:00' }],
        })
        expect(result.error).toBe('Lunes: la hora de salida debe ser posterior a la de entrada.')
        expect(find(ops, 'staff', 'insert')).toHaveLength(0)
        expect(find(ops, 'staff_schedules', 'insert')).toHaveLength(0)
      })

      it('si falla el insert del horario borra el profesional creado', async () => {
        const { ops } = use({
          handlers: {
            'staff.insert': { data: { id: 'staff1' }, error: null },
            'staff_schedules.insert': { error: { message: 'boom' } },
          },
        })
        const result = await createStaffMember('biz1', { ...base, schedules })
        expect(result.error).toBe('No se pudo guardar el horario: boom')
        expect(result.success).toBeUndefined()
        const del = find(ops, 'staff', 'delete')
        expect(del).toHaveLength(1)
        expect(hasFilter(del[0], 'id', 'staff1') && hasFilter(del[0], 'business_id', 'biz1')).toBe(true)
        expect(logAction).not.toHaveBeenCalled()
      })
    })
  })

  describe('updateStaffMember', () => {
    const data = { full_name: 'John Nuevo', specialty_role: 'Estilista' }

    it('rechaza a quien no es administrador', async () => {
      const { ops } = use({ role: 'barber' })
      const result = await updateStaffMember('staff1', { ...data, service_ids: 'all' })
      expect(result.error).toBe('Solo un administrador puede gestionar el equipo.')
      expect(find(ops, 'staff', 'update')).toHaveLength(0)
    })

    it('rechaza staff de otro negocio (no aparece bajo el business_id del perfil)', async () => {
      const { ops } = use({ handlers: { 'staff.select': { data: null, error: null } } })
      const result = await updateStaffMember('staff-ajeno', { ...data, service_ids: 'all' })
      expect(result.error).toBe('Miembro del equipo no encontrado.')
      expect(find(ops, 'staff', 'update')).toHaveLength(0)
      expect(hasFilter(find(ops, 'staff', 'select')[0], 'business_id', 'biz1')).toBe(true)
    })

    it("'all' borra las filas de staff_services del profesional", async () => {
      const { ops } = use({ handlers: { 'staff.select': { data: STAFF_ROW, error: null } } })
      const result = await updateStaffMember('staff1', { ...data, service_ids: 'all' })

      expect(result.success).toBe(true)
      const upd = find(ops, 'staff', 'update')[0]
      expect(upd.payload).toEqual({ full_name: 'John Nuevo', specialty_role: 'Estilista' })
      expect(hasFilter(upd, 'id', 'staff1') && hasFilter(upd, 'business_id', 'biz1')).toBe(true)

      const del = find(ops, 'staff_services', 'delete')
      expect(del).toHaveLength(1)
      expect(hasFilter(del[0], 'staff_id', 'staff1')).toBe(true)
      expect(hasFilter(del[0], 'business_id', 'biz1')).toBe(true)
      expect(find(ops, 'staff_services', 'insert')).toHaveLength(0)

      expect(logAction).toHaveBeenCalledWith(expect.objectContaining({
        action: 'staff.updated',
        oldValue: { full_name: 'John', specialty_role: 'Barbero' },
        newValue: { full_name: 'John Nuevo', specialty_role: 'Estilista' },
      }))
    })

    it('exige al menos un servicio cuando no es "all"', async () => {
      const { ops } = use({ handlers: { 'staff.select': { data: STAFF_ROW, error: null } } })
      const result = await updateStaffMember('staff1', { ...data, service_ids: [] })
      expect(result.error).toBe('Elige al menos un servicio o "Todos los servicios".')
      expect(find(ops, 'staff', 'update')).toHaveLength(0)
    })

    it('rechaza servicios ajenos antes de escribir', async () => {
      const { ops } = use({
        handlers: {
          'staff.select': { data: STAFF_ROW, error: null },
          'services.select': { data: [{ id: 's1' }], error: null },
        },
      })
      const result = await updateStaffMember('staff1', { ...data, service_ids: ['s1', 'ajeno'] })
      expect(result.error).toBe('Algún servicio elegido no es válido.')
      expect(find(ops, 'staff', 'update')).toHaveLength(0)
    })

    it('con lista: inserta los que faltan primero y luego borra los sobrantes', async () => {
      const { ops } = use({
        handlers: {
          'staff.select': { data: STAFF_ROW, error: null },
          'services.select': { data: [{ id: 's2' }, { id: 's3' }], error: null },
          'staff_services.select': { data: [{ service_id: 's1' }, { service_id: 's2' }], error: null },
        },
      })
      const result = await updateStaffMember('staff1', { ...data, service_ids: ['s2', 's3'] })
      expect(result.success).toBe(true)

      const ssOps = ops.filter(o => o.table === 'staff_services' && o.op !== 'select')
      expect(ssOps.map(o => o.op)).toEqual(['insert', 'delete'])
      expect(ssOps[0].payload).toEqual([{ business_id: 'biz1', staff_id: 'staff1', service_id: 's3' }])
      expect(ssOps[1].filters).toContainEqual(['in', 'service_id', ['s1']])
    })

    it('valida nombre y cargo', async () => {
      use({ handlers: { 'staff.select': { data: STAFF_ROW, error: null } } })
      expect((await updateStaffMember('staff1', { full_name: 'J', specialty_role: 'Barbero', service_ids: 'all' })).error)
        .toBe('El nombre debe tener entre 2 y 80 caracteres.')
    })
  })

  describe('toggleStaffStatus', () => {
    it('rechaza a quien no es administrador', async () => {
      const { ops } = use({ role: 'barber' })
      const result = await toggleStaffStatus('staff1', false)
      expect(result.error).toBe('Solo un administrador puede gestionar el equipo.')
      expect(find(ops, 'staff', 'update')).toHaveLength(0)
    })

    it('desactiva filtrando por id y business_id, y audita', async () => {
      const { ops } = use({ handlers: { 'staff.select': { data: STAFF_ROW, error: null } } })
      const result = await toggleStaffStatus('staff1', false)

      expect(result.success).toBe(true)
      const upd = find(ops, 'staff', 'update')[0]
      expect(upd.payload).toEqual({ is_active: false })
      expect(hasFilter(upd, 'id', 'staff1')).toBe(true)
      expect(hasFilter(upd, 'business_id', 'biz1')).toBe(true)
      expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff.deactivated' }))
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/walk-ins', 'page')
    })

    it('no toca staff de otro negocio', async () => {
      const { ops } = use({ handlers: { 'staff.select': { data: null, error: null } } })
      const result = await toggleStaffStatus('staff-ajeno', false)
      expect(result.error).toBe('Miembro del equipo no encontrado.')
      expect(find(ops, 'staff', 'update')).toHaveLength(0)
    })
  })

  describe('saveStaffSchedulesBatch', () => {
    const schedule = [
      { day_of_week: 1, start_time: '09:00', end_time: '18:00' },
      { day_of_week: 2, start_time: '09:00', end_time: '18:00' },
    ]

    it('rechaza a quien no es administrador', async () => {
      const { ops } = use({ role: 'barber' })
      const result = await saveStaffSchedulesBatch('biz1', 'staff1', schedule)
      expect(result.error).toBe('Solo un administrador puede gestionar el equipo.')
      expect(find(ops, 'staff_schedules', 'delete')).toHaveLength(0)
    })

    it('rechaza si el businessId no coincide con el del perfil', async () => {
      const { ops } = use()
      const result = await saveStaffSchedulesBatch('otro-negocio', 'staff1', schedule)
      expect(result.error).toBe('Autorización denegada.')
      expect(find(ops, 'staff_schedules', 'delete')).toHaveLength(0)
    })

    it('rechaza staff de otro negocio', async () => {
      const { ops } = use({ handlers: { 'staff.select': { data: null, error: null } } })
      const result = await saveStaffSchedulesBatch('biz1', 'staff-ajeno', schedule)
      expect(result.error).toBe('Miembro del equipo no encontrado.')
      expect(find(ops, 'staff_schedules', 'delete')).toHaveLength(0)
    })

    it('devuelve el error de validación sin escribir nada', async () => {
      const { ops } = use({ handlers: { 'staff.select': { data: STAFF_ROW, error: null } } })
      const result = await saveStaffSchedulesBatch('biz1', 'staff1', [
        { day_of_week: 1, start_time: '18:00', end_time: '09:00' },
      ])
      expect(result.error).toBe('Lunes: la hora de salida debe ser posterior a la de entrada.')
      expect(find(ops, 'staff_schedules', 'delete')).toHaveLength(0)
      expect(find(ops, 'staff_schedules', 'insert')).toHaveLength(0)
    })

    it('reemplaza el horario forzando business_id y staff_id del servidor', async () => {
      const { ops } = use({ handlers: { 'staff.select': { data: STAFF_ROW, error: null } } })
      const result = await saveStaffSchedulesBatch('biz1', 'staff1', [
        { day_of_week: 1, start_time: '09:00', end_time: '18:00', business_id: 'hack', staff_id: 'hack' } as any,
      ])
      expect(result.success).toBe(true)
      expect(find(ops, 'staff_schedules', 'insert')[0].payload).toEqual([
        { business_id: 'biz1', staff_id: 'staff1', day_of_week: 1, start_time: '09:00', end_time: '18:00' },
      ])
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/book', 'page')
    })

    it('restaura el horario anterior si el insert falla', async () => {
      const snapshot = [{ day_of_week: 3, start_time: '10:00:00', end_time: '17:00:00' }]
      const { ops } = use({
        handlers: {
          'staff.select': { data: STAFF_ROW, error: null },
          'staff_schedules.select': { data: snapshot, error: null },
          'staff_schedules.insert': [{ error: { message: 'boom' } }, { error: null }],
        },
      })

      const result = await saveStaffSchedulesBatch('biz1', 'staff1', schedule)

      expect(result.error).toBe('No se pudo guardar el horario; se mantuvo el anterior.')
      const inserts = find(ops, 'staff_schedules', 'insert')
      expect(inserts).toHaveLength(2)
      expect(inserts[1].payload).toEqual([
        { day_of_week: 3, start_time: '10:00:00', end_time: '17:00:00', business_id: 'biz1', staff_id: 'staff1' },
      ])
    })
  })

  describe('saveStaffSchedulesForMany', () => {
    const schedule = [
      { day_of_week: 1, start_time: '09:00', end_time: '19:00' },
      { day_of_week: 2, start_time: '09:00', end_time: '19:00' },
    ]

    it('rechaza a quien no es administrador', async () => {
      const { ops } = use({ role: 'barber' })
      const result = await saveStaffSchedulesForMany('biz1', ['a', 'b'], schedule)
      expect(result.error).toBe('Solo un administrador puede gestionar el equipo.')
      expect(result.saved).toBe(0)
      expect(find(ops, 'staff_schedules', 'delete')).toHaveLength(0)
    })

    it('rechaza si el businessId no coincide con el del perfil', async () => {
      const { ops } = use()
      const result = await saveStaffSchedulesForMany('otro-negocio', ['a'], schedule)
      expect(result.error).toBe('Autorización denegada.')
      expect(find(ops, 'staff_schedules', 'delete')).toHaveLength(0)
    })

    it('rechaza una lista vacía', async () => {
      use()
      const result = await saveStaffSchedulesForMany('biz1', [], schedule)
      expect(result.error).toBe('Elige al menos un profesional.')
    })

    it('rechaza un horario inválido sin escribir nada', async () => {
      const { ops } = use({ handlers: { 'staff.select': { data: STAFF_ROW, error: null } } })
      const result = await saveStaffSchedulesForMany('biz1', ['a', 'b'], [
        { day_of_week: 1, start_time: '18:00', end_time: '09:00' },
      ])
      expect(result.error).toBe('Lunes: la hora de salida debe ser posterior a la de entrada.')
      expect(result.saved).toBe(0)
      expect(find(ops, 'staff_schedules', 'delete')).toHaveLength(0)
      expect(find(ops, 'staff_schedules', 'insert')).toHaveLength(0)
    })

    it('guarda el horario de cada profesional (sin duplicados) con ids del servidor', async () => {
      const { ops } = use({ handlers: { 'staff.select': { data: STAFF_ROW, error: null } } })
      const result = await saveStaffSchedulesForMany('biz1', ['a', 'b', 'a'], schedule)

      expect(result).toEqual({ success: true, saved: 2, failed: [] })
      const inserts = find(ops, 'staff_schedules', 'insert')
      expect(inserts).toHaveLength(2)
      expect(inserts.map(o => o.payload[0].staff_id)).toEqual(['a', 'b'])
      expect(inserts.every(o => o.payload.every((r: any) => r.business_id === 'biz1'))).toBe(true)
      expect(find(ops, 'staff_schedules', 'delete')).toHaveLength(2)
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/book', 'page')
    })

    it('reporta a quien no es del negocio o falla, y sigue con los demás', async () => {
      const { ops } = use({
        handlers: {
          // 'a' no es del negocio; 'b' y 'c' sí
          'staff.select': (op) => {
            const id = op.filters.find(f => f[1] === 'id')?.[2]
            return { data: id === 'a' ? null : { ...STAFF_ROW, id, full_name: `Nombre ${id}` }, error: null }
          },
          // el insert de 'b' falla (y se restaura), el de 'c' funciona
          'staff_schedules.insert': (op) =>
            Array.isArray(op.payload) && op.payload[0]?.staff_id === 'b' && op.payload.length === schedule.length
              ? { error: { message: 'boom' } }
              : { error: null },
        },
      })
      const result = await saveStaffSchedulesForMany('biz1', ['a', 'b', 'c'], schedule)

      expect(result.success).toBe(false)
      expect(result.saved).toBe(1)
      expect(result.failed).toEqual(['a', 'Nombre b'])
      expect(find(ops, 'staff_schedules', 'delete').every(o => !hasFilter(o, 'staff_id', 'a'))).toBe(true)
    })
  })
})
