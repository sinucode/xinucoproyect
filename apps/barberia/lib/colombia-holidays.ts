// lib/colombia-holidays.ts — festivos de Colombia (Ley 51 de 1983, "Ley Emiliani").
//
// Puro y sin dependencias. Sirve para que el negocio elija cuáles festivos cierra.
//  - Fijos (no se mueven): 1 ene, 1 may, 20 jul, 7 ago, 8 dic, 25 dic.
//  - Se pasan al lunes siguiente: 6 ene, 19 mar, 29 jun, 15 ago, 12 oct, 1 nov, 11 nov.
//  - Según la Semana Santa: Jueves y Viernes Santo (no se mueven); Ascensión, Corpus Christi
//    y Sagrado Corazón (caen en lunes).
// Si dos festivos caen el mismo día (p. ej. 30 jun 2025) se muestra una sola fila con ambos nombres.

export interface ColombiaHoliday {
  /** 'YYYY-MM-DD' */
  date: string
  name: string
}

/** Domingo de Pascua (algoritmo gregoriano anónimo). Devuelve mes 1–12 y día. */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { month, day }
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime())
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

/** Ley Emiliani: si no es lunes, pasa al lunes siguiente. */
function moveToMonday(date: Date): Date {
  const dow = date.getUTCDay() // 0 = domingo … 1 = lunes
  const add = dow === 1 ? 0 : (8 - dow) % 7
  return addDays(date, add)
}

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Los festivos del año, ordenados por fecha. */
export function colombiaHolidays(year: number): ColombiaHoliday[] {
  const easter = easterSunday(year)
  const easterDate = utcDate(year, easter.month, easter.day)

  const entries: { date: Date; name: string }[] = [
    // Fijos
    { date: utcDate(year, 1, 1),   name: 'Año Nuevo' },
    { date: utcDate(year, 5, 1),   name: 'Día del Trabajo' },
    { date: utcDate(year, 7, 20),  name: 'Día de la Independencia' },
    { date: utcDate(year, 8, 7),   name: 'Batalla de Boyacá' },
    { date: utcDate(year, 12, 8),  name: 'Inmaculada Concepción' },
    { date: utcDate(year, 12, 25), name: 'Navidad' },
    // Se pasan al lunes
    { date: moveToMonday(utcDate(year, 1, 6)),   name: 'Día de los Reyes Magos' },
    { date: moveToMonday(utcDate(year, 3, 19)),  name: 'Día de San José' },
    { date: moveToMonday(utcDate(year, 6, 29)),  name: 'San Pedro y San Pablo' },
    { date: moveToMonday(utcDate(year, 8, 15)),  name: 'Asunción de la Virgen' },
    { date: moveToMonday(utcDate(year, 10, 12)), name: 'Día de la Raza' },
    { date: moveToMonday(utcDate(year, 11, 1)),  name: 'Todos los Santos' },
    { date: moveToMonday(utcDate(year, 11, 11)), name: 'Independencia de Cartagena' },
    // Según la Semana Santa
    { date: addDays(easterDate, -3), name: 'Jueves Santo' },
    { date: addDays(easterDate, -2), name: 'Viernes Santo' },
    { date: moveToMonday(addDays(easterDate, 43)), name: 'Ascensión del Señor' },
    { date: moveToMonday(addDays(easterDate, 64)), name: 'Corpus Christi' },
    { date: moveToMonday(addDays(easterDate, 71)), name: 'Sagrado Corazón' },
  ]

  const byDate = new Map<string, string>()
  for (const { date, name } of entries) {
    const key = toKey(date)
    const existing = byDate.get(key)
    byDate.set(key, existing ? `${existing} · ${name}` : name)
  }

  return [...byDate.entries()]
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/**
 * Festivos desde `fromKey` ('YYYY-MM-DD', inclusive) durante los próximos `months` meses.
 * Recorre los años necesarios (el rango puede cruzar de un año a otro).
 */
export function upcomingColombiaHolidays(fromKey: string, months = 12): ColombiaHoliday[] {
  const [y, m, d] = fromKey.split('-').map(Number)
  const endKey = toKey(utcDate(y, m + months, d))
  const years = new Set<number>([y, y + 1, y + Math.ceil(months / 12)])
  return [...years]
    .flatMap(colombiaHolidays)
    .filter(h => h.date >= fromKey && h.date < endKey)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
