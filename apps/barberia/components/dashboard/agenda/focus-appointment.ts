// Lleva la vista a la tarjeta de una cita en la lista (id="appt-<id>") y la resalta un instante.
// Se usa desde la línea de tiempo del día: tocar una cita → ver su tarjeta con las acciones.

export const apptCardId = (appointmentId: string) => `appt-${appointmentId}`

/** Devuelve false si la tarjeta no está en pantalla (p. ej. la lista tiene otro filtro). */
export function focusAppointmentCard(appointmentId: string): boolean {
  if (typeof document === 'undefined') return false
  const el = document.getElementById(apptCardId(appointmentId))
  if (!el) return false

  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // Destello con la API de animaciones (no toca las clases que maneja React)
  if (typeof el.animate === 'function') {
    el.animate(
      [
        { boxShadow: '0 0 0 3px var(--primary-color)' },
        { boxShadow: '0 0 0 3px var(--primary-color)', offset: 0.6 },
        { boxShadow: '0 0 0 0 transparent' },
      ],
      { duration: 1800, easing: 'ease-out' },
    )
  }
  return true
}
