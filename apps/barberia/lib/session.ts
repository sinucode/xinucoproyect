// lib/session.ts — sesión, perfil y negocio memoizados POR PETICIÓN (React cache).
//
// Una sola carga de página ejecutaba auth.getUser() + la fila de profiles hasta ~8 veces (layout,
// página, DashboardContent y el requireAdmin de cada action llamada al renderizar). Cada una era un
// viaje a Supabase en serie. Aquí se hace UNA vez por petición y el resto reutiliza el resultado.
//
// Seguridad:
//  - React cache() vive solo durante UNA petición del servidor: nunca se comparte entre usuarios.
//  - Cada helper recibe el cliente Supabase del llamador (cookies de ESA petición); no se crea otro.
//  - Esto solo evita consultas repetidas: cada action/página sigue haciendo su propia verificación
//    de rol, de negocio y de ownership con los datos devueltos.
//  - Fuera de un render de React (tests/jest) cache() no memoiza, y todo se comporta como antes.

import { cache } from 'react'
import type { createClient } from '@xinuco/supabase/server'
import type { Business } from '@xinuco/types'

type ServerClient = Awaited<ReturnType<typeof createClient>>
type SessionUser = Awaited<ReturnType<ServerClient['auth']['getUser']>>['data']['user']

export interface SessionProfile {
  id:          string
  full_name:   string | null
  role:        string
  business_id: string | null
}

export type SessionBusiness = Pick<
  Business,
  'id' | 'name' | 'branding' | 'brand_config' | 'features_enabled' | 'trial_expires_at'
>

interface RequestStore {
  user?:     Promise<SessionUser>
  profile?:  Promise<SessionProfile | null>
  business:  Map<string, Promise<SessionBusiness | null>>
}

// Un objeto nuevo por petición (cache sin argumentos = alcance de la petición)
const requestStore = cache((): RequestStore => ({ business: new Map() }))

/** Usuario autenticado de la petición (valida el JWT contra Supabase Auth una sola vez). */
export function getSessionUser(supabase: ServerClient): Promise<SessionUser> {
  const store = requestStore()
  return (store.user ??= supabase.auth.getUser().then(({ data }) => data.user))
}

/** Perfil del usuario autenticado (null si no hay sesión o no se pudo leer). */
export function getMyProfile(supabase: ServerClient): Promise<SessionProfile | null> {
  const store = requestStore()
  return (store.profile ??= getSessionUser(supabase).then(async (user) => {
    if (!user) return null
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role, business_id')
      .eq('id', user.id)
      .single<SessionProfile>()
    return data ?? null
  }))
}

/**
 * Negocio del slug de la URL (campos que usan el layout y los feature gates).
 * Sigue sujeto a la RLS del usuario: un usuario ajeno recibe null.
 */
export function getBusinessBySlug(supabase: ServerClient, slug: string): Promise<SessionBusiness | null> {
  const store = requestStore()
  let pending = store.business.get(slug)
  if (!pending) {
    pending = Promise.resolve(
      supabase
        .from('businesses')
        .select('id, name, branding, brand_config, features_enabled, trial_expires_at')
        .eq('slug', slug)
        .single<SessionBusiness>(),
    ).then(({ data }) => data ?? null)
    store.business.set(slug, pending)
  }
  return pending
}
