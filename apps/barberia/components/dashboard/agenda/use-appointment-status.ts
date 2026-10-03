'use client'

// Cambio de estado de una cita (Iniciar / Terminar / No asistió / Cancelar), compartido por la
// tarjeta de la lista (InteractiveAgenda) y la hoja de detalle de la línea de tiempo
// (AppointmentDetailSheet): mismas confirmaciones, misma acción de servidor y mismo aviso de nota.

import { useState, useTransition } from 'react'
import { updateAppointmentStatus } from '@/actions/appointments'
import { APPT_ACTION_NEXT_STATUS, apptActionConfirmText, type ApptStatusAction } from '@/lib/agenda-status'
import type { AppointmentStatus } from '@xinuco/types'
import type { FinishNoteTarget } from './FinishNoteSheet'

export interface StatusChangeTarget {
  id: string
  customerId?: string | null
  customerName: string
}

export function useAppointmentStatusChange(onChanged?: (appointmentId: string, nextStatus: AppointmentStatus) => void) {
  const [isPending, startTransition] = useTransition()
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // "¿Dejar nota del corte?" tras terminar una cita
  const [noteTarget, setNoteTarget] = useState<FinishNoteTarget | null>(null)

  const changeStatus = (target: StatusChangeTarget, nextStatus: AppointmentStatus) => {
    setUpdatingId(target.id)
    setError(null)
    startTransition(async () => {
      const result = await updateAppointmentStatus(target.id, nextStatus)
      if (result.error) {
        setError(`Error al actualizar estado: ${result.error}`)
      } else {
        onChanged?.(target.id, nextStatus)
        // Terminada: ofrecer dejar una nota en el expediente del cliente (opcional)
        if (nextStatus === 'ready_to_pay' && target.customerId) {
          setNoteTarget({
            customerId: target.customerId,
            customerName: target.customerName || 'el cliente',
            appointmentId: target.id,
          })
        }
      }
      setUpdatingId(null)
    })
  }

  /** Ejecuta la acción (pidiendo confirmación si es destructiva). */
  const runAction = (action: ApptStatusAction, target: StatusChangeTarget) => {
    const confirmText = apptActionConfirmText(action, target.customerName)
    if (confirmText && !window.confirm(confirmText)) return
    changeStatus(target, APPT_ACTION_NEXT_STATUS[action])
  }

  return { isPending, updatingId, error, setError, noteTarget, setNoteTarget, changeStatus, runAction }
}
