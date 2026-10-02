'use server'

// actions/staff.ts — Módulo "Equipo": profesionales, servicios que hace cada uno y horario semanal.
//
// Seguridad: la política RLS de `staff` es FOR ALL para cualquier usuario del negocio, así que
// TODA mutación exige rol admin|super_admin aquí mismo, y el business_id sale SIEMPRE del
// PERFIL del usuario autenticado (nunca se confía en el que envía el cliente).

import { createClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Staff, StaffSchedule, ServiceAudienceOrAll, Json } from '@xinuco/types'
import { logAction } from '@/lib/audit'
import { businessNowHHMM, businessTodayISODate } from '@/lib/agenda-time'
import { loadStaffContacts } from '@/lib/staff-contacts'
import { normalizeStaffEmail, normalizeStaffPhone, validateWeeklySchedule } from '@/lib/team-utils'
import type { StaffStatusNow } from '@/lib/walk-in-wait'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ActionResult {
  success?: boolean
  error?:   string
  data?:    Staff | Staff[] | StaffSchedule[]
}

export interface TeamMember {
  id:             string
  full_name:      string
  specialty_role: string
  is_active:      boolean
  created_at:     string
  /** Usuario (auth) con el que inicia sesión; null = sin usuario. Le da acceso a "Mi cuenta". */
  user_id:        string | null
  /** Correo opcional: a dónde llegan los recibos de anticipos y pagos. */
  email:          string | null
  /** WhatsApp / celular opcional (dígitos, con "+" si trae indicativo). */
  phone:          string | null
  schedules:      { day_of_week: number; start_time: string; end_time: string }[]
  /** true = sin filas en staff_services → hace TODOS los servicios. */
  does_all_services: boolean
  /** Filas explícitas de staff_services (vacío cuando does_all_services). */
  service_ids:    string[]
  /** Estado AHORA (null si está inactivo o si no se pudo calcular). */
  status:         StaffStatusNow['status'] | null
  busy_until:     string | null
  customer_name:  string | null
  month_completed: number
  upcoming_count: number
  next_appointment: string | null
}

/** Usuario del negocio (barbero o manicurista) que se puede vincular a un profesional. */
export interface LinkableUser {
  id:        string
  full_name: string
  /** Profesional al que ya está vinculado (null = libre). */
  linked_staff_id: string | null
}

export interface TeamOverview {
  todayKey: string
  members:  TeamMember[]
  services: { id: string; name: string; audience: ServiceAudienceOrAll }[]
  linkableUsers: LinkableUser[]
}

const NOT_ADMIN = 'Solo un administrador puede gestionar el equipo.'
const DENIED = 'Autorización denegada.'
const NOT_FOUND = 'Miembro del equipo no encontrado.'
const SERVICES_REQUIRED = 'Elige al menos un servicio o "Todos los servicios".'
const SERVICES_INVALID = 'Algún servicio elegido no es válido.'
const USER_INVALID = 'El usuario elegido no es válido.'
const USER_ALREADY_LINKED = 'Ese usuario ya está vinculado a otro profesional.'
/** Roles de usuario que pueden vincularse a un profesional (ven "Mi cuenta"). */
const LINKABLE_ROLES = ['barber', 'manicurist']

type Supabase = Awaited<ReturnType<typeof createClient>>

type WeeklyScheduleInput = { day_of_week: number; start_time: string; end_time: string }

interface AdminContext {
  supabase:   Supabase
  userId:     string
  actorName:  string | null
  businessId: string
}

// ── Guards ────────────────────────────────────────────────────────────────────

/** Sesión + perfil admin/super_admin con business_id (el del PERFIL). */
async function requireAdmin(): Promise<({ ok: true } & AdminContext) | { ok: false; error: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: NOT_ADMIN }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, business_id, full_name')
    .eq('id', user.id)
    .single()

  const p = profile as { role?: string; business_id?: string | null; full_name?: string | null } | null
  if (!p || (p.role !== 'admin' && p.role !== 'super_admin') || !p.business_id) {
    return { ok: false, error: NOT_ADMIN }
  }

  return { ok: true, supabase, userId: user.id, actorName: p.full_name ?? null, businessId: p.business_id }
}

