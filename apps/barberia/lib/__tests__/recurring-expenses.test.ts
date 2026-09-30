import { runRecurringExpenses } from '../recurring-expenses'
import { loadAdminEmails, sendRecurringExpenseReminder } from '../email/notifications'

jest.mock('../email/notifications', () => ({
  loadAdminEmails: jest.fn(),
  sendRecurringExpenseReminder: jest.fn(),
}))

type Row = Record<string, any>

/** Fake mínimo de Supabase con tablas en memoria: select/eq/gte/lte/lt/in/order/range/insert. */
function makeDb(tables: Record<string, Row[]>) {
  const inserts: { table: string; row: Row }[] = []
  let seq = 0

  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = []
    let payload: Row | Row[] | undefined
    let range: [number, number] | undefined

    const chain: any = {
      select: () => chain,
      order: () => chain,
      eq: (c: string, v: any) => { filters.push(r => r[c] === v); return chain },
      gte: (c: string, v: any) => { filters.push(r => r[c] >= v); return chain },
      lte: (c: string, v: any) => { filters.push(r => r[c] <= v); return chain },
      lt:  (c: string, v: any) => { filters.push(r => r[c] < v); return chain },
      in:  (c: string, v: any[]) => { filters.push(r => v.includes(r[c])); return chain },
      range: (a: number, b: number) => { range = [a, b]; return chain },
      insert: (p: Row | Row[]) => { payload = p; return chain },
      then: (res: any, rej: any) => {
        let result: { data: Row[] | null; error: null }
        if (payload) {
          for (const row of Array.isArray(payload) ? payload : [payload]) {
            const withId = { id: `new${++seq}`, created_at: '2026-09-30T13:00:00Z', ...row }
            tables[table] = [...(tables[table] ?? []), withId]
            inserts.push({ table, row })
          }
          result = { data: null, error: null }
        } else {
          let rows = (tables[table] ?? []).filter(r => filters.every(f => f(r)))
          if (range) rows = rows.slice(range[0], range[1] + 1)
          result = { data: rows, error: null }
        }
        return Promise.resolve(result).then(res, rej)
      },
    }
    return chain
  }

  return { supabase: { from }, inserts, tables }
}

const BIZ = { id: 'biz1', name: 'Barbería Uno', slug: 'uno', is_active: true, features_enabled: { expenses_pgl: true } }

const expense = (o: Row): Row => ({
  id: `e_${Math.random()}`, business_id: 'biz1', amount: 100000, is_recurring: true,
  payment_method: 'transfer', created_at: '2026-08-01T00:00:00Z', ...o,
})

const arriendo = expense({ category: 'rent', description: 'Arriendo local', amount: 1500000, expense_date: '2026-08-30' })
const internet = expense({ category: 'utilities', description: 'Internet', amount: 90000, expense_date: '2026-08-31', payment_method: 'cash_register' })
const suscripcion = expense({ category: 'other', description: 'Suscripción', amount: 45000, expense_date: '2026-08-01' })

function setup(expenses: Row[], businesses: Row[] = [BIZ]) {
  return makeDb({
    expenses,
    businesses,
    expense_categories: [{ business_id: 'biz1', slug: 'other', name: 'Otros', color: 'zinc', is_hidden: false }],
  })
}

