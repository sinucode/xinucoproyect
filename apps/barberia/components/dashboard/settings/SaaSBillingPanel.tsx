'use client'

// components/dashboard/settings/SaaSBillingPanel.tsx
// ══════════════════════════════════════════════════════════════════════════════
// Panel de facturación SaaS para la barbería.
//
// Flujo:
//  1. Muestra plan actual + tarjetas de planes disponibles
//  2. Al hacer clic en "Activar Plan X":
//     a. Llama a createMPSaaSSubscription (Server Action)
//     b. Redirige al init_point de MercadoPago (autorización del débito recurrente)
//  3. Al volver de MP (?result=subscription), muestra banner de confirmación
//  4. El webhook procesa el evento 'preapproval' y activa el plan en la DB
//  5. Al cancelar: llama cancelMPSaaSSubscription → revierte a plan básico
// ══════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { CheckCircle, Loader2, AlertCircle, XCircle, Crown, Zap } from 'lucide-react'
import {
  createMPSaaSSubscription,
  cancelMPSaaSSubscription,
} from '@/actions/mercadopago'
import { PLAN_BUNDLES, PLAN_PRICES_COP, FEATURE_CATALOG, type PlanName } from '@xinuco/billing-catalog'
import type { BusinessFeatures } from '@xinuco/types'

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface SaaSBillingPanelProps {
  businessId:    string
  slug:          string
  payerEmail:    string
  currentPlan:   PlanName | 'custom'
  subscriptionStatus: string | null  // 'pending' | 'authorized' | 'paused' | 'cancelled' | null
  resultParam?:  string              // ?result= de la URL post-redirección
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

const PLAN_ICONS: Record<PlanName, React.ReactNode> = {
  esencial:    <Zap size={18} />,
  profesional: <CheckCircle size={18} />,
  elite:       <Crown size={18} />,
}

const PLAN_COLORS: Record<PlanName, { bg: string; border: string; text: string }> = {
  esencial:    { bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.2)', text: 'rgb(var(--zinc-400))' },
  profesional: { bg: 'rgba(96,165,250,0.08)',  border: 'rgba(96,165,250,0.25)', text: 'var(--st-blue, #60a5fa)' },
  elite:       { bg: 'rgba(197,160,89,0.08)',  border: 'rgba(197,160,89,0.3)',  text: '#C5A059' },
}

// ── Componente ─────────────────────────────────────────────────────────────────

export function SaaSBillingPanel({
  businessId, slug, payerEmail, currentPlan, subscriptionStatus, resultParam,
}: SaaSBillingPanelProps) {

  const [loading,  setLoading]  = useState<PlanName | null>(null)
  const [canceling, setCanceling] = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [canceled, setCanceled] = useState(false)

  const isActive  = subscriptionStatus === 'authorized'
  const isPending = subscriptionStatus === 'pending'

  // ── Suscribirse a un plan ─────────────────────────────────────────────────
  async function handleSubscribe(planId: PlanName) {
    if (planId === 'esencial') return
    setLoading(planId)
    setError(null)

    const result = await createMPSaaSSubscription({ businessId, planId, payerEmail, slug })

    if ('error' in result) {
      setError(result.error)
      setLoading(null)
      return
    }

    // Redirigir al init_point de MercadoPago (autorización del débito recurrente)
    window.location.href = result.init_point
  }

  // ── Cancelar suscripción activa ───────────────────────────────────────────
  async function handleCancel() {
    if (!confirm('¿Estás seguro de cancelar tu suscripción? Tu plan se revertirá a Esencial.')) return
    setCanceling(true)
    setError(null)

    const result = await cancelMPSaaSSubscription(businessId)

    if ('error' in result) {
      setError(result.error)
      setCanceling(false)
      return
    }

    setCanceled(true)
    setCanceling(false)
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Banner: volviste de MP ────────────────────────────────────────── */}
      {resultParam === 'subscription' && !canceled && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-blue-500/30 bg-blue-500/5">
          <Loader2 size={16} className="text-blue-400 shrink-0 mt-0.5 animate-spin" />
          <div>
            <p className="text-sm font-semibold text-blue-300">Activando tu suscripción…</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              Recibimos tu autorización. El plan se activará automáticamente en unos segundos.
            </p>
          </div>
        </div>
      )}

      {/* ── Banner: cancelado ─────────────────────────────────────────────── */}
      {canceled && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/5">
          <CheckCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-300">Suscripción cancelada</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              Tu plan fue revertido a Esencial. Puedes volver a suscribirte cuando quieras.
            </p>
          </div>
        </div>
      )}

      {/* ── Estado actual ─────────────────────────────────────────────────── */}
      <div className="p-4 rounded-xl border bg-zinc-900/40" style={{ borderColor: 'var(--border-color)' }}>
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Plan actual</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {currentPlan !== 'custom' && (
              <span style={{ color: PLAN_COLORS[currentPlan]?.text ?? 'rgb(var(--zinc-400))' }}>
                {PLAN_ICONS[currentPlan] ?? PLAN_ICONS.esencial}
              </span>
            )}
            <div>
              <p className="text-base font-bold text-zinc-100 capitalize">
                {currentPlan === 'custom' ? 'Personalizado' : `Plan ${PLAN_BUNDLES[currentPlan].label}`}
              </p>
              {currentPlan !== 'custom' && currentPlan !== 'esencial' && (
                <p className="text-xs text-zinc-500">
                  {fmtCOP(PLAN_PRICES_COP[currentPlan])} / mes
                </p>
              )}
            </div>
          </div>

          {/* Badge de estado */}
          {isActive && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full border border-green-500/30 bg-green-500/10 text-green-400">
              Activo
            </span>
          )}
          {isPending && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400">
              Pendiente
            </span>
          )}
          {subscriptionStatus === 'cancelled' && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full border border-red-500/30 bg-red-500/10 text-red-400">
              Cancelado
            </span>
          )}
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl border border-red-900/40 bg-red-950/30 text-xs text-red-400">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Tarjetas de planes ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(['esencial', 'profesional', 'elite'] as PlanName[]).map((planId) => {
          const bundle   = PLAN_BUNDLES[planId]
          const price    = PLAN_PRICES_COP[planId]
          const colors   = PLAN_COLORS[planId]
          const isCurrent = currentPlan === planId
          const isLoading = loading === planId

          // Módulos destacados del plan
          const enabledFeatures = Object.entries(bundle.features ?? {})
            .filter(([, v]) => v === true)
            .map(([k]) => FEATURE_CATALOG[k as keyof BusinessFeatures]?.label)
            .filter(Boolean)
            .slice(0, 5)

          return (
            <div
              key={planId}
              className="flex flex-col rounded-2xl border p-5 transition-all"
              style={{
                background:   isCurrent ? colors.bg   : 'rgb(var(--fg) / 0.02)',
                borderColor:  isCurrent ? colors.border : 'var(--border-color)',
                borderWidth:  isCurrent ? '2px' : '1px',
              }}
            >
              {/* Header */}
              <div className="flex items-center gap-2 mb-2">
                <span style={{ color: colors.text }}>{PLAN_ICONS[planId]}</span>
                <h3 className="text-sm font-bold" style={{ color: isCurrent ? colors.text : 'var(--xinuco-text)' }}>
                  {PLAN_BUNDLES[planId].label}
                  {isCurrent && <span className="ml-1.5 text-[10px] font-semibold opacity-80">(actual)</span>}
                </h3>
              </div>

              {/* Precio */}
              <p className="text-2xl font-extrabold tabular-nums mb-1" style={{ color: colors.text }}>
                {price === 0 ? 'Gratis' : fmtCOP(price)}
              </p>
              {price > 0 && <p className="text-xs text-zinc-500 -mt-0.5 mb-4">/ mes</p>}
              {price === 0 && <div className="mb-4" />}

              {/* Features */}
              <ul className="flex flex-col gap-1.5 flex-1 mb-5">
                {enabledFeatures.map((feat) => (
                  <li key={feat} className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <CheckCircle size={11} className="shrink-0 text-green-500/70" />
                    {feat}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              {isCurrent ? (
                <div className="text-center text-xs font-semibold py-2.5 rounded-xl border"
                  style={{ borderColor: colors.border, color: colors.text, background: colors.bg }}>
                  Plan actual
                </div>
              ) : planId === 'esencial' ? (
                <div className="text-center text-xs text-zinc-600 py-2.5">Plan de entrada</div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSubscribe(planId)}
                  disabled={!!loading || canceling}
                  className="w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: colors.border, color: '#080808' }}
                >
                  {isLoading ? (
                    <><Loader2 size={13} className="animate-spin" /> Redirigiendo…</>
                  ) : (
                    `Activar ${PLAN_BUNDLES[planId].label}`
                  )}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Cancelar suscripción activa ────────────────────────────────────── */}
      {isActive && !canceled && (
        <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-800 bg-zinc-900/30">
          <div>
            <p className="text-sm font-semibold text-zinc-300">Cancelar suscripción</p>
            <p className="text-xs text-zinc-500 mt-0.5">Tu plan pasará a Esencial al cancelar.</p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={canceling}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-900/40 text-xs font-semibold text-red-400 hover:bg-red-950/30 transition-colors disabled:opacity-40"
          >
            {canceling ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
            Cancelar
          </button>
        </div>
      )}

      {/* ── Info: modo test ───────────────────────────────────────────────── */}
      {process.env.NODE_ENV !== 'production' && (
        <p className="text-xs text-zinc-600 text-center">
          🧪 Modo test — se usará la cuenta sandbox de MercadoPago
        </p>
      )}
    </div>
  )
}