/** Anti-IDOR: el miembro debe ser del negocio del perfil. Devuelve su fila actual. */
async function findOwnStaff(supabase: Supabase, staffId: string, businessId: string) {
  if (!staffId || typeof staffId !== 'string') return null
  const { data } = await supabase
    .from('staff')
    .select('id, full_name, specialty_role, is_active, user_id')
    .eq('id', staffId)
    .eq('business_id', businessId)
    .maybeSingle()
  return (data as {
    id: string; full_name: string; specialty_role: string; is_active: boolean; user_id?: string | null
  } | null) ?? null
}

// ── Validación ────────────────────────────────────────────────────────────────

function validateProfile(data: { full_name: unknown; specialty_role: unknown }):
  { error: string } | { full_name: string; specialty_role: string } {
  const full_name = typeof data.full_name === 'string' ? data.full_name.trim() : ''
  const specialty_role = typeof data.specialty_role === 'string' ? data.specialty_role.trim() : ''
  if (full_name.length < 2 || full_name.length > 80) {
    return { error: 'El nombre debe tener entre 2 y 80 caracteres.' }
  }
  if (specialty_role.length < 2 || specialty_role.length > 40) {
    return { error: 'El cargo debe tener entre 2 y 40 caracteres.' }
  }
  return { full_name, specialty_role }
}

/** Correo y celular opcionales (vacío → null) con las mismas reglas que los CHECK de la base. */
function validateContact(data: { email?: unknown; phone?: unknown }, onlyProvided: boolean):
  { error: string } | { email?: string | null; phone?: string | null } {
  const out: { email?: string | null; phone?: string | null } = {}
  if (!onlyProvided || data.email !== undefined) {
    const email = normalizeStaffEmail(data.email)
    if ('error' in email) return { error: email.error }
    out.email = email.value
  }
  if (!onlyProvided || data.phone !== undefined) {
    const phone = normalizeStaffPhone(data.phone)
    if ('error' in phone) return { error: phone.error }
    out.phone = phone.value
  }
  return out
}

/**
 * El usuario a vincular debe ser del negocio, con rol barbero/manicurista, y no estar
 * vinculado a OTRO profesional del negocio. Devuelve un mensaje de error o null.
 */
async function validateLinkedUser(
  supabase: Supabase,
  businessId: string,
  staffId: string,
  userId: unknown,
): Promise<string | null> {
  if (typeof userId !== 'string' || !userId) return USER_INVALID

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .eq('business_id', businessId)
    .in('role', LINKABLE_ROLES)
    .maybeSingle()
  if (!profile) return USER_INVALID

  const { data: others } = await supabase
    .from('staff')
    .select('id')
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .neq('id', staffId)
    .limit(1)
  if (((others ?? []) as { id: string }[]).length > 0) return USER_ALREADY_LINKED

  return null
}

/** Todos los ids deben ser servicios del negocio. Devuelve la lista sin duplicados. */
async function validateServiceIds(
  supabase: Supabase,
  businessId: string,
  raw: unknown,
): Promise<{ error: string } | { ids: string[] }> {
  if (!Array.isArray(raw) || raw.some(id => typeof id !== 'string' || !id)) {
    return { error: SERVICES_INVALID }
  }
  const ids = Array.from(new Set(raw as string[]))
  const { data, error } = await supabase
    .from('services')
    .select('id')
    .eq('business_id', businessId)
    .in('id', ids)
  if (error) return { error: error.message }
  if (((data ?? []) as { id: string }[]).length !== ids.length) return { error: SERVICES_INVALID }
  return { ids }
}

/**
 * Auditoría de cambios que NINGÚN trigger de la BD cubre (los servicios que hace un profesional).
 * Altas, activar/desactivar y cambios de nombre/usuario los registra la BD sola.
 */
async function audit(
  ctx: AdminContext,
  action: string,
  entityId: string,
  oldValue: Record<string, unknown> | null,
  newValue: Record<string, unknown> | null,
) {
  await logAction({
    businessId: ctx.businessId,
    action,
    entityType: 'staff',
    entityId,
    oldValue:   oldValue as unknown as Json,
    newValue:   newValue as unknown as Json,
  })
}

