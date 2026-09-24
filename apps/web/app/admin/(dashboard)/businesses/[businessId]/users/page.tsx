import { createClient } from '@xinuco/supabase/server'
import { redirect } from 'next/navigation'
import { listBusinessUsers } from '@/actions/super-admin'
import { UserManager } from '@/components/super-admin/UserManager'

interface PageProps {
  params: Promise<{ businessId: string }>
}

/**
 * super-admin/businesses/[businessId]/users/page.tsx — Server Component
 * Shows the user management panel for a specific business.
 */
export default async function BusinessUsersPage({ params }: PageProps) {
  const { businessId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/admin/login')

  if (user.app_metadata?.role !== 'super_admin') redirect('/admin/login')

  const { data: biz, error } = await supabase
    .from('businesses')
    .select('id, name, slug')
    .eq('id', businessId)
    .returns<{ id: string, name: string, slug: string }[]>()
    .single()

  if (error || !biz) redirect('/admin/businesses')

  const { data: users } = await listBusinessUsers(businessId)

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(244,244,244,0.45)' }}>
        <a href="/admin/businesses" style={{ color: '#C5A059' }}>Negocios</a>
        <span>/</span>
        <a href={`/admin/businesses/${businessId}`} style={{ color: '#C5A059' }}>
          {biz.name}
        </a>
        <span>/</span>
        <span>Usuarios</span>
      </div>

      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#F4F4F4' }}>
          {biz.name} — Usuarios
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'rgba(244,244,244,0.45)' }}>/{biz.slug}</p>
      </div>

      {/* Tab nav */}
      <div
        className="flex gap-1 border-b pb-4"
        style={{ borderColor: 'rgba(197,160,89,0.12)' }}
      >
        <a
          href={`/admin/businesses/${businessId}`}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ color: 'rgba(244,244,244,0.45)' }}
        >
          Features
        </a>
        <a
          href={`/admin/businesses/${businessId}/users`}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'rgba(197,160,89,0.1)', color: '#C5A059' }}
        >
          Usuarios
        </a>
      </div>

      {/* User manager (client component) */}
      <UserManager
        businessId={biz.id}
        slug={biz.slug}
        users={users ?? []}
      />
    </div>
  )
}
