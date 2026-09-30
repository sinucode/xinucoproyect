// Escalas y trazos simples para los gráficos SVG hechos a mano.

/** Redondea un paso a 1, 2, 2.5, 5 × 10^n. */
function niceStep(raw: number): number {
  if (raw <= 0 || !Number.isFinite(raw)) return 1
  const exp = Math.floor(Math.log10(raw))
  const f = raw / 10 ** exp
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nf * 10 ** exp
}

export interface NiceScale {
  min:   number
  max:   number
  ticks: number[]
}

/**
 * Escala "bonita" que SIEMPRE incluye el cero. `target` = cantidad aproximada de marcas.
 * Con `integer` los pasos son enteros (conteos de clientes).
 */
export function niceScale(minValue: number, maxValue: number, target = 4, integer = false): NiceScale {
  let lo = Math.min(0, minValue)
  let hi = Math.max(0, maxValue)
  if (hi === lo) hi = lo + 1
  let step = niceStep((hi - lo) / target)
  if (integer) step = Math.max(1, Math.ceil(step))
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000)
  return { min: lo, max: hi, ticks }
}

/**
 * Barra con las esquinas del extremo de datos redondeadas (r) y la base recta, anclada a la línea base.
 * `dir`: 'up' (crece hacia arriba desde y+h), 'down' (hacia abajo desde y), 'right' (desde x hacia la derecha).
 */
export function roundedBarPath(
  x: number, y: number, w: number, h: number, r: number, dir: 'up' | 'down' | 'right',
): string {
  const rr = Math.max(0, Math.min(r, w / 2, h))
  if (h <= 0 || w <= 0) return ''
  if (dir === 'up') {
    return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
  }
  if (dir === 'down') {
    return `M${x},${y} V${y + h - rr} Q${x},${y + h} ${x + rr},${y + h} H${x + w - rr} Q${x + w},${y + h} ${x + w},${y + h - rr} V${y} Z`
  }
  const rh = Math.max(0, Math.min(r, h / 2, w))
  return `M${x},${y} H${x + w - rh} Q${x + w},${y} ${x + w},${y + rh} V${y + h - rh} Q${x + w},${y + h} ${x + w - rh},${y + h} H${x} Z`
}

/** Corta un texto para que quepa en `maxPx` (aprox. 6,4 px por carácter a 12 px). */
export function fitText(text: string, maxPx: number, charPx = 6.4): string {
  const max = Math.max(3, Math.floor(maxPx / charPx))
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}