// ════════════════════════════════════════════════════════════════════════════════
// getTeamOverview — datos completos de la página Equipo
// ════════════════════════════════════════════════════════════════════════════════

/** Rango [from, to) del mes actual, como hora local del negocio guardada "como UTC". */
function currentMonthRange(): { from: string; to: string } {
  const today = businessTodayISODate() // YYYY-MM-DD
  const [y, m] = today.split('-').map(Number)
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    from: `${y}-${pad(m)}-01T00:00:00Z`,
    to:   `${ny}-${pad(nm)}-01T00:00:00Z`,
  }
}

const PAGE_SIZE = 1000
const MAX_PAGES = 20

/** PostgREST limita a 1000 filas por consulta: pagina para que los conteos no se trunquen. */
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (error) return { rows, error: error.message }
    const batch = (data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return { rows, error: null }
}

export async function getTeamOverview(): Promise<TeamOverview | { error: string }> {
  const auth = await requireAdmin()
  if (!auth.ok) return { error: auth.error }
  const { supabase, businessId } = auth

  const todayKey = businessTodayISODate()
  const nowIso = `${todayKey}T${businessNowHHMM()}:00Z`
  const { from, to } = currentMonthRange()

  const [staffRes, schedRes, ssRes, servicesRes, statusRes, completedRes, upcomingRes, usersRes, contacts] = await Promise.all([
    supabase.from('staff')
      // email/phone no se leen aquí (privilegios por columna): vienen de get_staff_contacts
      .select('id, full_name, specialty_role, is_active, created_at, user_id')
      .eq('business_id', businessId)
      .order('is_active', { ascending: false })
      .order('full_name', { ascending: true }),
    supabase.from('staff_schedules')
      .select('staff_id, day_of_week, start_time, end_time')
      .eq('business_id', businessId),
    supabase.from('staff_services')
      .select('staff_id, service_id')
      .eq('business_id', businessId),
    supabase.from('services')
      .select('id, name, audience')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name', { ascending: true }),
    supabase.rpc('get_staff_status_now', { p_business_id: businessId }),
    fetchAllRows<{ staff_id: string | null }>((a, b) =>
      supabase.from('appointments')
        .select('staff_id')
        .eq('business_id', businessId)
        .eq('status', 'completed')
        .gte('start_time', from)
        .lt('start_time', to)
        .order('id', { ascending: true })
        .range(a, b),
    ),
    fetchAllRows<{ staff_id: string | null; start_time: string }>((a, b) =>
      supabase.from('appointments')
        .select('staff_id, start_time')
        .eq('business_id', businessId)
        .in('status', ['scheduled', 'payment_pending'])
        .gte('start_time', nowIso)
        .order('start_time', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b),
    ),
    // Usuarios que se pueden vincular a un profesional (barberos y manicuristas del negocio)
    supabase.from('profiles')
      .select('id, full_name, role')
      .eq('business_id', businessId)
      .in('role', LINKABLE_ROLES)
      .order('full_name', { ascending: true }),
    // Correo y celular: solo los entrega la función de admin; si falla, el equipo se ve sin ellos
    loadStaffContacts(supabase, businessId),
  ])

  const firstError = [staffRes, schedRes, ssRes, servicesRes, usersRes].find(r => r.error)?.error?.message
    ?? completedRes.error ?? upcomingRes.error
  if (firstError) return { error: firstError }

  const staffRows = (staffRes.data ?? []) as
    { id: string; full_name: string; specialty_role: string; is_active: boolean; created_at: string; user_id: string | null }[]
  const schedRows = (schedRes.data ?? []) as
    { staff_id: string; day_of_week: number; start_time: string; end_time: string }[]
  const ssRows = (ssRes.data ?? []) as { staff_id: string; service_id: string }[]
  const services = ((servicesRes.data ?? []) as { id: string; name: string; audience: ServiceAudienceOrAll | null }[])
    .map(s => ({ id: s.id, name: s.name, audience: (s.audience ?? 'men') as ServiceAudienceOrAll }))

  // El RPC solo devuelve activos; si falla, el estado queda en null (sin píldora).
  const statusById = new Map<string, StaffStatusNow>()
  if (!statusRes.error && Array.isArray(statusRes.data)) {
    for (const s of statusRes.data as unknown as StaffStatusNow[]) statusById.set(s.id, s)
  }

  const schedulesByStaff = new Map<string, TeamMember['schedules']>()
  for (const r of schedRows) {
    const list = schedulesByStaff.get(r.staff_id) ?? []
    list.push({ day_of_week: r.day_of_week, start_time: r.start_time, end_time: r.end_time })
    schedulesByStaff.set(r.staff_id, list)
  }

  const servicesByStaff = new Map<string, string[]>()
  for (const r of ssRows) {
    const list = servicesByStaff.get(r.staff_id) ?? []
    list.push(r.service_id)
    servicesByStaff.set(r.staff_id, list)
  }

  const completedByStaff = new Map<string, number>()
  for (const a of completedRes.rows) {
    if (!a.staff_id) continue
    completedByStaff.set(a.staff_id, (completedByStaff.get(a.staff_id) ?? 0) + 1)
  }

  // Ordenadas por start_time asc → la primera de cada staff es la próxima.
  const upcomingByStaff = new Map<string, { count: number; next: string }>()
  for (const a of upcomingRes.rows) {
    if (!a.staff_id) continue
    const cur = upcomingByStaff.get(a.staff_id)
    if (cur) cur.count += 1
    else upcomingByStaff.set(a.staff_id, { count: 1, next: a.start_time })
  }

  const members: TeamMember[] = staffRows.map(s => {
    const explicit = servicesByStaff.get(s.id) ?? []
    const st = s.is_active ? statusById.get(s.id) : undefined
    const up = upcomingByStaff.get(s.id)
    return {
      id:               s.id,
      full_name:        s.full_name,
      specialty_role:   s.specialty_role,
      is_active:        s.is_active,
      created_at:       s.created_at,
      user_id:          s.user_id ?? null,
      email:            contacts.get(s.id)?.email ?? null,
      phone:            contacts.get(s.id)?.phone ?? null,
      schedules:        schedulesByStaff.get(s.id) ?? [],
      does_all_services: explicit.length === 0,
      service_ids:      explicit,
      status:           st?.status ?? null,
      busy_until:       st?.busy_until ?? null,
      customer_name:    st?.customer_name ?? null,
      month_completed:  completedByStaff.get(s.id) ?? 0,
      upcoming_count:   up?.count ?? 0,
      next_appointment: up?.next ?? null,
    }
  })

  const linkedByUser = new Map<string, string>()
  for (const s of staffRows) if (s.user_id) linkedByUser.set(s.user_id, s.id)
  const linkableUsers: LinkableUser[] = ((usersRes.data ?? []) as { id: string; full_name: string | null }[])
    .map(u => ({ id: u.id, full_name: u.full_name?.trim() || 'Usuario sin nombre', linked_staff_id: linkedByUser.get(u.id) ?? null }))

  return { todayKey, members, services, linkableUsers }
}

