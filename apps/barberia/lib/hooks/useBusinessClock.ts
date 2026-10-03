'use client'

import { useEffect, useState } from 'react'

const BUSINESS_TZ = 'America/Bogota'

const fullFormat = new Intl.DateTimeFormat('es-CO', {
  timeZone: BUSINESS_TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
})

const compactFormat = new Intl.DateTimeFormat('es-CO', {
  timeZone: BUSINESS_TZ,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

export interface BusinessClock {
  /** "sáb 3 oct · 6:45:12 p. m." (hora de Bogotá) */
  full: string
  /** "6:45 p. m." (sin segundos ni fecha) */
  compact: string
}

/** "sáb, 3 oct, 6:45:12 p. m." → "sáb 3 oct · 6:45:12 p. m." */
function formatFull(now: Date): string {
  const parts = fullFormat.formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(p => p.type === type)?.value ?? ''
  const weekday = get('weekday').replace('.', '')
  const month = get('month').replace('.', '')
  const hour = get('hour')
  const minute = get('minute')
  const second = get('second')
  const dayPeriod = get('dayPeriod').replace(/\s+/g, ' ')
  return `${weekday} ${get('day')} ${month} · ${hour}:${minute}:${second} ${dayPeriod}`.trim()
}

/**
 * Reloj en vivo en la zona horaria del negocio (America/Bogota), con tick cada segundo.
 * Devuelve null hasta que el componente se monta (evita el desajuste de hidratación SSR/cliente).
 */
export function useBusinessClock(): BusinessClock | null {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!now) return null
  return { full: formatFull(now), compact: compactFormat.format(now).replace(/\s+/g, ' ') }
}
