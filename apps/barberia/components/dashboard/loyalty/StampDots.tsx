// Puntos de progreso del programa de sellos: "●●●●●●●○○○" (llenos = sellos ganados).
// Sin estado: se usa en el cobro, el panel de lealtad y el CRM.

interface StampDotsProps {
  balance:  number
  required: number
  /** Diámetro de cada punto en px. */
  size?:    number
}

export function StampDots({ balance, required, size = 10 }: StampDotsProps) {
  const total  = Math.max(1, Math.min(required, 50))
  const filled = Math.max(0, Math.min(balance, total))

  return (
    <span
      className="inline-flex flex-wrap items-center gap-1"
      role="img"
      aria-label={`${balance} de ${required} sellos`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="rounded-full border"
          style={{
            width:           size,
            height:          size,
            backgroundColor: i < filled ? 'var(--primary-color)' : 'transparent',
            borderColor:     i < filled ? 'var(--primary-color)' : 'var(--border-color)',
          }}
        />
      ))}
    </span>
  )
}
