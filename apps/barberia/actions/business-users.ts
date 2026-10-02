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
  /** Profesional del equipo (staff) vinculado a esta cuenta, si lo hay */
  linked_staff:     { id: string; full_name: string } | null
}

/** Vínculo de la cuenta con un profesional del negocio (solo barbero/manicurista) */
export type StaffLink =
  | { mode: 'none' }
  | { mode: 'existing'; staffId: string }
  | { mode: 'new' }

const ASSIGNABLE_ROLES = ['admin', 'barber', 'manicurist'] as const
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

const LINKABLE_ROLES: readonly string[] = ['barber', 'manicurist']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAFF_LINK_INVALID = 'Vínculo con profesional inválido.'

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
  const raw = (message ?? '').trim()
  const msg = raw.toLowerCase()
  if (msg.includes('already') || msg.includes('registered') || msg.includes('duplicate')) {
    return 'Ese correo ya está en uso.'
  }
  // Supabase rechaza contraseñas filtradas en internet (Have I Been Pwned) o muy comunes
  if (msg.includes('weak') || msg.includes('pwned') || msg.includes('easy to guess')) {
    return 'Esa contraseña es muy común o apareció en filtraciones de internet. Usa una más segura (mezcla mayúsculas, minúsculas, números y símbolos).'
  }
  if (msg.includes('should contain')) {
    return 'La contraseña debe tener mayúsculas, minúsculas, números y símbolos.'
  }
  if (msg.includes('password should be at least') || msg.includes('password is too short')) {
    return 'La contraseña es demasiado corta.'
  }
  if (msg.includes('email') && (msg.includes('invalid') || msg.includes('validate'))) {
    return 'El correo no es válido.'
  }
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return 'Demasiados intentos seguidos. Espera un minuto e inténtalo de nuevo.'
  }
  console.error('[business-users] error de auth:', raw)
  if (msg.includes('database error')) {
    return 'La base de datos rechazó el registro del usuario. Revisa el log de Auth en Supabase.'
  }
  // Pantalla solo de super_admin: mostrar la causa real ayuda a resolverla (nunca incluye la contraseña)
  return raw ? `No se pudo completar la operación: ${raw}` : 'No se pudo completar la operación. Inténtalo de nuevo.'
}

// ── Vínculo cuenta ↔ profesional ──────────────────────────────────────────────

// [SEC] El cliente envía datos sin tipar: solo se aceptan los tres modos conocidos.
function parseStaffLink(input: unknown): StaffLink | null {
  if (!input || typeof input !== 'object') return null
  const l = input as { mode?: unknown; staffId?: unknown }
  if (l.mode === 'none') return { mode: 'none' }
  if (l.mode === 'new') return { mode: 'new' }
  if (l.mode === 'existing' && typeof l.staffId === 'string') {
    return { mode: 'existing', staffId: l.staffId }
  }
  return null
}

/**
 * Aplica el vínculo de la cuenta con un profesional del negocio.
 * Devuelve un mensaje de error en español, o null si todo salió bien.
 * [SEC] Usa service role: TODA consulta filtra por business_id.
 */
async function applyStaffLink(
  adminClient: AdminClient,
  businessId: string,
  userId: string,
  role: AssignableRole,
  fullName: string,
  link: StaffLink,
): Promise<string | null> {
  // Desvincula la cuenta de cualquier profesional del negocio (opcionalmente excepto uno)
  const unlink = async (exceptStaffId?: string): Promise<string | null> => {
    let q = adminClient
      .from('staff')
      .update({ user_id: null })
      .eq('business_id', businessId)
      .eq('user_id', userId)
    if (exceptStaffId) q = q.neq('id', exceptStaffId)
    const { error } = await q
    if (error) {
      console.error('[business-users] applyStaffLink desvincular:', error.message)
      return 'No se pudo desvincular al profesional anterior.'
    }
    return null
  }

  if (!LINKABLE_ROLES.includes(role) || link.mode === 'none') {
    return unlink()
  }

  if (link.mode === 'existing') {
    if (typeof link.staffId !== 'string' || !UUID_RE.test(link.staffId)) return STAFF_LINK_INVALID

    const { data: target, error: targetError } = await adminClient
      .from('staff')
      .select('id, user_id')
      .eq('id', link.staffId)
      .eq('business_id', businessId)
      .maybeSingle()
    if (targetError) {
      console.error('[business-users] applyStaffLink buscar profesional:', targetError.message)
      return 'No se pudo consultar al profesional.'
    }
    if (!target) return 'Profesional no encontrado.'
    if (target.user_id && target.user_id !== userId) {
      return 'Ese profesional ya tiene otra cuenta vinculada.'
    }

    const unlinkError = await unlink(link.staffId)
    if (unlinkError) return unlinkError

    const { error } = await adminClient
      .from('staff')
      .update({ user_id: userId })
      .eq('id', link.staffId)
      .eq('business_id', businessId)
    if (error) {
      if (error.code === '23505') return 'Ese usuario ya está vinculado a otro profesional.'
      console.error('[business-users] applyStaffLink vincular:', error.message)
      return 'No se pudo vincular al profesional.'
    }
    return null
  }

  // mode === 'new': profesional nuevo (sin horario y con todos los servicios)
  const unlinkError = await unlink()
  if (unlinkError) return unlinkError

  const { error } = await adminClient
    .from('staff')
    .insert({
      business_id:    businessId,
      full_name:      fullName,
      specialty_role: role === 'manicurist' ? 'Manicurista' : 'Barbero',
      is_active:      true,
      user_id:        userId,
    })
  if (error) {
    if (error.code === '23505') return 'Ya existe un miembro del equipo con esos datos.'
    console.error('[business-users] applyStaffLink crear profesional:', error.message)
    return 'No se pudo crear el profesional.'
  }
  return null
}

