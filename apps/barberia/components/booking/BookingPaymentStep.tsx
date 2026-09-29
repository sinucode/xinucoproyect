'use client'

// components/booking/BookingPaymentStep.tsx
// ══════════════════════════════════════════════════════════════════════════════
// Paso de pago del BookingWizard — se muestra después de que el cliente
// llena sus datos y elige pagar online con MercadoPago.
//
// Flujo:
//  1. Muestra resumen de la cita + fee de MP
//  2. Crea la cita (status: payment_pending) + preferencia MP
//  3. Muestra QR + link
//  4. Polling cada 3s hasta que el webhook confirme el pago
//  5. Al aprobar → llama onPaymentApproved()
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  QrCode, Copy, CheckCircle, XCircle, Loader2,
  RefreshCw, ExternalLink, AlertCircle, ArrowLeft
} from 'lucide-react'
import { createBookingWithPayment, type BookingWithPaymentResult } from '@/actions/bookings'
import { getMPPaymentStatus } from '@/actions/mercadopago'
import { calculateFeePreview } from '@/actions/mercadopago'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface BookingPaymentStepProps {
  businessId:       string
  serviceId:        string
  serviceName:      string
  servicePriceCop:  number
  staffId:          string | null
  startTime:        string
  userData:         { name: string; phone: string; email: string }
  /** Productos apartados: se pagan en el local, NO se cobran por MercadoPago. */
  products?:        { item_id: string; name: string; quantity: number; unit_price: number }[]
  onPaymentApproved: () => void
  onBack:            () => void
}

type StepState = 'fee_preview' | 'creating' | 'qr_shown' | 'approved' | 'rejected' | 'error'

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

// ── Componente ────────────────────────────────────────────────────────────────