// ════════════════════════════════════════════════════════════════════════════════
// Alta / edición / activación
// ════════════════════════════════════════════════════════════════════════════════

/**
 * createStaffMember — Crea un profesional. `service_ids`: lista (los servicios que hace),
 * 'all' o vacío/omitido (hace todos → sin filas en staff_services).
 * El business_id sale del perfil; el argumento solo se contrasta contra él.
 */
export async function createStaffMember(
  businessId: string,
  data: {
    full_name: string
    specialty_role: string
    /** Correo opcional (recibos de anticipos y pagos). Vacío = sin correo. */
    email?: string | null
    /** WhatsApp / celular opcional. Vacío = sin celular. */
    phone?: string | null
    service_ids?: string[] | 'all'
    /** Horario semanal inicial (mismo formato que saveStaffSchedulesBatch). Omitido = sin horario. */
    schedules?: WeeklyScheduleInput[]
  }
): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return { error: auth.error }
  const { supabase } = auth
  if (businessId !== auth.businessId) return { error: DENIED }

  const parsed = validateProfile(data)
  if ('error' in parsed) return { error: parsed.error }

  const contact = validateContact(data, false)
  if ('error' in contact) return { error: contact.error }

  // Validar el horario ANTES de crear nada: si es inválido no se crea el profesional.
  const schedules = data.schedules ?? []
  const scheduleError = validateWeeklySchedule(schedules)
  if (scheduleError) return { error: scheduleError }

  let serviceIds: string[] = []
  if (Array.isArray(data.service_ids) && data.service_ids.length > 0) {
    const checked = await validateServiceIds(supabase, auth.businessId, data.service_ids)
    if ('error' in checked) return { error: checked.error }
    serviceIds = checked.ids
  }

  const { data: result, error } = await supabase
    .from('staff')
    .insert({
      business_id:    auth.businessId,
      full_name:      parsed.full_name,
      specialty_role: parsed.specialty_role,
      is_active:      true,
      // Solo si hay dato: así el alta no depende de las columnas cuando no se usan
      ...(contact.email ? { email: contact.email } : {}),
      ...(contact.phone ? { phone: contact.phone } : {}),
    })
    // Columnas explícitas: email/phone no son legibles con el cliente del usuario (RETURNING las pediría)
    .select('id, business_id, user_id, full_name, specialty_role, is_active, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { error: 'Ya existe un miembro del equipo con esos datos.' }
    }
    return { error: error.message }
  }

  const created = result as Staff

  if (serviceIds.length > 0) {
    const { error: ssError } = await supabase
      .from('staff_services')
      .insert(serviceIds.map(service_id => ({
        business_id: auth.businessId,
        staff_id:    created.id,
        service_id,
      })))
    if (ssError) {
      // Sin filas significaría "hace todo": mejor deshacer el alta que dejarlo mal configurado.
      await supabase.from('staff').delete().eq('id', created.id).eq('business_id', auth.businessId)
      return { error: `No se pudieron asignar los servicios: ${ssError.message}` }
    }
  }

  if (schedules.length > 0) {
    const { error: schedError } = await supabase
      .from('staff_schedules')
      .insert(toScheduleInsertRows(auth.businessId, created.id, schedules))
    if (schedError) {
      // Un profesional sin horario nunca aparece en la reserva: mejor deshacer el alta.
      await supabase.from('staff').delete().eq('id', created.id).eq('business_id', auth.businessId)
      return { error: `No se pudo guardar el horario: ${schedError.message}` }
    }
  }

  revalidatePath('/[slug]/dashboard/staff', 'page')
  revalidatePath('/[slug]/dashboard/services', 'page')
  revalidatePath('/[slug]/book', 'page')
  revalidatePath('/[slug]', 'page')
  return { success: true, data: created }
}

