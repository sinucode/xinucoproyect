import {
  createStaffBreaks,
  createStaffTimeOff,
  deleteStaffBreak,
  deleteStaffTimeOff,
} from '../staff-availability'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

interface Setup {
  role?: string
  businessId?: string | null
  staffFound?: boolean
  user?: { id: string } | null
  writeError?: { message: string } | null
}

/** Builder encadenable y "thenable" (await sobre insert/delete devuelve { error }). */
function makeSupabase({
  role = 'admin',
  businessId = 'biz1',
  staffFound = true,
  user = { id: 'user1' },
  writeError = null,
}: Setup = {}) {
  const calls: Record<string, { insert: any[]; deleteEq: any[][] }> = {}

  const from = jest.fn((table: string) => {
    calls[table] ??= { insert: [], deleteEq: [] }
    const state = { deleting: false }
    const builder: any = {
      select: jest.fn(() => builder),
      eq: jest.fn((...args: any[]) => {
        if (state.deleting) calls[table].deleteEq.push(args)
        return builder
      }),
      insert: jest.fn((rows: any) => {
        calls[table].insert.push(rows)
        return builder
      }),
      delete: jest.fn(() => {
        state.deleting = true
        return builder
      }),
      single: jest.fn(async () =>
        table === 'profiles'
          ? { data: role ? { role, business_id: businessId } : null, error: null }
          : { data: null, error: null },
      ),
      maybeSingle: jest.fn(async () => ({ data: staffFound ? { id: 'staff1' } : null, error: null })),
      then: (resolve: any) => resolve({ error: writeError }),
    }
    return builder
  })

  const supabase = {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from,
  }
  return { supabase, calls, from }
}

