import { Repeat } from 'lucide-react'
import { formatCOP } from '@xinuco/utils'
import type { UpcomingFixedExpense } from '@/actions/expenses'

const MAX_SHOWN = 3

/**
 * Aviso compacto del dashboard del administrador: gastos fijos que vencen hoy o mañana y aún
 * no están registrados. Server Component (sin estado): enlaza a la página de Gastos.
 */
export function UpcomingFixedExpensesNotice({
  items,
  slug,
  today,
}: {
  items: UpcomingFixedExpense[]
  slug:  string
  today: string
}) {
  if (items.length === 0) return null
  const shown = items.slice(0, MAX_SHOWN)
  const extra = items.length - shown.length

  return (
    <a
      href={`/${slug}/dashboard/expenses`}
      className="flex items-start gap-3 rounded-2xl p-4 transition-colors hover:bg-fg/[0.03]"
      style={{
        background: 'color-mix(in srgb, var(--primary-color) 7%, transparent)',
        border: '1px solid color-mix(in srgb, var(--primary-color) 30%, transparent)',
      }}
    >
      <Repeat size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--primary-color)' }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-xinuco-text">Gastos fijos</p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {shown.map(item => (
            <li key={`${item.category}::${item.description}::${item.due_date}`} className="text-xs text-xinuco-muted truncate">
              {item.due_date === today ? 'Hoy vence' : 'Mañana vence'}{' '}
              <span className="text-xinuco-text font-medium">{item.description}</span>
              {' · '}
              <span className="tabular-nums">{formatCOP(item.amount)}</span>
            </li>
          ))}
          {extra > 0 && <li className="text-xs text-xinuco-muted">y {extra} más</li>}
        </ul>
      </div>
      <span className="text-xs shrink-0 self-center" style={{ color: 'var(--primary-color)' }}>Ver →</span>
    </a>
  )
}
