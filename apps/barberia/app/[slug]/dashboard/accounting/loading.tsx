export default function AccountingLoading() {
  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 animate-pulse" aria-busy="true">
      <div className="pb-6 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="h-7 w-44 rounded-md" style={{ background: 'var(--surface-color, rgba(255,255,255,0.06))' }} />
        <div className="h-3 w-64 max-w-full rounded-md mt-3" style={{ background: 'var(--surface-color, rgba(255,255,255,0.06))' }} />
      </div>
      <div className="h-10 rounded-xl" style={{ background: 'var(--surface-color, rgba(255,255,255,0.06))' }} />
      <div className="h-10 rounded-xl" style={{ background: 'var(--surface-color, rgba(255,255,255,0.06))' }} />
      <div className="h-72 rounded-2xl" style={{ background: 'var(--surface-color, rgba(255,255,255,0.06))' }} />
    </div>
  )
}
