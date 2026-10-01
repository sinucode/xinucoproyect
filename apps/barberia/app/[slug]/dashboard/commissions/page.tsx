import { redirect } from 'next/navigation'

/**
 * Comisiones vive ahora dentro de Equipo (pestaña "Comisiones").
 * Se conserva la ruta para enlaces y marcadores antiguos.
 */
export default async function CommissionsRedirectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  redirect(`/${slug}/dashboard/staff?tab=comisiones`)
}
