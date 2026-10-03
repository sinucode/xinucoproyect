import {
  buildTimelineLayout, freeMinutes, formatMinutes, isoToDayMin, minToLabel, nowOffsetRem, remainingFreeMinutes,
  type TimelineAppt,
} from '../staff-day-utils'

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

describe('remainingFreeMinutes (contador de tiempo libre de hoy)', () => {
  const schedule = { startMin: 540, endMin: 1080 } // 9:00–18:00
  const busy = [{ startMin: 600, endMin: 660 }, { startMin: 900, endMin: 960 }] // 10–11 y 15–16

  it('otro día (nowMin null): todo el horario', () => {
    expect(remainingFreeMinutes(schedule, busy, null)).toBe(freeMinutes(schedule, busy))
    expect(remainingFreeMinutes(schedule, busy, null)).toBe(540 - 120)
  })

  it('hoy: solo cuenta desde ahora (no el tiempo que ya pasó)', () => {
    // 12:00 → quedan 12–18 menos 15–16
    expect(remainingFreeMinutes(schedule, busy, 720)).toBe(360 - 60)
  })

  it('antes de abrir cuenta todo el horario', () => {
    expect(remainingFreeMinutes(schedule, busy, 300)).toBe(540 - 120)
  })

  it('una cita en curso ahora ya no cuenta como libre', () => {
    // 10:30 → quedan 11–18 menos 15–16
    expect(remainingFreeMinutes(schedule, busy, 630)).toBe(420 - 60)
  })

  it('después del cierre no queda nada', () => {
    expect(remainingFreeMinutes(schedule, busy, 1080)).toBe(0)
    expect(remainingFreeMinutes(schedule, busy, 1300)).toBe(0)
  })
})

describe('nowOffsetRem (línea "Ahora")', () => {
  it('al inicio del rango está arriba', () => {
    expect(nowOffsetRem(540, 540, 30)).toBe(0)
  })

  it('una fila completa más abajo suma alto de fila + separación', () => {
    expect(nowOffsetRem(570, 540, 30)).toBeCloseTo(2.75 + 0.125)
  })

  it('a mitad de fila avanza media altura de fila', () => {
    expect(nowOffsetRem(555, 540, 30)).toBeCloseTo(2.75 / 2)
    expect(nowOffsetRem(585, 540, 30)).toBeCloseTo(2.75 + 0.125 + 2.75 / 2)
  })
})
