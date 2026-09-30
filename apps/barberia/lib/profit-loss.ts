// lib/profit-loss.ts — estado de resultados (P&G) de un negocio para un rango de fechas.
// Lo comparten Gastos (tarjeta "Utilidad del mes") y Contabilidad (estado completo).
// Toda la aritmética vive en el RPC get_profit_loss (solo admin); aquí solo se traducen los errores.
import type { ProfitLossResult } from '@xinuco/types'

const PL_FAILED = 'No se pudo calcular el estado de resultados. Intenta de nuevo.'
const PL_FORBIDDEN = 'No tienes permiso para ver el estado de resultados.'

/** Cliente de Supabase del servidor (solo se usa `.rpc`). */
type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/**
 * Llama a get_profit_loss. `businessId` DEBE salir del perfil del usuario (nunca del navegador).
 * No lanza: devuelve `{ pl }` o `{ error }` en español.
 */
export async function fetchProfitLoss(
  supabase: RpcClient,
  businessId: string,
  from: string,
  to: string,
): Promise<{ pl: ProfitLossResult } | { error: string }> {
  const res = await supabase.rpc('get_profit_loss', {
    p_business_id: businessId,
    p_date_from:   from,
    p_date_to:     to,
  })

  if (res.error) {
    return { error: res.error.message.includes('forbidden') ? PL_FORBIDDEN : PL_FAILED }
  }
  const result = res.data as (ProfitLossResult & { error?: string }) | null
  if (!result || result.error) return { error: PL_FAILED }
  return { pl: result }
}
