// Piezas compartidas de "Horario y días cerrados" (evita importaciones circulares).

export interface ClosureRow {
  id:        string
  date_from: string
  date_to:   string
  kind:      'holiday' | 'custom'
  reason:    string
}

export function cardStyle(): React.CSSProperties {
  return { backgroundColor: 'var(--card-color, #111111)', border: '1px solid var(--border-color)' }
}

export function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)' }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-zinc-100">{title}</h2>
        <p className="text-xs text-zinc-500 leading-relaxed">{subtitle}</p>
      </div>
    </div>
  )
}

