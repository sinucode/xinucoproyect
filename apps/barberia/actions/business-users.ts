'use server'
// ============================================================
// actions/business-users.ts — Gestión de usuarios de un negocio
// desde la consola de vertical (/adminbarberia). Solo super_admin.
// ============================================================

import { createClient, createAdminClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

export interface ActionResult {
  success: boolean
  error?:  string
}

export interface BusinessUser {
  id:               string
  full_name:        string
  role:             string
  email:            string | null
  is_active:        boolean
  last_sign_in_at:   string | null
  created_at:       string
}

const ASSIGNABLE_ROLES = ['admin', 'barber', 'manicurist'] as const
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

type AdminClient = ReturnType<typeof createAdminClient> extends Promise<infer T> ? T : never

// ── Auth guard — igual que el resto de acciones de super_admin ───────────────
// [SEC] app_metadata.role del JWT, nunca profiles — el cliente no puede escribirlo.
async function requireSuperAdmin(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'No autenticado.'
  if (user.app_metadata?.role !== 'super_admin') return 'Acceso denegado. Se requiere rol super_admin.'
  return null
}

// [SEC] IDOR guard — evita que un userId de OTRO negocio sea manipulado desde
// este panel, y evita que una cuenta super_admin sea tocada como si fuera staff.
async function assertUserInBusiness(
  adminClient: AdminClient,
  businessId: string,
  userId: string,
): Promise<string | null> {
  const { data: profile, error } = await adminClient
    .from('profiles')
    .select('id, role, business_id')
    .eq('id', userId)
    .single()

  if (error || !profile) return 'Usuario no encontrado.'
  if (profile.business_id !== businessId) return 'El usuario no pertenece a este negocio.'
  if (profile.role === 'super_admin') return 'No se puede modificar una cuenta super_admin.'

  // El rol real de super_admin vive en app_metadata: una cuenta super_admin puede
  // tener además una fila en profiles con otro rol, y no debe tocarse desde aquí.
  const { data: { user } } = await adminClient.auth.admin.getUserById(userId)
  if (!user) return 'Usuario no encontrado.'
  if (user.app_metadata?.role === 'super_admin') return 'No se puede modificar una cuenta super_admin.'
  return null
}

function mapAuthError(message: string | undefined): string {
  const msg = (message ?? '').toLowerCase()
  if (msg.includes('already') || msg.includes('registered') || msg.includes('duplicate')) {
    return 'Ese correo ya está en uso.'
  }
  console.error('[business-users] error de auth:', message)
  return 'No se pudo completar la operación. Inténtalo de nuevo.'
}

// ── listBusinessUsers ─────────────────────────────────────────────────────────

export async function listBusinessUsers(businessId: string): Promise<{
  data: BusinessUser[] | null
  error: string | null
}> {
  const authError = await requireSuperAdmin()
  if (authError) return { data: null, error: authError }

  const adminClient = await createAdminClient()

  const { data: profiles, error: profilesError } = await adminClient
    .from('profiles')
    .select('id, full_name, role, created_at')
    .eq('business_id', businessId)
    .order('created_at')

  if (profilesError) return { data: null, error: profilesError.message }

  const staff = (profiles ?? []).filter((p: { role: string }) => p.role !== 'super_admin')

  const enriched = await Promise.all(staff.map(async (p: { id: string; full_name: string; role: string; created_at: string }) => {
    try {
      const { data: { user } } = await adminClient.auth.admin.getUserById(p.id)
      if (user?.app_metadata?.role === 'super_admin') return null
      const bannedUntil = user?.banned_until ?? null
      const isActive = !bannedUntil || new Date(bannedUntil) <= new Date()
      return {
        id: p.id,
        full_name: p.full_name,
        role: p.role,
        email: user?.email ?? null,
        is_active: isActive,
        last_sign_in_at: user?.last_sign_in_at ?? null,
        created_at: p.created_at,
      }
    } catch (err) {
      console.error('listBusinessUsers: no se pudo enriquecer usuario', p.id)
      return {
        id: p.id, full_name: p.full_name, role: p.role,
        email: null, is_active: true, last_sign_in_at: null, created_at: p.created_at,
      }
    }
  }))

  return { data: enriched.filter((u): u is BusinessUser => u !== null), error: null }
}

// ── createBusinessUser ────────────────────────────────────────────────────────

export async function createBusinessUser(params: {
  businessId: string
  email:      string
  password:   string
  fullName:   string
  role:       AssignableRole
}): Promise<ActionResult & { userId?: string }> {
  const authError = await requireSuperAdmin()
  if (authError) return { success: false, error: authError }

  const email    = params.email.trim()
  const fullName = params.fullName.trim()

  if (!email)                                     return { success: false, error: 'El correo es obligatorio.' }
  if (params.password.length < 8)                 return { success: false, error: 'La contraseña debe tener al menos 8 caracteres.' }
  if (!fullName)                                   return { success: false, error: 'El nombre es obligatorio.' }
  if (!ASSIGNABLE_ROLES.includes(params.role))     return { success: false, error: 'Rol inválido.' }

  const adminClient = await createAdminClient()

  // slug SIEMPRE desde el servidor — nunca confiar en lo que envía el cliente
  const { data: biz, error: bizError } = await adminClient
    .from('businesses')
    .select('slug')
    .eq('id', params.businessId)
    .single()

  if (bizError || !biz) return { success: false, error: 'Negocio no encontrado.' }

  const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: params.password,
    email_confirm: true,
    app_metadata: { business_id: params.businessId, slug: biz.slug },
    user_metadata: { full_name: fullName },
  })

  if (createError || !createData?.user) {
    return { success: false, error: mapAuthError(createError?.message) }
  }

  const userId = createData.user.id

  const { error: profileError } = await adminClient
    .from('profiles')
    .upsert({ id: userId, business_id: params.businessId, full_name: fullName, role: params.role })

  if (profileError) {
    await adminClient.auth.admin.deleteUser(userId)
    console.error('createBusinessUser: perfil no creado, se hizo rollback del usuario auth')
    return { success: false, error: `Perfil no creado: ${profileError.message}` }
  }

  revalidatePath('/adminbarberia')
  return { success: true, userId }
}

