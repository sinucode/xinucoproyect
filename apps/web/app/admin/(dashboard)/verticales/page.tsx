import { createClient } from '@xinuco/supabase/server'
import { Scissors, Layers, ArrowUpRight } from 'lucide-react'
import { VERTICALS } from '@/lib/verticals'

const VERTICAL_ICONS: Record<string, typeof Scissors> = {
  barberia: Scissors,
}

/**
 * /admin/verticales — Home del panel global. Lista las verticales activas de Xinuco.
 * El guard de auth ya corre en (dashboard)/layout.tsx.
 */
export default async function VerticalesPage() {
  const supabase = await createClient()

  // Fase 1: `businesses` no tiene columna `vertical` — todas las filas son de barbería.
  const { count, error } = await supabase
    .from('businesses')
    .select('id', { count: 'exact', head: true })

  const barberiaCount = error ? null : count

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#F4F4F4' }}>Verticales</h1>
        <p className="text-sm mt-0.5" style={{ color: 'rgba(244,244,244,0.45)' }}>
          {VERTICALS.length} vertical{VERTICALS.length === 1 ? '' : 'es'} activa{VERTICALS.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {VERTICALS.map((vertical) => {
          const Icon = VERTICAL_ICONS[vertical.id] ?? Layers
          const count = vertical.id === 'barberia' ? barberiaCount : null

          return (
            <a
              key={vertical.id}
              href={vertical.consoleUrl}
              className="group flex flex-col gap-4 p-5 rounded-2xl transition-colors hover:bg-white/[0.03]"
              style={{ border: '1px solid rgba(197,160,89,0.12)', background: 'rgba(255,255,255,0.02)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: 'color-mix(in srgb, #C5A059 15%, transparent)',
                    border:     '1px solid color-mix(in srgb, #C5A059 30%, transparent)',
                    color:      '#C5A059',
                  }}
                >
                  <Icon size={18} strokeWidth={2} />
                </div>
                <ArrowUpRight
                  size={16}
                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  style={{ color: 'rgba(244,244,244,0.35)' }}
                />
              </div>

              <div className="flex flex-col gap-1">
                <span className="font-semibold text-sm" style={{ color: '#F4F4F4' }}>
                  {vertical.name}
                </span>
                <p className="text-xs leading-relaxed" style={{ color: 'rgba(244,244,244,0.45)' }}>
                  {vertical.description}
                </p>
              </div>

              <div
                className="flex items-center justify-between pt-3"
                style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
              >
                <span className="text-xs tabular-nums" style={{ color: 'rgba(244,244,244,0.55)' }}>
                  {count === null ? '—' : `${count} negocio${count === 1 ? '' : 's'}`}
                </span>
                <span className="text-xs font-medium" style={{ color: '#C5A059' }}>
                  Abrir consola →
                </span>
              </div>
            </a>
          )
        })}
      </div>
    </div>
  )
}