/**
 * updateStaffMember — Edita nombre, cargo y servicios de un profesional.
 * `service_ids`: 'all' → borra sus filas (hace todo); lista → debe ser no vacía y de servicios del negocio.
 */
export async function updateStaffMember(
  staffId: string,
  data: {
    full_name: string
    specialty_role: string
    service_ids: string[] | 'all'
    /** Correo: undefined = no cambiar; vacío/null = quitarlo. */
    email?: string | null
    /** WhatsApp / celular: undefined = no cambiar; vacío/null = quitarlo. */
    phone?: string | null
    /**
     * Usuario con el que inicia sesión (para "Mi cuenta"). undefined = no cambiar;
     * null = quitar el vínculo; id = vincular (barbero/manicurista del negocio, libre).
     */
    user_id?: string | null
  }
): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return { error: auth.error }
  const { supabase, businessId } = auth

  const existing = await findOwnStaff(supabase, staffId, businessId)
  if (!existing) return { error: NOT_FOUND }

  const parsed = validateProfile(data)
  if ('error' in parsed) return { error: parsed.error }

  const contact = validateContact(data, true)
  if ('error' in contact) return { error: contact.error }

  // Vínculo con un usuario: se valida ANTES de escribir nada
  const changesUser = data.user_id !== undefined
  if (changesUser && data.user_id !== null) {
    const userError = await validateLinkedUser(supabase, businessId, staffId, data.user_id)
    if (userError) return { error: userError }
  }

  // Validar TODO antes de escribir, para no dejar cambios a medias.
  let targetIds: string[] | 'all'
  if (data.service_ids === 'all') {
    targetIds = 'all'
  } else {
    if (!Array.isArray(data.service_ids) || data.service_ids.length === 0) return { error: SERVICES_REQUIRED }
    const checked = await validateServiceIds(supabase, businessId, data.service_ids)
    if ('error' in checked) return { error: checked.error }
    targetIds = checked.ids
  }

  const { error: updError } = await supabase
    .from('staff')
    .update({
      full_name: parsed.full_name,
      specialty_role: parsed.specialty_role,
      ...(changesUser ? { user_id: data.user_id ?? null } : {}),
      ...(contact.email !== undefined ? { email: contact.email } : {}),
      ...(contact.phone !== undefined ? { phone: contact.phone } : {}),
    })
    .eq('id', staffId)
    .eq('business_id', businessId)
  if (updError) {
    // Carrera: otro admin vinculó a ese usuario justo antes (índice único uq_staff_business_user)
    if (updError.code === '23505' && changesUser && data.user_id) return { error: USER_ALREADY_LINKED }
    return { error: updError.message }
  }

  let servicesChanged = false
  if (targetIds === 'all') {
    const { data: removed, error } = await supabase
      .from('staff_services')
      .delete()
      .eq('staff_id', staffId)
      .eq('business_id', businessId)
      .select('service_id')
    if (error) return { error: error.message }
    servicesChanged = (removed ?? []).length > 0
  } else {
    // Insertar primero los que faltan y borrar después los sobrantes: nunca queda en cero filas
    // (sin filas = "hace todo") en mitad del cambio.
    const { data: currentRows, error: curError } = await supabase
      .from('staff_services')
      .select('service_id')
      .eq('staff_id', staffId)
      .eq('business_id', businessId)
    if (curError) return { error: curError.message }

    const current = new Set(((currentRows ?? []) as { service_id: string }[]).map(r => r.service_id))
    const wanted = new Set(targetIds)
    const toInsert = targetIds.filter(id => !current.has(id))
    const toDelete = Array.from(current).filter(id => !wanted.has(id))

    servicesChanged = toInsert.length > 0 || toDelete.length > 0
    if (toInsert.length > 0) {
      const { error } = await supabase
        .from('staff_services')
        .insert(toInsert.map(service_id => ({ business_id: businessId, staff_id: staffId, service_id })))
      if (error) return { error: error.message }
    }
    if (toDelete.length > 0) {
      const { error } = await supabase
        .from('staff_services')
        .delete()
        .eq('staff_id', staffId)
        .eq('business_id', businessId)
        .in('service_id', toDelete)
      if (error) return { error: error.message }
    }
  }

  if (servicesChanged) {
    await audit(auth, 'staff.services_changed', staffId,
      null,
      { full_name: parsed.full_name, servicios: targetIds === 'all' ? 'todos' : targetIds.length })
  }

  revalidatePath('/[slug]/dashboard/staff', 'page')
  revalidatePath('/[slug]/dashboard/services', 'page')
  revalidatePath('/[slug]/book', 'page')
  revalidatePath('/[slug]', 'page')
  if (changesUser) revalidatePath('/[slug]/dashboard/ledger', 'page')
  return { success: true }
}

