'use client'

// components/pos/MPPaymentPanel.tsx
// ══════════════════════════════════════════════════════════════════════════════
// Panel de pago con MercadoPago para el POS del dashboard.
//
// Flujo:
//  1. Muestra el selector de método (PSE, Nequi, QR, Débito, Crédito)
//  2. Muestra el desglose de fee en tiempo real (via Server Action)
//  3. Botón "Generar link de pago" → crea preferencia en MP
//  4. Muestra QR + link copiable para que el cliente pague desde su celular
//  5. Hace polling cada 3s para detectar cuando el pago fue aprobado
//  6. Al aprobar → llama onPaymentApproved() y el modal padre cierra
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  QrCode, ExternalLink, Copy, CheckCircle, XCircle,
  Loader2, Smartphone, CreditCard, Banknote, RefreshCw, AlertCircle
} from 'lucide-react'
import {
  createMPPreference,
  calculateFeePreview,
  getMPPaymentStatus,
  type MPPreferenceItem,
} from '@/actions/mercadopago'
import type { MPPaymentMethod } from '@/lib/mercadopago/types'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface MPPaymentPanelProps {
  businessId:    string
  appointmentId?: string
  items:         MPPreferenceItem[]
  totalAmount:   number   // COP INTEGER (gross)
  externalRef:   string
  payerEmail?:   string
  /** Llamado cuando el pago es aprobado. El padre puede entonces hacer checkout. */
  onPaymentApproved: (mpPaymentDbId: string) => void
  onCancel:          () => void
}

type PanelState = 'selecting' | 'loading' | 'qr_shown' | 'approved' | 'rejected' | 'error'

// ── Métodos disponibles ────────────────────────────────────────────────────────

const METHODS: { value: MPPaymentMethod; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'qr',          label: 'QR / Link',       icon: <QrCode size={18} />,      description: 'El cliente escanea el QR o abre el link' },
  { value: 'pse',         label: 'PSE',              icon: <Banknote size={18} />,    description: 'Débito bancario en línea' },
  { value: 'nequi',       label: 'Nequi',            icon: <Smartphone size={18} />,  description: 'Pago con Nequi' },
  { value: 'daviplata',   label: 'Daviplata',         icon: <Smartphone size={18} />,  description: 'Pago con Daviplata' },
  { value: 'debit_card',  label: 'Tarjeta Débito',   icon: <CreditCard size={18} />,  description: 'Tarjeta débito' },
  { value: 'credit_card', label: 'Tarjeta Crédito',  icon: <CreditCard size={18} />,  description: 'Tarjeta de crédito' },
]

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

// ── Componente ────────────────────────────────────────────────────────────────

