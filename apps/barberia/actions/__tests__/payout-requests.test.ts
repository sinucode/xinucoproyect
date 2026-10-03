import {
  cancelPayoutRequest,
  getMyPayoutRequests,
  getPendingPayoutRequestsCount,
  listPendingPayoutRequests,
  recordTeamMovement,
  requestPayout,
  resolvePayoutRequest,
} from '../ledger'
import { createClient } from '@xinuco/supabase/server'

jest.mock('@xinuco/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/email/notifications', () => ({
  sendTeamPaymentReceipt: jest.fn().mockResolvedValue({ sent: true, to: 'c***s@gmail.com' }),
  createServiceClient: jest.fn(),
  resolveStaffEmail: jest.fn(),
}))

type Result = { data?: any; error?: any; count?: number | null }

/** Fake de Supabase: cada from(tabla) consume el siguiente resultado encolado (o { data: [] }). */
function setup(
  role: string | null,
  queues: Record<string, Result[]> = {},
  rpcResult: Result = { data: null, error: null },
) {
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
  const rpc = jest.fn().mockResolvedValue(rpcResult)
  if (role !== null && !queues.profiles) {
    queues.profiles = Array.from({ length: 5 }, () => ({ data: { role, business_id: 'biz1' }, error: null }))
  }
  const supabase = {
    from,
    rpc,
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: role === null ? null : { id: 'u1' } } }) },
  }
  ;(createClient as jest.Mock).mockResolvedValue(supabase)
  return { supabase, calls, rpc }
}

const opsOf = (calls: ReturnType<typeof setup>['calls'], table: string, op: string) =>
  calls.filter(c => c.table === table).flatMap(c => c.ops).filter(o => o.op === op)

const NOT_ADMIN = 'Solo un administrador puede gestionar los pagos al equipo.'

describe('requestPayout (profesional)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('envía la solicitud por la función de la base con datos validados', async () => {
    const { rpc } = setup('barber', {}, { data: 'req-1', error: null })
    const res = await requestPayout({ kind: 'advance', amount: 50000, note: '  Arriendo ' })
    expect(res).toEqual({ success: true, id: 'req-1' })
    expect(rpc).toHaveBeenCalledWith('request_payout', { p_kind: 'advance', p_amount: 50000, p_note: 'Arriendo' })
  })

  it('no llama a la base con un monto inválido', async () => {
    const { rpc } = setup('barber')
    expect(await requestPayout({ kind: 'payout', amount: 0 })).toHaveProperty('error')
    expect(await requestPayout({ kind: 'payout', amount: 10.5 })).toHaveProperty('error')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rechaza sin sesión', async () => {
    const { rpc } = setup(null)
    expect(await requestPayout({ kind: 'advance', amount: 1000 })).toHaveProperty('error')
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['pending_exists', null, /solicitud pendiente/],
    ['not_linked', null, /vinculado/],
    ['exceeds_balance', '30000', /\$30\.000/],
  ])('traduce el error %s de la base', async (code, details, pattern) => {
    setup('barber', {}, { data: null, error: { message: code, details } })
    const res = await requestPayout({ kind: 'payout', amount: 90000 })
    expect(res.error).toMatch(pattern)
  })
})

describe('cancelPayoutRequest (profesional)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('cancela con la función de la base', async () => {
    const { rpc } = setup('barber')
    expect(await cancelPayoutRequest('req-1')).toEqual({ success: true })
    expect(rpc).toHaveBeenCalledWith('cancel_payout_request', { p_id: 'req-1' })
  })

  it('una solicitud ya resuelta devuelve el mensaje de la base', async () => {
    setup('barber', {}, { data: null, error: { message: 'not_pending' } })
    expect((await cancelPayoutRequest('req-1')).error).toMatch(/ya no está pendiente/)
  })

  it('sin id no llama a la base', async () => {
    const { rpc } = setup('barber')
    expect(await cancelPayoutRequest('')).toHaveProperty('error')
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('getMyPayoutRequests', () => {
  beforeEach(() => jest.clearAllMocks())

  const row = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    id, staff_id: 's1', kind: 'advance', amount: '50000', note: null, status,
    created_at: '2026-10-01T15:00:00Z', resolved_at: null, resolution_note: null,
    staff: { full_name: 'Demo Andrés' }, ...extra,
  })

  it('devuelve solo las del profesional (staff del usuario + negocio), la pendiente primero', async () => {
    const { calls } = setup('barber', {
      staff: [{ data: { id: 's1' }, error: null }],
      payout_requests: [{ data: [row('r2', 'paid'), row('r1', 'pending')], error: null }],
    })
    const res = await getMyPayoutRequests()
    expect('requests' in res && res.requests.map(r => r.id)).toEqual(['r1', 'r2'])
    expect('requests' in res && res.requests[0].amount).toBe(50000)
    const eqs = opsOf(calls, 'payout_requests', 'eq').map(o => `${o.args[0]}=${o.args[1]}`)
    expect(eqs).toEqual(expect.arrayContaining(['business_id=biz1', 'staff_id=s1']))
  })

  it('usuario sin profesional vinculado → error', async () => {
    setup('barber', { staff: [{ data: null, error: null }] })
    expect(await getMyPayoutRequests()).toHaveProperty('error')
  })
})