/**
 * toggleStaffStatus — Activa o desactiva un profesional.
 * Filtra por id Y business_id (evita mutación masiva y cruce entre negocios).
 */
export async function toggleStaffStatus(
  staffId: string,
  isActive: boolean
): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return { error: auth.error }
  const { supabase, businessId } = auth

  const existing = await findOwnStaff(supabase, staffId, businessId)
  if (!existing) return { error: NOT_FOUND }

  const { error } = await supabase
    .from('staff')
    .update({ is_active: isActive })
    .eq('id', staffId)
    .eq('business_id', businessId)

  if (error) return { error: error.message }

  revalidatePath('/[slug]/dashboard/staff', 'page')
  revalidatePath('/[slug]/book', 'page')
  revalidatePath('/[slug]/dashboard/walk-ins', 'page')
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════════
// GESTIÓN DE HORARIOS — staff_schedules
// ════════════════════════════════════════════════════════════════════════════════

/**
 * getStaffSchedules — Obtiene los bloques de horario de un miembro del equipo.
 * day_of_week: 0 = Domingo, 1 = Lunes … 6 = Sábado
 * Lectura acotada por RLS y, además, por el negocio del perfil del usuario.
 */
export async function getStaffSchedules(staffId: string): Promise<StaffSchedule[]> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data: profile } = await supabase
    .from('profiles')
    .select('business_id')
    .eq('id', user.id)
    .single()
  const businessId = (profile as { business_id?: string | null } | null)?.business_id
  if (!businessId) return []

  const { data, error } = await supabase
    .from('staff_schedules')
    .select('*')
    .eq('staff_id', staffId)
    .eq('business_id', businessId)
    .order('day_of_week', { ascending: true })

  if (error) throw error
  return data as StaffSchedule[]
}

