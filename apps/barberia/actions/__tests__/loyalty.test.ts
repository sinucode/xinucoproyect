import {
  getLoyaltySettings,
  updateLoyaltySettings,
  getLoyaltyOverview,
  findCustomerLoyalty,
  getCustomerLoyalty,
  adjustCustomerLoyalty,
  applyPendingLoyalty,
} from '../loyalty'
import { POINT_VALUE_TOO_HIGH } from '@/lib/loyalty-utils'
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
 * para esa tabla. El builder es encadenable y "thenable".
 */
function makeSupabase(
  role: string | null,
  queues: Record<string, Result[]> = {},
  rpcImpl?: (fn: string, args: any) => Result,
) {
  const calls: { table: string; ops: { op: string; args: any[] }[] }[] = []

  const from = jest.fn((table: string) => {
    const call = { table, ops: [] as { op: string; args: any[] }[] }
    calls.push(call)
    // El perfil responde siempre lo mismo (varias acciones lo leen en la misma prueba)
    const result: Result = table === 'profiles' && role !== null
      ? { data: { role, business_id: 'biz1' }, error: null }
      : queues[table]?.length ? queues[table].shift()! : { data: [], error: null }
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
    rpc: jest.fn((fn: string, args: any) => Promise.resolve(rpcImpl ? rpcImpl(fn, args) : { data: null, error: null })),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: role === null ? null : { id: 'u1' } } }) },
  }
  return { supabase, calls }
}

function setup(role: string | null, queues: Record<string, Result[]> = {}, rpcImpl?: (fn: string, args: any) => Result) {
  const m = makeSupabase(role, queues, rpcImpl)
  ;(createClient as jest.Mock).mockResolvedValue(m.supabase)
  return m
}

const opOf = (calls: ReturnType<typeof makeSupabase>['calls'], table: string, op: string, nth = 0) =>
  calls.filter(c => c.table === table).flatMap(c => c.ops).filter(o => o.op === op)[nth]

const validConfig = {
  loyalty_mode: 'points' as const,
  loyalty_earn_per_cop: 1000,
  loyalty_point_value_cop: 50,
  loyalty_min_redeem_points: 0,
  loyalty_expiry_months: 12,
  loyalty_stamps_required: 10,
  loyalty_stamp_max_reward_cop: 0,
}

const bizRow = { features_enabled: { loyalty: true }, ...validConfig }

const NOT_ADMIN = 'Solo un administrador puede gestionar la lealtad.'

