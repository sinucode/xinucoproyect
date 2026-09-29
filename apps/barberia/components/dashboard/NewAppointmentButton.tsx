'use client'

import Link from 'next/link'
import { CalendarPlus } from 'lucide-react'

interface NewAppointmentButtonProps {
  slug: string
}

export function NewAppointmentButton({ slug }: NewAppointmentButtonProps) {
  return (
    <Link 
      id="btn-new-appointment" 
      href={`/${slug}/book`}
      target="_blank"
      rel="noopener noreferrer" // Abrimos el Wizard en una pestaña nueva para no perder el contexto del Dashboard
      className="btn-primary mt-1 !px-4 !py-2 !text-xs flex items-center gap-1.5"
    >
      <CalendarPlus size={14} />
      <span>Nueva cita</span>
    </Link>
  )
}