/** Filas listas para insertar: solo los campos esperados; los ids los fija el servidor. */
function toScheduleInsertRows(businessId: string, staffId: string, schedules: WeeklyScheduleInput[]) {
  return schedules.map(s => ({
    business_id: businessId,
    staff_id:    staffId,
    day_of_week: s.day_of_week,
    start_time:  s.start_time,
    end_time:    s.end_time,
  }))
}

/**
 * Núcleo del reemplazo SEGURO del horario de UN profesional (ya validado y verificado como del negocio):
 * guarda una copia del horario actual; si el insert falla, la restaura
 * (así un error nunca deja a la persona sin horario).
 */
async function replaceStaffSchedule(
  supabase: Supabase,
  businessId: string,
  staffId: string,
  schedules: WeeklyScheduleInput[],
): Promise<{ error?: string }> {
  const toInsert = toScheduleInsertRows(businessId, staffId, schedules)

  // PASO 1: copia del horario actual
  const { data: snapshot, error: snapError } = await supabase
    .from('staff_schedules')
    .select('day_of_week, start_time, end_time')
    .eq('staff_id', staffId)
    .eq('business_id', businessId)
  if (snapError) return { error: `No se pudo leer el horario actual: ${snapError.message}` }

  // PASO 2: borrar
  const { error: deleteError } = await supabase
    .from('staff_schedules')
    .delete()
    .eq('staff_id', staffId)
    .eq('business_id', businessId)
  if (deleteError) return { error: `Error al limpiar horarios: ${deleteError.message}` }

  // PASO 3: insertar el nuevo; si falla, restaurar la copia
  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from('staff_schedules').insert(toInsert)
    if (insertError) {
      const previous = ((snapshot ?? []) as WeeklyScheduleInput[])
        .map(s => ({ ...s, business_id: businessId, staff_id: staffId }))
      if (previous.length > 0) {
        await supabase.from('staff_schedules').insert(previous)
      }
      return { error: 'No se pudo guardar el horario; se mantuvo el anterior.' }
    }
  }

  return {}
}

function revalidateSchedulePaths() {
  revalidatePath('/[slug]/dashboard/staff', 'page')
  revalidatePath('/[slug]/dashboard/appointments', 'page')
  revalidatePath('/[slug]/book', 'page')
}

/**
 * saveStaffSchedulesBatch — Reemplaza el horario semanal de un profesional.
 * Reemplazo SEGURO (ver replaceStaffSchedule).
 */
export async function saveStaffSchedulesBatch(
  businessId: string,
  staffId: string,
  schedules: WeeklyScheduleInput[]
): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return { error: auth.error }
  const { supabase } = auth
  if (businessId !== auth.businessId) return { error: DENIED }

  const existing = await findOwnStaff(supabase, staffId, auth.businessId)
  if (!existing) return { error: NOT_FOUND }

  const validation = validateWeeklySchedule(schedules)
  if (validation) return { error: validation }

  const result = await replaceStaffSchedule(supabase, auth.businessId, staffId, schedules)
  if (result.error) return { error: result.error }

  revalidateSchedulePaths()
  return { success: true }
}

const MAX_BULK_STAFF = 100