// ── updateBusinessUser ────────────────────────────────────────────────────────

export async function updateBusinessUser(
  businessId: string,
  userId: string,
  params: { fullName: string; email: string; role: AssignableRole },
): Promise<ActionResult> {
  const authError = await requireSuperAdmin()
  if (authError) return { success: false, error: authError }

  const adminClient = await createAdminClient()

  const assertError = await assertUserInBusiness(adminClient, businessId, userId)
  if (assertError) return { success: false, error: assertError }

  const fullName = params.fullName.trim()
  const email    = params.email.trim()

  if (!fullName)                                 return { success: false, error: 'El nombre es obligatorio.' }
  if (!email)                                     return { success: false, error: 'El correo es obligatorio.' }
  if (!ASSIGNABLE_ROLES.includes(params.role))    return { success: false, error: 'Rol inválido.' }

  // Auth primero: si el correo está en uso falla aquí, antes de tocar el perfil.
  const { data: { user: currentUser } } = await adminClient.auth.admin.getUserById(userId)

  const updates: { user_metadata: { full_name: string }; email?: string; email_confirm?: boolean } = {
    user_metadata: { full_name: fullName },
  }
  if (currentUser?.email !== email) {
    updates.email = email
    updates.email_confirm = true
  }

  const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(userId, updates)
  if (authUpdateError) return { success: false, error: mapAuthError(authUpdateError.message) }

  const { error: profileError } = await adminClient
    .from('profiles')
    .update({ full_name: fullName, role: params.role })
    .eq('id', userId)
    .eq('business_id', businessId)

  if (profileError) {
    console.error('[business-users] updateBusinessUser perfil:', profileError.message)
    return { success: false, error: 'No se pudo actualizar el perfil.' }
  }

  revalidatePath('/adminbarberia')
  return { success: true }
}

// ── setBusinessUserActive ─────────────────────────────────────────────────────

export async function setBusinessUserActive(
  businessId: string,
  userId: string,
  active: boolean,
): Promise<ActionResult> {
  const authError = await requireSuperAdmin()
  if (authError) return { success: false, error: authError }

  const adminClient = await createAdminClient()

  const assertError = await assertUserInBusiness(adminClient, businessId, userId)
  if (assertError) return { success: false, error: assertError }

  const { error } = await adminClient.auth.admin.updateUserById(userId, {
    ban_duration: active ? 'none' : '876600h', // ~100 años
  })

  if (error) return { success: false, error: error.message }

  revalidatePath('/adminbarberia')
  return { success: true }
}

// ── setBusinessUserPassword ───────────────────────────────────────────────────

export async function setBusinessUserPassword(
  businessId: string,
  userId: string,
  password: string,
): Promise<ActionResult> {
  const authError = await requireSuperAdmin()
  if (authError) return { success: false, error: authError }

  const adminClient = await createAdminClient()

  const assertError = await assertUserInBusiness(adminClient, businessId, userId)
  if (assertError) return { success: false, error: assertError }

  if (password.length < 8) return { success: false, error: 'La contraseña debe tener al menos 8 caracteres.' }

  // [SEC] nunca loguear la contraseña ni incluirla en mensajes de error
  const { error } = await adminClient.auth.admin.updateUserById(userId, { password })
  if (error) return { success: false, error: 'No se pudo actualizar la contraseña.' }

  revalidatePath('/adminbarberia')
  return { success: true }
}
