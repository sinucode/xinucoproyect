// Paleta y medidas de los gráficos del tablero. Los neutros (guías, ejes, texto, tooltip, celda vacía)
// son variables CSS del dashboard (globals.css) con el valor oscuro histórico como fallback, así leen bien
// en modo claro; los colores categóricos y de estado no cambian.
export const CHART = {
  grid:    'var(--chart-grid, #2c2c2a)',   // líneas guía (hairline)
  axis:    'var(--chart-axis, #383835)',   // ejes y línea base
  muted:   'var(--chart-muted, #898781)',   // texto de ejes
  ink2:    'var(--chart-ink-2, #c3c2b7)',   // texto secundario
  ink:     'var(--chart-ink, #ffffff)',   // texto principal
  surface: 'var(--chart-surface, #1a1a19)',   // fondo de tooltips
  // Categóricos en orden fijo
  blue:    '#3987e5',
  orange:  '#d95926',
  aqua:    '#199e70',
  yellow:  '#c98500',
  magenta: '#d55181',
  green:   '#008300',
  violet:  '#9085e9',
  red:     '#e66767',
  // Estado (siempre con ícono o signo + texto)
  good:     '#0ca30c',
  warning:  '#fab219',
  critical: '#d03b3b',
  // Sin dato
  empty:   'var(--chart-empty, #1f1f1d)',
} as const

export const FONT_SIZE = 11
export const FONT_SIZE_LABEL = 12

/** Clases de texto de estado (pares con ▲/▼ o +/−). */
export const STATUS_TEXT = {
  good:     'text-emerald-400',
  critical: 'text-red-400',
  warning:  'text-amber-400',
  neutral:  'text-xinuco-muted',
} as const
