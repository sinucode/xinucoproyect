import {
  getFixedAssets,
  getAssetPortfolioSummary,
  registerFixedAsset,
  updateFixedAsset,
  disposeFixedAsset,
} from '../fixed-assets'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))

type Result = { data?: any; error?: any }

function setup(role: string | null, queues: Record<string, Result[]> = {}, rpcResult: Result = { data: 'asset-1', error: null }) {
  const calls: { table: string; ops: { op: string; args: any[] }[] }[] = []
  if (role !== null && !queues.profiles) queues.profiles = Array.from({ length: 20 }, () => ({ data: { role, business_id: 'biz1' }, error: null }))

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
    rpc: jest.fn().mockResolvedValue(rpcResult),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: role === null ? null : { id: 'u1' } } }) },
  }
  ;(createClient as jest.Mock).mockResolvedValue(supabase)
  return { supabase, calls }
}

const validInput = {
  name: ' Silla Takara ',
  category: 'furniture' as const,
  purchase_date: '2026-01-10',
  purchase_price: 1_200_000,
  salvage_value: 0,
  useful_life_months: 120,
  depreciation_method: 'straight_line' as const,
  payment_method: 'cash_register' as const,
  location: ' Estación 2 ',
}

beforeEach(() => jest.clearAllMocks())

describe('permisos', () => {
  it('rechaza a quien no es admin en todas las acciones', async () => {
    setup('barber')
    expect((await getFixedAssets({ status: 'active' })).error).toContain('administrador')
    expect((await getAssetPortfolioSummary()).error).toContain('administrador')
    expect((await registerFixedAsset(validInput)).error).toContain('administrador')
    expect((await updateFixedAsset('a1', { name: 'x' })).error).toContain('administrador')
    expect((await disposeFixedAsset('a1', { date: '2026-02-01', reason: 'donated' })).error).toContain('administrador')
  })

  it('rechaza sin sesión', async () => {
    setup(null)
    expect((await registerFixedAsset(validInput)).error).toContain('administrador')
  })
})

describe('getFixedAssets / resumen', () => {
  it('usa el negocio del perfil y filtra en uso', async () => {
    const { calls } = setup('admin', { fixed_assets: [{ data: [{ id: 'a1' }], error: null }] })
    const res = await getFixedAssets({ status: 'active' })
    expect(res.data).toEqual([{ id: 'a1' }])
    const ops = calls.find(c => c.table === 'fixed_assets')!.ops
    expect(ops).toEqual(expect.arrayContaining([
      { op: 'eq', args: ['business_id', 'biz1'] },
      { op: 'eq', args: ['is_active', true] },
      { op: 'is', args: ['disposed_at', null] },
    ]))
  })

  it('dados de baja incluye los desactivados antiguos', async () => {
    const { calls } = setup('admin', { fixed_assets: [{ data: [], error: null }] })
    await getFixedAssets({ status: 'disposed' })
    const ops = calls.find(c => c.table === 'fixed_assets')!.ops
    expect(ops).toContainEqual({ op: 'or', args: ['disposed_at.not.is.null,is_active.eq.false'] })
  })

  it('resumen llama al RPC con el negocio del perfil', async () => {
    const { supabase } = setup('admin', {}, { data: { total_book_value: 5, monthly_depreciation: 1 }, error: null })
    const res = await getAssetPortfolioSummary()
    expect(supabase.rpc).toHaveBeenCalledWith('get_total_asset_value', { p_business_id: 'biz1' })
    expect(res.data).toMatchObject({ total_book_value: 5 })
  })
})