describe('Loyalty Server Actions', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('permisos', () => {
    it.each(['barber', 'manicurist', 'cashier'])('el rol %s no puede administrar', async (role) => {
      const m = setup(role)
      expect(await updateLoyaltySettings(validConfig)).toEqual({ error: NOT_ADMIN })
      expect(await getLoyaltySettings()).toEqual({ error: NOT_ADMIN })
      expect(await getLoyaltyOverview()).toEqual({ error: NOT_ADMIN })
      expect(await adjustCustomerLoyalty('c1', 10, 'Cortesía')).toEqual({ error: NOT_ADMIN })
      expect(await applyPendingLoyalty()).toEqual({ error: NOT_ADMIN })
      // Nada tocó el negocio ni los RPC
      expect(m.calls.filter(c => c.table === 'businesses')).toHaveLength(0)
      expect(m.supabase.rpc).not.toHaveBeenCalled()
    })

    it('sin sesión se rechaza', async () => {
      setup(null)
      expect(await updateLoyaltySettings(validConfig)).toEqual({ error: NOT_ADMIN })
      expect((await findCustomerLoyalty('juan')).error).toBeDefined()
      expect((await getCustomerLoyalty('c1')).error).toBeDefined()
    })

    it('un miembro no admin sí puede consultar el saldo de un cliente', async () => {
      setup('barber', {}, () => ({
        data: {
          enabled: true, mode: 'points', balance: 1240, expiring_30d: 0, point_value_cop: 50, value_cop: 62000,
          min_redeem: 0, stamps_required: 10, stamp_max_reward_cop: 0, can_redeem: true,
        },
        error: null,
      }))
      const res = await getCustomerLoyalty('c1')
      expect(res.loyalty).toMatchObject({ mode: 'points', balance: 1240, value_cop: 62000, can_redeem: true })
    })

    it('un miembro no admin puede buscar clientes', async () => {
      setup('cashier', { customers: [{ data: [{ id: 'c1', full_name: 'Juan', phone: '300' }], error: null }] }, () => ({
        data: { enabled: true, mode: 'stamps', balance: 7, stamps_required: 10, can_redeem: false },
        error: null,
      }))
      const res = await findCustomerLoyalty('Juan')
      expect(res.results).toHaveLength(1)
      expect(res.results[0].loyalty).toMatchObject({ mode: 'stamps', balance: 7 })
    })
  })

  describe('updateLoyaltySettings', () => {
    it('guarda con el business_id del perfil y devuelve la configuración', async () => {
      const m = setup('admin', { businesses: [{ data: { ...bizRow, loyalty_earn_per_cop: 2000 }, error: null }] })
      const res = await updateLoyaltySettings({ ...validConfig, loyalty_earn_per_cop: 2000 })
      expect(res.success).toBe(true)
      expect(res.settings).toMatchObject({ enabled: true, loyalty_earn_per_cop: 2000 })
      expect(opOf(m.calls, 'businesses', 'update')?.args[0]).toEqual({ ...validConfig, loyalty_earn_per_cop: 2000 })
      expect(opOf(m.calls, 'businesses', 'eq')?.args).toEqual(['id', 'biz1'])
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/loyalty', 'page')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/settings/loyalty', 'page')
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard', 'layout')
    })

    it('ignora un business_id o campos extra que mande el cliente', async () => {
      const m = setup('admin', { businesses: [{ data: bizRow, error: null }] })
      await updateLoyaltySettings({ ...validConfig, business_id: 'otro', slug: 'x', features_enabled: {} } as any)
      const payload = opOf(m.calls, 'businesses', 'update')?.args[0]
      expect(payload).toEqual(validConfig)
      expect(opOf(m.calls, 'businesses', 'eq')?.args).toEqual(['id', 'biz1'])
    })

    it('regla del 100%: el punto debe valer menos de lo que se gasta para ganarlo', async () => {
      const m = setup('admin')
      expect(await updateLoyaltySettings({ ...validConfig, loyalty_point_value_cop: 1000 })).toEqual({ error: POINT_VALUE_TOO_HIGH })
      expect(await updateLoyaltySettings({ ...validConfig, loyalty_point_value_cop: 2000 })).toEqual({ error: POINT_VALUE_TOO_HIGH })
      expect(m.calls.filter(c => c.table === 'businesses')).toHaveLength(0)
    })

    it.each([
      { loyalty_earn_per_cop: 99 },
      { loyalty_earn_per_cop: 1_000_001 },
      { loyalty_expiry_months: 0 },
      { loyalty_expiry_months: 61 },
      { loyalty_min_redeem_points: -1 },
      { loyalty_stamps_required: 1 },
      { loyalty_stamps_required: 51 },
      { loyalty_stamp_max_reward_cop: -5 },
      { loyalty_mode: 'oro' },
    ])('rechaza %j', async (patch) => {
      const m = setup('admin')
      const res = await updateLoyaltySettings({ ...validConfig, ...patch } as any)
      expect(res.error).toBeDefined()
      expect(m.calls.filter(c => c.table === 'businesses')).toHaveLength(0)
    })

    it('si la BD falla devuelve un error en español', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
      setup('admin', { businesses: [{ data: null, error: { message: 'boom' } }] })
      const res = await updateLoyaltySettings(validConfig)
      expect(res.error).toBe('No se pudo guardar la configuración de lealtad.')
      spy.mockRestore()
    })
  })

  describe('getLoyaltyOverview', () => {
    it('arma configuración, resumen y movimientos del modo activo', async () => {
      const m = setup(
        'admin',
        {
          businesses: [{ data: { ...bizRow, loyalty_mode: 'stamps' }, error: null }],
          loyalty_ledgers: [{
            data: [
              { id: 'l1', entry_type: 'earn', points_added: 1, points_redeemed: 0, discount_cop: null, notes: 'Visita', sale_id: 's1', created_at: '2026-09-01T10:00:00Z', customer: { id: 'c1', full_name: 'Juan', phone: '300' } },
              { id: 'l2', entry_type: 'redeem', points_added: 0, points_redeemed: 10, discount_cop: 25000, notes: null, sale_id: 's2', created_at: '2026-09-02T10:00:00Z', customer: [{ id: 'c1', full_name: 'Juan', phone: '300' }] },
              { id: 'l3', entry_type: 'adjust', points_added: 0, points_redeemed: 2, discount_cop: null, notes: 'Error', sale_id: null, created_at: '2026-09-03T10:00:00Z', customer: null },
            ],
            error: null,
          }],
        },
        (fn) => fn === 'get_loyalty_summary'
          ? { data: { mode: 'stamps', customers_with_balance: 4, total_balance: 22, customers_ready: 1, redeemed_total: 10, discount_given_cop: 25000 }, error: null }
          : { data: null, error: null },
      )

      const res = await getLoyaltyOverview()
      if ('error' in res) throw new Error(res.error)
      expect(res.settings.loyalty_mode).toBe('stamps')
      expect(res.summary).toMatchObject({ customers_ready: 1, discount_given_cop: 25000 })
      expect(res.movements.map(x => x.units)).toEqual([1, -10, -2])
      expect(res.movements[1].customer?.full_name).toBe('Juan')
      expect(res.movements[2].customer).toBeNull()

      expect(m.supabase.rpc).toHaveBeenCalledWith('get_loyalty_summary', { p_business_id: 'biz1' })
      const ledgerEqs = m.calls.find(c => c.table === 'loyalty_ledgers')!.ops.filter(o => o.op === 'eq').map(o => o.args)
      expect(ledgerEqs).toEqual([['business_id', 'biz1'], ['kind', 'stamps']])
    })
  })

  describe('adjustCustomerLoyalty', () => {
    it('llama al RPC con el ajuste y el motivo', async () => {
      const m = setup('admin', {}, () => ({ data: { balance: 15 }, error: null }))
      const res = await adjustCustomerLoyalty('c1', 5, '  Cortesía por espera  ')
      expect(res).toEqual({ success: true, balance: 15 })
      expect(m.supabase.rpc).toHaveBeenCalledWith('adjust_customer_loyalty', {
        p_customer_id: 'c1', p_delta: 5, p_reason: 'Cortesía por espera',
      })
    })

    it('valida delta y motivo antes de llamar al RPC', async () => {
      const m = setup('admin')
      expect((await adjustCustomerLoyalty('c1', 0, 'Motivo')).error).toBeDefined()
      expect((await adjustCustomerLoyalty('c1', 1.5, 'Motivo')).error).toBeDefined()
      expect((await adjustCustomerLoyalty('c1', 5, 'ab')).error).toMatch(/motivo/i)
      expect(m.supabase.rpc).not.toHaveBeenCalled()
    })

    it('traduce los errores del RPC', async () => {
      setup('admin', {}, () => ({ data: null, error: { message: 'insufficient_balance' } }))
      expect((await adjustCustomerLoyalty('c1', -50, 'Corrección')).error).toBe('El cliente no tiene saldo suficiente.')
    })
  })

  describe('applyPendingLoyalty', () => {
    it('por defecto aplica al mes en curso del negocio actual', async () => {
      const m = setup('admin', {}, () => ({ data: { sales: 3, units: 42 }, error: null }))
      const res = await applyPendingLoyalty()
      expect(res).toEqual({ success: true, sales: 3, units: 42 })
      const args = (m.supabase.rpc as jest.Mock).mock.calls[0]
      expect(args[0]).toBe('apply_pending_loyalty')
      expect(args[1].p_business_id).toBe('biz1')
      expect(args[1].p_from).toMatch(/^\d{4}-\d{2}-01$/)
    })

    it('rechaza un rango inválido', async () => {
      const m = setup('admin')
      expect((await applyPendingLoyalty({ from: '2026-09-30', to: '2026-09-01' })).error).toBeDefined()
      expect((await applyPendingLoyalty({ from: 'hoy' })).error).toBeDefined()
      expect(m.supabase.rpc).not.toHaveBeenCalled()
    })
  })

  describe('findCustomerLoyalty', () => {
    it('no consulta con menos de 2 caracteres', async () => {
      const m = setup('admin')
      expect(await findCustomerLoyalty(' a ')).toEqual({ results: [] })
      expect(m.calls.filter(c => c.table === 'customers')).toHaveLength(0)
    })

    it('busca solo en el negocio del perfil y limpia caracteres del filtro', async () => {
      const m = setup('admin', { customers: [{ data: [], error: null }] })
      await findCustomerLoyalty('juan,(x)%')
      expect(opOf(m.calls, 'customers', 'eq')?.args).toEqual(['business_id', 'biz1'])
      expect(opOf(m.calls, 'customers', 'or')?.args[0]).toBe('phone.ilike.%juan x%,full_name.ilike.%juan x%')
      expect(opOf(m.calls, 'customers', 'limit')?.args[0]).toBe(8)
    })
  })
})
