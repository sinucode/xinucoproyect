'use client'
// ============================================================
// components/dashboard/TrialBanner.tsx
// Banner informativo visible cuando el negocio tiene un trial activo.
// Solo se muestra a admins. Se auto-oculta cuando el trial vence.
// ============================================================

import { useTrialStatus } from '@/lib/features/context'
import { useIsAdmin } from '@/lib/features/role-context'
import { Sparkles, Clock, ArrowRight } from 'lucide-react'
import Link from 'next/link'

interface TrialBannerProps {
  slug: string
}

export function TrialBanner({ slug }: TrialBannerProps) {
  const { isActive, daysLeft, expiresAt } = useTrialStatus()
  const isAdmin = useIsAdmin()

  // Solo visible para admins durante un trial activo
  if (!isActive || !isAdmin) return null

  const isUrgent = daysLeft <= 3

  const expiryFormatted = expiresAt
    ? new Date(expiresAt).toLocaleDateString('es-CO', {
        day:   'numeric',
        month: 'long',
        year:  'numeric',
      })
    : ''

  return (
    <div
      className="flex items-center justify-between gap-4 px-5 py-3 text-sm"
      style={{
        background: isUrgent
          ? 'linear-gradient(90deg, rgba(239,68,68,0.12), rgba(220,38,38,0.08))'
          : 'linear-gradient(90deg, rgba(197,160,89,0.12), rgba(197,160,89,0.06))',
        borderBottom: `1px solid ${isUrgent ? 'rgba(239,68,68,0.20)' : 'rgba(197,160,89,0.18)'}`,
      }}
    >
      {/* Icono + texto */}
      <div className="flex items-center gap-2.5">
        {isUrgent
          ? <Clock size={15} style={{ color: 'var(--danger-text, #f87171)', flexShrink: 0 }} />
          : <Sparkles size={15} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
        }
        <span style={{ color: isUrgent ? 'var(--danger-soft, #fca5a5)' : 'color-mix(in srgb, var(--text-color) 75%, transparent)' }}>
          {isUrgent
            ? `⚠️ Tu período de prueba vence en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'} (${expiryFormatted}).`
            : `Período de prueba activo — ${daysLeft} ${daysLeft === 1 ? 'día restante' : 'días restantes'} hasta el ${expiryFormatted}.`
          }
          {' '}
          <span style={{ color: isUrgent ? 'var(--danger-text, #f87171)' : 'rgba(197,160,89,0.80)' }}>
            Al vencer, solo se desactiva el acceso, tus datos permanecen intactos.
          </span>
        </span>
      </div>

      {/* CTA */}
      <Link
        href={`/${slug}/dashboard/settings/billing`}
        className="flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap px-3 py-1.5 rounded-lg transition-all hover:scale-[1.03] shrink-0"
        style={{
          background: isUrgent
            ? 'rgba(239,68,68,0.15)'
            : 'color-mix(in srgb, var(--primary-color) 15%, transparent)',
          color: isUrgent ? 'var(--danger-soft, #fca5a5)' : 'var(--primary-color)',
          border: `1px solid ${isUrgent ? 'rgba(239,68,68,0.25)' : 'color-mix(in srgb, var(--primary-color) 30%, transparent)'}`,
        }}
      >
        {isUrgent ? 'Contratar plan' : 'Ver planes'}
        <ArrowRight size={12} />
      </Link>
    </div>
  )
}
