'use client'

import Link from 'next/link'
import { AlertTriangle, CheckCircle2, XCircle, type LucideIcon } from 'lucide-react'
import type { Insight, InsightTone } from '@/lib/report-insights'
import { CHART } from './charts/theme'

const TONE: Record<InsightTone, { icon: LucideIcon; color: string; sr: string }> = {
  critical: { icon: XCircle,       color: CHART.critical, sr: 'Urgente' },
  warning:  { icon: AlertTriangle, color: CHART.warning,  sr: 'Atención' },
  good:     { icon: CheckCircle2,  color: CHART.good,     sr: 'Buena noticia' },
}

export function InsightCards({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) {
    return (
      <p className="text-sm text-xinuco-muted rounded-xl px-4 py-3" style={{ border: '1px solid var(--border-color)' }}>
        Por ahora no hay recomendaciones: cuando haya más ventas y citas, aquí verás qué mejorar.
      </p>
    )
  }

  return (
    <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {insights.map((it, i) => {
        const t = TONE[it.tone]
        const Icon = t.icon
        return (
          <li
            key={i}
            className="flex items-start gap-3 rounded-xl p-3.5 min-w-0"
            style={{
              background: 'rgb(var(--fg) / 0.03)',
              border: '1px solid var(--border-color)',
              borderLeft: `3px solid ${t.color}`,
            }}
          >
            <Icon size={18} strokeWidth={2} className="shrink-0 mt-0.5" style={{ color: t.color }} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-xinuco-text break-words">
                <span className="sr-only">{t.sr}: </span>
                {it.title}
              </p>
              <p className="text-xs text-xinuco-muted mt-1 break-words">{it.detail}</p>
              {it.href && (
                <Link href={it.href} className="inline-block mt-2 text-xs font-semibold hover:underline" style={{ color: 'var(--primary-color)' }}>
                  Ver clientes →
                </Link>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
