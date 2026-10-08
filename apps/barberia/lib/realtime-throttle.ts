// lib/realtime-throttle.ts — lógica PURA para coalescer ráfagas de eventos Realtime en un único refresh.
// Sin 'use client' ni 'use server'.

export interface RefreshScheduler {
  /** Pide un refresh: se agrupa con otros pedidos cercanos (debounce) y respeta el intervalo mínimo. */
  trigger: () => void
  /** Cancela cualquier refresh pendiente. */
  cancel: () => void
}

interface Options {
  /** Espera (ms) tras el ÚLTIMO evento antes de refrescar. */
  debounceMs: number
  /** Separación mínima (ms) entre dos refreshes consecutivos. */
  minIntervalMs: number
  onRefresh: () => void
  /** Inyectable para tests; por defecto Date.now. */
  now?: () => number
}

export function createRefreshScheduler({ debounceMs, minIntervalMs, onRefresh, now = Date.now }: Options): RefreshScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastRun = -Infinity

  function run() {
    timer = null
    lastRun = now()
    onRefresh()
  }

  function trigger() {
    // Debounce: cada evento nuevo reinicia la espera
    if (timer) clearTimeout(timer)
    // Throttle: nunca antes de lastRun + minIntervalMs
    const wait = Math.max(debounceMs, lastRun + minIntervalMs - now())
    timer = setTimeout(run, wait)
  }

  function cancel() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  return { trigger, cancel }
}

/** Backoff exponencial para reintentos de suscripción: 1 s, 2 s, 4 s... con tope de maxMs (30 s). */
export function realtimeBackoffMs(attempt: number, baseMs = 1000, maxMs = 30000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
}
