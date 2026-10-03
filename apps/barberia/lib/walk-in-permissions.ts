// lib/walk-in-permissions.ts — quién puede hacer qué en la Fila de espera.
//
// Espejo en TypeScript de las reglas que la base de datos aplica de verdad
// (migración 20261002110000_walk_ins_barber_rules.sql: guards en start_walk_in /
// reserve_walk_in / release_walk_in y trigger en walk_ins). Aquí sirven para ocultar
// botones y para dar un error claro desde las server actions antes de llegar a la BD.
//
// En walk_ins `staff_id` es a la vez el barbero PEDIDO por el cliente y el barbero con
// el hueco APARTADO (el hueco además tiene `appointment_id`). Ambos cuentan como "suyo".

export interface WalkInActor {
  /** admin o super_admin del negocio: puede todo */
  isAdmin: boolean
  /** profesional (staff.id) ligado a la cuenta del barbero; null si no está ligada */
  staffId: string | null
}

export interface WalkInOwnership {
  staff_id:        string | null
  appointment_id?: string | null
}

const isMine = (actor: WalkInActor, staffId: string | null | undefined): boolean =>
  !!actor.staffId && !!staffId && actor.staffId === staffId

/** ¿El turno está asignado (pedido o apartado) a OTRO profesional distinto del que mira? */
export function isForSomeoneElse(actor: WalkInActor, entry: WalkInOwnership): boolean {
  return !actor.isAdmin && !!entry.staff_id && !isMine(actor, entry.staff_id)
}

/** "Atender": a nombre propio, y turno suyo o sin barbero asignado. */
export function canAttend(actor: WalkInActor, entry: WalkInOwnership): boolean {
  if (actor.isAdmin) return true
  if (!actor.staffId) return false
  return !entry.staff_id || entry.staff_id === actor.staffId
}

/** "Apartar": para sí mismo un turno libre, o gestionar uno suyo. `targetStaffId` null = el DB elige. */
export function canReserve(
  actor: WalkInActor,
  entry: WalkInOwnership,
  targetStaffId: string | null,
): boolean {
  if (actor.isAdmin) return true
  if (isMine(actor, entry.staff_id)) return true
  return !entry.staff_id && !!targetStaffId && isMine(actor, targetStaffId)
}

/** "Cambiar barbero": admin, o el turno ya es suyo (traspasarlo). */
export function canChangeStaff(actor: WalkInActor, entry: WalkInOwnership): boolean {
  return actor.isAdmin || isMine(actor, entry.staff_id)
}

/**
 * "Liberar" (cancel=false) / "Quitar de la fila" (cancel=true).
 * El hueco apartado de otro profesional solo lo libera el admin; sacar de la fila un
 * turno sin hueco apartado (el cliente se fue) lo puede hacer cualquiera del equipo.
 */
export function canRelease(
  actor: WalkInActor,
  entry: WalkInOwnership,
  cancel: boolean,
): boolean {
  if (actor.isAdmin) return true
  if (!entry.staff_id || isMine(actor, entry.staff_id)) return true
  return cancel && !entry.appointment_id
}

/**
 * "Los tuyos primero" (vista de barbero): los turnos que apartó/pidió para él van al
 * principio; el orden de llegada (el de la lista recibida) se conserva dentro de cada grupo.
 */
export function sortWaitingForBarber<T extends { staff_id: string | null }>(
  waiting: T[],
  viewerStaffId: string | null,
): T[] {
  if (!viewerStaffId) return waiting
  const mine   = waiting.filter((w) => w.staff_id === viewerStaffId)
  const others = waiting.filter((w) => w.staff_id !== viewerStaffId)
  return [...mine, ...others]
}

export const WALK_IN_NOT_YOURS_MESSAGE =
  'Este turno es de otro profesional. Solo el administrador puede cambiarlo.'
