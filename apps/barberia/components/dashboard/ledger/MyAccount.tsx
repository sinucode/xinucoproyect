'use client'

// MyAccount — "Mi cuenta" (vista del profesional): lo que ha ganado hoy / esta semana / este mes,
// su saldo, su último pago, sus movimientos agrupados por día y sus solicitudes de pago o anticipo.
// No registra movimientos: solo puede PEDIR (el administrador paga desde "Pagos al equipo").

import { UserX } from 'lucide-react'
import { AdminPageHeader } from '@xinuco/ui'
import type { StaffAccount } from '@/actions/ledger'
import type { PayoutRequestView } from '@/lib/payout-requests'
import { AccountHistory, BalanceSummary, useAccountUrl, type AccountViewFilters } from './AccountParts'
import { LastPayoutLine, PayoutRequestsPanel, PeriodSummary, RequestPayoutButton } from './MyAccountExtras'

export function MyAccount({
  account,
  filters,
  today,
  requests = [],
}: {
  account: StaffAccount
  filters: AccountViewFilters
  /** Hoy en la zona del negocio ('YYYY-MM-DD'), calculado en el servidor. */
  today: string
  requests?: PayoutRequestView[]
}) {
  const { setParams, pending } = useAccountUrl()
  const hasPendingRequest = requests.some(r => r.status === 'pending')

  function changeFilters(next: Partial<AccountViewFilters>) {
    const merged = { ...filters, ...next }
    setParams({
      type: merged.type === 'all' ? null : merged.type,
      from: merged.from || null,
      to:   merged.to || null,
      page: null,
    })
  }

  return (
    <>
      <AdminPageHeader
        title="Mi cuenta"
        subtitle="Tus comisiones, propinas y pagos."
        actionButton={<RequestPayoutButton balance={account.balance} hasPending={hasPendingRequest} />}
      />
      <PeriodSummary earnings={account.periodEarnings} />
      <BalanceSummary account={account} />
      <LastPayoutLine lastPayout={account.lastPayout} />
      <PayoutRequestsPanel requests={requests} />
      <AccountHistory
        account={account}
        filters={filters}
        onFiltersChange={changeFilters}
        onLoadMore={() => setParams({ page: String(account.page + 1) })}
        pending={pending}
        today={today}
        groupByDay
      />
    </>
  )
}

/** El usuario no está vinculado a ningún profesional: no hay cuenta que mostrar. */
export function NotLinkedCard() {
  return (
    <>
      <AdminPageHeader
        title="Mi cuenta"
        subtitle="Tus comisiones, propinas y pagos."
      />
      <div
        className="flex flex-col items-center justify-center py-16 px-4 gap-4 text-center rounded-2xl border animate-fade-in"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--surface-color)' }}
      >
        <UserX size={32} style={{ color: 'var(--primary-color)' }} strokeWidth={1.5} />
        <p className="max-w-md text-sm text-xinuco-muted leading-relaxed">
          Tu usuario aún no está vinculado a un profesional. Pídele al administrador que lo vincule en Equipo.
        </p>
      </div>
    </>
  )
}
