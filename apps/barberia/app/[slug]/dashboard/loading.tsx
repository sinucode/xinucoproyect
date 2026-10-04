import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton'

// Inicio: feedback instantáneo al tocar la pestaña (mismo wrapper que page.tsx → sin salto de layout)
export default function DashboardLoading() {
  return (
    <div className="bg-xinuco-bg" aria-busy="true" aria-label="Cargando inicio">
      <main className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <DashboardSkeleton />
      </main>
    </div>
  )
}