/**
 * saveStaffSchedulesForMany — Aplica el MISMO horario semanal a varios profesionales
 * ("Aplicar también a…"). Mismo guard de admin, verificación de negocio, validación y reemplazo
 * seguro que saveStaffSchedulesBatch, por profesional. Un fallo en uno no detiene a los demás.
 * `failed` trae los nombres de quienes no se pudieron guardar (o el id si no es del negocio).
 */
export async function saveStaffSchedulesForMany(
  businessId: string,
  staffIds: string[],
  schedules: WeeklyScheduleInput[]
): Promise<{ success?: boolean; error?: string; saved: number; failed: string[] }> {
  const auth = await requireAdmin()
  if (!auth.ok) return { error: auth.error, saved: 0, failed: [] }
  const { supabase } = auth
  if (businessId !== auth.businessId) return { error: DENIED, saved: 0, failed: [] }

  if (!Array.isArray(staffIds) || staffIds.length === 0 || staffIds.some(id => typeof id !== 'string' || !id)) {
    return { error: 'Elige al menos un profesional.', saved: 0, failed: [] }
  }
  const ids = Array.from(new Set(staffIds))
  if (ids.length > MAX_BULK_STAFF) {
    return { error: 'Demasiados profesionales en una sola operación.', saved: 0, failed: [] }
  }

  const validation = validateWeeklySchedule(schedules)
  if (validation) return { error: validation, saved: 0, failed: [] }

  let saved = 0
  const failed: string[] = []
  for (const staffId of ids) {
    const existing = await findOwnStaff(supabase, staffId, auth.businessId)
    if (!existing) {
      failed.push(staffId)
      continue
    }
    const result = await replaceStaffSchedule(supabase, auth.businessId, staffId, schedules)
    if (result.error) failed.push(existing.full_name)
    else saved += 1
  }

  if (saved > 0) revalidateSchedulePaths()
  return { success: failed.length === 0, saved, failed }
}

/**
 * getAvailableSlotsAction — Llama a la función RPC segura en PostgreSQL
 * para obtener los horarios disponibles.
 *
 * Si se pasa `serviceId`, invoca `get_available_slots_v2` (RF7 — Agendamiento Tri-factorial)
 * que valida staff + workstation + intervalo del negocio.
 * En caso contrario hace fallback a `get_available_slots` original.
 */
export async function getAvailableSlotsAction(
  businessId: string,
  staffId: string | null,
  date: string, // Formato YYYY-MM-DD
  durationMinutes: number = 30,
  serviceId?: string        // RF7 — habilita validación de workstations
) {
  const supabase = await createClient()

  let rawData: unknown
  let rpcError: { message: string } | null = null

  if (serviceId) {
    // RF7: usar v2 con validación de workstations + buffer_time del servicio
    const { data, error } = await supabase.rpc('get_available_slots_v2', {
      p_business_id:      businessId,
      p_staff_id:         staffId,
      p_service_id:       serviceId,
      p_date:             date,
      p_duration_minutes: durationMinutes,
    } as Parameters<typeof supabase.rpc>[1])

    rawData  = data
    rpcError = error
  } else {
    // Fallback: función original sin restricción de workstations
    const { data, error } = await supabase.rpc('get_available_slots', {
      p_business_id:      businessId,
      p_staff_id:         staffId,
      p_date:             date,
      p_duration_minutes: durationMinutes,
    } as Parameters<typeof supabase.rpc>[1])

    rawData  = data
    rpcError = error
  }

  if (rpcError) {
    return { error: `Error al calcular espacios: ${rpcError.message}`, slots: [] }
  }

  // Normalizar el resultado. Supabase a veces devuelve [{ "get_available_slots": "09:00" }] en lugar de ["09:00"]
  let slotsArray: string[] = []
  if (Array.isArray(rawData)) {
    if (rawData.length > 0 && typeof rawData[0] === 'object' && rawData[0] !== null) {
       slotsArray = (rawData as Record<string, unknown>[]).map(obj => Object.values(obj)[0] as string)
    } else {
       slotsArray = rawData as string[]
    }
  }

  // Asegurar formato HH:MM (eliminar segundos si PostgREST devuelve "09:00:00")
  slotsArray = slotsArray.map(s => s.substring(0, 5))

  return { success: true, slots: slotsArray }
}
