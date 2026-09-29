import { buildTimelineLayout, freeMinutes, formatMinutes, isoToDayMin, minToLabel, type TimelineAppt } from '../staff-day-utils'

const DATE = '2026-09-30'
const appt = (id: string, hhmm: string, total: number): TimelineAppt => ({
  id,
  start_time: `${DATE}T${hhmm}:00Z`,
  status: 'scheduled',
  customer_name: 'Ana',
  service_name: 'Corte',
  total_minutes: total,
})

describe('staff-day-utils', () => {
  it('convierte ISO (hora local guardada como UTC) a minutos del día', () => {
    expect(isoToDayMin(`${DATE}T10:30:00Z`, DATE)).toBe(630)
    expect(minToLabel(540)).toBe('9:00')
  })

  it('una cita larga abarca varias filas como un solo bloque', () => {
    const layout = buildTimelineLayout({
      schedule: { startMin: 540, endMin: 720 }, // 9:00–12:00
      interval: 30,
      breaks: [],
      timeOff: [],
      appts: [appt('a1', '10:00', 60)],
      dateKey: DATE,
    })
    expect(layout.rowCount).toBe(6)
    expect(layout.appts).toHaveLength(1)
    expect(layout.appts[0]).toMatchObject({ row: 2, span: 2 })
    // Filas cubiertas por la cita no generan bloque "libre"
    const freeRows = layout.segments.filter((s) => s.kind === 'free').map((s) => s.row)
    expect(freeRows).toEqual([0, 1, 4, 5])
  })

  it('agrupa filas consecutivas de una pausa y da prioridad al permiso', () => {
    const layout = buildTimelineLayout({
      schedule: { startMin: 540, endMin: 840 }, // 9:00–14:00
      interval: 30,
      breaks: [{ id: 'b1', startMin: 720, endMin: 780 }], // 12–13
      timeOff: [{ id: 't1', startMin: 750, endMin: 810 }], // 12:30–13:30
      appts: [],
      dateKey: DATE,
    })
    const brk = layout.segments.find((s) => s.kind === 'break')
    const off = layout.segments.find((s) => s.kind === 'off')
    expect(brk).toMatchObject({ row: 6, span: 1 })
    expect(off).toMatchObject({ row: 7, span: 2 })
  })

  it('calcula minutos libres y los formatea', () => {
    const free = freeMinutes({ startMin: 540, endMin: 1140 }, [
      { startMin: 720, endMin: 780 },
      { startMin: 600, endMin: 660 },
    ])
    expect(free).toBe(600 - 120)
    expect(formatMinutes(480)).toBe('8 h')
    expect(formatMinutes(90)).toBe('1 h 30 min')
  })
})