export function MPPaymentPanel({
  businessId, appointmentId, items, totalAmount,
  externalRef, payerEmail, onPaymentApproved, onCancel,
}: MPPaymentPanelProps) {

  const [state, setState]               = useState<PanelState>('selecting')
  const [selectedMethod, setMethod]     = useState<MPPaymentMethod>('qr')
  const [feeData, setFeeData]           = useState<{ fee: number; net: number; rate: number } | null>(null)
  const [feeLoading, setFeeLoading]     = useState(false)
  const [preferenceData, setPreference] = useState<{
    preference_id: string; init_point: string; qr_url: string
    mp_payment_db_id: string; is_test_mode: boolean
  } | null>(null)
  const [errorMsg, setErrorMsg]         = useState<string | null>(null)
  const [copied, setCopied]             = useState(false)
  const [pollCount, setPollCount]       = useState(0)
  const pollingRef                      = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Calcular fee preview al cambiar el método ────────────────────────────────
  useEffect(() => {
    if (state !== 'selecting') return
    let cancelled = false
    setFeeLoading(true)
    calculateFeePreview(totalAmount, selectedMethod)
      .then((bd) => {
        if (cancelled) return
        setFeeData({ fee: bd.fee_amount_cop, net: bd.net_amount_cop, rate: bd.effective_rate_bp })
      })
      .catch(() => setFeeData(null))
      .finally(() => { if (!cancelled) setFeeLoading(false) })
    return () => { cancelled = true }
  }, [selectedMethod, totalAmount, state])

  // ── Polling para detectar el pago aprobado ───────────────────────────────────
  const startPolling = useCallback((dbId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    setPollCount(0)

    pollingRef.current = setInterval(async () => {
      setPollCount((c) => c + 1)
      const status = await getMPPaymentStatus(dbId)
      if (!status) return

      if (status.mp_status === 'approved' || status.mp_status === 'authorized') {
        clearInterval(pollingRef.current!)
        setState('approved')
        setTimeout(() => onPaymentApproved(dbId), 1200)
      } else if (
        status.mp_status === 'rejected' ||
        status.mp_status === 'cancelled' ||
        status.mp_status === 'charged_back'
      ) {
        clearInterval(pollingRef.current!)
        setState('rejected')
        setErrorMsg('El pago fue rechazado o cancelado por MercadoPago.')
      }
    }, 3000)
  }, [onPaymentApproved])

  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [])

  // ── Generar preferencia ───────────────────────────────────────────────────────
  async function handleGenerate() {
    setState('loading')
    setErrorMsg(null)

    const result = await createMPPreference({
      businessId, appointmentId, items,
      payerEmail, externalRef,
    })

    if ('error' in result) {
      setState('error')
      setErrorMsg(result.error)
      return
    }

    setPreference(result.data)
    setState('qr_shown')
    startPolling(result.data.mp_payment_db_id)
  }

  // ── Copiar link ───────────────────────────────────────────────────────────────
  function handleCopy() {
    if (!preferenceData?.init_point) return
    navigator.clipboard.writeText(preferenceData.init_point).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── RENDER ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 animate-fade-in">

      {/* ── Estado: Selección de método ─────────────────────────────────────── */}
      {state === 'selecting' && (
        <>
          {/* Selector de método */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
              Método de pago MercadoPago
            </h4>
            <div className="grid grid-cols-2 gap-1.5">
              {METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all text-sm
                    ${selectedMethod === m.value
                      ? 'border-[var(--primary-color)] bg-[var(--primary-color)]/[0.08] text-[var(--primary-color)]'
                      : 'border-zinc-800 bg-zinc-900/30 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                    }`}
                >
                  {m.icon}
                  <div>
                    <div className="font-semibold leading-tight">{m.label}</div>
                    <div className="text-[10px] opacity-70 leading-tight">{m.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Fee preview */}
          <div className="p-3 bg-zinc-900/60 rounded-xl border border-zinc-800">
            {feeLoading ? (
              <div className="flex items-center gap-2 text-zinc-500 text-xs">
                <Loader2 size={12} className="animate-spin" />
                Calculando fee...
              </div>
            ) : feeData ? (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">Cliente paga</span>
                  <span className="font-semibold text-zinc-200">{fmtCOP(totalAmount)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">Fee MP ({(feeData.rate / 100).toFixed(2)}% ef.)</span>
                  <span className="text-red-400">- {fmtCOP(feeData.fee)}</span>
                </div>
                <div className="flex justify-between text-xs border-t border-zinc-800 pt-1.5 mt-1.5">
                  <span className="font-bold text-zinc-300">Te llega</span>
                  <span className="font-extrabold text-[var(--primary-color)]">{fmtCOP(feeData.net)}</span>
                </div>
              </div>
            ) : null}
          </div>

          {/* Botón generar */}
          <button
            type="button"
            onClick={handleGenerate}
            className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-[var(--primary-color)] text-[#09090b] hover:opacity-90 transition-opacity"
          >
            <QrCode size={16} />
            Generar link de pago
          </button>
        </>
      )}

      {/* ── Estado: Cargando ───────────────────────────────────────────────── */}
      {state === 'loading' && (
        <div className="flex flex-col items-center justify-center py-8 gap-3 text-zinc-400">
          <Loader2 size={32} className="animate-spin text-[var(--primary-color)]" />
          <p className="text-sm font-semibold">Generando link de pago...</p>
        </div>
      )}

      {/* ── Estado: QR mostrado ────────────────────────────────────────────── */}
      {state === 'qr_shown' && preferenceData && (
        <div className="space-y-4">
          {/* Badge modo test */}
          {preferenceData.is_test_mode && (
            <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-950/40 border border-amber-700/40 rounded-lg text-xs text-amber-400 font-semibold">
              🧪 Modo Test — usa tarjetas de prueba de MP
            </div>
          )}
          {/* Instrucción */}
          <div className="text-center">
            <p className="text-sm font-bold text-zinc-200">Muéstrale el QR al cliente</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {preferenceData.is_test_mode
                ? 'Sandbox activo — pagos de prueba únicamente'
                : 'Escanea con la app del banco, Nequi o cualquier app de pago'}
            </p>
          </div>

          {/* QR */}
          <div className="flex justify-center">
            <div className="p-3 bg-white rounded-2xl shadow-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preferenceData.qr_url}
                alt="QR MercadoPago"
                width={180}
                height={180}
                className="block"
              />
            </div>
          </div>

          {/* Polling indicator */}
          <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
            <RefreshCw size={11} className="animate-spin" />
            Esperando pago... ({pollCount > 0 ? `${pollCount * 3}s` : 'ahora'})
          </div>

          {/* Link copiable */}
          <div className="flex gap-2">
            <div className="flex-1 truncate text-xs bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-400 font-mono">
              {preferenceData.init_point}
            </div>
            <button
              type="button"
              onClick={handleCopy}
              title="Copiar link"
              className="shrink-0 px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors"
            >
              {copied ? <CheckCircle size={15} className="text-green-400" /> : <Copy size={15} />}
            </button>
            <a
              href={preferenceData.init_point}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir en MP"
              className="shrink-0 px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors"
            >
              <ExternalLink size={15} />
            </a>
          </div>

          {/* Cancelar */}
          <button
            type="button"
            onClick={() => {
              if (pollingRef.current) clearInterval(pollingRef.current)
              onCancel()
            }}
            className="w-full py-2 rounded-xl text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-700 transition-colors"
          >
            Cancelar y volver a métodos de pago
          </button>
        </div>
      )}

      {/* ── Estado: Aprobado ────────────────────────────────────────────────── */}
      {state === 'approved' && (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <CheckCircle size={48} className="text-green-400" />
          <p className="text-base font-bold text-green-300">¡Pago aprobado!</p>
          <p className="text-xs text-zinc-500">Finalizando cobro...</p>
        </div>
      )}

      {/* ── Estado: Rechazado / Error ────────────────────────────────────────── */}
      {(state === 'rejected' || state === 'error') && (
        <div className="space-y-4">
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <XCircle size={40} className="text-red-400" />
            <p className="text-sm font-bold text-red-300">
              {state === 'rejected' ? 'Pago rechazado' : 'Error al generar link'}
            </p>
            {errorMsg && (
              <div className="flex items-start gap-2 p-3 bg-red-950/40 border border-red-900/30 rounded-xl text-xs text-red-400 max-w-full">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => { setState('selecting'); setErrorMsg(null) }}
            className="w-full py-2.5 rounded-xl text-sm font-semibold border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            Intentar de nuevo
          </button>
        </div>
      )}
    </div>
  )
}
