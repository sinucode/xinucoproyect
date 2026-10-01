import { colombiaHolidays, easterSunday, upcomingColombiaHolidays } from '../colombia-holidays'

const names = (year: number) => new Map(colombiaHolidays(year).map(h => [h.date, h.name]))

describe('easterSunday', () => {
  it('calcula la Pascua (algoritmo gregoriano)', () => {
    expect(easterSunday(2024)).toEqual({ month: 3, day: 31 })
    expect(easterSunday(2025)).toEqual({ month: 4, day: 20 })
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 })
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 })
  })
})

describe('colombiaHolidays(2026)', () => {
  const h = names(2026)

  it('tiene 18 festivos, ordenados y sin repetir fecha', () => {
    const list = colombiaHolidays(2026)
    expect(list).toHaveLength(18)
    const dates = list.map(x => x.date)
    expect(dates).toEqual([...dates].sort())
    expect(new Set(dates).size).toBe(18)
  })

  it('festivos fijos', () => {
    expect(h.get('2026-01-01')).toBe('Año Nuevo')
    expect(h.get('2026-05-01')).toBe('Día del Trabajo')
    expect(h.get('2026-07-20')).toBe('Día de la Independencia')
    expect(h.get('2026-08-07')).toBe('Batalla de Boyacá')
    expect(h.get('2026-12-08')).toBe('Inmaculada Concepción')
    expect(h.get('2026-12-25')).toBe('Navidad')
  })

  it('festivos que pasan al lunes (Ley Emiliani)', () => {
    expect(h.get('2026-01-12')).toBe('Día de los Reyes Magos')
    expect(h.get('2026-03-23')).toBe('Día de San José')
    expect(h.get('2026-06-29')).toBe('San Pedro y San Pablo')
    expect(h.get('2026-08-17')).toBe('Asunción de la Virgen')
    expect(h.get('2026-10-12')).toBe('Día de la Raza')
    expect(h.get('2026-11-02')).toBe('Todos los Santos')
    expect(h.get('2026-11-16')).toBe('Independencia de Cartagena')
  })

  it('festivos de Semana Santa', () => {
    expect(h.get('2026-04-02')).toBe('Jueves Santo')
    expect(h.get('2026-04-03')).toBe('Viernes Santo')
    expect(h.get('2026-05-18')).toBe('Ascensión del Señor')
    expect(h.get('2026-06-08')).toBe('Corpus Christi')
    expect(h.get('2026-06-15')).toBe('Sagrado Corazón')
  })

  it('los que se mueven siempre caen en lunes', () => {
    const moved = ['Reyes', 'San José', 'San Pedro', 'Asunción', 'Raza', 'Todos los Santos', 'Cartagena', 'Ascensión', 'Corpus', 'Sagrado']
    for (const { date, name } of colombiaHolidays(2026)) {
      if (moved.some(m => name.includes(m))) expect(new Date(`${date}T00:00:00Z`).getUTCDay()).toBe(1)
    }
  })
})

describe('colombiaHolidays (otros años)', () => {
  it('2025: Semana Santa y Ascensión', () => {
    const h = names(2025)
    expect(h.get('2025-04-17')).toBe('Jueves Santo')
    expect(h.get('2025-04-18')).toBe('Viernes Santo')
    expect(h.get('2025-06-02')).toBe('Ascensión del Señor')
    expect(h.get('2025-06-23')).toBe('Corpus Christi')
  })

  it('2025: dos festivos el mismo día se juntan en una fila (30 jun)', () => {
    const list = colombiaHolidays(2025)
    expect(list).toHaveLength(17)
    expect(names(2025).get('2025-06-30')).toBe('San Pedro y San Pablo · Sagrado Corazón')
  })

  it('un festivo que ya cae en lunes no se mueve', () => {
    // 6 ene 2025 fue lunes
    expect(names(2025).get('2025-01-06')).toBe('Día de los Reyes Magos')
    // 12 oct 2026 fue lunes
    expect(names(2026).has('2026-10-12')).toBe(true)
  })
})

describe('upcomingColombiaHolidays', () => {
  it('toma los próximos 12 meses cruzando de año, incluyendo hoy', () => {
    const list = upcomingColombiaHolidays('2026-09-30', 12)
    expect(list[0].date).toBe('2026-10-12')
    expect(list.some(x => x.date === '2027-01-11')).toBe(true) // Reyes 2027
    expect(list.every(x => x.date >= '2026-09-30' && x.date < '2027-09-30')).toBe(true)
    expect(list.map(x => x.date)).toEqual([...list.map(x => x.date)].sort())
  })

  it('incluye el día de hoy si es festivo', () => {
    expect(upcomingColombiaHolidays('2026-10-12', 1)[0].date).toBe('2026-10-12')
  })
})
