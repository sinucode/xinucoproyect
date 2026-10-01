'use client'

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, 10)
}

function withThousands(digits: string): string {
  return digits ? Number(digits).toLocaleString('es-CO') : ''
}

/**
 * Campo de dinero en pesos: escribe solo dígitos y se ve con puntos de miles.
 * `value` es el texto de dígitos (sin puntos); conviértelo con Number() al guardar.
 */
export function MoneyField({
  id, value, onChange, placeholder, ariaLabel, autoFocus, disabled,
}: {
  id?:          string
  value:        string
  onChange:     (digits: string) => void
  placeholder?: string
  ariaLabel?:   string
  autoFocus?:   boolean
  disabled?:    boolean
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-xinuco-muted">$</span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        disabled={disabled}
        value={withThousands(value)}
        onChange={e => onChange(digitsOnly(e.target.value))}
        placeholder={placeholder ?? '0'}
        className="input-base min-h-11 pl-7 tabular-nums"
      />
    </div>
  )
}
