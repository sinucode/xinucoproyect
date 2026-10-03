import {
  listCustomers,
  getCustomerExpediente,
  createCustomer,
  updateCustomer,
  addCustomerNote,
  updateCustomerTags,
  updateCustomerPreferences,
} from '../crm'
import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

type Result = { data?: unknown; error?: unknown; count?: number | null }

/** Cadena tipo query-builder de Supabase: cada método devuelve la misma cadena y
 *  la cadena es "awaitable" (o termina en single/maybeSingle) con el resultado dado. */
function chain(result: Result = { data: null, error: null }) {
  const c: Record<string, any> = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'gte', 'order', 'limit']) {
    c[m] = jest.fn(() => c)
  }
  c.single = jest.fn(() => Promise.resolve(result))
  c.maybeSingle = jest.fn(() => Promise.resolve(result))
  c.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
  return c
}

const USER = { id: 'u1' }

describe('CRM Server Actions', () => {
  let tables: Record<string, ReturnType<typeof chain>[]>
  let calls: Record<string, ReturnType<typeof chain>[]>
  let rpc: jest.Mock
  let supabase: any

  /** Encola resultados por tabla (uno por cada `from(table)` en orden). */
  function queue(table: string, ...results: Result[]) {
    tables[table] = [...(tables[table] ?? []), ...results.map((r) => chain(r))]
  }

  beforeEach(() => {
    jest.clearAllMocks()
    tables = {}
    calls = {}
    rpc = jest.fn()

    supabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: USER } }) },
      from: jest.fn((table: string) => {
        const q = tables[table] ?? []
        const c = q.length > 1 ? (q.shift() as ReturnType<typeof chain>) : (q[0] ?? chain())
        ;(calls[table] ??= []).push(c)
        return c
      }),
      rpc,
    }
    ;(createClient as jest.Mock).mockResolvedValue(supabase)

    // Perfil por defecto: negocio b1
    queue('profiles', { data: { business_id: 'b1', full_name: 'Ana Admin' }, error: null })
  })

  // ── listCustomers ───────────────────────────────────────────────────────────

  describe('listCustomers', () => {
    it('pasa parámetros validados al RPC con el businessId del perfil', async () => {
      rpc.mockResolvedValueOnce({
        data: {
          total: 45,
          items: [{
            id: 'c1', full_name: 'Juan', phone: '300', email: null, birthday: null,
            preferred_staff_id: null, created_at: '2026-01-01T00:00:00Z', visits: 3,
            last_visit: '2026-09-20T10:00:00Z', next_appointment: null, total_spent: '120000', tags: ['VIP'],
          }],
        },
        error: null,
      })

      const result = await listCustomers({ query: '  juan ', filter: 'inactive', sort: 'spent', page: 1 })

      expect(rpc).toHaveBeenCalledWith('list_customers', {
        p_business_id: 'b1',
        p_query:       'juan',
        p_filter:      'inactive',
        p_sort:        'spent',
        p_limit:       30,
        p_offset:      30,
      })
      expect(result.total).toBe(45)
      expect(result.items[0]).toEqual(expect.objectContaining({ id: 'c1', visits: 3, total_spent: 120000, tags: ['VIP'] }))
    })

    it('valores inválidos caen a los defaults', async () => {
      rpc.mockResolvedValueOnce({ data: { total: 0, items: [] }, error: null })

      await listCustomers({ query: '', filter: 'x; drop table', sort: 'nope', page: -4 })

      expect(rpc).toHaveBeenCalledWith('list_customers', {
        p_business_id: 'b1',
        p_query:       null,
        p_filter:      'all',
        p_sort:        'recent',
        p_limit:       30,
        p_offset:      0,
      })
    })

    it('sin sesión devuelve error y no llama al RPC', async () => {
      supabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
      const result = await listCustomers({})
      expect(result.error).toBeDefined()
      expect(rpc).not.toHaveBeenCalled()
    })

    it('barbero: total_spent llega NULL y se conserva como null (no 0)', async () => {
      rpc.mockResolvedValueOnce({
        data: {
          total: 1,
          items: [{
            id: 'c1', full_name: 'Juan', phone: '300', email: null, birthday: null,
            preferred_staff_id: null, created_at: '2026-01-01T00:00:00Z', visits: 3,
            last_visit: null, next_appointment: null, total_spent: null, tags: [],
          }],
        },
        error: null,
      })
      const result = await listCustomers({})
      expect(result.items[0].total_spent).toBeNull()
      expect(result.items[0].visits).toBe(3)
    })
  })

  // ── getCustomerExpediente ───────────────────────────────────────────────────

  describe('getCustomerExpediente', () => {
    const queueBase = () => {
      queue('customers', { data: { id: 'c1', business_id: 'b1', full_name: 'Juan', created_at: '2026-01-01T00:00:00Z' }, error: null })
      queue('appointments',
        { data: [{ id: 'a1', start_time: '2026-09-20T10:00:00Z', status: 'completed', services: { name: 'Corte' }, staff: { full_name: 'Luis' } }], error: null },
        { data: [{ id: 'a9', start_time: '2999-01-01T10:00:00Z', status: 'scheduled', services: { name: 'Barba' }, staff: null }], error: null },
        { data: [{ start_time: '2026-09-20T10:00:00Z' }], count: 1, error: null },
      )
      queue('customer_notes', { data: [], error: null })
      queue('customer_tags', { data: [], error: null })
      queue('staff', { data: [], error: null })
    }

    it('lee el dinero del RPC y NO consulta sales ni sale_items directamente', async () => {
      queueBase()
      rpc.mockResolvedValueOnce({
        data: {
          total_spent: 60000, paid_sales: 2,
          paid_by_appointment: [{ appointment_id: 'a1', amount: 60000 }],
          purchased_products: [{ description: 'Cera', quantity: 1, total_price: 20000, created_at: '2026-09-01T00:00:00Z' }],
          upcoming_products: [{ appointment_id: 'a9', name: 'Cera', quantity: 2 }],
        },
        error: null,
      })

      const exp = await getCustomerExpediente('c1')

      expect(rpc).toHaveBeenCalledWith('get_customer_sales_summary', { p_customer_id: 'c1' })
      expect(calls.sales).toBeUndefined()
      expect(calls.sale_items).toBeUndefined()
      expect(exp?.total_spent).toBe(60000)
      expect(exp?.avg_ticket).toBe(30000)
      expect(exp?.visits[0].amount_paid).toBe(60000)
      expect(exp?.purchased_products[0].total_price).toBe(20000)
      expect(exp?.upcoming[0].products).toEqual([{ name: 'Cera', quantity: 2 }])
    })

    it('barbero: montos NULL → sin dinero en el expediente, pero con visitas y productos', async () => {
      queueBase()
      rpc.mockResolvedValueOnce({
        data: {
          total_spent: null, paid_sales: null, paid_by_appointment: null,
          purchased_products: [{ description: 'Cera', quantity: 1, total_price: null, created_at: '2026-09-01T00:00:00Z' }],
          upcoming_products: [{ appointment_id: 'a9', name: 'Cera', quantity: 2 }],
        },
        error: null,
      })

      const exp = await getCustomerExpediente('c1')

      expect(exp?.total_spent).toBeNull()
      expect(exp?.paid_sales).toBeNull()
      expect(exp?.avg_ticket).toBeNull()
      expect(exp?.visits).toHaveLength(1)
      expect(exp?.visits[0].amount_paid).toBeNull()
      expect(exp?.total_visits).toBe(1)
      expect(exp?.purchased_products).toEqual([
        { description: 'Cera', quantity: 1, total_price: null, created_at: '2026-09-01T00:00:00Z' },
      ])
      expect(exp?.upcoming[0].products).toEqual([{ name: 'Cera', quantity: 2 }])
    })

    it('si el RPC falla, no se muestra dinero (null) en vez de ceros falsos', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
      queueBase()
      rpc.mockResolvedValueOnce({ data: null, error: { message: 'forbidden' } })
      const exp = await getCustomerExpediente('c1')
      expect(exp?.total_spent).toBeNull()
      spy.mockRestore()
    })
  })

  // ── createCustomer ──────────────────────────────────────────────────────────

  describe('createCustomer', () => {
    it('valida nombre, teléfono, correo y cumpleaños', async () => {
      expect((await createCustomer({ full_name: 'A', phone: '3001234567' })).error).toMatch(/nombre/i)
      expect((await createCustomer({ full_name: 'Juan', phone: '123' })).error).toMatch(/teléfono/i)
      expect((await createCustomer({ full_name: 'Juan', phone: '3001234567', email: 'x' })).error).toMatch(/correo/i)
      expect((await createCustomer({ full_name: 'Juan', phone: '3001234567', birthday: '2999-01-01' })).error).toMatch(/cumpleaños/i)
      expect(supabase.from).not.toHaveBeenCalled()
    })

    it('rechaza teléfono duplicado en el negocio antes de insertar', async () => {
      queue('customers', { data: { id: 'existing' }, error: null })

      const result = await createCustomer({ full_name: 'Juan Pérez', phone: '300 123 4567' })

      expect(result.error).toBe('Ya existe un cliente con ese teléfono.')
      expect(calls.customers).toHaveLength(1)
      expect(calls.customers[0].eq).toHaveBeenCalledWith('phone', '3001234567')
      expect(calls.customers[0].insert).not.toHaveBeenCalled()
    })

    it('inserta con el business_id del perfil y datos normalizados', async () => {
      queue('customers', { data: null, error: null }, { data: { id: 'new1' }, error: null })

      const result = await createCustomer({
        full_name: ' Juan  Pérez ', phone: '300-123-4567', email: '', birthday: '1990-03-14',
      })

      expect(result).toEqual({ success: true, customerId: 'new1' })
      expect(calls.customers[1].insert).toHaveBeenCalledWith({
        business_id: 'b1',
        full_name:   'Juan Pérez',
        phone:       '3001234567',
        email:       null,
        birthday:    '1990-03-14',
      })
      expect(revalidatePath).toHaveBeenCalled()
    })

    it('mapea la violación de unicidad (23505) al mismo mensaje', async () => {
      queue('customers', { data: null, error: null }, { data: null, error: { code: '23505', message: 'dup' } })
      const result = await createCustomer({ full_name: 'Juan', phone: '3001234567' })
      expect(result.error).toBe('Ya existe un cliente con ese teléfono.')
    })
  })

  // ── updateCustomer ──────────────────────────────────────────────────────────

  describe('updateCustomer', () => {
    it('rechaza teléfono que ya usa OTRO cliente', async () => {
      queue('customers', { data: { id: 'c1' }, error: null }, { data: { id: 'other' }, error: null })

      const result = await updateCustomer('c1', { full_name: 'Juan', phone: '3001234567' })

      expect(result.error).toBe('Ya existe un cliente con ese teléfono.')
      expect(calls.customers[1].neq).toHaveBeenCalledWith('id', 'c1')
    })

    it('rechaza clientes de otro negocio', async () => {
      queue('customers', { data: null, error: null })
      const result = await updateCustomer('zzz', { full_name: 'Juan', phone: '3001234567' })
      expect(result.error).toBe('Cliente no encontrado.')
    })

    it('actualiza filtrando por business_id', async () => {
      queue('customers', { data: { id: 'c1' }, error: null }, { data: null, error: null }, { error: null })

      const result = await updateCustomer('c1', { full_name: 'Juan', phone: '3001234567', birthday: '1990-03-14' })

      expect(result.success).toBe(true)
      expect(calls.customers[2].update).toHaveBeenCalledWith({
        full_name: 'Juan', phone: '3001234567', email: null, birthday: '1990-03-14',
      })
      expect(calls.customers[2].eq).toHaveBeenCalledWith('business_id', 'b1')
    })
  })

  // ── addCustomerNote ─────────────────────────────────────────────────────────

  describe('addCustomerNote', () => {
    it('valida contenido vacío y longitud máxima', async () => {
      expect((await addCustomerNote('c1', '   ')).error).toContain('no puede estar vacío')
      expect((await addCustomerNote('c1', 'x'.repeat(1001))).error).toContain('1000')
    })

    it('guarda created_by, author_name y staff_id desde staff.user_id', async () => {
      queue('customers', { data: { id: 'c1' }, error: null })
      queue('staff', { data: { id: 'staff1' }, error: null })
      queue('customer_notes', {
        data: {
          id: 'n1', business_id: 'b1', customer_id: 'c1', staff_id: 'staff1', appointment_id: null,
          content: 'Great client', created_at: '2026-09-29T15:00:00Z',
          created_by: 'u1', author_name: 'Ana Admin', staff: { full_name: 'Barber Bob' },
        },
        error: null,
      })

      const result = await addCustomerNote('c1', '  Great client ')

      expect(result.success).toBe(true)
      expect(calls.staff[0].eq).toHaveBeenCalledWith('user_id', 'u1')
      expect(calls.customer_notes[0].insert).toHaveBeenCalledWith({
        business_id:    'b1',
        customer_id:    'c1',
        staff_id:       'staff1',
        created_by:     'u1',
        author_name:    'Ana Admin',
        appointment_id: null,
        content:        'Great client',
      })
      expect(result.note?.author_name).toBe('Ana Admin')
      expect(revalidatePath).toHaveBeenCalled()
    })

    it('staff_id null cuando el usuario no tiene ficha de barbero (admin)', async () => {
      queue('customers', { data: { id: 'c1' }, error: null })
      queue('staff', { data: null, error: null })
      queue('customer_notes', {
        data: {
          id: 'n2', business_id: 'b1', customer_id: 'c1', staff_id: null, appointment_id: null,
          content: 'Nota', created_at: '2026-09-29T15:00:00Z',
          created_by: 'u1', author_name: 'Ana Admin', staff: null,
        },
        error: null,
      })

      const result = await addCustomerNote('c1', 'Nota')

      expect(result.success).toBe(true)
      expect(calls.customer_notes[0].insert).toHaveBeenCalledWith(
        expect.objectContaining({ staff_id: null, created_by: 'u1', author_name: 'Ana Admin' }),
      )
      expect(result.note?.staff_name).toBeNull()
    })

    it('rechaza clientes que no son del negocio', async () => {
      queue('customers', { data: null, error: null })
      const result = await addCustomerNote('other', 'Nota')
      expect(result.error).toBe('Cliente no encontrado.')
      expect(calls.customer_notes).toBeUndefined()
    })
  })

  // ── updateCustomerTags ──────────────────────────────────────────────────────

  describe('updateCustomerTags', () => {
    it('reemplaza etiquetas (DELETE + INSERT) con el business_id del perfil', async () => {
      queue('customers', { data: { id: 'c1' }, error: null })
      queue('customer_tags', { error: null }, { error: null })

      const result = await updateCustomerTags('c1', ['VIP', 'Late', 'VIP'])

      expect(result.success).toBe(true)
      expect(calls.customer_tags[0].delete).toHaveBeenCalled()
      expect(calls.customer_tags[1].insert).toHaveBeenCalledWith([
        { business_id: 'b1', customer_id: 'c1', tag: 'VIP' },
        { business_id: 'b1', customer_id: 'c1', tag: 'Late' },
      ])
      expect(revalidatePath).toHaveBeenCalled()
    })

    it('no toca etiquetas de clientes de otro negocio', async () => {
      queue('customers', { data: null, error: null })
      const result = await updateCustomerTags('other', ['VIP'])
      expect(result.error).toBe('Cliente no encontrado.')
      expect(calls.customer_tags).toBeUndefined()
    })
  })
  // ── updateCustomerPreferences (barbero preferido: solo admin) ────────────────

  describe('updateCustomerPreferences', () => {
    function loginAs(role: string) {
      tables.profiles = []
      queue('profiles', { data: { business_id: 'b1', full_name: 'Alguien', role }, error: null })
    }

    it.each(['barber', 'manicurist'])('el rol %s no puede cambiarlo (no toca la base)', async (role) => {
      loginAs(role)
      const result = await updateCustomerPreferences('c1', { preferred_staff_id: 's1' })
      expect(result.error).toBe('Solo un administrador puede cambiar el barbero preferido.')
      expect(calls.customers).toBeUndefined()
    })

    it('el admin lo cambia, validando que el barbero sea del negocio', async () => {
      loginAs('admin')
      queue('customers', { data: { id: 'c1' }, error: null }, { error: null })
      queue('staff', { data: { id: 's1' }, error: null })
      const result = await updateCustomerPreferences('c1', { preferred_staff_id: 's1' })
      expect(result.success).toBe(true)
      expect(calls.customers[1].update).toHaveBeenCalledWith({ preferred_staff_id: 's1' })
    })

    it('si la base lo rechaza (trigger admin_required) devuelve el mensaje en español', async () => {
      loginAs('super_admin')
      queue('customers', { data: { id: 'c1' }, error: null }, { error: { message: 'admin_required' } })
      const result = await updateCustomerPreferences('c1', { preferred_staff_id: null })
      expect(result.error).toBe('Solo un administrador puede cambiar el barbero preferido.')
    })
  })
})
