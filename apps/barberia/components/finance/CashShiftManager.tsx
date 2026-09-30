'use client'

import { useState, useTransition } from 'react'
import { Landmark, Lock, Unlock, DollarSign, Loader2, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react'
import { openShift, closeShift, type getActiveShiftDetails } from '@/actions/finance'

// Tipo extraído para el detalle del turno
type ShiftDetails = Awaited<ReturnType<typeof getActiveShiftDetails>>

interface CashShiftManagerProps {
  initialShiftDetails: ShiftDetails | null
  businessId: string
  hasInProgressAppointments: boolean
}

export function CashShiftManager({
  initialShiftDetails,
  businessId,
  hasInProgressAppointments,
}: CashShiftManagerProps) {
  const [isPending, startTransition] = useTransition()
  
  // Estados locales
  const [shiftDetails, setShiftDetails] = useState<ShiftDetails | null>(initialShiftDetails)
  const [showOpenModal, setShowOpenModal] = useState(false)
  const [showCloseModal, setShowCloseModal] = useState(false)
  
  // Inputs
  const [startingCash, setStartingCash] = useState<number | ''>('')
  const [actualClosing, setActualClosing] = useState<number | ''>('')
  
  // Mensajes de error
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Apertura de caja
  const handleOpenShift = () => {
    const cash = Number(startingCash)
    if (isNaN(cash) || cash < 0) {
      setErrorMsg('Por favor ingresa una base de caja inicial válida (mayor o igual a cero).')
      return
    }

    setErrorMsg(null)
    startTransition(async () => {
      const result = await openShift(businessId, cash)
      if (result.error) {
        setErrorMsg(result.error)
      } else {
        // Recargar página / estado
        window.location.reload()
      }
    })
  }

  // Cierre de caja
  const handleCloseShift = () => {
    if (hasInProgressAppointments) {
      setErrorMsg('No puedes cerrar el turno porque hay citas activas En Curso.')
      return
    }

    const cash = Number(actualClosing)
    if (isNaN(cash) || cash < 0) {
      setErrorMsg('Por favor ingresa un balance de cierre físico válido.')
      return
    }

    if (!shiftDetails?.shift.id) {
      setErrorMsg('No se pudo encontrar el ID del turno activo.')
      return
    }

    setErrorMsg(null)
    startTransition(async () => {
      const result = await closeShift(businessId, shiftDetails.shift.id, cash)
      if (result.error) {
        setErrorMsg(result.message || 'Error al cerrar caja.')
      } else {
        window.location.reload()
      }
    })
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(val)
  }

  // Cálculos de descuadre
  const expectedCash = shiftDetails?.expectedCashBalance ?? 0
  const closingInput = Number(actualClosing) || 0
  const discrepancy = closingInput - expectedCash

  return (
    <div className="w-full animate-fade-in space-y-4">
      {/* ────────────────── CASO 1: NO HAY TURNO ACTIVO ────────────────── */}
      {!shiftDetails ? (
        <div 
          className="card border border-zinc-800 p-5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-950/80 backdrop-blur-sm shadow-xl"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-start gap-4">
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center border shrink-0 bg-red-950/15 border-red-900/30"
            >
              <Lock size={22} className="text-red-500" />
            </div>
            <div>
              <h3 className="text-base font-bold text-xinuco-text">Caja Cerrada</h3>
              <p className="text-xs text-xinuco-muted mt-1 leading-relaxed">
                No hay un turno de caja abierto para este negocio. Debes abrir un turno registrando la base inicial de efectivo para poder procesar pagos y citas.
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              setShowOpenModal(true)
              setErrorMsg(null)
            }}
            className="btn-primary shrink-0 self-start md:self-center font-bold flex items-center gap-2 h-10 px-5 text-sm"
          >
            <Unlock size={15} />
            Abrir Turno de Caja
          </button>
        </div>
      ) : (
        /* ────────────────── CASO 2: TURNO ACTIVO (TARJETA EJECUTIVA) ────────────────── */
        <div 
          className="card relative overflow-hidden border border-zinc-850 p-6 rounded-2xl bg-zinc-950/85 backdrop-blur-sm shadow-xl"
          style={{ borderColor: 'color-mix(in srgb, var(--primary-color) 25%, transparent)' }}
        >
          {/* Luz indicadora de actividad en esquina */}
          <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Caja Abierta</span>
          </div>

          {/* Icono + Titular */}
          <div className="flex items-center gap-3.5 mb-5">
            <div 
              className="w-11 h-11 rounded-xl flex items-center justify-center border shrink-0"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--primary-color) 12%, transparent)',
                borderColor: 'color-mix(in srgb, var(--primary-color) 25%, transparent)',
              }}
            >
              <Landmark size={20} style={{ color: 'var(--primary-color)' }} />
            </div>
            <div>
              <h3 className="text-base font-bold text-xinuco-text">Turno de Caja Activo</h3>
              <p className="text-xs text-xinuco-muted mt-0.5">
                Iniciado el: <span className="text-xinuco-text">{new Date(shiftDetails.shift.opened_at).toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</span>
              </p>
            </div>
          </div>

          {/* Grid de Métricas Financieras */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <div className="bg-zinc-900/30 border border-zinc-900 p-4 rounded-xl">
              <span className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider block mb-1">
                Base Inicial
              </span>
              <span className="text-lg font-bold text-xinuco-text">
                {formatCurrency(shiftDetails.shift.opening_balance)}
              </span>
            </div>

            <div className="bg-zinc-900/30 border border-zinc-900 p-4 rounded-xl">
              <span className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider block mb-1">
                Total Ventas
              </span>
              <span className="text-lg font-bold text-[var(--primary-color)]">
                {formatCurrency(shiftDetails.totalSales)}
              </span>
            </div>

            <div className="bg-zinc-900/30 border border-zinc-900 p-4 rounded-xl">
              <span className="text-xs font-semibold text-xinuco-muted uppercase tracking-wider block mb-1">
                Efectivo Esperado
              </span>
              <span className="text-lg font-bold text-xinuco-text">
                {formatCurrency(shiftDetails.expectedCashBalance)}
              </span>
              {shiftDetails.totalCashExpenses > 0 && (
                <span className="text-[11px] text-xinuco-muted block mt-1">
                  Gastos pagados de la caja: −{formatCurrency(shiftDetails.totalCashExpenses)}
                </span>
              )}
              {shiftDetails.totalCashTeamPayments > 0 && (
                <span className="text-[11px] text-xinuco-muted block mt-1">
                  Pagos al equipo desde la caja: −{formatCurrency(shiftDetails.totalCashTeamPayments)}
                </span>
              )}
            </div>
          </div>

          {/* Botón Cierre */}
          <div className="flex justify-end border-t border-zinc-900 pt-4">
            <button
              onClick={() => {
                setShowCloseModal(true)
                setActualClosing('')
                setErrorMsg(null)
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold border border-zinc-800 text-zinc-300 hover:text-zinc-150 hover:bg-white/[0.04] transition-all flex items-center gap-2"
            >
              <Lock size={13} />
              Cerrar Turno de Caja (Arqueo)
            </button>
          </div>
        </div>
      )}

      {/* ────────────────── MODAL DE APERTURA DE CAJA ────────────────── */}
      {showOpenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-xinuco-text">Apertura de Caja</h3>
              <button 
                onClick={() => setShowOpenModal(false)}
                className="text-zinc-500 hover:text-zinc-300 text-sm font-semibold"
              >
                Cerrar
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-xinuco-muted leading-relaxed">
                Ingresa el monto de efectivo disponible en caja física al iniciar el día laboral. Este valor servirá como saldo base.
              </p>
              
              <div>
                <label className="block text-xs font-semibold text-xinuco-muted mb-1">
                  Efectivo de Base inicial (COP)
                </label>
                <div className="relative">
                  <DollarSign size={14} className="absolute left-3 top-3 text-zinc-500" />
                  <input
                    type="number"
                    min="0"
                    placeholder="Monto de base, ej: 50000"
                    value={startingCash}
                    onChange={(e) => setStartingCash(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full text-sm bg-zinc-900 border border-zinc-800 rounded-xl pl-8 pr-3 py-2.5 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
                  />
                </div>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-950/40 border border-red-900/30 rounded-xl text-red-400 text-xs flex gap-2">
                <span className="font-bold">⚠️</span>
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex gap-2.5 pt-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowOpenModal(false)}
                className="flex-1 px-4 py-2 text-xs font-bold border border-zinc-800 text-zinc-400 hover:text-zinc-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleOpenShift}
                disabled={isPending}
                className="flex-1 btn-primary text-xs font-bold py-2 flex items-center justify-center gap-1.5"
              >
                {isPending ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    Abriendo...
                  </>
                ) : (
                  'Confirmar Apertura'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────── MODAL DE CIERRE DE CAJA (ARQUEO) ────────────────── */}
      {showCloseModal && shiftDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-xinuco-text">Arqueo y Cierre de Caja</h3>
              <button 
                onClick={() => setShowCloseModal(false)}
                className="text-zinc-500 hover:text-zinc-300 text-sm font-semibold"
              >
                Cerrar
              </button>
            </div>

            {/* Advertencia Crítica de Integridad: Citas En Curso */}
            {hasInProgressAppointments && (
              <div className="p-3 bg-red-950/40 border border-red-900/40 rounded-xl text-red-400 text-xs flex gap-2 leading-relaxed">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block mb-0.5">Cierre de Turno Bloqueado:</span>
                  <span>Existen citas en estado **En Curso** actualmente. Debes terminarlas o cancelarlas en la agenda antes de poder consolidar el turno de caja.</span>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-xinuco-muted">
                  <span>Base de Apertura:</span>
                  <span className="font-semibold text-zinc-300">{formatCurrency(shiftDetails.shift.opening_balance)}</span>
                </div>
                <div className="flex justify-between text-xs text-xinuco-muted">
                  <span>Total Recaudado en Efectivo:</span>
                  <span className="font-semibold text-zinc-300">{formatCurrency(shiftDetails.totalCashCollected)}</span>
                </div>
                <div className="flex justify-between text-xs text-xinuco-muted">
                  <span>Gastos pagados de la caja:</span>
                  <span className="font-semibold text-zinc-300">
                    {shiftDetails.totalCashExpenses > 0 ? '−' : ''}{formatCurrency(shiftDetails.totalCashExpenses)}
                  </span>
                </div>
                {shiftDetails.totalCashTeamPayments > 0 && (
                  <div className="flex justify-between text-xs text-xinuco-muted">
                    <span>Pagos al equipo desde la caja:</span>
                    <span className="font-semibold text-zinc-300">
                      −{formatCurrency(shiftDetails.totalCashTeamPayments)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-xinuco-text border-t border-zinc-900 pt-2">
                  <span>Monto Esperado en Caja:</span>
                  <span className="text-[var(--primary-color)]">{formatCurrency(shiftDetails.expectedCashBalance)}</span>
                </div>
              </div>

              {/* Formulario balance físico real */}
              <div>
                <label className="block text-xs font-semibold text-xinuco-muted mb-1">
                  Efectivo Físico Real en Caja (COP)
                </label>
                <div className="relative">
                  <DollarSign size={14} className="absolute left-3 top-3 text-zinc-500" />
                  <input
                    type="number"
                    min="0"
                    placeholder="Monto contado físicamente, ej: 154000"
                    value={actualClosing}
                    onChange={(e) => setActualClosing(e.target.value === '' ? '' : Number(e.target.value))}
                    disabled={hasInProgressAppointments}
                    className="w-full text-sm bg-zinc-900 border border-zinc-800 rounded-xl pl-8 pr-3 py-2.5 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* ALERTA DE DESCUADRE (UX Premium — The Mirror) */}
              {actualClosing !== '' && !hasInProgressAppointments && (
                <div className="animate-fade-in shrink-0">
                  {discrepancy < 0 ? (
                    /* Faltante */
                    <div className="p-3.5 bg-amber-950/20 border border-amber-900/35 rounded-xl text-amber-400 text-xs flex gap-2.5 leading-relaxed">
                      <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
                      <div>
                        <span className="font-bold block mb-0.5">Descuadre: Faltante de dinero</span>
                        <span>Se registran <span className="font-semibold text-amber-300">{formatCurrency(Math.abs(discrepancy))} menos</span> en caja que lo calculado según ventas. Asegura que todos los movimientos hayan sido registrados.</span>
                      </div>
                    </div>
                  ) : discrepancy > 0 ? (
                    /* Sobrante */
                    <div className="p-3.5 bg-blue-950/25 border border-blue-900/35 rounded-xl text-blue-400 text-xs flex gap-2.5 leading-relaxed">
                      <AlertCircle size={16} className="shrink-0 mt-0.5 text-blue-500" />
                      <div>
                        <span className="font-bold block mb-0.5">Descuadre: Sobrante de dinero</span>
                        <span>Se registran <span className="font-semibold text-blue-300">{formatCurrency(discrepancy) } de más</span> en caja. Esto puede deberse a propinas no declaradas o errores en vueltos.</span>
                      </div>
                    </div>
                  ) : (
                    /* Caja Cuadrada Perfecta */
                    <div className="p-3.5 bg-emerald-950/20 border border-emerald-900/35 rounded-xl text-emerald-400 text-xs flex gap-2.5 leading-relaxed">
                      <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-500" />
                      <div>
                        <span className="font-bold block mb-0.5">Caja Cuadrada</span>
                        <span>El efectivo contado coincide exactamente con los registros financieros. ¡Excelente trabajo de arqueo!</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-950/40 border border-red-900/30 rounded-xl text-red-400 text-xs flex gap-2">
                <span className="font-bold">⚠️</span>
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex gap-2.5 pt-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                className="flex-1 px-4 py-2 text-xs font-bold border border-zinc-800 text-zinc-400 hover:text-zinc-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCloseShift}
                disabled={isPending || hasInProgressAppointments || actualClosing === ''}
                className="flex-1 btn-primary text-xs font-bold py-2 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    Cerrando...
                  </>
                ) : (
                  'Confirmar Cierre'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
