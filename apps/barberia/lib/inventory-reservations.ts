// lib/inventory-reservations.ts — helpers puros para productos apartados.
//
// Los apartados vienen del RPC get_inventory_reservations (solo citas abiertas de
// hoy en adelante). Reservar NO descuenta stock: el stock baja al cobrar.
// Disponible = current_stock − apartado en citas abiertas.

export interface InventoryReservation {
  item_id:        string
  appointment_id: string
  quantity:       number
  start_time:     string          // ISO — hora local del negocio guardada como UTC
  customer_name:  string | null
  customer_phone: string | null
}

/** Total apartado por ítem, opcionalmente excluyendo una cita (la que se cobra). */
export function reservedByItem(
  reservations: InventoryReservation[],
  excludeAppointmentId?: string | null,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of reservations) {
    if (excludeAppointmentId && r.appointment_id === excludeAppointmentId) continue
    out[r.item_id] = (out[r.item_id] ?? 0) + r.quantity
  }
  return out
}

/** Apartados de un ítem, en orden cronológico. */
export function reservationsForItem(
  reservations: InventoryReservation[],
  itemId: string,
  excludeAppointmentId?: string | null,
): InventoryReservation[] {
  return reservations
    .filter((r) => r.item_id === itemId && r.appointment_id !== excludeAppointmentId)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
}

/** Normaliza la respuesta del RPC (jsonb) a una lista segura. */
export function parseReservations(data: unknown): InventoryReservation[] {
  return Array.isArray(data) ? (data as InventoryReservation[]) : []
}
