'use client'

// TeamPayments — "Pagos al equipo" (vista del administrador): lo que gana cada profesional,
// lo que se le adelantó y lo que se le pagó. Liquidar, anticipos y ajustes.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  HandCoins,
  Plus,
  SlidersHorizontal,
  MessageCircle,
  Copy,
  Check,
  X,
  Users,
  Mail,
  AlertTriangle,
} from 'lucide-react'
import { AdminPageHeader } from '@xinuco/ui'
import { formatCOP } from '@xinuco/utils'
import type { StaffAccount, TeamPaymentsOverview } from '@/actions/ledger'
import { specialtyLabel } from '@/lib/team-utils'
import {
  buildWhatsAppSettlementText,
  settlementTextLines,
  shortDateLabel,
  waLink,
  type TeamReceiptResult,
} from '@/lib/team-payments'
import { suggestedPayAmount, type PayoutRequestView } from '@/lib/payout-requests'
import { AccountHistory, BalanceSummary, useAccountUrl, type AccountViewFilters } from './AccountParts'
import { PayoutRequestsAdmin } from './PayoutRequestsAdmin'
import { TeamMovementSheet, type SavedMovement, type SheetKind } from './TeamMovementSheet'

interface TeamPaymentsProps {
  slug:         string
  overview:     TeamPaymentsOverview
  selectedId:   string | null
  account:      StaffAccount | null
  accountError: string | null
  filters:      AccountViewFilters
  today:        string
  /** Solicitudes de pago / anticipo pendientes de los profesionales. */
  payoutRequests?: PayoutRequestView[]
}

interface Receipt {
  staffId:   string
  staffName: string
  kind:      'payment' | 'advance'
  amount:    number
  /** Texto de WhatsApp (solo pagos). */
  text:      string | null
  /** Celular del profesional para abrir su chat (null = elegir el contacto en WhatsApp). */
  phone:     string | null
  /** Recibo por correo: null si no se pidió enviarlo. */
  email:     TeamReceiptResult | null
}

function receiptEmailMessage(result: TeamReceiptResult): { ok: boolean; text: string } {
  if (result.sent) return { ok: true, text: `Recibo enviado a ${result.to ?? 'su correo'}` }
  if (result.reason === 'no_email') return { ok: false, text: 'Sin correo: no se envió el recibo.' }
  if (result.reason === 'email_disabled') return { ok: false, text: 'Los correos del negocio están desactivados: no se envió el recibo.' }
  return { ok: false, text: 'No se pudo enviar el recibo' }
}

function money(value: number): string {
  return `${value < 0 ? '−' : ''}${formatCOP(Math.abs(value))}`
}

