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
              <span className="text-xinuco-muted">Servicio</span>
              <span className="font-semibold text-xinuco-text">{serviceName}</span>
            </div>
            {products.map((p) => (
              <div key={p.item_id} className="flex justify-between">
                <span className="text-xinuco-muted">Producto apartado</span>
                <span className="font-semibold text-xinuco-text">{p.quantity} × {p.name}</span>
              </div>
            ))}
            {products.length > 0 && (
              <p className="text-xs text-xinuco-muted">Productos: se pagan en el local.</p>
            )}
            <div className="flex justify-between border-t pt-2 mt-1"
              style={{ borderColor: 'color-mix(in srgb, var(--primary-color) 15%, transparent)' }}>
              <span className="text-xinuco-muted">{products.length > 0 ? 'Total a pagar ahora' : 'Total'}</span>
              <span className="font-bold" style={{ color: 'var(--primary-color)' }}>
                {fmtCOP(servicePriceCop)}
              </span>
            </div>
          </div>

          {/* Fee MP */}
          {feeData && (
            <div className="p-3 rounded-xl border border-xinuco-border space-y-1.5 text-xs" style={{ background: 'var(--booking-surface, rgba(255,255,255,0.03))' }}>
              <p className="font-bold text-xinuco-muted uppercase tracking-wider text-[10px]">Detalle del pago con MercadoPago</p>
              <div className="flex justify-between">
                <span className="text-xinuco-muted">Pagas</span>
                <span className="text-xinuco-text">{fmtCOP(servicePriceCop)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xinuco-muted">Fee MP (est.)</span>
                <span className="text-xinuco-muted">{fmtCOP(feeData.fee)}</span>
              </div>
              <div className="flex justify-between border-t border-xinuco-border pt-1.5 font-bold">
                <span className="text-xinuco-text">Recibe el negocio</span>
                <span style={{ color: 'var(--primary-color)' }}>{fmtCOP(feeData.net)}</span>
              </div>
            </div>
          )}

          {/* CTAs */}
          <div className="space-y-2.5">
            <button onClick={handlePay}
              className="w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2.5 transition-all"
              style={{ background: 'var(--primary-color)', color: 'var(--on-primary, #080808)' }}>
              <QrCode size={20} />
              Pagar con MercadoPago
            </button>
            <button onClick={onBack}
              className="w-full py-3 rounded-2xl text-sm font-medium text-xinuco-muted hover:text-xinuco-text border border-xinuco-border hover:border-xinuco-primary flex items-center justify-center gap-1.5 transition-colors">
              <ArrowLeft size={14} />
              Cambiar método de pago
            </button>
          </div>
        </>
      )}

      {/* ── Creando preferencia ────────────────────────────────────────── */}
      {stepState === 'creating' && (
        <div className="flex flex-col items-center py-10 gap-3 text-xinuco-muted">
          <Loader2 size={36} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
          <p className="text-sm font-semibold">Generando link de pago…</p>
        </div>
      )}

      {/* ── QR mostrado ──────────────────────────────────────────────── */}
      {stepState === 'qr_shown' && result && (
        <div className="space-y-4">
          {/* Badge test */}
          {result.is_test_mode && (
            <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-400 light:text-amber-700 font-semibold">
              🧪 Modo Test — usa tarjetas de prueba de MP
            </div>
          )}

          <div className="text-center">
            <p className="font-bold text-xinuco-text">Escanea para pagar</p>
            <p className="text-xs text-xinuco-muted mt-0.5">Puedes usar Nequi, PSE, tarjeta o cualquier billetera</p>
          </div>

          {/* QR */}
          <div className="flex justify-center">
            <div className="p-3 bg-white rounded-2xl shadow-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.qr_url} alt="QR MercadoPago" width={190} height={190} className="block" />
            </div>
          </div>

          {/* Polling */}
          <div className="flex items-center justify-center gap-2 text-xs text-xinuco-muted">
            <RefreshCw size={11} className="animate-spin" />
            Esperando pago… ({pollCount > 0 ? `${pollCount * 3}s` : 'ahora'})
          </div>

          {/* Link copiable */}
          <div className="flex gap-2">
            <div className="flex-1 truncate text-xs border border-xinuco-border rounded-xl px-3 py-2 text-xinuco-muted font-mono" style={{ background: 'var(--booking-surface, rgba(255,255,255,0.03))' }}>
              {result.init_point}
            </div>
            <button onClick={handleCopy} title="Copiar"
              className="shrink-0 px-3 py-2 rounded-xl border border-xinuco-border text-xinuco-muted hover:text-xinuco-text transition-colors" style={{ background: 'var(--booking-surface, rgba(255,255,255,0.03))' }}>
              {copied ? <CheckCircle size={15} className="text-green-400 light:text-green-600" /> : <Copy size={15} />}
            </button>
            <a href={result.init_point} target="_blank" rel="noopener noreferrer" title="Abrir en MP"
              className="shrink-0 px-3 py-2 rounded-xl border border-xinuco-border text-xinuco-muted hover:text-xinuco-text transition-colors" style={{ background: 'var(--booking-surface, rgba(255,255,255,0.03))' }}>
              <ExternalLink size={15} />
            </a>
          </div>

          <button onClick={() => { clearInterval(pollingRef.current!); onBack() }}
            className="w-full py-2 rounded-xl text-xs text-xinuco-muted hover:text-xinuco-text border border-xinuco-border transition-colors">
            Cancelar y volver
          </button>
        </div>
      )}

      {/* ── Aprobado ─────────────────────────────────────────────────── */}
      {stepState === 'approved' && (
        <div className="flex flex-col items-center py-10 gap-3">
          <CheckCircle size={52} className="text-green-400 light:text-green-600" />
          <p className="text-base font-bold text-green-300 light:text-green-700">¡Pago aprobado!</p>
          <p className="text-xs text-xinuco-muted">Confirmando tu cita…</p>
        </div>
      )}

      {/* ── Rechazado / error ─────────────────────────────────────────── */}
      {(stepState === 'rejected' || stepState === 'error') && (
        <div className="space-y-4">
          <div className="flex flex-col items-center py-6 gap-3">
            <XCircle size={44} className="text-red-400 light:text-red-600" />
            <p className="text-sm font-bold text-red-300 light:text-red-700">
              {stepState === 'error' ? 'Error al generar el pago' : 'Pago rechazado'}
            </p>
            {errorMsg && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 light:text-red-700 w-full">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>
          <button onClick={onBack}
            className="w-full py-3 rounded-2xl text-sm font-semibold border border-xinuco-border text-xinuco-text hover:tint-5 transition-colors flex items-center justify-center gap-1.5">
            <ArrowLeft size={14} />
            Volver e intentar de nuevo
          </button>
        </div>
      )}
    </div>
  )
}
