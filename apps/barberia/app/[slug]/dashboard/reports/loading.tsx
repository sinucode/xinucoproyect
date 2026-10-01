const BLOCK = { background: 'var(--surface-color, rgba(255,255,255,0.06))' }

export default function ReportsLoading() {
  return (
    <div
      className="flex flex-col gap-6 max-w-5xl mx-auto w-full min-w-0 px-4 sm:px-6 py-6 animate-pulse"
      aria-busy="true"
      aria-label="Cargando reportes"
    >
      <div className="pb-6 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="h-7 w-32 rounded-md" style={BLOCK} />
        <div className="h-3 w-72 max-w-full rounded-md mt-3" style={BLOCK} />
      </div>
      {/* Chips de período */}
      <div className="flex gap-2 overflow-hidden">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-9 w-24 shrink-0 rounded-full" style={BLOCK} />
        ))}
      </div>
      {/* Utilidad del período */}
      <div className="h-48 rounded-2xl" style={BLOCK} />
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className={`h-24 rounded-xl ${i === 4 ? 'col-span-2 lg:col-span-1' : ''}`} style={BLOCK} />
        ))}
      </div>
      <div className="h-64 rounded-2xl" style={BLOCK} />
      <div className="h-80 rounded-2xl" style={BLOCK} />
    </div>
  )
}