export function TeamPayments({
  slug, overview, selectedId, account, accountError, filters, today, payoutRequests = [],
}: TeamPaymentsProps) {
  const router = useRouter()
  const { setParams, pending } = useAccountUrl()
  const [sheet, setSheet] = useState<SheetKind | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [copied, setCopied] = useState(false)
  /** Solicitud que atiende el panel abierto (null = movimiento normal). */
  const [activeRequest, setActiveRequest] = useState<PayoutRequestView | null>(null)
  /** "Pagar" sobre una solicitud de otro profesional: se abre el panel cuando cargue su cuenta. */
  const [wantPay, setWantPay] = useState<PayoutRequestView | null>(null)

  const selected = overview.members.find(m => m.staff.id === selectedId) ?? null
  const { owed, advances_outstanding } = overview.totals

  // El comprobante es del profesional que se liquidó: al cambiar de profesional se descarta
  useEffect(() => {
    setReceipt(prev => (prev && prev.staffId !== selectedId ? null : prev))
  }, [selectedId])

  function openForRequest(r: PayoutRequestView) {
    setActiveRequest(r)
    setSheet(r.kind === 'payout' ? 'settle' : 'advance')
  }

  function payRequest(r: PayoutRequestView) {
    if (r.staff_id === selectedId && account) {
      openForRequest(r)
      return
    }
    setWantPay(r)
    selectStaff(r.staff_id)
  }

  // Al terminar de cargar la cuenta del profesional de la solicitud, se abre el panel
  useEffect(() => {
    if (wantPay && selected?.staff.id === wantPay.staff_id && account) {
      openForRequest(wantPay)
      setWantPay(null)
    }
  }, [wantPay, selected, account])

  function closeSheet() {
    setSheet(null)
    setActiveRequest(null)
  }

  function selectStaff(id: string) {
    // Al cambiar de profesional se reinician filtros y paginación
    setParams({ staff: id, type: null, from: null, to: null, page: null })
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

  function handleSaved(saved: SavedMovement) {
    closeSheet()
    if (saved.kind === 'settle' && account && selected) {
      const lines = settlementTextLines(account.settlement, saved.entry.amount)

      setReceipt({
        staffId:   selected.staff.id,
        staffName: selected.staff.full_name,
        kind:      'payment',
        amount:    saved.entry.amount,
        phone:     selected.phone,
        email:     saved.receipt,
        text: buildWhatsAppSettlementText({
          businessName: overview.businessName,
          staffName:    selected.staff.full_name,
          fromLabel:    saved.periodFrom ? shortDateLabel(saved.periodFrom) : null,
          toLabel:      saved.periodTo ? shortDateLabel(saved.periodTo) : null,
          lines,
          total:        saved.entry.amount,
          method:       saved.method,
        }),
      })
      setCopied(false)
    } else if (saved.kind === 'advance' && selected) {
      setReceipt({
        staffId:   selected.staff.id,
        staffName: selected.staff.full_name,
        kind:      'advance',
        amount:    saved.entry.amount,
        phone:     selected.phone,
        email:     saved.receipt,
        text:      null,
      })
    }
    router.refresh()
  }

  async function copyText() {
    if (!receipt?.text) return
    try {
      await navigator.clipboard.writeText(receipt.text)
    } catch {
      // Respaldo para navegadores sin permiso de portapapeles
      const area = document.createElement('textarea')
      area.value = receipt.text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      try { document.execCommand('copy') } finally { document.body.removeChild(area) }
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <AdminPageHeader
        title="Pagos al equipo"
        subtitle="Lo que gana cada profesional, lo que se le adelantó y lo que se le pagó."
      />

      <PayoutRequestsAdmin
        requests={payoutRequests}
        payableStaffIds={overview.members.map(m => m.staff.id)}
        onPay={payRequest}
      />

      {overview.members.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 px-4 gap-4 text-center rounded-2xl border animate-fade-in"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--surface-color)' }}
        >
          <Users size={32} style={{ color: 'var(--primary-color)' }} strokeWidth={1.5} />
          <div className="max-w-md space-y-1">
            <h2 className="text-lg font-bold text-xinuco-text">Aún no tienes profesionales</h2>
            <p className="text-sm text-xinuco-muted">Añádelos en Equipo y aquí verás lo que gana cada uno.</p>
          </div>
          <Link href={`/${slug}/dashboard/staff`} className="btn-primary !py-2.5">Ir a Equipo</Link>
        </div>
      ) : (
        <>
          {/* Totales */}
          <section aria-label="Totales" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              className="rounded-2xl p-5 flex flex-col gap-1"
              style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.03))' }}
            >
              <span className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">Le debes al equipo</span>
              <span className="text-2xl font-bold tabular-nums" style={{ color: 'var(--primary-color)' }}>
                {formatCOP(owed)}
              </span>
            </div>
            {advances_outstanding > 0 && (
              <div
                className="rounded-2xl p-5 flex flex-col gap-1"
                style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.03))' }}
              >
                <span className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider">Anticipos por descontar</span>
                <span className="text-2xl font-bold tabular-nums text-yellow-400">
                  {formatCOP(advances_outstanding)}
                </span>
              </div>
            )}
          </section>

          {/* Selector de profesional */}
          <nav aria-label="Profesionales" className="flex flex-wrap gap-2">
            {overview.members.map(m => {
              const active = m.staff.id === selectedId
              const bal = m.current_balance
              return (
                <button
                  key={m.staff.id}
                  type="button"
                  onClick={() => selectStaff(m.staff.id)}
                  aria-pressed={active}
                  className={`flex flex-col items-start gap-0.5 rounded-xl px-4 py-2.5 border text-left transition-colors ${
                    m.staff.is_active ? '' : 'opacity-70'
                  }`}
                  style={active ? {
                    borderColor: 'var(--primary-color)',
                    background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
                  } : { borderColor: 'var(--border-color)' }}
                >
                  <span className="text-sm font-semibold text-xinuco-text">
                    {m.staff.full_name}
                    {!m.staff.is_active && <span className="ml-1.5 text-[10px] font-medium text-xinuco-muted">Inactivo</span>}
                  </span>
                  <span
                    className="text-xs font-bold tabular-nums"
                    style={{ color: bal < 0 ? '#f87171' : bal === 0 ? 'var(--text-muted, #a1a1aa)' : 'var(--primary-color)' }}
                  >
                    {money(bal)}
                  </span>
                </button>
              )
            })}
          </nav>

          {/* Panel del profesional elegido */}
          {selected && (
            <section aria-label={`Cuenta de ${selected.staff.full_name}`} className="flex flex-col gap-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-xinuco-text break-words">{selected.staff.full_name}</h2>
                  <p className="text-xs text-xinuco-muted">{specialtyLabel(selected.staff.specialty_role)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSheet('settle')}
                    disabled={!account}
                    className="btn-primary !py-2.5 !px-4 !text-xs"
                  >
                    <HandCoins size={14} />
                    Liquidar
                  </button>
                  <button
                    type="button"
                    onClick={() => setSheet('advance')}
                    disabled={!account}
                    className="btn-ghost !py-2.5 !px-4 !text-xs"
                  >
                    <Plus size={14} />
                    Anticipo
                  </button>
                  <button
                    type="button"
                    onClick={() => setSheet('adjust')}
                    disabled={!account}
                    className="btn-ghost !py-2.5 !px-4 !text-xs"
                  >
                    <SlidersHorizontal size={14} />
                    Ajuste
                  </button>
                </div>
              </div>

              {/* Comprobante tras un pago */}
              {receipt && receipt.staffId === selected.staff.id && (
                <div
                  role="status"
                  className="rounded-2xl p-5 flex flex-col gap-3 animate-fade-in border"
                  style={{
                    borderColor: 'rgba(52,211,153,0.3)',
                    background: 'rgba(52,211,153,0.07)',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <span className="p-1.5 rounded-full bg-emerald-500/15 text-emerald-400 shrink-0">
                        <Check size={16} />
                      </span>
                      <div>
                        <p className="text-sm font-bold text-xinuco-text">
                          {receipt.kind === 'payment' ? 'Pago registrado' : 'Anticipo registrado'}: {formatCOP(receipt.amount)}
                        </p>
                        {receipt.email && (() => {
                          const msg = receiptEmailMessage(receipt.email)
                          return (
                            <p
                              className="text-xs mt-0.5 flex items-center gap-1.5"
                              style={{ color: msg.ok ? '#34d399' : '#fbbf24' }}
                            >
                              {msg.ok ? <Mail size={12} className="shrink-0" /> : <AlertTriangle size={12} className="shrink-0" />}
                              {msg.text}
                            </p>
                          )
                        })()}
                        {receipt.text && (
                          <p className="text-xs text-xinuco-muted mt-0.5">
                            Puedes enviarle el detalle a {receipt.staffName.split(' ')[0]} por WhatsApp.
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReceipt(null)}
                      aria-label="Cerrar aviso"
                      className="p-1.5 rounded-lg text-xinuco-muted hover:text-xinuco-text hover:bg-white/[0.05] transition-colors shrink-0"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {receipt.text && (
                    <>
                      <pre
                        className="text-xs text-xinuco-muted whitespace-pre-wrap break-words rounded-lg px-3 py-2.5 font-sans"
                        style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}
                      >
                        {receipt.text}
                      </pre>
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={waLink(receipt.phone, receipt.text)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-primary !py-2.5 !px-4 !text-xs"
                        >
                          <MessageCircle size={14} />
                          Enviar por WhatsApp
                        </a>
                        <button type="button" onClick={copyText} className="btn-ghost !py-2.5 !px-4 !text-xs">
                          {copied ? <Check size={14} /> : <Copy size={14} />}
                          {copied ? 'Copiado' : 'Copiar texto'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {accountError ? (
                <p role="alert" className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">
                  {accountError}
                </p>
              ) : account ? (
                <>
                  <BalanceSummary account={account} />
                  <AccountHistory
                    account={account}
                    filters={filters}
                    onFiltersChange={changeFilters}
                    onLoadMore={() => setParams({ page: String(account.page + 1) })}
                    pending={pending}
                  />
                </>
              ) : null}
            </section>
          )}
        </>
      )}

      {/* Panel de liquidar / anticipo / ajuste */}
      {sheet && selected && account && (
        <TeamMovementSheet
          kind={sheet}
          slug={slug}
          staffId={selected.staff.id}
          staffName={selected.staff.full_name}
          receiptEmailMasked={selected.receipt_email_masked}
          balance={account.balance}
          hasActiveShift={overview.activeShift !== null}
          today={today}
          suggestedPeriod={account.suggestedPeriod}
          initialAmount={activeRequest ? suggestedPayAmount(activeRequest, account.balance) : undefined}
          initialNotes={activeRequest && activeRequest.kind === 'advance'
            ? (activeRequest.note && activeRequest.note.length >= 3 ? activeRequest.note : 'Anticipo solicitado')
            : undefined}
          payoutRequestId={activeRequest?.id}
          onClose={closeSheet}
          onSaved={handleSaved}
        />
      )}
    </>
  )
}
