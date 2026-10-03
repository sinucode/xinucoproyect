'use client'

// MyAccount — "Mi cuenta" (vista del profesional): lo que ha ganado hoy / esta semana / este mes,
// su saldo, su último pago, sus movimientos agrupados por día y sus solicitudes de pago o anticipo.
// No registra movimientos: solo puede PEDIR (el administrador paga desde "Pagos al equipo").

import { useEffect, useState } from 'react'
import { UserX } from 'lucide-react'
import { AdminPageHeader } from '@xinuco/ui'
import type { StaffAccount } from '@/actions/ledger'
import type { PayoutRequestView } from '@/lib/payout-requests'
import { AccountHistory, BalanceSummary, useAccountUrl, type AccountViewFilters } from './AccountParts'
import {
  LastPayoutLine,
  PayoutRequestsHistory,
  PeriodSummary,
  PendingRequestCard,
  RequestPayoutButton,
} from './MyAccountExtras'

const NO_REQUESTS: PayoutRequestView[] = []

export function MyAccount({
  account,
  filters,
  today,
  requests = NO_REQUESTS,
}: {
  account: StaffAccount
  filters: AccountViewFilters
  /** Hoy en la zona del negocio ('YYYY-MM-DD'), calculado en el servidor. */
  today: string
  requests?: PayoutRequestView[]
}) {
  const { setParams, pending } = useAccountUrl()
  // Copia local de las solicitudes: lo que el profesional envía/cancela se ve al instante y el
  // refresco del servidor (router.refresh) la reemplaza cuando llegan los datos reales.
  const [localRequests, setLocalRequests] = useState(requests)
  useEffect(() => { setLocalRequests(requests) }, [requests])

  const pendingRequest = localRequests.find(r => r.status === 'pending') ?? null
  const hasPendingRequest = pendingRequest !== null

  function handleRequested(request: PayoutRequestView) {
    setLocalRequests(prev => [request, ...prev.filter(r => r.status !== 'pending')])
  }

  function handleCancelled(id: string) {
    setLocalRequests(prev => prev.map(r => (r.id === id ? { ...r, status: 'cancelled' } : r)))
  }

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
        actionButton={
          <RequestPayoutButton
            balance={account.balance}
            hasPending={hasPendingRequest}
            onRequested={handleRequested}
          />
        }
      />
      <PendingRequestCard request={pendingRequest} onCancelled={handleCancelled} />
      <PeriodSummary earnings={account.periodEarnings} />
      <BalanceSummary account={account} />
      <LastPayoutLine lastPayout={account.lastPayout} />
      <PayoutRequestsHistory requests={localRequests} />
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
