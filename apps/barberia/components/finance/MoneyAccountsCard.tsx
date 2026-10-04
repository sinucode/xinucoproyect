'use client'

// "Tu plata" (Inicio, solo administrador): lo que hay en cada medio y cómo va hoy,
// la deuda con el dueño y el acceso a "Mover plata".

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, ArrowLeftRight, CheckCircle2, HandCoins, Wallet } from 'lucide-react'
import type { MoneyAccountsStatus } from '@xinuco/types'
import { getMoneyAccountsStatus } from '@/actions/money-accounts'
import { formatMoney, formatSignedMoney } from '@/lib/money-accounts'
import { MoveMoneySheet, type MoveMoneyPreset } from '@/components/finance/MoveMoneySheet'

interface MoneyAccountsCardProps {
  initialStatus: MoneyAccountsStatus
}

export function MoneyAccountsCard({ initialStatus }: MoneyAccountsCardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [status, setStatus] = useState<MoneyAccountsStatus>(initialStatus)
  const [sheet, setSheet] = useState<{ preset?: MoveMoneyPreset } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Si el servidor entrega datos nuevos (router.refresh), se usan
  useEffect(() => { setStatus(initialStatus) }, [initialStatus])

  // ?mover=1 (acción rápida "+") y, desde el aviso de saldo insuficiente, ?hacia=<medio>&monto=<faltante>
  useEffect(() => {
    if (searchParams.get('mover') !== '1') return
    const hacia = searchParams.get('hacia')
    const monto = Number(searchParams.get('monto'))
    const validTo = hacia && initialStatus.accounts.some(a => a.id === hacia) ? hacia : undefined
    setSheet({
      preset: validTo || (Number.isInteger(monto) && monto > 0)
        ? { toId: validTo, amount: Number.isInteger(monto) && monto > 0 ? monto : undefined }
        : undefined,
    })
    const next = new URLSearchParams(searchParams.toString())
    ;['mover', 'hacia', 'monto'].forEach(k => next.delete(k))
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])

  const closeSheet = useCallback(() => setSheet(null), [])

  const handleDone = useCallback(async (message: string) => {
    setSheet(null)
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 6000)
    const fresh = await getMoneyAccountsStatus()
    if (fresh.data) setStatus(fresh.data)
    router.refresh() // la caja (efectivo esperado) también cambia
  }, [router])

  const { accounts, owner_loans_pending: loansPending, open_shift_id: openShiftId } = status
  const total = accounts.reduce((sum, a) => sum + a.balance, 0)

  return (
    <div
      className="card animate-fade-in space-y-4 rounded-2xl border bg-zinc-950/85 p-4 shadow-xl backdrop-blur-sm sm:p-6"
      style={{ borderColor: 'var(--border-color)' }}
    >
      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
              borderColor: 'color-mix(in srgb, var(--primary-color) 25%, transparent)',
            }}
          >
            <Wallet size={18} style={{ color: 'var(--primary-color)' }} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-xinuco-text">Tu plata</h3>
            <p className="text-xs text-xinuco-muted">Lo que tienes en cada medio y cómo va hoy</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSheet({})}
          className="btn-primary min-h-11 shrink-0 !px-4"
        >
          <ArrowLeftRight size={15} aria-hidden="true" />
          Mover plata
        </button>
      </div>

      {notice && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-400 animate-fade-in"
        >
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {notice}
        </p>
      )}

      {/* Un renglón por medio */}
      <ul className="divide-y divide-zinc-900 rounded-xl border border-zinc-900 bg-zinc-900/30">
        {accounts.map(a => {
          const negative = a.balance < 0
          const quiet = a.today_in === 0 && a.today_out === 0
          return (
            <li key={a.id} className="px-3 py-3 sm:px-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="break-words text-sm font-medium text-xinuco-text">{a.name}</span>
                  {a.is_cash_drawer && (
                    <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">Caja</span>
                  )}
                </div>
                <span
                  className={`flex shrink-0 items-center gap-1 text-base font-bold tabular-nums ${negative ? 'text-red-400' : 'text-xinuco-text'}`}
                >
                  {negative && <AlertTriangle size={14} aria-label="Saldo negativo" />}
                  {formatMoney(a.balance)}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                <span className="text-xinuco-muted">
                  {quiet ? (
                    'Sin movimientos hoy'
                  ) : (
                    <>
                      Hoy:{' '}
                      <span className="tabular-nums">+{formatMoney(a.today_in)}</span>
                      {' · '}
                      <span className="tabular-nums">−{formatMoney(a.today_out)}</span>
                    </>
                  )}
                </span>
                {!quiet && (
                  <span
                    className={`font-semibold tabular-nums ${a.today_net > 0 ? 'text-emerald-400' : a.today_net < 0 ? 'text-red-400' : 'text-xinuco-muted'}`}
                  >
                    {formatSignedMoney(a.today_net)}
                  </span>
                )}
              </div>
              {a.is_cash_drawer && !openShiftId && (
                <p className="mt-0.5 text-[11px] text-xinuco-muted">Caja cerrada: saldo del último cierre</p>
              )}
            </li>
          )
        })}

        {/* Total */}
        <li className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
          <span className="text-sm font-semibold text-xinuco-text">Total en todos los medios</span>
          <span className={`shrink-0 text-base font-bold tabular-nums ${total < 0 ? 'text-red-400' : ''}`} style={total < 0 ? undefined : { color: 'var(--primary-color)' }}>
            {formatMoney(total)}
          </span>
        </li>
      </ul>

      {/* Deuda con el dueño */}
      {loansPending > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5"
          style={{ color: 'var(--st-amber, #fbbf24)', borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.08)' }}
        >
          <p className="flex min-w-0 flex-1 basis-48 items-start gap-2 text-xs">
            <HandCoins size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              El negocio le debe al dueño{' '}
              <span className="font-bold tabular-nums">{formatMoney(loansPending)}</span>
            </span>
          </p>
          <button
            type="button"
            onClick={() => setSheet({ preset: { kind: 'loan_repayment', amount: loansPending } })}
            className="min-h-11 shrink-0 rounded-xl border border-amber-400/40 px-4 text-xs font-bold hover:bg-amber-400/10"
          >
            Devolver
          </button>
        </div>
      )}

      <MoveMoneySheet
        open={sheet !== null}
        onClose={closeSheet}
        accounts={accounts}
        ownerLoansPending={loansPending}
        hasOpenShift={!!openShiftId}
        preset={sheet?.preset}
        onDone={handleDone}
      />
    </div>
  )
}
