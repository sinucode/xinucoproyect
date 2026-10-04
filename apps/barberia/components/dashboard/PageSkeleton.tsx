import { Skeleton } from '@xinuco/ui'

/**
 * PageSkeleton — esqueleto genérico para los loading.tsx de las páginas del dashboard.
 *
 * Se muestra al instante al tocar una pestaña (BottomNav / sidebar), mientras el servidor
 * termina de renderizar la página real. Dentro del layout del dashboard: el tema, el Header y
 * la barra inferior no se tocan, solo cambia el área de contenido.
 *
 *  - 'list':  título + barra de herramientas + filas (Agenda, Clientes, Fila, Equipo…)
 *  - 'cards': título + tarjetas de resumen + bloque grande (Inventario, Activos, Fidelización…)
 *  - 'form':  título + secciones de formulario (Configuración)
 */
type PageSkeletonVariant = 'list' | 'cards' | 'form'

interface PageSkeletonProps {
  /** Texto accesible para lectores de pantalla */
  label?: string
  variant?: PageSkeletonVariant
  /**
   * Envoltura exterior idéntica a la de la página real. 'main' = páginas con
   * `<div bg-xinuco-bg><main …>` (Inicio, Agenda); 'div' = el resto (evita saltos de layout).
   */
  shell?: 'div' | 'main'
}

const WRAPPER = 'flex flex-col gap-6 max-w-[1600px] mx-auto w-full min-w-0 px-4 sm:px-6 lg:px-8 py-6'

function Header() {
  return (
    <div className="pb-6 border-b" style={{ borderColor: 'var(--border-color)' }}>
      <Skeleton className="h-7 w-44 max-w-full" />
      <Skeleton className="h-3 w-64 max-w-full mt-3" rounded="sm" />
    </div>
  )
}

function ListBody() {
  return (
    <>
      <Skeleton className="h-11 w-full" rounded="md" />
      <ul className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="card flex items-center gap-3 py-3">
            <Skeleton className="w-11 h-11 shrink-0" rounded="full" />
            <div className="flex-1 flex flex-col gap-2 min-w-0">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="w-14 h-6 shrink-0" rounded="full" />
          </li>
        ))}
      </ul>
    </>
  )
}

function CardsBody() {
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card">
            <Skeleton className="h-3 w-16 mb-3" rounded="sm" />
            <Skeleton className="h-7 w-24" />
          </div>
        ))}
      </div>
      <Skeleton className="h-72 w-full" rounded="lg" />
    </>
  )
}

function FormBody() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="card flex items-center gap-3">
          <Skeleton className="w-10 h-10 shrink-0" rounded="lg" />
          <div className="flex-1 flex flex-col gap-2 min-w-0">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
      <Skeleton className="h-40 w-full" rounded="lg" />
    </div>
  )
}

export function PageSkeleton({ label = 'Cargando', variant = 'list', shell = 'div' }: PageSkeletonProps) {
  const body = (
    <>
      <Header />
      {variant === 'cards' ? <CardsBody /> : variant === 'form' ? <FormBody /> : <ListBody />}
    </>
  )

  if (shell === 'main') {
    return (
      <div className="bg-xinuco-bg min-h-screen" aria-busy="true" aria-label={label} role="status">
        <main className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">{body}</main>
      </div>
    )
  }

  return (
    <div className={WRAPPER} aria-busy="true" aria-label={label} role="status">
      {body}
    </div>
  )
}
