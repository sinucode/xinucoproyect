import {
  createCommissionRule,
  updateCommissionRule,
  deleteCommissionRule,
  applyPendingCommissions,
  getCommissionsOverview,
} from '../commissions'
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
function makeSupabase(role: string | null, queues: Record<string, Result[]> = {}, rpcResult: Result = { data: null, error: null }) {
  const calls: { table: string; ops: { op: string; args: any[] }[] }[] = []

  const from = jest.fn((table: string) => {
    const call = { table, ops: [] as { op: string; args: any[] }[] }
    calls.push(call)
    // El perfil se consulta en cada acción: no se consume de la cola.
    const result: Result = table === 'profiles' && queues.profiles?.length
      ? queues.profiles[0]
      : queues[table]?.length ? queues[table].shift()! : { data: [], error: null }

    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result).then(res, rej)
        return (...args: any[]) => { call.ops.push({ op: prop, args }); return chain }
      },
    })
    return chain
  })

  const rpc = jest.fn().mockResolvedValue(rpcResult)

  const supabase = {
    from,
    rpc,
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: role === null ? null : { id: 'u1' } } }) },
  }
  if (role !== null && !queues.profiles) {
    queues.profiles = [{ data: { role, business_id: 'biz1' }, error: null }]
  }
  return { supabase, calls, rpc }
}

function setup(role: string | null, queues: Record<string, Result[]> = {}, rpcResult?: Result) {
  const m = makeSupabase(role, queues, rpcResult)
  ;(createClient as jest.Mock).mockResolvedValue(m.supabase)
  return m
}

const NOT_ADMIN = 'Solo un administrador puede gestionar comisiones.'

const validInput = {
  staff_id: null as string | null,
  service_id: null as string | null,
  mode: 'percentage' as 'percentage' | 'fixed',
  value: 50,
  product_percentage: 0,
}

const range = { from: '2026-09-01', to: '2026-09-29' }

function ops(calls: ReturnType<typeof makeSupabase>['calls']) {
  return calls.flatMap(c => c.ops.map(o => ({ t: c.table, ...o })))
}

