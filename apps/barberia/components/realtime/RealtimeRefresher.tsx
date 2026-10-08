'use client'

// RealtimeRefresher — mantiene el dashboard "en vivo". Se suscribe (Supabase Realtime, postgres_changes) a
// citas, turnos sin cita y solicitudes de pago del negocio; ante cualquier cambio refresca la ruta actual
// con router.refresh() (re-renderiza en el servidor, conserva el estado de los componentes cliente e
// invalida el router cache, así las demás pestañas se vuelven a pedir al visitarlas).
// La RLS sigue filtrando: el cliente del navegador usa el JWT del usuario, por lo que cada rol solo recibe
// los eventos que ya podría leer. No renderiza nada salvo un aviso discreto de "Nueva cita agendada".

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@xinuco/supabase/client'
import { createRefreshScheduler, realtimeBackoffMs } from '@/lib/realtime-throttle'

const DEBOUNCE_MS      = 600     // agrupa ráfagas de eventos en un solo refresh
const MIN_INTERVAL_MS  = 2000    // nunca más de un refresh cada 2 s
const AWAY_REFRESH_MS  = 15000   // al volver tras >15 s oculto/sin red, refresca una vez
const TOAST_MS         = 4000
const TOAST_STATUSES   = new Set(['scheduled', 'payment_pending'])
const TABLES           = ['appointments', 'walk_ins', 'payout_requests'] as const

export function RealtimeRefresher({ businessId }: { businessId: string }) {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  const [toast, setToast] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!businessId) return
    const supabase = createClient()
    let disposed = false
    let channel: ReturnType<typeof supabase.channel> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let needsCatchUp = false           // hubo una caída: refrescar al re-suscribir
    let awayAt: number | null = null   // desde cuándo la pestaña está oculta / sin red

    const scheduler = createRefreshScheduler({
      debounceMs: DEBOUNCE_MS,
      minIntervalMs: MIN_INTERVAL_MS,
      onRefresh: () => routerRef.current.refresh(),
    })

    function showToast() {
      setToast(true)
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(false), TOAST_MS)
    }

    function teardownChannel() {
      if (channel) {
        const ch = channel
        channel = null
        supabase.removeChannel(ch).catch(() => {})
      }
    }

    function scheduleRetry() {
      if (disposed || retryTimer) return
      const delay = realtimeBackoffMs(attempt++)
      retryTimer = setTimeout(() => {
        retryTimer = null
        void subscribe()
      }, delay)
    }

    async function syncAuth() {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (token) supabase.realtime.setAuth(token)
      } catch (err) {
        console.warn('[realtime] no se pudo leer la sesión', err)
      }
    }

    async function subscribe() {
      if (disposed) return
      teardownChannel()
      // El JWT debe estar en el socket ANTES de unirse al canal para que la RLS aplique
      await syncAuth()
      if (disposed) return

      const ch = supabase.channel(`dashboard:${businessId}`)
      for (const table of TABLES) {
        ch.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `business_id=eq.${businessId}` },
          (payload) => {
            scheduler.trigger()
            if (table === 'appointments' && payload.eventType === 'INSERT') {
              const status = (payload.new as { status?: string } | null)?.status
              if (status && TOAST_STATUSES.has(status)) showToast()
            }
          },
        )
      }
      channel = ch
      ch.subscribe((status) => {
        // Ignora estados de un canal ya reemplazado o cerrado por nosotros
        if (disposed || channel !== ch) return
        if (status === 'SUBSCRIBED') {
          attempt = 0
          if (needsCatchUp) {
            needsCatchUp = false
            scheduler.trigger() // pudimos perder eventos durante la caída
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          needsCatchUp = true
          if (status !== 'CLOSED') console.warn(`[realtime] canal ${status}, reintentando`)
          teardownChannel()
          scheduleRetry()
        }
      })
    }

    // Mantiene el JWT del socket al día cuando Supabase lo renueva
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session?.access_token) {
        supabase.realtime.setAuth(session.access_token)
      }
    })

    // Pestaña oculta / sin red: al volver tras mucho tiempo, un refresh para recuperar lo perdido
    function markAway() { if (awayAt === null) awayAt = Date.now() }
    function markBack() {
      if (awayAt === null) return
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      const away = Date.now() - awayAt
      awayAt = null
      if (away > AWAY_REFRESH_MS) scheduler.trigger()
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') markAway()
      else markBack()
    }
    if (document.visibilityState === 'hidden') markAway()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('offline', markAway)
    window.addEventListener('online', markBack)

    void subscribe()

    return () => {
      disposed = true
      scheduler.cancel()
      if (retryTimer) clearTimeout(retryTimer)
      if (toastTimer.current) clearTimeout(toastTimer.current)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('offline', markAway)
      window.removeEventListener('online', markBack)
      authSub.subscription.unsubscribe()
      teardownChannel()
    }
  }, [businessId])

  if (!toast) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-6">
      <div
        role="status"
        aria-live="polite"
        className="rounded-full border border-xinuco-border bg-xinuco-surface px-4 py-2 text-sm font-medium text-xinuco-text shadow-lg"
      >
        Nueva cita agendada
      </div>
    </div>
  )
}