describe('runRecurringExpenses', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(loadAdminEmails as jest.Mock).mockResolvedValue(['admin@uno.co'])
    ;(sendRecurringExpenseReminder as jest.Mock).mockResolvedValue({ recipients: 1, sent: 1 })
  })

  it('registra los que vencen hoy (día 31 ajustado a 30) y avisa los de mañana (mes siguiente)', async () => {
    const db = setup([arriendo, internet, suscripcion])
    const res = await runRecurringExpenses(db.supabase, { todayKey: '2026-09-30' })

    expect(res.errors).toEqual([])
    expect(res.businesses).toBe(1)
    expect(res.registered.map(r => [r.description, r.expense_date, r.amount])).toEqual([
      ['Arriendo local', '2026-09-30', 1500000],
      ['Internet', '2026-09-30', 90000],
    ])

    // Filas insertadas: automáticas, fijas, sin turno ni autor; el efectivo de la caja pasa a transferencia
    expect(db.inserts).toHaveLength(2)
    expect(db.inserts[0].row).toEqual({
      business_id: 'biz1', category: 'rent', description: 'Arriendo local', amount: 1500000,
      expense_date: '2026-09-30', is_recurring: true, payment_method: 'transfer',
      shift_id: null, auto_registered: true, created_by: null,
    })
    expect(db.inserts[1].row).toMatchObject({ category: 'utilities', payment_method: 'transfer', auto_registered: true })

    // Aviso de mañana (1 de octubre): solo la suscripción, con el nombre de categoría del negocio
    expect(res.reminders).toEqual([{
      business_id: 'biz1', due_date: '2026-10-01',
      items: [{ description: 'Suscripción', category: 'other', amount: 45000 }],
      recipients: 1, sent: 1,
    }])
    expect(sendRecurringExpenseReminder).toHaveBeenCalledTimes(1)
    expect(sendRecurringExpenseReminder).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz1',
      dueDate: '2026-10-01',
      items: [{ description: 'Suscripción', category: 'other', amount: 45000, categoryName: 'Otros' }],
    }))
  })

  it('avisa mañana dentro del mismo mes y no registra lo que aún no vence', async () => {
    const db = setup([arriendo])   // día 30
    const res = await runRecurringExpenses(db.supabase, { todayKey: '2026-09-29' })
    expect(res.registered).toEqual([])
    expect(db.inserts).toEqual([])
    expect(res.reminders).toHaveLength(1)
    expect(res.reminders[0]).toMatchObject({ due_date: '2026-09-30', items: [{ description: 'Arriendo local' }] })
  })

  it('un solo correo por negocio aunque venzan varios gastos', async () => {
    const db = setup([
      expense({ category: 'rent', description: 'A', expense_date: '2026-08-15' }),
      expense({ category: 'rent', description: 'B', expense_date: '2026-08-15' }),
    ])
    const res = await runRecurringExpenses(db.supabase, { todayKey: '2026-09-14' })
    expect(sendRecurringExpenseReminder).toHaveBeenCalledTimes(1)
    expect(res.reminders[0].items.map(i => i.description)).toEqual(['A', 'B'])
  })

  it('dryRun calcula el resumen sin insertar ni enviar', async () => {
    const db = setup([arriendo, suscripcion])
    const res = await runRecurringExpenses(db.supabase, { todayKey: '2026-09-30', dryRun: true })
    expect(res.dryRun).toBe(true)
    expect(res.registered).toHaveLength(1)
    expect(res.reminders).toEqual([expect.objectContaining({ due_date: '2026-10-01', recipients: 1, sent: 0 })])
    expect(db.inserts).toEqual([])
    expect(sendRecurringExpenseReminder).not.toHaveBeenCalled()
  })

  it('es idempotente: una segunda corrida el mismo día no vuelve a registrar', async () => {
    const db = setup([arriendo])
    const first = await runRecurringExpenses(db.supabase, { todayKey: '2026-09-30' })
    expect(first.registered).toHaveLength(1)

    const second = await runRecurringExpenses(db.supabase, { todayKey: '2026-09-30' })
    expect(second.registered).toEqual([])
    expect(db.inserts).toHaveLength(1)
  })

  it('no duplica si el gasto ya lo registró el usuario a mano (misma categoría y descripción normalizada)', async () => {
    const manual = expense({ category: 'rent', description: '  arriendo LOCAL ', expense_date: '2026-09-28', is_recurring: false })
    const db = setup([arriendo, manual])
    const res = await runRecurringExpenses(db.supabase, { todayKey: '2026-09-30' })
    expect(res.registered).toEqual([])
    expect(db.inserts).toEqual([])
  })

  it('recupera hasta 3 días si el cron no corrió, incluso cruzando de mes', async () => {
    const db = setup([arriendo])   // vence el 30 de septiembre
    const res = await runRecurringExpenses(db.supabase, { todayKey: '2026-10-01' })
    expect(res.registered.map(r => r.expense_date)).toEqual(['2026-09-30'])
  })

  it('no registra automáticamente lo vencido hace más de 3 días', async () => {
    const db = setup([arriendo])
    const res = await runRecurringExpenses(db.supabase, { todayKey: '2026-10-05' })
    expect(res.registered).toEqual([])
    expect(db.inserts).toEqual([])
  })

  it('un gasto al que se le quitó la marca "fijo" deja de repetirse', async () => {
    const stopped = expense({ category: 'rent', description: 'Arriendo local', amount: 1, expense_date: '2026-09-05', is_recurring: false })
    const db = setup([arriendo, stopped])
    const res = await runRecurringExpenses(db.supabase, { todayKey: '2026-10-04' })
    expect(res.registered).toEqual([])
    expect(res.reminders).toEqual([])
  })

  it('omite negocios inactivos o sin el módulo Gastos', async () => {
    const db = setup(
      [arriendo],
      [{ ...BIZ, features_enabled: {} }],
    )
    expect((await runRecurringExpenses(db.supabase, { todayKey: '2026-09-30' })).registered).toEqual([])

    const db2 = setup([arriendo], [{ ...BIZ, is_active: false }])
    expect((await runRecurringExpenses(db2.supabase, { todayKey: '2026-09-30' })).registered).toEqual([])
  })

  it('un negocio sin gastos fijos no hace nada', async () => {
    const db = setup([expense({ category: 'rent', description: 'X', expense_date: '2026-08-30', is_recurring: false })])
    const res = await runRecurringExpenses(db.supabase, { todayKey: '2026-09-30' })
    expect(res).toMatchObject({ businesses: 0, registered: [], reminders: [], errors: [] })
  })

  it('cada negocio se procesa con sus propios gastos (sin mezclar tenants)', async () => {
    const other = expense({ business_id: 'biz2', category: 'rent', description: 'Arriendo local', expense_date: '2026-08-30' })
    const db = setup([arriendo, other], [BIZ, { ...BIZ, id: 'biz2', slug: 'dos' }])
    const res = await runRecurringExpenses(db.supabase, { todayKey: '2026-09-30' })
    expect(res.registered.map(r => r.business_id).sort()).toEqual(['biz1', 'biz2'])
    expect(db.inserts.map(i => i.row.business_id).sort()).toEqual(['biz1', 'biz2'])
  })

  it('un fallo en un negocio queda en errors y no detiene a los demás', async () => {
    const db = setup([arriendo, expense({ business_id: 'biz2', category: 'rent', description: 'X', expense_date: '2026-08-30' })],
      [BIZ, { ...BIZ, id: 'biz2', slug: 'dos' }])
    const realFrom = db.supabase.from
    db.supabase.from = (table: string) => {
      const chain = realFrom(table)
      if (table === 'expenses') {
        const origInsert = chain.insert
        chain.insert = (p: Row) => {
          if (p.business_id === 'biz1') return Promise.resolve({ error: { message: 'boom' } })
          return origInsert(p)
        }
      }
      return chain
    }
    const res = await runRecurringExpenses(db.supabase, { todayKey: '2026-09-30' })
    expect(res.errors.some(e => e.includes('biz1') && e.includes('boom'))).toBe(true)
    expect(res.registered.map(r => r.business_id)).toEqual(['biz2'])
  })
})