export function BookingPaymentStep({
  businessId, serviceId, serviceName, servicePriceCop,
  staffId, startTime, userData, products = [],
  onPaymentApproved, onBack,
}: BookingPaymentStepProps) {

  const [stepState, setStepState]   = useState<StepState>('fee_preview')
  const [feeData, setFeeData]       = useState<{ fee: number; net: number } | null>(null)
  const [result, setResult]         = useState<BookingWithPaymentResult | null>(null)
  const [errorMsg, setErrorMsg]     = useState<string | null>(null)
  const [copied, setCopied]         = useState(false)
  const [pollCount, setPollCount]   = useState(0)
  const pollingRef                  = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Cargar fee preview al montar ─────────────────────────────────────────
  useEffect(() => {
    calculateFeePreview(servicePriceCop, 'qr')
      .then(bd => setFeeData({ fee: bd.fee_amount_cop, net: bd.net_amount_cop }))
      .catch(() => null)
  }, [servicePriceCop])

  // ── Polling ───────────────────────────────────────────────────────────────
  const startPolling = useCallback((dbId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    pollingRef.current = setInterval(async () => {
      setPollCount(c => c + 1)
      const status = await getMPPaymentStatus(dbId)
      if (!status) return
      if (status.mp_status === 'approved' || status.mp_status === 'authorized') {
        clearInterval(pollingRef.current!)
        setStepState('approved')
        setTimeout(onPaymentApproved, 1500)
      } else if (['rejected','cancelled','charged_back'].includes(status.mp_status)) {
        clearInterval(pollingRef.current!)
        setStepState('rejected')
        setErrorMsg('El pago fue rechazado. Puedes intentar reservar de nuevo.')
      }
    }, 3000)
  }, [onPaymentApproved])

  useEffect(() => () => { if (pollingRef.current) clearInterval(pollingRef.current) }, [])

  // ── Iniciar pago ──────────────────────────────────────────────────────────
  async function handlePay() {
    setStepState('creating')
    setErrorMsg(null)

    const res = await createBookingWithPayment({
      business_id:       businessId,
      service_id:        serviceId,
      staff_id:          staffId,
      start_time:        startTime,
      full_name:         userData.name,
      phone:             userData.phone,
      email:             userData.email || null,
      service_name:      serviceName,
      service_price_cop: servicePriceCop,
      products:          products.map(({ item_id, quantity }) => ({ item_id, quantity })),
    })

    if ('error' in res) {
      setStepState('error')
      setErrorMsg(res.message)
      return
    }

    setResult(res.data)
    setStepState('qr_shown')
    startPolling(res.data.mp_payment_db_id)
  }

  function handleCopy() {
    if (!result?.init_point) return
    navigator.clipboard.writeText(result.init_point).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── Fee preview + botón pagar ──────────────────────────────────── */}
      {stepState === 'fee_preview' && (
        <>
          {/* Resumen */}
          <div className="p-4 rounded-2xl space-y-2 text-sm"
            style={{
              background: 'color-mix(in srgb, var(--primary-color) 6%, transparent)',
              border:     '1px solid color-mix(in srgb, var(--primary-color) 15%, transparent)',
            }}>
            <div className="flex justify-between">
              <span className="text-zinc-500">Servicio</span>
              <span className="font-semibold text-zinc-200">{serviceName}</span>
            </div>
            {products.map((p) => (
              <div key={p.item_id} className="flex justify-between">
                <span className="text-zinc-500">Producto apartado</span>
                <span className="font-semibold text-zinc-200">{p.quantity} × {p.name}</span>
              </div>
            ))}
            {products.length > 0 && (
              <p className="text-xs text-zinc-500">Productos: se pagan en el local.</p>
            )}
            <div className="flex justify-between border-t pt-2 mt-1"
              style={{ borderColor: 'color-mix(in srgb, var(--primary-color) 15%, transparent)' }}>
              <span className="text-zinc-500">{products.length > 0 ? 'Total a pagar ahora' : 'Total'}</span>
              <span className="font-bold" style={{ color: 'var(--primary-color)' }}>
                {fmtCOP(servicePriceCop)}
              </span>
            </div>
          </div>

          {/* Fee MP */}
          {feeData && (
            <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-1.5 text-xs">
              <p className="font-bold text-zinc-400 uppercase tracking-wider text-[10px]">Detalle del pago con MercadoPago</p>
              <div className="flex justify-between">
                <span className="text-zinc-500">Pagas</span>
                <span className="text-zinc-300">{fmtCOP(servicePriceCop)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Fee MP (est.)</span>
                <span className="text-zinc-400">{fmtCOP(feeData.fee)}</span>
              </div>
              <div className="flex justify-between border-t border-zinc-800 pt-1.5 font-bold">
                <span className="text-zinc-300">Recibe el negocio</span>
                <span style={{ color: 'var(--primary-color)' }}>{fmtCOP(feeData.net)}</span>
              </div>
            </div>
          )}

          {/* CTAs */}
          <div className="space-y-2.5">
            <button onClick={handlePay}
              className="w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2.5 transition-all"
              style={{ background: 'var(--primary-color)', color: 'var(--bg-color, #080808)' }}>
              <QrCode size={20} />
              Pagar con MercadoPago
            </button>
            <button onClick={onBack}
              className="w-full py-3 rounded-2xl text-sm font-medium text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-700 flex items-center justify-center gap-1.5 transition-colors">
              <ArrowLeft size={14} />
              Cambiar método de pago
            </button>
          </div>
        </>
      )}

      {/* ── Creando preferencia ────────────────────────────────────────── */}
      {stepState === 'creating' && (
        <div className="flex flex-col items-center py-10 gap-3 text-zinc-400">
          <Loader2 size={36} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
          <p className="text-sm font-semibold">Generando link de pago…</p>
        </div>
      )}

      {/* ── QR mostrado ──────────────────────────────────────────────── */}
      {stepState === 'qr_shown' && result && (
        <div className="space-y-4">
          {/* Badge test */}
          {result.is_test_mode && (
            <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-950/40 border border-amber-700/40 rounded-xl text-xs text-amber-400 font-semibold">
              🧪 Modo Test — usa tarjetas de prueba de MP
            </div>
          )}

          <div className="text-center">
            <p className="font-bold text-zinc-200">Escanea para pagar</p>
            <p className="text-xs text-zinc-500 mt-0.5">Puedes usar Nequi, PSE, tarjeta o cualquier billetera</p>
          </div>

          {/* QR */}
          <div className="flex justify-center">
            <div className="p-3 bg-white rounded-2xl shadow-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.qr_url} alt="QR MercadoPago" width={190} height={190} className="block" />
            </div>
          </div>

          {/* Polling */}
          <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
            <RefreshCw size={11} className="animate-spin" />
            Esperando pago… ({pollCount > 0 ? `${pollCount * 3}s` : 'ahora'})
          </div>

          {/* Link copiable */}
          <div className="flex gap-2">
            <div className="flex-1 truncate text-xs bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-400 font-mono">
              {result.init_point}
            </div>
            <button onClick={handleCopy} title="Copiar"
              className="shrink-0 px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 transition-colors">
              {copied ? <CheckCircle size={15} className="text-green-400" /> : <Copy size={15} />}
            </button>
            <a href={result.init_point} target="_blank" rel="noopener noreferrer" title="Abrir en MP"
              className="shrink-0 px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 transition-colors">
              <ExternalLink size={15} />
            </a>
          </div>

          <button onClick={() => { clearInterval(pollingRef.current!); onBack() }}
            className="w-full py-2 rounded-xl text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 transition-colors">
            Cancelar y volver
          </button>
        </div>
      )}

      {/* ── Aprobado ─────────────────────────────────────────────────── */}
      {stepState === 'approved' && (
        <div className="flex flex-col items-center py-10 gap-3">
          <CheckCircle size={52} className="text-green-400" />
          <p className="text-base font-bold text-green-300">¡Pago aprobado!</p>
          <p className="text-xs text-zinc-500">Confirmando tu cita…</p>
        </div>
      )}

      {/* ── Rechazado / error ─────────────────────────────────────────── */}
      {(stepState === 'rejected' || stepState === 'error') && (
        <div className="space-y-4">
          <div className="flex flex-col items-center py-6 gap-3">
            <XCircle size={44} className="text-red-400" />
            <p className="text-sm font-bold text-red-300">
              {stepState === 'error' ? 'Error al generar el pago' : 'Pago rechazado'}
            </p>
            {errorMsg && (
              <div className="flex items-start gap-2 p-3 bg-red-950/40 border border-red-900/30 rounded-xl text-xs text-red-400 w-full">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>
          <button onClick={onBack}
            className="w-full py-3 rounded-2xl text-sm font-semibold border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center justify-center gap-1.5">
            <ArrowLeft size={14} />
            Volver e intentar de nuevo
          </button>
        </div>
      )}
    </div>
  )
}
