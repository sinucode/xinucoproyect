import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { AdminPageHeader } from '@xinuco/ui'
import { requireSettingsAdmin } from '@/lib/settings-guard'
import { businessTodayISODate } from '@/lib/agenda-time'
import { listMoneyAccounts } from '@/actions/money-accounts'
import { PaymentMethodsManager } from '@/components/dashboard/settings/PaymentMethodsManager'

export const metadata: Metadata = {
  title: 'Medios de pago — Xinuco',
  description: 'Los medios con los que cobras y pagas',
}

export default async function PaymentMethodsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  await requireSettingsAdmin(slug)

  const { data: accounts, error } = await listMoneyAccounts()

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Link
        href={`/${slug}/dashboard/settings`}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-xinuco-muted hover:text-xinuco-text transition-colors w-fit"
      >
        <ArrowLeft size={14} />
        Configuración
      </Link>

      <AdminPageHeader
        title="Medios de pago"
        subtitle="Efectivo, bancos, billeteras y datáfono: lo que tienes en cada uno y cómo lo usas."
      />

      {error || !accounts ? (
        <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-400">
          {error ?? 'No se pudo cargar la información. Intenta de nuevo.'}
        </p>
      ) : (
        <PaymentMethodsManager accounts={accounts} today={businessTodayISODate()} />
      )}
    </div>
  )
}