// ── listBusinessStaffForLinking ───────────────────────────────────────────────

export async function listBusinessStaffForLinking(businessId: string): Promise<{
  data: { id: string; full_name: string; is_active: boolean; user_id: string | null }[] | null
  error: string | null
}> {
  const authError = await requireSuperAdmin()
  if (authError) return { data: null, error: authError }

  const adminClient = await createAdminClient()

  const { data, error } = await adminClient
    .from('staff')
    .select('id, full_name, is_active, user_id')
    .eq('business_id', businessId)
    .order('full_name')

  if (error) {
    console.error('[business-users] listBusinessStaffForLinking:', error.message)
    return { data: null, error: 'No se pudieron cargar los profesionales.' }
  }
  return { data: data ?? [], error: null }
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

  // Profesionales vinculados a una cuenta (una sola consulta, mapeados por user_id)
  const { data: linkedRows } = await adminClient
    .from('staff')
    .select('id, full_name, user_id')
    .eq('business_id', businessId)
    .not('user_id', 'is', null)
  const staffByUser = new Map<string, { id: string; full_name: string }>()
  for (const row of (linkedRows ?? []) as { id: string; full_name: string; user_id: string }[]) {
    staffByUser.set(row.user_id, { id: row.id, full_name: row.full_name })
  }

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
        linked_staff: staffByUser.get(p.id) ?? null,
      }
    } catch (err) {
      console.error('listBusinessUsers: no se pudo enriquecer usuario', p.id)
      return {
        id: p.id, full_name: p.full_name, role: p.role,
        email: null, is_active: true, last_sign_in_at: null, created_at: p.created_at,
        linked_staff: staffByUser.get(p.id) ?? null,
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
  staffLink?: StaffLink
}): Promise<ActionResult & { userId?: string; warning?: string }> {
  const authError = await requireSuperAdmin()
  if (authError) return { success: false, error: authError }

  const email    = params.email.trim()
  const fullName = params.fullName.trim()

  if (!email)                                     return { success: false, error: 'El correo es obligatorio.' }
  if (params.password.length < 8)                 return { success: false, error: 'La contraseña debe tener al menos 8 caracteres.' }
  if (!fullName)                                   return { success: false, error: 'El nombre es obligatorio.' }
  if (!ASSIGNABLE_ROLES.includes(params.role))     return { success: false, error: 'Rol inválido.' }

  const staffLink = params.staffLink === undefined ? ({ mode: 'none' } as StaffLink) : parseStaffLink(params.staffLink)
  if (!staffLink)                                  return { success: false, error: STAFF_LINK_INVALID }

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

  // La cuenta ya es válida: si el vínculo falla NO se borra el usuario, solo se avisa.
  const linkError = await applyStaffLink(adminClient, params.businessId, userId, params.role, fullName, staffLink)

  revalidatePath('/adminbarberia')
  if (linkError) {
    return { success: true, userId, warning: `Usuario creado, pero no se pudo vincular al profesional: ${linkError}` }
  }
  return { success: true, userId }
}

// ── updateBusinessUser ────────────────────────────────────────────────────────

export async function updateBusinessUser(
  businessId: string,
  userId: string,
  params: { fullName: string; email: string; role: AssignableRole; staffLink?: StaffLink },
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

  const staffLink = params.staffLink === undefined ? undefined : parseStaffLink(params.staffLink)
  if (params.staffLink !== undefined && !staffLink) return { success: false, error: STAFF_LINK_INVALID }

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

  // Si el rol pasa a admin siempre se desvincula; si no, solo cuando el cliente envió un vínculo.
  const effectiveLink: StaffLink | undefined = params.role === 'admin' ? { mode: 'none' } : (staffLink ?? undefined)
  if (effectiveLink) {
    const linkError = await applyStaffLink(adminClient, businessId, userId, params.role, fullName, effectiveLink)
    if (linkError) return { success: false, error: linkError }
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
