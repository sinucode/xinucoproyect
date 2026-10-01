// lib/settings-guard.ts — guardia común de las páginas de Configuración (Server Components).
//
// Solo un administrador del negocio de la URL entra. El negocio sale del perfil de la sesión
// y debe coincidir con el del slug (nunca se confía en el slug solo).

import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'

export async function requireSettingsAdmin(slug: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${slug}/login`)

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id, full_name')
    .eq('id', user.id)
    .single<{ role: string; business_id: string | null; full_name: string | null }>()

  if (!profile?.business_id) redirect(`/${slug}/login`)
  if (profile.role !== 'admin' && profile.role !== 'super_admin') redirect(`/${slug}/dashboard`)

  const { data: biz } = await supabase
    .from('businesses')
    .select('id')
    .eq('slug', slug)
    .maybeSingle<{ id: string }>()

  if (!biz || biz.id !== profile.business_id) redirect(`/${slug}/login`)

  return { supabase, businessId: biz.id, fullName: profile.full_name }
}
