// lib/staff-contacts.ts — Correo y celular del equipo (solo admin).
//
// `staff.email` / `staff.phone` NO son legibles con el cliente del usuario (privilegios por
// columna, migración 20261001160000_staff_contact_private.sql): se leen con la función DEFINER
// get_staff_contacts, que exige admin / super_admin del negocio. Nunca pidas esas columnas con
// `.from('staff').select(...)` desde el cliente RLS: falla con "permission denied" para todos.

export interface StaffContact {
  email: string | null
  phone: string | null
}

/** Mínimo del cliente Supabase que se necesita (así se puede probar sin el cliente real). */
interface RpcCapable {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/**
 * Contactos de todos los profesionales del negocio, por id de profesional. Best-effort: si la
 * función falla (p. ej. todavía no está desplegada en la base) se registra y devuelve un mapa
 * vacío — la pantalla se muestra igual, sin correo/celular.
 */
export async function loadStaffContacts(
  supabase: unknown,
  businessId: string,
): Promise<Map<string, StaffContact>> {
  const out = new Map<string, StaffContact>()
  try {
    const { data, error } = await (supabase as RpcCapable).rpc('get_staff_contacts', { p_business_id: businessId })
    if (error) {
      console.error('[staff-contacts] get_staff_contacts:', error.message)
      return out
    }
    for (const row of (Array.isArray(data) ? data : []) as { id: string; email?: string | null; phone?: string | null }[]) {
      out.set(row.id, { email: row.email ?? null, phone: row.phone ?? null })
    }
  } catch (err) {
    console.error('[staff-contacts] get_staff_contacts:', err instanceof Error ? err.message : err)
  }
  return out
}
