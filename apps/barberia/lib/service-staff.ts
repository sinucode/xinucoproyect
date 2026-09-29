// lib/service-staff.ts — cálculo puro de qué filas de `staff_services` hay que
// insertar/borrar para que un servicio quede ofrecido por los barberos elegidos.
//
// SEMÁNTICA (la usan la reserva pública y la fila de espera):
//   - Un barbero SIN filas en staff_services hace TODOS los servicios.
//   - Un barbero CON filas solo hace los servicios que tiene listados.
//
// Por eso, para EXCLUIR a un barbero de un servicio no basta con borrar una fila:
// si no tenía filas (hacía todo implícitamente) hay que materializar filas para
// todos los demás servicios activos; y al restringir nunca se puede dejar a un
// barbero en cero filas (volvería a "hacer todo").

export interface StaffServiceRow {
  staff_id: string
  service_id: string
}

export interface DiffStaffServicesInput {
  /** Filas actuales de staff_services (de cualquier servicio) del negocio. */
  currentRows: StaffServiceRow[]
  /** IDs de los barberos ACTIVOS del negocio. */
  staffIds: string[]
  /** IDs de los servicios ACTIVOS del negocio (puede incluir o no el servicio objetivo). */
  serviceIds: string[]
  /** Servicio que se está creando/editando. */
  targetServiceId: string
  /** 'all' = todos los barberos; o la lista de barberos que SÍ lo hacen. */
  target: 'all' | string[]
}

export interface DiffStaffServicesResult {
  inserts: StaffServiceRow[]
  deletes: StaffServiceRow[]
  /**
   * Barberos a los que no se puede excluir del servicio porque quedarían sin
   * ninguna asignación (y "sin filas" significa "hace todo"). La acción debe
   * rechazar el cambio si esta lista no está vacía.
   */
  blocked: string[]
}

export function diffStaffServices(input: DiffStaffServicesInput): DiffStaffServicesResult {
  const { currentRows, staffIds, serviceIds, targetServiceId, target } = input

  const inserts: StaffServiceRow[] = []
  const deletes: StaffServiceRow[] = []
  const blocked: string[] = []

  const otherServiceIds = Array.from(new Set(serviceIds)).filter(id => id !== targetServiceId)
  const chosen = target === 'all' ? null : new Set(target)

  for (const staffId of Array.from(new Set(staffIds))) {
    const rows = currentRows.filter(r => r.staff_id === staffId)
    const hasRows = rows.length > 0
    const hasTarget = rows.some(r => r.service_id === targetServiceId)
    const offered = chosen === null || chosen.has(staffId)

    if (offered) {
      // Sin filas → ya hace todo (incluido este servicio): no tocar, o lo restringiríamos.
      if (hasRows && !hasTarget) inserts.push({ staff_id: staffId, service_id: targetServiceId })
      continue
    }

    // Excluir al barbero de este servicio.
    if (!hasRows) {
      if (otherServiceIds.length === 0) {
        blocked.push(staffId)
        continue
      }
      for (const sid of otherServiceIds) inserts.push({ staff_id: staffId, service_id: sid })
      continue
    }

    if (hasTarget) {
      const remaining = rows.filter(r => r.service_id !== targetServiceId)
      if (remaining.length === 0) {
        blocked.push(staffId)
        continue
      }
      deletes.push({ staff_id: staffId, service_id: targetServiceId })
    }
  }

  return { inserts, deletes, blocked }
}

/**
 * Resuelve qué barberos hacen un servicio aplicando la semántica anterior.
 * Devuelve los IDs (de `staffIds`) que lo hacen.
 */
export function resolveServiceStaffIds(
  serviceId: string,
  staffIds: string[],
  rows: StaffServiceRow[],
): string[] {
  return staffIds.filter(staffId => {
    const mine = rows.filter(r => r.staff_id === staffId)
    return mine.length === 0 || mine.some(r => r.service_id === serviceId)
  })
}