describe('staff-availability Server Actions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const use = (setup?: Setup) => {
    const m = makeSupabase(setup)
    ;(createClient as jest.Mock).mockResolvedValue(m.supabase)
    return m
  }

  describe('createStaffBreaks', () => {
    const valid = { staffId: 'staff1', days: [1, 2, 3], startTime: '12:00', endTime: '13:00', label: 'Almuerzo' }

    it('rechaza sin sesión', async () => {
      const { calls } = use({ user: null })
      const r = await createStaffBreaks(valid)
      expect(r).toHaveProperty('error')
      expect(calls.staff_breaks).toBeUndefined()
    })

    it('rechaza a un usuario que no es admin', async () => {
      const { calls } = use({ role: 'barber' })
      const r = await createStaffBreaks(valid)
      expect(r).toHaveProperty('error')
      expect(calls.staff_breaks).toBeUndefined()
    })

    it('rechaza staff de otro negocio (anti-IDOR)', async () => {
      const { calls } = use({ staffFound: false })
      const r = await createStaffBreaks(valid)
      expect(r).toEqual({ error: 'Miembro del equipo no encontrado.' })
      expect(calls.staff_breaks).toBeUndefined()
    })

    it('rechaza rango inválido (fin <= inicio)', async () => {
      const { calls } = use()
      const r = await createStaffBreaks({ ...valid, startTime: '13:00', endTime: '12:00' })
      expect(r).toHaveProperty('error')
      expect(calls.staff_breaks).toBeUndefined()
    })

    it('rechaza formato de hora inválido y días fuera de rango', async () => {
      use()
      expect(await createStaffBreaks({ ...valid, startTime: '25:00' })).toHaveProperty('error')
      expect(await createStaffBreaks({ ...valid, days: [7] })).toHaveProperty('error')
      expect(await createStaffBreaks({ ...valid, days: [] })).toHaveProperty('error')
    })

    it('inserta una fila por día con el business_id del servidor', async () => {
      const { calls } = use({ businessId: 'biz-server' })
      const r = await createStaffBreaks({ ...valid, days: [1, 2, 2, 3] })
      expect(r).toEqual({ success: true })
      expect(calls.staff_breaks.insert).toHaveLength(1)
      const rows = calls.staff_breaks.insert[0]
      expect(rows).toHaveLength(3)
      expect(rows.map((x: any) => x.day_of_week)).toEqual([1, 2, 3])
      for (const row of rows) {
        expect(row).toMatchObject({
          business_id: 'biz-server',
          staff_id: 'staff1',
          start_time: '12:00:00',
          end_time: '13:00:00',
          label: 'Almuerzo',
        })
      }
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/appointments', 'page')
    })

    it('usa "Almuerzo" si la etiqueta viene vacía', async () => {
      const { calls } = use()
      await createStaffBreaks({ ...valid, label: '  ' })
      expect(calls.staff_breaks.insert[0][0].label).toBe('Almuerzo')
    })
  })

  describe('createStaffTimeOff', () => {
    const valid = {
      staffId: 'staff1',
      date: '2026-09-30',
      startTime: '10:00',
      endTime: '12:30',
      kind: 'permission',
      reason: 'Trámite',
    }

    it('rechaza a un usuario que no es admin', async () => {
      const { calls } = use({ role: 'manicurist' })
      const r = await createStaffTimeOff(valid)
      expect(r).toHaveProperty('error')
      expect(calls.staff_time_off).toBeUndefined()
    })

    it('rechaza staff de otro negocio', async () => {
      const { calls } = use({ staffFound: false })
      const r = await createStaffTimeOff(valid)
      expect(r).toHaveProperty('error')
      expect(calls.staff_time_off).toBeUndefined()
    })

    it('rechaza rango, fecha, tipo y motivo inválidos', async () => {
      const { calls } = use()
      expect(await createStaffTimeOff({ ...valid, startTime: '12:30', endTime: '10:00' })).toHaveProperty('error')
      expect(await createStaffTimeOff({ ...valid, date: '2026-02-31' })).toHaveProperty('error')
      expect(await createStaffTimeOff({ ...valid, kind: 'party' })).toHaveProperty('error')
      expect(await createStaffTimeOff({ ...valid, reason: 'x'.repeat(201) })).toHaveProperty('error')
      expect(calls.staff_time_off).toBeUndefined()
    })

    it('inserta con business_id del servidor y hora local guardada como UTC', async () => {
      const { calls } = use({ businessId: 'biz-server' })
      const r = await createStaffTimeOff(valid)
      expect(r).toEqual({ success: true })
      expect(calls.staff_time_off.insert[0]).toEqual({
        business_id: 'biz-server',
        staff_id: 'staff1',
        starts_at: '2026-09-30T10:00:00Z',
        ends_at: '2026-09-30T12:30:00Z',
        kind: 'permission',
        reason: 'Trámite',
        created_by: 'user1',
      })
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/appointments', 'page')
    })

    it('guarda reason null cuando está vacío', async () => {
      const { calls } = use()
      await createStaffTimeOff({ ...valid, reason: '' })
      expect(calls.staff_time_off.insert[0].reason).toBeNull()
    })
  })

  describe('deleteStaffBreak / deleteStaffTimeOff', () => {
    it('rechazan a un no admin', async () => {
      const { calls } = use({ role: 'barber' })
      expect(await deleteStaffBreak('b1')).toHaveProperty('error')
      expect(await deleteStaffTimeOff('t1')).toHaveProperty('error')
      expect(calls.staff_breaks).toBeUndefined()
      expect(calls.staff_time_off).toBeUndefined()
    })

    it('borran acotando por business_id del servidor', async () => {
      const { calls } = use({ businessId: 'biz-server' })
      expect(await deleteStaffBreak('b1')).toEqual({ success: true })
      expect(calls.staff_breaks.deleteEq).toEqual([['id', 'b1'], ['business_id', 'biz-server']])
      expect(await deleteStaffTimeOff('t1')).toEqual({ success: true })
      expect(calls.staff_time_off.deleteEq).toEqual([['id', 't1'], ['business_id', 'biz-server']])
    })

    it('propaga errores de la BD', async () => {
      use({ writeError: { message: 'boom' } })
      expect(await deleteStaffBreak('b1')).toEqual({ error: 'boom' })
    })
  })
})
