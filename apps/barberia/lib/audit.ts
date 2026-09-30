// lib/audit.ts — Escritura de eventos de auditoría desde el servidor (NO es un archivo 'use server').
//
// Un archivo 'use server' expone cada export como endpoint público; logAction no puede vivir ahí.
// La mayoría de los registros los escriben triggers de la BD. Esto es solo para eventos puntuales
// que ningún trigger cubre. El actor sale SIEMPRE de la sesión en la BD (se ignoran parámetros de actor).

import { createClient } from '@xinuco/supabase/server'
import type { Json } from '@xinuco/types'

type Supabase = Awaited<ReturnType<typeof createClient>>

export interface LogActionParams {
  businessId:  string
  action:      string
  entityType:  string
  entityId?:   string | null
  oldValue?:   Json | null
  newValue?:   Json | null
}

/**
 * Registra un evento en la auditoría. NUNCA lanza: un fallo de auditoría no bloquea la operación.
 * `client` es opcional; si no se pasa se crea uno con la sesión actual.
 */
export async function logAction(params: LogActionParams, client?: Supabase): Promise<void> {
  try {
    const supabase = client ?? (await createClient())
    const { error } = await supabase.rpc('log_action', {
      p_business_id: params.businessId,
      p_actor_id:    null,
      p_actor_name:  null,
      p_action:      params.action,
      p_entity_type: params.entityType,
      p_entity_id:   params.entityId ?? null,
      p_old_value:   params.oldValue ?? null,
      p_new_value:   params.newValue ?? null,
    })
    if (error) {
      console.error('[audit.logAction] Error registrando acción:', error.message, {
        action:     params.action,
        entityType: params.entityType,
        entityId:   params.entityId,
      })
    }
  } catch (e) {
    console.error('[audit.logAction] Error inesperado:', e)
  }
}
