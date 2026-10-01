import {
  getMoneyAccountsStatus,
  listMoneyAccounts,
  listActiveAccountsForCheckout,
  saveMoneyAccount,
  reorderMoneyAccounts,
  recordAccountMovement,
} from '../money-accounts'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))

type Result = { data?: any; error?: any }

function setup(role: string | null, queues: Record<string, Result[]> = {}, rpcResult: Result = { data: 'x1', error: null }) {
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

beforeEach(() => jest.clearAllMocks())

describe('permisos', () => {
  it('rechaza a quien no es admin en todas las acciones', async () => {
    const { supabase } = setup('barber')
    expect((await getMoneyAccountsStatus()).error).toContain('administrador')
    expect((await listMoneyAccounts()).error).toContain('administrador')
    expect((await saveMoneyAccount({ name: 'Nequi', method_kind: 'transfer', opening_balance: 0, opening_date: '2026-10-01', is_active: true })).error).toContain('administrador')
    expect((await reorderMoneyAccounts(['a'])).error).toContain('administrador')
    expect((await recordAccountMovement({ kind: 'transfer', amount: 10, from: 'a', to: 'b' })).error).toContain('administrador')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('rechaza sin sesión', async () => {
    setup(null)
    expect((await getMoneyAccountsStatus()).error).toContain('administrador')
  })
})

describe('getMoneyAccountsStatus', () => {
  it('normaliza los números del RPC', async () => {
    setup('admin', {}, {
      data: {
        today: '2026-10-01',
        accounts: [{ id: 'a', name: 'Efectivo', method_kind: 'cash', is_cash_drawer: true, opening_balance: 0, opening_date: '2026-10-01', today_in: '1000', today_out: 200, today_net: '800', balance: '5000' }],
        owner_loans_pending: '30000',
        open_shift_id: null,
      },
      error: null,
    })
    const { data } = await getMoneyAccountsStatus()
    expect(data?.accounts[0]).toMatchObject({ id: 'a', today_in: 1000, today_net: 800, balance: 5000, is_cash_drawer: true })
    expect(data?.owner_loans_pending).toBe(30000)
    expect(data?.open_shift_id).toBeNull()
  })

  it('si el RPC falla devuelve un error en español', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    setup('admin', {}, { data: null, error: { message: 'forbidden' } })
    expect((await getMoneyAccountsStatus()).error).toContain('administrador')
    spy.mockRestore()
  })
})

describe('listMoneyAccounts', () => {
  it('filtra por el negocio del perfil y ordena', async () => {
    const { calls } = setup('admin', {
      money_accounts: [{ data: [{ id: 'a', business_id: 'biz1', name: 'Efectivo', method_kind: 'cash', is_cash_drawer: true, is_active: true, sort_order: 0, opening_balance: 0, opening_date: '2026-10-01' }], error: null }],
    })
    const { data } = await listMoneyAccounts()
    expect(data).toHaveLength(1)
    const ops = calls.find(c => c.table === 'money_accounts')!.ops
    expect(ops).toContainEqual({ op: 'eq', args: ['business_id', 'biz1'] })
  })
})

describe('saveMoneyAccount', () => {
  const input = { name: 'Nequi', method_kind: 'transfer' as const, opening_balance: 50_000, opening_date: '2026-10-01', is_active: true }

  it('llama a save_money_account y revalida', async () => {
    const { supabase } = setup('admin', {}, { data: 'new-id', error: null })
    const r = await saveMoneyAccount(input)
    expect(r).toEqual({ success: true, id: 'new-id' })
    expect(supabase.rpc).toHaveBeenCalledWith('save_money_account', {
      p_id: null, p_name: 'Nequi', p_method_kind: 'transfer', p_opening_balance: 50_000,
      p_opening_date: '2026-10-01', p_is_active: true, p_sort_order: null,
    })
    expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard', 'layout')
    expect(revalidatePath).toHaveBeenCalledWith('/[slug]/dashboard/settings/payment-methods', 'page')
  })

  it('traduce los errores de la base', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    setup('admin', {}, { data: null, error: { message: 'duplicate_name' } })
    expect((await saveMoneyAccount(input)).error).toContain('con ese nombre')
    expect(revalidatePath).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('reorderMoneyAccounts', () => {
  const row = (id: string, sort_order: number) => ({
    id, business_id: 'biz1', name: id, method_kind: 'transfer', is_cash_drawer: false, is_active: true, sort_order, opening_balance: 10, opening_date: '2026-09-01',
  })

  it('solo guarda los medios cuyo orden cambió, reenviando el resto de sus datos', async () => {
    const { supabase } = setup('admin', { money_accounts: [{ data: [row('a', 0), row('b', 1), row('c', 2)], error: null }] })
    const r = await reorderMoneyAccounts(['a', 'c', 'b'])
    expect(r).toEqual({ success: true })
    expect(supabase.rpc).toHaveBeenCalledTimes(2)
    expect(supabase.rpc).toHaveBeenCalledWith('save_money_account', expect.objectContaining({
      p_id: 'c', p_sort_order: 1, p_opening_balance: 10, p_opening_date: '2026-09-01', p_is_active: true,
    }))
    expect(supabase.rpc).toHaveBeenCalledWith('save_money_account', expect.objectContaining({ p_id: 'b', p_sort_order: 2 }))
  })
})

describe('recordAccountMovement', () => {
  it('registra el movimiento con el RPC', async () => {
    const { supabase } = setup('admin', {}, { data: 'mv-1', error: null })
    const r = await recordAccountMovement({ kind: 'owner_loan', amount: 100_000, to: 't', notes: ' para el arriendo ' })
    expect(r).toEqual({ success: true, id: 'mv-1' })
    expect(supabase.rpc).toHaveBeenCalledWith('record_account_movement', {
      p_kind: 'owner_loan', p_amount: 100_000, p_from: null, p_to: 't', p_notes: 'para el arriendo',
    })
  })

  it('valida el tipo y el monto antes de llamar a la base', async () => {
    const { supabase } = setup('admin')
    expect((await recordAccountMovement({ kind: 'nope' as any, amount: 10 })).error).toBeDefined()
    expect((await recordAccountMovement({ kind: 'transfer', amount: 0 })).error).toBeDefined()
    expect((await recordAccountMovement({ kind: 'transfer', amount: 1.5 })).error).toBeDefined()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('traduce exceeds_loan', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    setup('admin', {}, { data: null, error: { message: 'exceeds_loan' } })
    expect((await recordAccountMovement({ kind: 'loan_repayment', amount: 10, from: 'a' })).error).toContain('debe al dueño')
    spy.mockRestore()
  })
})

describe('listActiveAccountsForCheckout', () => {
  it('la puede usar un barbero y devuelve los medios activos sin saldos', async () => {
    const { calls } = setup('barber', {
      money_accounts: [{ data: [
        { id: 'c', name: 'Efectivo', method_kind: 'cash', is_cash_drawer: true },
        { id: 't', name: 'Nequi', method_kind: 'transfer', is_cash_drawer: false },
      ], error: null }],
    })
    const res = await listActiveAccountsForCheckout()
    expect(res.data).toEqual([
      { id: 'c', name: 'Efectivo', method_kind: 'cash', is_cash_drawer: true },
      { id: 't', name: 'Nequi', method_kind: 'transfer', is_cash_drawer: false },
    ])
    const q = calls.find(c => c.table === 'money_accounts')!
    expect(q.ops).toContainEqual({ op: 'eq', args: ['business_id', 'biz1'] })
    expect(q.ops).toContainEqual({ op: 'eq', args: ['is_active', true] })
  })

  it('sin sesión devuelve un error', async () => {
    setup(null)
    expect((await listActiveAccountsForCheckout()).error).toBeDefined()
  })
})
