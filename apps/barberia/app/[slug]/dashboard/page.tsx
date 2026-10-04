import { Suspense }           from 'react'
import { createClient }        from '@xinuco/supabase/server'
import { redirect }            from 'next/navigation'
import type { Metadata }       from 'next'

import { DashboardContent }    from '@/components/dashboard/DashboardContent'
import { DashboardSkeleton }   from '@/components/dashboard/DashboardSkeleton'
import { getSessionUser }      from '@/lib/session'

export const metadata: Metadata = {
  title: 'Dashboard — Xinuco',
}

interface DashboardPageProps {
  params: Promise<{ slug: string }>
}

/**
 * DashboardPage — Orquestador del panel principal.
 *
 * Arquitectura de streaming:
 *  1. El Header se renderiza INMEDIATAMENTE (datos ya disponibles desde el TenantLayout).
 *  2. <DashboardContent> es un async Server Component envuelto en <Suspense>.
 *     Mientras resuelve sus queries, el usuario ve <DashboardSkeleton> (shimmer animado).
 *  3. Una vez que la data llega, React hace streaming del contenido real sin re-hidratación completa.
 *
 * Nota: business y userName se obtienen aquí de forma liviana (solo select name/branding/full_name)
 * para poder renderizar el Header sin esperar todo el DashboardContent.
 */
export default async function DashboardPage({ params }: DashboardPageProps) {
  const { slug } = await params
  const supabase  = await createClient()

  // Guard rápido de sesión
  const user = await getSessionUser(supabase)
  if (!user) redirect(`/${slug}/login`)

  return (
    <div className="bg-xinuco-bg">
      <main className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardContent slug={slug} />
        </Suspense>
      </main>
    </div>
  )
}
