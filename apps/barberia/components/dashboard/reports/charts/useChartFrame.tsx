'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { CHART } from './theme'

// ── Ancho del contenedor (los gráficos se ajustan al ancho de su tarjeta) ─────

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(Math.floor(el.getBoundingClientRect().width))
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0)
      setWidth(prev => (prev === w ? prev : w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, width]
}

// ── Tooltip: hover (escritorio) / toque (móvil) ───────────────────────────────

export interface TipRow {
  label:   string
  value:   string
  /** Color del marcador (cuadrito). El texto nunca usa el color de la serie. */
  marker?: string
}

export interface TipContent {
  title: string
  rows?: TipRow[]
  /** Línea libre bajo las filas */
  note?: string
}

interface TipState {
  key:     string
  x:       number
  y:       number
  content: TipContent
}

const TIP_W = 220

function Tooltip({ tip, width }: { tip: TipState; width: number }) {
  const half = Math.min(TIP_W, Math.max(120, width - 8)) / 2
  const left = Math.max(half + 4, Math.min(tip.x, width - half - 4))
  const above = tip.y > 70
  return (
    <div
      role="tooltip"
      className="absolute z-20 pointer-events-none rounded-lg px-3 py-2 shadow-lg"
      style={{
        left,
        top: tip.y,
        width: half * 2,
        transform: `translate(-50%, ${above ? 'calc(-100% - 10px)' : '12px'})`,
        background: CHART.surface,
        border: `1px solid ${CHART.axis}`,
      }}
    >
      <p className="text-xs font-semibold" style={{ color: CHART.ink }}>{tip.content.title}</p>
      {tip.content.rows?.map((r, i) => (
        <p key={i} className="flex items-center justify-between gap-3 text-xs mt-1" style={{ color: CHART.ink2 }}>
          <span className="flex items-center gap-1.5 min-w-0">
            {r.marker && <span aria-hidden className="inline-block h-2 w-2 rounded-sm shrink-0" style={{ background: r.marker }} />}
            <span className="break-words">{r.label}</span>
          </span>
          <span className="tabular-nums whitespace-nowrap font-medium" style={{ color: CHART.ink }}>{r.value}</span>
        </p>
      ))}
      {tip.content.note && <p className="text-[11px] mt-1" style={{ color: CHART.muted }}>{tip.content.note}</p>}
    </div>
  )
}

export interface ChartFrame {
  /** Ref del contenedor (`relative w-full`) */
  ref:      React.RefObject<HTMLDivElement | null>
  width:    number
  /** Propiedades de eventos para una marca: hover con mouse, toque con dedo. */
  bind:     (key: string, anchor: { x: number; y: number }, content: TipContent) => {
    onPointerEnter: (e: React.PointerEvent) => void
    onPointerLeave: (e: React.PointerEvent) => void
    onPointerDown:  (e: React.PointerEvent) => void
    onClick:        (e: React.MouseEvent) => void
  }
  /** Al tocar el fondo del gráfico se cierra el tooltip */
  clear:    () => void
  tooltip:  ReactNode
}

/** Ancho + tooltip. Las coordenadas del ancla son píxeles dentro del contenedor (el SVG mide lo mismo). */
export function useChartFrame(): ChartFrame {
  const [ref, width] = useContainerWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState | null>(null)

  const clear = useCallback(() => setTip(null), [])
  const lastPointer = useRef<string>('mouse')

  // Toque fuera del gráfico → cierra
  useEffect(() => {
    if (!tip) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setTip(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [tip, ref])

  const bind: ChartFrame['bind'] = (key, anchor, content) => ({
    onPointerEnter: e => { if (e.pointerType === 'mouse') setTip({ key, ...anchor, content }) },
    onPointerLeave: e => { if (e.pointerType === 'mouse') setTip(null) },
    onPointerDown: e => { lastPointer.current = e.pointerType },
    onClick: e => {
      e.stopPropagation()
      // Mouse: el hover ya lo abrió, el clic lo deja abierto. Dedo: tocar abre; tocar de nuevo cierra.
      if (lastPointer.current === 'mouse') setTip({ key, ...anchor, content })
      else setTip(prev => (prev?.key === key ? null : { key, ...anchor, content }))
    },
  })

  return { ref, width, bind, clear, tooltip: tip ? <Tooltip tip={tip} width={width} /> : null }
}