describe('Commissions Server Actions', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('permisos', () => {
    it.each(['barber', 'manicurist', 'cashier'])('rechaza el rol %s', async (role) => {
      const { rpc } = setup(role)
      expect(await createCommissionRule(validInput)).toEqual({ error: NOT_ADMIN })
      expect(await updateCommissionRule('r1', validInput)).toEqual({ error: NOT_ADMIN })
      expect(await deleteCommissionRule('r1')).toEqual({ error: NOT_ADMIN })
      expect(await applyPendingCommissions(range)).toEqual({ error: NOT_ADMIN })
      expect(await getCommissionsOverview(range)).toEqual({ error: NOT_ADMIN })
      expect(rpc).not.toHaveBeenCalled()
    })

    it('rechaza sin sesión', async () => {
      setup(null)
      expect(await createCommissionRule(validInput)).toEqual({ error: NOT_ADMIN })
    })

    it('rechaza un perfil sin business_id', async () => {
      setup('admin', { profiles: [{ data: { role: 'admin', business_id: null }, error: null }] })
      expect(await deleteCommissionRule('r1')).toEqual({ error: NOT_ADMIN })
    })

    it('no escribe nada cuando el rol no es admin', async () => {
      const { calls } = setup('barber')
      await createCommissionRule(validInput)
      expect(calls.map(c => c.table)).toEqual(['profiles'])
    })
  })

  describe('validación', () => {
    const cases: [string, Partial<typeof validInput>, RegExp][] = [
      ['servicio y productos en cero', { value: 0, product_percentage: 0 }, /mayor a 0/i],
      ['valor 0 con servicio aunque haya % productos', { value: 0, service_id: 's1', product_percentage: 10 }, /solo aplica a reglas sin servicio/i],
      ['porcentaje > 100', { value: 101 }, /entre 1 y 100/i],
      ['porcentaje decimal', { value: 12.5 }, /entero/i],
      ['valor negativo', { value: -5 }, /entero/i],
      ['monto fijo > 10.000.000', { mode: 'fixed', value: 10_000_001 }, /monto fijo/i],
      ['% de productos > 100', { product_percentage: 101 }, /productos/i],
      ['% de productos decimal', { product_percentage: 5.5 }, /productos/i],
      ['% de productos con servicio', { service_id: 's1', product_percentage: 10 }, /solo aplica a reglas sin servicio específico/i],
      ['modo inválido', { mode: 'otro' as any }, /tipo de comisión/i],
    ]

    it.each(cases)('%s', async (_label, patch, re) => {
      const { calls } = setup('admin')
      const r = await createCommissionRule({ ...validInput, ...patch })
      expect(r.error).toMatch(re)
      expect(calls.map(c => c.table)).toEqual(['profiles']) // no llega a escribir
    })

    it('permite una regla solo de productos (valor 0, sin servicio)', async () => {
      const { calls } = setup('admin', { commission_rules: [{ data: null, error: null }] })
      const r = await createCommissionRule({ ...validInput, value: 0, product_percentage: 10 })
      expect(r).toEqual({ success: true })
      const insert = ops(calls).find(o => o.t === 'commission_rules' && o.op === 'insert')!
      expect(insert.args[0]).toMatchObject({
        commission_percentage: 0, fixed_amount: 0, product_percentage: 10,
      })
    })

    it('rechaza un profesional que no es del negocio', async () => {
      setup('admin', { staff: [{ data: null, error: null }] })
      const r = await createCommissionRule({ ...validInput, staff_id: 'otro' })
      expect(r.error).toBe('Profesional no encontrado.')
    })

    it('rechaza un servicio que no es del negocio', async () => {
      setup('admin', { services: [{ data: null, error: null }] })
      const r = await createCommissionRule({ ...validInput, service_id: 'otro' })
      expect(r.error).toBe('Servicio no encontrado.')
    })
  })

  describe('createCommissionRule', () => {
    it('porcentaje: usa el business_id del perfil y mapea columnas', async () => {
      const { calls } = setup('admin', {
        staff: [{ data: { id: 'st1' }, error: null }],
        services: [{ data: { id: 'sv1' }, error: null }],
        commission_rules: [{ data: null, error: null }],
      })
      const r = await createCommissionRule({ ...validInput, staff_id: 'st1', service_id: 'sv1', value: 40 })
      expect(r).toEqual({ success: true })
      const insert = ops(calls).find(o => o.t === 'commission_rules' && o.op === 'insert')!
      expect(insert.args[0]).toEqual({
        business_id: 'biz1',
        staff_id: 'st1',
        service_id: 'sv1',
        commission_percentage: 40,
        fixed_amount: 0,
        product_percentage: 0,
      })
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/commissions', 'page')
    })

    it('monto fijo: fixed_amount = valor y porcentaje 0', async () => {
      const { calls } = setup('admin', { commission_rules: [{ data: null, error: null }] })
      await createCommissionRule({ ...validInput, mode: 'fixed', value: 5000, product_percentage: 8 })
      const insert = ops(calls).find(o => o.t === 'commission_rules' && o.op === 'insert')!
      expect(insert.args[0]).toMatchObject({
        staff_id: null, service_id: null,
        commission_percentage: 0, fixed_amount: 5000, product_percentage: 8,
      })
    })

    it('unicidad (23505): mensaje claro', async () => {
      setup('admin', { commission_rules: [{ data: null, error: { code: '23505', message: 'dup' } }] })
      const r = await createCommissionRule(validInput)
      expect(r.error).toBe('Ya existe una regla para esa combinación de profesional y servicio.')
    })
  })

  describe('updateCommissionRule', () => {
    it('actualiza filtrando por id y business_id del perfil', async () => {
      const { calls } = setup('admin', { commission_rules: [{ data: [{ id: 'r1' }], error: null }] })
      const r = await updateCommissionRule('r1', { ...validInput, mode: 'fixed', value: 3000 })
      expect(r).toEqual({ success: true })
      const all = ops(calls).filter(o => o.t === 'commission_rules')
      expect(all.find(o => o.op === 'update')!.args[0]).toEqual({
        staff_id: null, service_id: null,
        commission_percentage: 0, fixed_amount: 3000, product_percentage: 0,
      })
      expect(all.filter(o => o.op === 'eq').map(o => o.args)).toEqual([['id', 'r1'], ['business_id', 'biz1']])
    })

    it('regla de otro negocio / inexistente', async () => {
      setup('admin', { commission_rules: [{ data: [], error: null }] })
      expect((await updateCommissionRule('x', validInput)).error).toBe('Regla no encontrada.')
    })

    it('23505 al cambiar a una combinación existente', async () => {
      setup('admin', { commission_rules: [{ data: null, error: { code: '23505', message: 'dup' } }] })
      expect((await updateCommissionRule('r1', validInput)).error).toMatch(/Ya existe una regla/)
    })
  })

  describe('deleteCommissionRule', () => {
    it('filtra por business_id del perfil', async () => {
      const { calls } = setup('admin', { commission_rules: [{ data: [{ id: 'r1' }], error: null }] })
      expect(await deleteCommissionRule('r1')).toEqual({ success: true })
      const eqs = ops(calls).filter(o => o.t === 'commission_rules' && o.op === 'eq').map(o => o.args)
      expect(eqs).toEqual([['id', 'r1'], ['business_id', 'biz1']])
    })

    it('regla inexistente', async () => {
      setup('admin', { commission_rules: [{ data: [], error: null }] })
      expect((await deleteCommissionRule('x')).error).toBe('Regla no encontrada.')
    })
  })

  describe('applyPendingCommissions', () => {
    it('usa el business_id del perfil, nunca el del cliente', async () => {
      const { rpc } = setup('admin', {}, { data: { sales: 3, entries: 5 }, error: null })
      const r = await applyPendingCommissions(range)
      expect(r).toEqual({ success: true, sales: 3, entries: 5 })
      expect(rpc).toHaveBeenCalledWith('apply_pending_commissions', {
        p_business_id: 'biz1',
        p_from: '2026-09-01',
        p_to: '2026-09-29',
      })
      expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/ledger', 'page')
    })

    it('rango inválido no llama al RPC', async () => {
      const { rpc } = setup('admin')
      expect(((await applyPendingCommissions({ from: '2026-09-10', to: '2026-09-01' })) as { error?: string }).error).toBeTruthy()
      expect(((await applyPendingCommissions({ from: 'ayer', to: 'hoy' })) as { error?: string }).error).toBeTruthy()
      expect(((await applyPendingCommissions({ from: '2025-01-01', to: '2026-09-29' })) as { error?: string }).error).toMatch(/366/)
      expect(rpc).not.toHaveBeenCalled()
    })

    it('propaga el error del RPC', async () => {
      setup('admin', {}, { data: null, error: { message: 'boom' } })
      expect(await applyPendingCommissions(range)).toEqual({ error: 'boom' })
    })

    it('traduce "forbidden" a mensaje de admin', async () => {
      setup('admin', {}, { data: null, error: { message: 'forbidden' } })
      expect(await applyPendingCommissions(range)).toEqual({ error: NOT_ADMIN })
    })
  })

  describe('getCommissionsOverview', () => {
    it('resume por profesional: servicios, productos y propinas', async () => {
      const { calls } = setup('admin', {
        commission_rules: [{ data: [], error: null }],
        staff: [{ data: [
          { id: 'a', full_name: 'Ana', is_active: true },
          { id: 'b', full_name: 'Beto', is_active: false },
        ], error: null }],
        services: [{ data: [{ id: 's1', name: 'Corte', audience: 'men' }], error: null }],
        staff_ledger: [{ data: [
          { staff_id: 'a', entry_type: 'commission', amount: 10000, sale_item: { item_type: 'service' } },
          { staff_id: 'a', entry_type: 'commission', amount: 5000, sale_item: [{ item_type: 'service' }] },
          { staff_id: 'a', entry_type: 'commission', amount: 2000, sale_item: { item_type: 'product' } },
          { staff_id: 'a', entry_type: 'tip', amount: 3000, sale_item: null },
          { staff_id: 'b', entry_type: 'commission', amount: 30000, sale_item: { item_type: 'service' } },
        ], error: null }],
      })
      const r = await getCommissionsOverview(range)
      if ('error' in r) throw new Error(r.error)
      expect(r.staff).toEqual([{ id: 'a', full_name: 'Ana' }]) // solo activos
      expect(r.summary).toEqual([
        { staff_id: 'b', staff_name: 'Beto', services_amount: 30000, services_count: 1, products_amount: 0, tips_amount: 0, total: 30000 },
        { staff_id: 'a', staff_name: 'Ana', services_amount: 15000, services_count: 2, products_amount: 2000, tips_amount: 3000, total: 20000 },
      ])
      // rango en UTC-5: [from 05:00Z, día siguiente al "to" 05:00Z)
      const ledgerOps = ops(calls).filter(o => o.t === 'staff_ledger')
      expect(ledgerOps.find(o => o.op === 'gte')!.args).toEqual(['sale.created_at', '2026-09-01T05:00:00Z'])
      expect(ledgerOps.find(o => o.op === 'lt')!.args).toEqual(['sale.created_at', '2026-09-30T05:00:00Z'])
      expect(ledgerOps.find(o => o.op === 'eq')!.args).toEqual(['business_id', 'biz1'])
    })

    it('rango inválido cae al mes actual', async () => {
      setup('admin')
      const r = await getCommissionsOverview({ from: 'x', to: 'y' })
      if ('error' in r) throw new Error(r.error)
      expect(r.range.from).toMatch(/^\d{4}-\d{2}-01$/)
      expect(r.range.to >= r.range.from).toBe(true)
    })
  })
})
