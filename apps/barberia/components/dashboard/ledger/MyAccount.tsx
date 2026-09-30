'use client'

// MyAccount — "Mi cuenta" (vista de solo lectura del profesional): sus comisiones, propinas,
// bonos, descuentos, anticipos y pagos. Sin botones de escritura.

import { UserX } from 'lucide-react'
import { AdminPageHeader } from '@xinuco/ui'
import type { StaffAccount } from '@/actions/ledger'
import { AccountHistory, BalanceSummary, useAccountUrl, type AccountViewFilters } from './AccountParts'

export function MyAccount({ account, filters }: { account: StaffAccount; filters: AccountViewFilters }) {
  const { setParams, pending } = useAccountUrl()

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
      />
      <BalanceSummary account={account} />
      <AccountHistory
        account={account}
        filters={filters}
        onFiltersChange={changeFilters}
        onLoadMore={() => setParams({ page: String(account.page + 1) })}
        pending={pending}
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
