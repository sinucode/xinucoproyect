import { diffStaffServices, resolveServiceStaffIds } from '../service-staff'

const S = ['a', 'b', 'c']
const SERVICES = ['s1', 's2', 's3'] // s1 = objetivo

describe('diffStaffServices', () => {
  it('restringir desde "todos implícito": los excluidos materializan los demás servicios', () => {
    const r = diffStaffServices({
      currentRows: [],
      staffIds: S,
      serviceIds: SERVICES,
      targetServiceId: 's1',
      target: ['a'],
    })
    // a: sin filas y lo hace → no se toca (sigue haciendo todo)
    expect(r.inserts.filter(x => x.staff_id === 'a')).toEqual([])
    expect(r.inserts.filter(x => x.staff_id === 'b')).toEqual([
      { staff_id: 'b', service_id: 's2' },
      { staff_id: 'b', service_id: 's3' },
    ])
    expect(r.inserts.filter(x => x.staff_id === 'c')).toHaveLength(2)
    expect(r.inserts.some(x => x.service_id === 's1')).toBe(false)
    expect(r.deletes).toEqual([])
    expect(r.blocked).toEqual([])
  })

  it('volver a "todos": solo agrega fila a quienes tienen filas explícitas', () => {
    const r = diffStaffServices({
      currentRows: [
        { staff_id: 'b', service_id: 's2' },
        { staff_id: 'b', service_id: 's3' },
        { staff_id: 'c', service_id: 's1' },
        { staff_id: 'c', service_id: 's2' },
      ],
      staffIds: S,
      serviceIds: SERVICES,
      targetServiceId: 's1',
      target: 'all',
    })
    expect(r.inserts).toEqual([{ staff_id: 'b', service_id: 's1' }])
    expect(r.deletes).toEqual([])
    expect(r.blocked).toEqual([])
  })

  it('mixto: agrega, borra y materializa según el barbero', () => {
    const r = diffStaffServices({
      currentRows: [
        { staff_id: 'a', service_id: 's2' }, // a: explícito sin s1 → se agrega
        { staff_id: 'b', service_id: 's1' }, // b: tiene s1 y otro → se borra
        { staff_id: 'b', service_id: 's3' },
        // c: sin filas → se materializa
      ],
      staffIds: S,
      serviceIds: SERVICES,
      targetServiceId: 's1',
      target: ['a'],
    })
    expect(r.inserts).toEqual(
      expect.arrayContaining([
        { staff_id: 'a', service_id: 's1' },
        { staff_id: 'c', service_id: 's2' },
        { staff_id: 'c', service_id: 's3' },
      ]),
    )
    expect(r.inserts).toHaveLength(3)
    expect(r.deletes).toEqual([{ staff_id: 'b', service_id: 's1' }])
    expect(r.blocked).toEqual([])
  })

  it('bloquea excluir a un barbero que quedaría sin ninguna asignación', () => {
    const r = diffStaffServices({
      currentRows: [{ staff_id: 'b', service_id: 's1' }],
      staffIds: ['a', 'b'],
      serviceIds: SERVICES,
      targetServiceId: 's1',
      target: ['a'],
    })
    expect(r.blocked).toEqual(['b'])
    expect(r.deletes).toEqual([])
  })

  it('bloquea excluir a un barbero sin filas cuando no hay otros servicios', () => {
    const r = diffStaffServices({
      currentRows: [],
      staffIds: ['a', 'b'],
      serviceIds: ['s1'],
      targetServiceId: 's1',
      target: ['a'],
    })
    expect(r.blocked).toEqual(['b'])
    expect(r.inserts).toEqual([])
  })

  it('ignora filas de barberos que no están en staffIds', () => {
    const r = diffStaffServices({
      currentRows: [{ staff_id: 'zzz', service_id: 's2' }],
      staffIds: ['a'],
      serviceIds: SERVICES,
      targetServiceId: 's1',
      target: 'all',
    })
    expect(r).toEqual({ inserts: [], deletes: [], blocked: [] })
  })
})

describe('resolveServiceStaffIds', () => {
  it('sin filas = hace todo; con filas solo los listados', () => {
    const rows = [
      { staff_id: 'b', service_id: 's2' },
      { staff_id: 'c', service_id: 's1' },
    ]
    expect(resolveServiceStaffIds('s1', S, rows)).toEqual(['a', 'c'])
  })
})
