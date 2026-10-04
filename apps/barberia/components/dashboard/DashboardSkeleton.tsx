import {
  NextAppointmentSkeleton,
  AgendaItemSkeleton,
  Skeleton,
} from '@xinuco/ui'

/**
 * DashboardSkeleton — Fallback de Suspense y loading.tsx del Inicio.
 * Replica la estructura de DashboardContent: saludo + (en PC) columna de dinero a la izquierda
 * y agenda del día a la derecha; en celular, una sola columna.
 */
export function DashboardSkeleton() {
  return (
    <>
      {/* Saludo skeleton */}
      <section aria-hidden>
        <Skeleton className="h-3 w-24 mb-2" rounded="sm" />
        <Skeleton className="h-8 w-48" />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] xl:items-start">
        {/* Columna 1 — Caja / próxima cita */}
        <div className="flex flex-col gap-6 min-w-0">
          <section aria-hidden>
            <NextAppointmentSkeleton />
          </section>
        </div>

        {/* Columna 2 — Agenda del día */}
        <div className="flex flex-col gap-6 min-w-0">
          <section aria-hidden>
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
            <ul className="flex flex-col gap-0">
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="mb-2">
                  <AgendaItemSkeleton />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  )
}
