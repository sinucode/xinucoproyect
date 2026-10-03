'use client'

import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { QuickBookingSheet } from '@/components/agenda/QuickBookingSheet'

interface NewAppointmentButtonProps {
  slug: string
  /** Profesional preseleccionado (solo lo respeta el admin) */
  staffId?: string
  /** Fecha 'YYYY-MM-DD' con la que abre la hoja (por defecto hoy) */
  initialDate?: string
}

/** "Nueva cita": abre la reserva interna (hoja) en vez de la página pública de reservas. */
export function NewAppointmentButton({ slug, staffId, initialDate }: NewAppointmentButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        id="btn-new-appointment"
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary mt-1 !px-4 !py-2 !text-xs flex min-h-11 items-center gap-1.5"
      >
        <CalendarPlus size={14} />
        <span>Nueva cita</span>
      </button>
      <QuickBookingSheet
        slug={slug}
        open={open}
        onClose={() => setOpen(false)}
        staffId={staffId}
        initialDate={initialDate}
      />
    </>
  )
}