describe('admin: listar, contar y resolver', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each(['barber', 'manicurist'])('el rol %s no lista ni rechaza solicitudes', async (role) => {
    const { rpc, calls } = setup(role)
    expect(await listPendingPayoutRequests()).toEqual({ error: NOT_ADMIN })
    expect(await resolvePayoutRequest('r1', 'rejected', 'No hay caja')).toEqual({ error: NOT_ADMIN })
    expect(rpc).not.toHaveBeenCalled()
    expect(calls.filter(c => c.table === 'payout_requests')).toHaveLength(0)
  })

  it('el conteo del aviso es 0 sin consultar si no es admin', async () => {
    const { calls } = setup('barber')
    expect(await getPendingPayoutRequestsCount()).toBe(0)
    expect(calls.filter(c => c.table === 'payout_requests')).toHaveLength(0)
  })

  it('el conteo del admin usa el negocio del perfil y solo pendientes', async () => {
    const { calls } = setup('admin', { payout_requests: [{ data: null, error: null, count: 3 }] })
    expect(await getPendingPayoutRequestsCount()).toBe(3)
    const eqs = opsOf(calls, 'payout_requests', 'eq').map(o => `${o.args[0]}=${o.args[1]}`)
    expect(eqs).toEqual(expect.arrayContaining(['business_id=biz1', 'status=pending']))
  })

  it('el conteo es 0 si la tabla aún no existe', async () => {
    setup('admin', { payout_requests: [{ data: null, error: { message: 'relation does not exist' } }] })
    expect(await getPendingPayoutRequestsCount()).toBe(0)
  })

  it('rechazar exige motivo y lo manda a la base', async () => {
    const { rpc } = setup('admin')
    expect(await resolvePayoutRequest('r1', 'rejected', '  ')).toHaveProperty('error')
    expect(rpc).not.toHaveBeenCalled()

    expect(await resolvePayoutRequest('r1', 'rejected', ' Se paga el viernes ')).toEqual({ success: true })
    expect(rpc).toHaveBeenCalledWith('resolve_payout_request', {
      p_id: 'r1', p_status: 'rejected', p_note: 'Se paga el viernes', p_ledger_entry_id: null,
    })
  })

  it('marcar pagada enlaza el movimiento', async () => {
    const { rpc } = setup('admin')
    expect(await resolvePayoutRequest('r1', 'paid', null, 'led-1')).toEqual({ success: true })
    expect(rpc).toHaveBeenCalledWith('resolve_payout_request', {
      p_id: 'r1', p_status: 'paid', p_note: null, p_ledger_entry_id: 'led-1',
    })
  })

  it('un estado inválido no llega a la base', async () => {
    const { rpc } = setup('admin')
    expect(await resolvePayoutRequest('r1', 'cancelled' as never, 'x')).toEqual({ error: 'Estado no válido.' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('recordTeamMovement atendiendo una solicitud', () => {
  beforeEach(() => jest.clearAllMocks())

  const staffOk = { data: { id: 's1' }, error: null }
  const pendingReq = (extra: Record<string, unknown> = {}) => ({
    data: { id: 'r1', staff_id: 's1', kind: 'advance', status: 'pending', ...extra }, error: null,
  })
  const advance = {
    staffId: 's1', type: 'advance' as const, amount: 50000, notes: 'Anticipo solicitado',
    payment_method: 'transfer' as const, sendReceipt: false, payoutRequestId: 'r1',
  }

  it('si la solicitud ya no está pendiente NO mueve plata', async () => {
    const { calls, rpc } = setup('admin', { staff: [staffOk], payout_requests: [pendingReq({ status: 'cancelled' })] })
    const res = await recordTeamMovement(advance)
    expect(res.error).toMatch(/ya no está pendiente/)
    expect(opsOf(calls, 'staff_ledger', 'insert')).toHaveLength(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('una solicitud de otro profesional o de otro tipo no se puede atender con este movimiento', async () => {
    const other = setup('admin', { staff: [staffOk], payout_requests: [pendingReq({ staff_id: 's2' })] })
    expect((await recordTeamMovement(advance)).error).toMatch(/no corresponde/)
    expect(opsOf(other.calls, 'staff_ledger', 'insert')).toHaveLength(0)

    const wrongKind = setup('admin', { staff: [staffOk], payout_requests: [pendingReq({ kind: 'payout' })] })
    expect((await recordTeamMovement(advance)).error).toMatch(/no corresponde/)
    expect(opsOf(wrongKind.calls, 'staff_ledger', 'insert')).toHaveLength(0)
  })

  it('solicitud inexistente (o de otro negocio) → no mueve plata', async () => {
    const { calls } = setup('admin', { staff: [staffOk], payout_requests: [{ data: null, error: null }] })
    expect((await recordTeamMovement(advance)).error).toMatch(/No encontramos la solicitud/)
    expect(opsOf(calls, 'staff_ledger', 'insert')).toHaveLength(0)
  })

  it('registra el anticipo y luego marca la solicitud pagada con el id del nuevo movimiento', async () => {
    const { calls, rpc } = setup('admin', {
      staff: [staffOk],
      payout_requests: [pendingReq()],
      staff_ledger: [{ data: { id: 'led-9', amount: 50000, entry_type: 'advance' }, error: null }],
    })
    const res = await recordTeamMovement(advance)
    expect(res.success).toBe(true)
    expect(res.requestResolved).toBe(true)
    expect(opsOf(calls, 'staff_ledger', 'insert')[0].args[0]).toMatchObject({
      business_id: 'biz1', staff_id: 's1', entry_type: 'advance', amount: 50000,
    })
    expect(rpc).toHaveBeenCalledWith('resolve_payout_request', {
      p_id: 'r1', p_status: 'paid', p_note: null, p_ledger_entry_id: 'led-9',
    })
  })

  it('si cerrar la solicitud falla, el movimiento queda registrado y se avisa', async () => {
    setup('admin', {
      staff: [staffOk],
      payout_requests: [pendingReq()],
      staff_ledger: [{ data: { id: 'led-9', amount: 50000, entry_type: 'advance' }, error: null }],
    }, { data: null, error: { message: 'not_pending' } })
    const res = await recordTeamMovement(advance)
    expect(res.success).toBe(true)
    expect(res.entry?.id).toBe('led-9')
    expect(res.requestResolved).toBeUndefined()
    expect(res.requestWarning).toMatch(/Ciérrala manualmente/)
  })

  it('solo anticipos y pagos pueden atender una solicitud', async () => {
    const { calls } = setup('admin', { staff: [staffOk] })
    const res = await recordTeamMovement({
      staffId: 's1', type: 'bonus', amount: 1000, notes: 'Meta del mes', payoutRequestId: 'r1',
    })
    expect(res.error).toMatch(/Solo un anticipo o un pago/)
    expect(opsOf(calls, 'staff_ledger', 'insert')).toHaveLength(0)
  })

  it('un movimiento sin solicitud no toca payout_requests ni la función', async () => {
    const { calls, rpc } = setup('admin', {
      staff: [staffOk],
      staff_ledger: [{ data: { id: 'led-1' }, error: null }],
    })
    const res = await recordTeamMovement({ staffId: 's1', type: 'bonus', amount: 1000, notes: 'Meta del mes' })
    expect(res.success).toBe(true)
    expect(calls.filter(c => c.table === 'payout_requests')).toHaveLength(0)
    expect(rpc).not.toHaveBeenCalled()
  })
})
