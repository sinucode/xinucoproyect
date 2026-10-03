'use client'

import { useBusinessClock } from '@/lib/hooks/useBusinessClock'

/**
 * HeaderClock — fecha y hora en vivo del negocio (America/Bogota).
 * Escritorio: "sáb 3 oct · 6:45:12 p. m." · Móvil: "6:45 p. m." (sin fecha ni segundos).
 * Hasta montar reserva el ancho con un placeholder (sin desajuste de hidratación).
 */
export function HeaderClock({ variant }: { variant: 'desktop' | 'mobile' }) {
  const clock = useBusinessClock()

  if (variant === 'mobile') {
    return (
      <span
        className="text-xs tabular-nums text-xinuco-muted whitespace-nowrap shrink-0 min-w-[4.5rem] text-right"
        suppressHydrationWarning
      >
        {clock?.compact ?? ''}
      </span>
    )
  }

  return (
    <span
      className="text-sm tabular-nums text-xinuco-muted whitespace-nowrap min-w-[13rem]"
      aria-label="Fecha y hora del negocio"
      suppressHydrationWarning
    >
      {clock?.full ?? ''}
    </span>
  )
}