describe('registerFixedAsset', () => {
  it('llama al RPC con los datos limpios y revalida', async () => {
    const { supabase } = setup('admin')
    const res = await registerFixedAsset(validInput)
    expect(res).toEqual({ success: true, id: 'asset-1' })
    expect(supabase.rpc).toHaveBeenCalledWith('register_fixed_asset', expect.objectContaining({
      p_name: 'Silla Takara', p_category: 'furniture', p_purchase_price: 1_200_000, p_salvage_value: 0,
      p_useful_life_months: 120, p_method: 'straight_line', p_payment_method: 'cash_register', p_location: 'Estación 2',
    }))
    expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/fixed-assets', 'page')
    expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/accounting', 'page')
  })

  it('envía p_account_id solo si hay medio elegido', async () => {
    const { supabase } = setup('admin')
    await registerFixedAsset({ ...validInput, payment_method: 'transfer', account_id: 'acc-1' })
    expect(supabase.rpc).toHaveBeenLastCalledWith('register_fixed_asset', expect.objectContaining({ p_payment_method: 'transfer', p_account_id: 'acc-1' }))
    await registerFixedAsset(validInput)
    expect('p_account_id' in (supabase.rpc.mock.calls[1][1] as object)).toBe(false)
  })

  it('valida antes de llamar al RPC', async () => {
    const { supabase } = setup('admin')
    expect((await registerFixedAsset({ ...validInput, name: '  ' })).error).toBe('Escribe el nombre del equipo.')
    expect((await registerFixedAsset({ ...validInput, purchase_price: 0 })).error).toBe('El precio no es válido.')
    expect((await registerFixedAsset({ ...validInput, purchase_price: 10.5 })).error).toBe('El precio no es válido.')
    expect((await registerFixedAsset({ ...validInput, salvage_value: 1_200_000 })).error).toContain('valor residual')
    expect((await registerFixedAsset({ ...validInput, useful_life_months: 601 })).error).toContain('vida útil')
    expect((await registerFixedAsset({ ...validInput, purchase_date: '2999-01-01' })).error).toContain('fecha')
    expect((await registerFixedAsset({ ...validInput, payment_method: 'x' as any })).error).toContain('cómo se pagó')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('traduce shift_not_open', async () => {
    setup('admin', {}, { data: null, error: { message: 'shift_not_open' } })
    expect((await registerFixedAsset(validInput)).error)
      .toBe('No hay una caja abierta. Abre la caja o elige otro medio de pago.')
  })
})

describe('updateFixedAsset', () => {
  const current = { purchase_price: 1_000_000, salvage_value: 0, disposed_at: null, is_active: true }

  it('actualiza solo campos permitidos y detecta 0 filas', async () => {
    const { calls } = setup('admin', {
      fixed_assets: [{ data: current, error: null }, { data: [{ id: 'a1' }], error: null }],
    })
    const res = await updateFixedAsset('a1', { name: ' Nueva ', payment_method: 'cash_register' } as any)
    expect(res).toEqual({ success: true })
    const update = calls.filter(c => c.table === 'fixed_assets')[1].ops.find(o => o.op === 'update')!
    expect(update.args[0]).toEqual({ name: 'Nueva' })

    setup('admin', { fixed_assets: [{ data: current, error: null }, { data: [], error: null }] })
    expect((await updateFixedAsset('a1', { name: 'x' })).error).toBe('No encontramos ese equipo.')
  })

  it('no edita equipos dados de baja ni inexistentes', async () => {
    setup('admin', { fixed_assets: [{ data: { ...current, disposed_at: '2026-02-01' }, error: null }] })
    expect((await updateFixedAsset('a1', { name: 'x' })).error).toContain('ya fue dado de baja')
    setup('admin', { fixed_assets: [{ data: null, error: null }] })
    expect((await updateFixedAsset('a1', { name: 'x' })).error).toBe('No encontramos ese equipo.')
  })

  it('valida el residual contra el precio guardado y mapea errores de la base', async () => {
    setup('admin', { fixed_assets: [{ data: current, error: null }] })
    expect((await updateFixedAsset('a1', { salvage_value: 1_000_000 })).error).toContain('valor residual')

    setup('admin', { fixed_assets: [{ data: current, error: null }, { data: null, error: { message: 'forbidden_field' } }] })
    expect((await updateFixedAsset('a1', { name: 'x' })).error).toBe('Ese dato no se puede cambiar desde aquí.')
  })
})

describe('disposeFixedAsset', () => {
  it('venta: manda precio y medio de pago y devuelve el resultado', async () => {
    const { supabase } = setup('admin', {}, { data: { book_value: 400_000, price: 500_000, result: 100_000 }, error: null })
    const res = await disposeFixedAsset('a1', { date: '2026-02-01', reason: 'sold', price: 500_000, paymentMethod: 'cash_register' })
    expect(res).toEqual({ success: true, bookValue: 400_000, price: 500_000, result: 100_000 })
    expect(supabase.rpc).toHaveBeenCalledWith('dispose_fixed_asset', {
      p_asset_id: 'a1', p_date: '2026-02-01', p_reason: 'sold', p_price: 500_000, p_payment_method: 'cash_register', p_notes: undefined,
    })
  })

  it('venta con medio: manda p_account_id; si no fue venta, no', async () => {
    const { supabase } = setup('admin', {}, { data: { book_value: 10, price: 5, result: -5 }, error: null })
    await disposeFixedAsset('a1', { date: '2026-02-01', reason: 'sold', price: 5, paymentMethod: 'transfer', accountId: 'acc-1' })
    expect(supabase.rpc).toHaveBeenLastCalledWith('dispose_fixed_asset', expect.objectContaining({ p_payment_method: 'transfer', p_account_id: 'acc-1' }))
    await disposeFixedAsset('a1', { date: '2026-02-01', reason: 'damaged', notes: 'x', accountId: 'acc-1' })
    expect('p_account_id' in (supabase.rpc.mock.calls[1][1] as object)).toBe(false)
  })

  it('no manda precio si no fue venta', async () => {
    const { supabase } = setup('admin', {}, { data: { book_value: 10, price: null, result: -10 }, error: null })
    await disposeFixedAsset('a1', { date: '2026-02-01', reason: 'damaged', price: 999, paymentMethod: 'transfer', notes: 'Se cayó' })
    expect(supabase.rpc).toHaveBeenCalledWith('dispose_fixed_asset', expect.objectContaining({
      p_price: undefined, p_payment_method: undefined, p_notes: 'Se cayó',
    }))
  })

  it('valida motivo, nota, precio y medio de pago', async () => {
    const { supabase } = setup('admin')
    expect((await disposeFixedAsset('a1', { date: '2026-02-01', reason: 'x' as any })).error).toContain('motivo')
    expect((await disposeFixedAsset('a1', { date: '2026-02-01', reason: 'stolen' })).error).toBe('Cuéntanos qué pasó con el equipo.')
    expect((await disposeFixedAsset('a1', { date: '2026-02-01', reason: 'sold', paymentMethod: 'other' })).error).toBe('El precio no es válido.')
    expect((await disposeFixedAsset('a1', { date: '2026-02-01', reason: 'sold', price: 5 })).error).toBe('Elige cómo se pagó.')
    expect((await disposeFixedAsset('a1', { date: '2999-02-01', reason: 'donated' })).error).toContain('fecha')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('traduce errores de la base', async () => {
    setup('admin', {}, { data: null, error: { message: 'already_disposed' } })
    expect((await disposeFixedAsset('a1', { date: '2026-02-01', reason: 'donated' })).error).toBe('Este equipo ya fue dado de baja.')
  })
})
