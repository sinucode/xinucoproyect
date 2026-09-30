'use client'

import { useState, useTransition, useEffect } from 'react'
import { Plus, Minus, Trash, CreditCard, Banknote, Landmark, X, Loader2, DollarSign, Percent, QrCode, Gift } from 'lucide-react'
import { checkoutAppointment, getAppointmentProducts, type CheckoutItemInput } from '@/actions/finance'
import { getInventoryItems, getInventoryReservations } from '@/actions/inventory'
import { getCustomerLoyalty } from '@/actions/loyalty'
import { useFeature } from '@/lib/features/context'
import {
  formatMoney,
  formatUnits,
  maxRedeemablePoints,
  stampRewardCop,
  type CustomerLoyalty,
} from '@/lib/loyalty-utils'
import { StampDots } from '@/components/dashboard/loyalty/StampDots'
import { reservedByItem, type InventoryReservation } from '@/lib/inventory-reservations'
import type { PaymentMethod, InventoryItem } from '@xinuco/types'
import { MPPaymentPanel } from '@/components/pos/MPPaymentPanel'
import { CashReceivedInput } from '@/components/pos/CashReceivedInput'

interface CheckoutModalProps {
  appointment: {
    id: string
    customer_name?: string
    customer_id?: string
    service_name?: string | null
    service_price?: number // we can pass or fetch this
    staff_id?: string | null
  }
  businessId: string
  activeShiftId: string
  onClose: () => void
  onSuccess: () => void
}

export function CheckoutModal({
  appointment,
  businessId,
  activeShiftId,
  onClose,
  onSuccess,
}: CheckoutModalProps) {
  const [isPending, startTransition] = useTransition()
  
  // Lista de ítems a cobrar, pre-poblada con el servicio principal
  const [items, setItems] = useState<CheckoutItemInput[]>([
    {
      description: appointment.service_name || 'Servicio de Peluquería',
      quantity: 1,
      unitPrice: appointment.service_price || 0,
      itemType: 'service',
      staffId: appointment.staff_id || null,
    },
  ])

  // Selector de productos de inventario (se carga una sola vez al abrir el panel)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [showManualForm, setShowManualForm] = useState(false)
  const [inventory, setInventory] = useState<InventoryItem[] | null>(null)
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [inventoryError, setInventoryError] = useState<string | null>(null)
  const [inventoryLoaded, setInventoryLoaded] = useState(false)
  const [inventoryFilter, setInventoryFilter] = useState('')
  // Apartados de citas abiertas (se restan del stock ofrecido, salvo los de ESTA cita)
  const [reservations, setReservations] = useState<InventoryReservation[]>([])

  // Productos que el cliente apartó al reservar en línea: se precargan en el ticket
  const [prefillLoading, setPrefillLoading] = useState(true)

  // Estado para añadir nuevos productos manualmente
  const [newProdName, setNewProdName] = useState('')
  const [newProdPrice, setNewProdPrice] = useState<number | ''>('')
  const [newProdQty, setNewProdQty] = useState<number>(1)

  // Descuentos y propinas
  const [tipAmount, setTipAmount] = useState<number | ''>('')
  const [discountAmount, setDiscountAmount] = useState<number | ''>('')

  // Método de pago
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  
  // Recibido y vuelto (para efectivo)
  const [receivedAmount, setReceivedAmount] = useState<number | ''>('')

  // Validaciones
  const [validationError, setValidationError] = useState<string | null>(null)
  // Cobro hecho pero el canje de lealtad no se pudo registrar: se avisa antes de cerrar
  const [loyaltyWarning, setLoyaltyWarning] = useState<string | null>(null)

  // Lealtad: saldo del cliente (solo si el negocio tiene la función y la cita tiene cliente)
  const loyaltyFeature = useFeature('loyalty')
  const [loyalty, setLoyalty] = useState<CustomerLoyalty | null>(null)
  const [useLoyalty, setUseLoyalty] = useState(false)
  const [pointsInput, setPointsInput] = useState<number | ''>('')

  // Totales
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const finalTip = Number(tipAmount) || 0
  const finalDiscount = Number(discountAmount) || 0

  // Lealtad: el descuento se muestra aquí; el servidor lo recalcula con el saldo real.
  // Solo métodos inmediatos: con el QR de MercadoPago el monto ya está fijado.
  const amountAfterManual = Math.max(0, subtotal - finalDiscount)
  const isMercadoPago = paymentMethod === 'mercadopago'
  const firstServicePrice = items.find((it) => it.itemType === 'service')?.unitPrice ?? 0

  let pointsCap = 0        // tope de puntos usables en este ticket (saldo y monto)
  let pointsToUse = 0
  let loyaltyDiscount = 0
  if (loyalty) {
    if (loyalty.mode === 'points') {
      pointsCap = Math.min(loyalty.balance, Math.floor(amountAfterManual / (loyalty.point_value_cop || 1)))
      pointsToUse = Math.max(0, Math.min(Number(pointsInput) || 0, pointsCap))
      if (useLoyalty && !isMercadoPago && pointsToUse >= Math.max(loyalty.min_redeem, 1)) {
        loyaltyDiscount = pointsToUse * loyalty.point_value_cop
      }
    } else if (useLoyalty && !isMercadoPago && loyalty.can_redeem) {
      loyaltyDiscount = Math.min(stampRewardCop(firstServicePrice, loyalty.stamp_max_reward_cop), amountAfterManual)
    }
  }
  const stampReward = loyalty?.mode === 'stamps'
    ? Math.min(stampRewardCop(firstServicePrice, loyalty.stamp_max_reward_cop), amountAfterManual)
    : 0
  const pointsMax = loyalty?.mode === 'points'
    ? maxRedeemablePoints(loyalty.balance, loyalty.point_value_cop, amountAfterManual, loyalty.min_redeem)
    : 0

  const totalAmount = Math.max(0, subtotal - finalDiscount - loyaltyDiscount + finalTip)

  // Monto recibido (el cambio lo muestra CashReceivedInput)
  // Vacío = pago exacto (igual que en el Punto de Venta)
  const finalReceived = receivedAmount === '' ? totalAmount : Number(receivedAmount) || 0

  // Apartados por OTRAS citas (los de esta cita son del propio cliente y se pueden cobrar)
  const reservedOthers = reservedByItem(reservations, appointment.id)

  // Stock disponible por ítem de inventario = existencias − apartado por otras citas
  // (para topar el stepper)
  const stockById: Record<string, number> = {}
  for (const inv of inventory ?? []) {
    stockById[inv.id] = Math.max(0, inv.current_stock - (reservedOthers[inv.id] ?? 0))
  }

  // Cargar el saldo de lealtad del cliente de la cita
  useEffect(() => {
    if (!loyaltyFeature || !appointment.customer_id) return
    let cancelled = false
    getCustomerLoyalty(appointment.customer_id)
      .then(({ loyalty: data }) => {
        if (!cancelled && data?.enabled) setLoyalty(data)
      })
      .catch(() => { /* sin lealtad: el cobro sigue normal */ })
    return () => { cancelled = true }
  }, [loyaltyFeature, appointment.customer_id])

  // Precargar los productos apartados de esta cita (el cajero puede quitarlos/ajustarlos)
  useEffect(() => {
    let cancelled = false
    getAppointmentProducts(appointment.id)
      .then(({ data }) => {
        if (cancelled || data.length === 0) return
        setItems((prev) => {
          const existing = new Set(prev.map((it) => it.inventoryItemId).filter(Boolean))
          const toAdd: CheckoutItemInput[] = data
            .filter((p) => !existing.has(p.itemId))
            .map((p) => ({
              description: p.name,
              quantity: p.quantity,
              unitPrice: p.unitPrice,
              itemType: 'product' as const,
              staffId: appointment.staff_id || null,
              inventoryItemId: p.itemId,
            }))
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev
        })
      })
      .catch(() => { /* sin precarga: el cajero puede agregarlos a mano */ })
      .finally(() => { if (!cancelled) setPrefillLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointment.id])

  // Abrir el panel de productos y cargar el inventario la primera vez
  const handleOpenAddProduct = async () => {
    setShowAddProduct(true)
    setShowManualForm(false)
    if (inventoryLoaded || inventoryLoading) return
    setInventoryLoading(true)
    setInventoryError(null)
    try {
      const [{ data, error }, resResult] = await Promise.all([
        getInventoryItems(businessId),
        getInventoryReservations(businessId),
      ])
      if (error || !data) {
        setInventoryError(error || 'No se pudo cargar el inventario.')
      } else {
        setInventory(data)
        setReservations(resResult.data ?? [])
        setInventoryLoaded(true)
      }
    } catch {
      setInventoryError('No se pudo cargar el inventario.')
    } finally {
      setInventoryLoading(false)
    }
  }

  // Agregar un producto del inventario (o incrementar su cantidad)
  const handleAddInventoryItem = (inv: InventoryItem) => {
    const existingIdx = items.findIndex((it) => it.inventoryItemId === inv.id)
    const available = stockById[inv.id] ?? inv.current_stock
    if (existingIdx >= 0) {
      if (items[existingIdx].quantity + 1 > available) {
        setValidationError(`No hay más unidades de ${inv.name} en inventario.`)
        return
      }
      setItems(items.map((it, i) => (i === existingIdx ? { ...it, quantity: it.quantity + 1 } : it)))
    } else {
      setItems([
        ...items,
        {
          description: inv.name,
          quantity: 1,
          unitPrice: inv.unit_price ?? 0,
          itemType: 'product',
          staffId: appointment.staff_id || null,
          inventoryItemId: inv.id,
        },
      ])
    }
    setValidationError(null)
  }

  // Cambiar cantidad de un producto del ticket (mín. 1, tope = stock si es de inventario)
  const handleChangeQuantity = (index: number, delta: number) => {
    const item = items[index]
    const next = item.quantity + delta
    if (next < 1) return
    if (delta > 0 && item.inventoryItemId && item.inventoryItemId in stockById) {
      if (next > stockById[item.inventoryItemId]) {
        setValidationError(`No hay más unidades de ${item.description} en inventario.`)
        return
      }
    }
    setItems(items.map((it, i) => (i === index ? { ...it, quantity: next } : it)))
    setValidationError(null)
  }

  // Agregar un producto dinámicamente
  const handleAddProduct = () => {
    if (!newProdName.trim()) {
      setValidationError('Por favor ingresa la descripción del producto.')
      return
    }
    const price = Number(newProdPrice) || 0
    if (price <= 0) {
      setValidationError('El precio del producto debe ser mayor a cero.')
      return
    }

    const newItem: CheckoutItemInput = {
      description: newProdName.trim(),
      quantity: newProdQty,
      unitPrice: price,
      itemType: 'product',
      staffId: appointment.staff_id || null,
    }

    setItems([...items, newItem])
    setNewProdName('')
    setNewProdPrice('')
    setNewProdQty(1)
    setShowAddProduct(false)
    setShowManualForm(false)
    setValidationError(null)
  }

  // Eliminar un ítem
  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) {
      setValidationError('Debe haber al menos un servicio en el cobro.')
      return
    }
    setItems(items.filter((_, i) => i !== index))
    setValidationError(null)
  }

  // Confirmar cobro
  const handleConfirmCheckout = () => {
    if (prefillLoading) {
      setValidationError('Cargando productos apartados de la cita… intenta de nuevo en un momento.')
      return
    }
    if (!paymentMethod) {
      setValidationError('Debes seleccionar un método de pago.')
      return
    }

    if (paymentMethod === 'cash' && finalReceived < totalAmount) {
      setValidationError('El monto recibido en efectivo es menor al total a pagar.')
      return
    }

    if (useLoyalty && loyalty?.mode === 'points' && loyaltyDiscount <= 0) {
      setValidationError(
        loyalty.min_redeem > 0
          ? `Para canjear puntos ingresa al menos ${formatUnits(loyalty.min_redeem)} puntos, o desactiva «Usar puntos».`
          : 'Ingresa los puntos a canjear o desactiva «Usar puntos».',
      )
      return
    }

    // Lo que se canjea (el servidor recalcula el descuento con el saldo real)
    const loyaltyRedeem =
      useLoyalty && loyalty && loyaltyDiscount > 0
        ? loyalty.mode === 'stamps' ? { stamps: true as const } : { units: pointsToUse }
        : undefined

    setValidationError(null)

    startTransition(async () => {
      const result = await checkoutAppointment({
        appointmentId: appointment.id,
        businessId,
        shiftId: activeShiftId,
        paymentMethod,
        receivedAmount: paymentMethod === 'cash' ? finalReceived : totalAmount,
        tipAmount: finalTip,
        discountAmount: finalDiscount,
        items,
        loyaltyRedeem,
      })

      if (result.error) {
        setValidationError(result.message || 'Ocurrió un error al procesar el cobro.')
      } else if (result.loyaltyWarning) {
        setLoyaltyWarning(result.loyaltyWarning)
      } else {
        onSuccess()
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

  // Filtro del selector de inventario
  const filterText = inventoryFilter.trim().toLowerCase()
  const visibleInventory = (inventory ?? []).filter(
    (inv) => !filterText || inv.name.toLowerCase().includes(filterText)
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div 
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl text-zinc-100 flex flex-col max-h-[90vh]"
        style={{ borderColor: 'var(--border-color)' }}
      >
        {/* Header del Modal */}
        <div className="flex items-center justify-between border-b border-zinc-800 p-4 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-xinuco-text">Cobro de Cita</h2>
            <p className="text-xs text-xinuco-muted">
              Cliente: <span className="font-semibold text-xinuco-text">{appointment.customer_name || 'Sin nombre'}</span>
            </p>
          </div>
          <button
            onClick={loyaltyWarning ? onSuccess : onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors"
            title="Cerrar modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Contenido con Scroll */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Listado de Items a Cobrar */}
          <div>
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h3 className="text-xs font-bold uppercase tracking-wider text-xinuco-muted">
                Detalle del Ticket
              </h3>
              {!showAddProduct && (
                <button
                  onClick={handleOpenAddProduct}
                  className="text-xs font-semibold flex items-center gap-1 text-[var(--primary-color)] hover:underline"
                >
                  <Plus size={14} />
                  Añadir Producto
                </button>
              )}
            </div>

            {/* Selector de productos de inventario */}
            {showAddProduct && (
              <div className="mb-4 p-3 bg-zinc-900 border border-zinc-800 rounded-xl space-y-3 animate-fade-in">
                {!showManualForm ? (
                  <>
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-xinuco-text">Agregar Producto</h4>
                      <button
                        type="button"
                        onClick={() => setShowAddProduct(false)}
                        className="p-0.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors"
                        title="Cerrar"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {inventoryLoading && (
                      <div className="flex items-center gap-2 text-xs text-xinuco-muted py-2">
                        <Loader2 size={14} className="animate-spin" />
                        Cargando inventario...
                      </div>
                    )}

                    {inventoryError && !inventoryLoading && (
                      <p className="text-xs text-red-400">{inventoryError}</p>
                    )}

                    {inventoryLoaded && inventory && (
                      <>
                        {inventory.length > 6 && (
                          <input
                            type="text"
                            placeholder="Buscar producto…"
                            value={inventoryFilter}
                            onChange={(e) => setInventoryFilter(e.target.value)}
                            className="w-full text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
                          />
                        )}
                        {inventory.length === 0 ? (
                          <p className="text-xs text-xinuco-muted">No hay productos activos en el inventario.</p>
                        ) : visibleInventory.length === 0 ? (
                          <p className="text-xs text-xinuco-muted">Sin resultados.</p>
                        ) : (
                          <ul className="max-h-48 overflow-y-auto grid grid-cols-1 gap-1.5">
                            {visibleInventory.map((inv) => {
                              const reservedM = reservedOthers[inv.id] ?? 0
                              const available = Math.max(0, inv.current_stock - reservedM)
                              const outOfStock = available <= 0
                              const noPrice = !inv.unit_price
                              const disabled = outOfStock || noPrice
                              return (
                                <li key={inv.id}>
                                  <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => handleAddInventoryItem(inv)}
                                    className="w-full flex items-center justify-between gap-3 text-left px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-950 hover:border-[var(--primary-color)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-800"
                                  >
                                    <span className="min-w-0">
                                      <span className="block text-sm font-semibold text-zinc-100 truncate">{inv.name}</span>
                                      <span className="block text-xs text-xinuco-muted">
                                        {noPrice ? 'Sin precio' : formatCurrency(inv.unit_price as number)}
                                      </span>
                                    </span>
                                    <span
                                      className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                                        outOfStock
                                          ? 'text-red-400 border-red-900/40 bg-red-950/40'
                                          : 'text-zinc-300 border-zinc-800 bg-zinc-900'
                                      }`}
                                    >
                                      {outOfStock ? 'Agotado' : `Quedan ${available}`}
                                      {reservedM > 0 && ` (${reservedM} apartadas)`}
                                    </span>
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => setShowManualForm(true)}
                      className="text-xs font-semibold text-[var(--primary-color)] hover:underline"
                    >
                      Otro producto (manual)
                    </button>
                  </>
                ) : (
                  <>
                <h4 className="text-xs font-bold text-xinuco-text">Agregar Producto Adicional</h4>
                <div className="grid grid-cols-1 gap-2">
                  <input
                    type="text"
                    placeholder="Ej: Cera Modeladora 100g"
                    value={newProdName}
                    onChange={(e) => setNewProdName(e.target.value)}
                    className="w-full text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <DollarSign size={14} className="absolute left-2.5 top-2.5 text-zinc-500" />
                      <input
                        type="number"
                        placeholder="Precio (COP)"
                        value={newProdPrice}
                        onChange={(e) => setNewProdPrice(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full text-sm bg-zinc-950 border border-zinc-800 rounded-lg pl-7 pr-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
                      />
                    </div>
                    <input
                      type="number"
                      min="1"
                      placeholder="Cant."
                      value={newProdQty}
                      onChange={(e) => setNewProdQty(Math.max(1, Number(e.target.value)))}
                      className="w-full text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-zinc-700"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowManualForm(false)}
                    className="text-xs px-3 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors"
                  >
                    Volver
                  </button>
                  <button
                    onClick={handleAddProduct}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[var(--primary-color)] text-black font-semibold hover:opacity-90 transition-opacity"
                  >
                    Agregar Item
                  </button>
                </div>
                  </>
                )}
              </div>
            )}

            {/* Render items list */}
            <ul className="divide-y divide-zinc-900 border border-zinc-900 rounded-xl bg-zinc-900/30 overflow-hidden">
              {items.map((item, idx) => (
                <li key={idx} className="flex items-center justify-between p-3 gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-xinuco-text truncate">
                      {item.description}
                    </p>
                    <p className="text-xs text-xinuco-muted">
                      {item.itemType === 'service' ? 'Servicio' : 'Producto'} • {item.quantity} x {formatCurrency(item.unitPrice)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {item.itemType === 'product' && (
                      <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950">
                        <button
                          type="button"
                          onClick={() => handleChangeQuantity(idx, -1)}
                          aria-label={`Quitar una unidad de ${item.description}`}
                          disabled={item.quantity <= 1}
                          className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Quitar una unidad"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="min-w-[1.25rem] text-center text-xs font-semibold text-zinc-100">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => handleChangeQuantity(idx, 1)}
                          aria-label={`Agregar una unidad de ${item.description}`}
                          className="p-1 text-zinc-400 hover:text-zinc-100"
                          title="Agregar una unidad"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    )}
                    <span className="text-sm font-bold text-xinuco-text">
                      {formatCurrency(item.unitPrice * item.quantity)}
                    </span>
                    <button
                      onClick={() => handleRemoveItem(idx)}
                      className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-white/[0.05] transition-colors"
                      title="Eliminar del ticket"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Lealtad: saldo del cliente y canje */}
          {loyalty && (
            <div
              className="rounded-xl border p-3 space-y-2.5 animate-fade-in"
              style={{ borderColor: 'var(--border-color)', background: 'var(--surface-color, rgba(255,255,255,0.02))' }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Gift size={16} className="shrink-0" style={{ color: 'var(--primary-color)' }} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-xinuco-muted">Lealtad</p>
                    {loyalty.mode === 'points' ? (
                      <p className="text-sm font-semibold text-xinuco-text">
                        Tiene {formatUnits(loyalty.balance)} {loyalty.balance === 1 ? 'punto' : 'puntos'}{' '}
                        <span className="text-xinuco-muted font-normal">({formatMoney(loyalty.value_cop ?? loyalty.balance * loyalty.point_value_cop)})</span>
                      </p>
                    ) : (
                      <p className="text-sm font-semibold text-xinuco-text">
                        {loyalty.balance} de {loyalty.stamps_required} sellos
                      </p>
                    )}
                  </div>
                </div>

                {(loyalty.mode === 'points' ? pointsMax > 0 : loyalty.can_redeem) && (
                  <label
                    className={`flex items-center gap-2 text-xs font-semibold shrink-0 ${
                      isMercadoPago || isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    } text-xinuco-text`}
                  >
                    <input
                      type="checkbox"
                      role="switch"
                      checked={useLoyalty && !isMercadoPago}
                      disabled={isMercadoPago || isPending}
                      onChange={(e) => {
                        setUseLoyalty(e.target.checked)
                        if (e.target.checked && loyalty.mode === 'points') setPointsInput(pointsMax)
                        setValidationError(null)
                      }}
                      className="h-4 w-4 rounded accent-[var(--primary-color)]"
                    />
                    {loyalty.mode === 'points'
                      ? 'Usar puntos'
                      : `Usar servicio gratis (−${formatMoney(stampReward)})`}
                  </label>
                )}
              </div>

              {loyalty.mode === 'stamps' && (
                <div className="flex flex-col gap-1">
                  <StampDots balance={loyalty.balance} required={loyalty.stamps_required} />
                  {!loyalty.can_redeem && (
                    <p className="text-xs text-xinuco-muted">
                      Le {loyalty.stamps_required - loyalty.balance === 1 ? 'falta 1 sello' : `faltan ${loyalty.stamps_required - loyalty.balance} sellos`} para su servicio gratis.
                    </p>
                  )}
                </div>
              )}

              {loyalty.mode === 'points' && loyalty.balance > 0 && loyalty.balance < loyalty.min_redeem && (
                <p className="text-xs text-xinuco-muted">
                  Puede canjear desde {formatUnits(loyalty.min_redeem)} puntos.
                </p>
              )}
              {loyalty.mode === 'points' && loyalty.balance >= loyalty.min_redeem && loyalty.balance > 0 && pointsMax === 0 && (
                <p className="text-xs text-xinuco-muted">
                  El total a pagar es muy bajo para canjear puntos.
                </p>
              )}

              {loyalty.mode === 'points' && useLoyalty && !isMercadoPago && pointsMax > 0 && (
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label htmlFor="loyalty-points" className="block text-xs font-semibold text-xinuco-muted mb-1">
                      Puntos a usar (máx. {formatUnits(pointsMax)})
                    </label>
                    <input
                      id="loyalty-points"
                      type="number"
                      inputMode="numeric"
                      min={Math.max(loyalty.min_redeem, 1)}
                      max={pointsCap}
                      value={pointsInput}
                      onChange={(e) => setPointsInput(e.target.value === '' ? '' : Math.floor(Number(e.target.value)))}
                      onBlur={() => setPointsInput(pointsToUse)}
                      className="w-full text-sm bg-zinc-900/50 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 focus:outline-none focus:border-zinc-700"
                    />
                  </div>
                  <p className="text-sm font-bold text-[var(--primary-color)] tabular-nums pt-5">
                    −{formatMoney(loyaltyDiscount)}
                  </p>
                </div>
              )}

              {isMercadoPago && (loyalty.mode === 'points' ? pointsMax > 0 : loyalty.can_redeem) && (
                <p className="text-xs text-amber-400">
                  Para usar {loyalty.mode === 'points' ? 'puntos' : 'el servicio gratis'} elige efectivo, tarjeta o transferencia.
                </p>
              )}
            </div>
          )}

          {/* Descuento y Propina */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-xinuco-muted mb-1">
                Propina (COP)
              </label>
              <div className="relative">
                <DollarSign size={14} className="absolute left-2.5 top-2.5 text-zinc-500" />
                <input
                  type="number"
                  placeholder="0"
                  value={tipAmount}
                  onChange={(e) => setTipAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full text-sm bg-zinc-900/50 border border-zinc-800 rounded-xl pl-7 pr-3 py-2 text-zinc-100 placeholder-zinc-650 focus:outline-none focus:border-zinc-700"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-xinuco-muted mb-1">
                Descuento (COP)
              </label>
              <div className="relative">
                <Percent size={14} className="absolute left-2.5 top-2.5 text-zinc-500" />
                <input
                  type="number"
                  placeholder="0"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full text-sm bg-zinc-900/50 border border-zinc-800 rounded-xl pl-7 pr-3 py-2 text-zinc-100 placeholder-zinc-650 focus:outline-none focus:border-zinc-700"
                />
              </div>
            </div>
          </div>

          {/* Método de Pago */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-xinuco-muted mb-2">
              Método de Pago
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setPaymentMethod('cash'); setValidationError(null) }}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all gap-1.5
                  ${paymentMethod === 'cash'
                    ? 'border-[var(--primary-color)] bg-[var(--primary-color)]/[0.08] text-[var(--primary-color)]'
                    : 'border-zinc-900 bg-zinc-900/30 text-zinc-400 hover:text-zinc-200 hover:border-zinc-800'
                  }`}
              >
                <Banknote size={20} />
                <span className="text-xs font-semibold">Efectivo</span>
              </button>
              <button
                type="button"
                onClick={() => { setPaymentMethod('card'); setValidationError(null); setReceivedAmount('') }}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all gap-1.5
                  ${paymentMethod === 'card'
                    ? 'border-[var(--primary-color)] bg-[var(--primary-color)]/[0.08] text-[var(--primary-color)]'
                    : 'border-zinc-900 bg-zinc-900/30 text-zinc-400 hover:text-zinc-200 hover:border-zinc-800'
                  }`}
              >
                <CreditCard size={20} />
                <span className="text-xs font-semibold">Tarjeta</span>
              </button>
              <button
                type="button"
                onClick={() => { setPaymentMethod('transfer'); setValidationError(null); setReceivedAmount('') }}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all gap-1.5
                  ${paymentMethod === 'transfer'
                    ? 'border-[var(--primary-color)] bg-[var(--primary-color)]/[0.08] text-[var(--primary-color)]'
                    : 'border-zinc-900 bg-zinc-900/30 text-zinc-400 hover:text-zinc-200 hover:border-zinc-800'
                  }`}
              >
                <Landmark size={20} />
                <span className="text-xs font-semibold">Transf.</span>
              </button>
              <button
                type="button"
                onClick={() => { setPaymentMethod('mercadopago'); setValidationError(null); setReceivedAmount(''); setUseLoyalty(false) }}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all gap-1.5
                  ${paymentMethod === 'mercadopago'
                    ? 'border-[var(--primary-color)] bg-[var(--primary-color)]/[0.08] text-[var(--primary-color)]'
                    : 'border-zinc-900 bg-zinc-900/30 text-zinc-400 hover:text-zinc-200 hover:border-zinc-800'
                  }`}
              >
                <QrCode size={20} />
                <span className="text-xs font-semibold">MercadoPago</span>
              </button>
            </div>
          </div>

          {/* Panel MercadoPago — QR + fee preview + polling */}
          {paymentMethod === 'mercadopago' && (
            <div className="animate-fade-in">
              <MPPaymentPanel
                businessId={businessId}
                appointmentId={appointment.id}
                items={items.map((item) => ({
                  title:         item.description,
                  quantity:      item.quantity,
                  unit_price_cop: item.unitPrice,
                }))}
                totalAmount={totalAmount}
                externalRef={`appt_${appointment.id}`}
                payerEmail={undefined}
                onPaymentApproved={(_mpDbId) => {
                  // Pago confirmado por MP → ejecutar checkout con paymentMethod mercadopago
                  startTransition(async () => {
                    const result = await checkoutAppointment({
                      appointmentId: appointment.id,
                      businessId,
                      shiftId:       activeShiftId,
                      paymentMethod: 'mercadopago',
                      receivedAmount: totalAmount,
                      tipAmount:     finalTip,
                      discountAmount: finalDiscount,
                      items,
                    })
                    if (result.error) {
                      setValidationError(result.message || 'Error al finalizar el cobro.')
                      setPaymentMethod(null)
                    } else {
                      onSuccess()
                    }
                  })
                }}
                onCancel={() => setPaymentMethod(null)}
              />
            </div>
          )}

          {/* Monto Recibido y Cambio para Efectivo */}
          {paymentMethod === 'cash' && (
            <CashReceivedInput total={totalAmount} value={receivedAmount} onChange={setReceivedAmount} />
          )}

          {/* Alertas de error */}
          {validationError && (
            <div className="p-3 bg-red-950/40 border border-red-900/30 rounded-xl flex gap-2 text-red-400 text-xs leading-relaxed animate-fade-in shrink-0">
              <span className="font-bold">⚠️ Error:</span>
              <span>{validationError}</span>
            </div>
          )}
        </div>

        {/* Resumen Final de Cobro y Acciones */}
        <div className="border-t border-zinc-900 bg-zinc-900/40 p-4 space-y-4 shrink-0">
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-xinuco-muted">
              <span>Subtotal ítems:</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {finalDiscount > 0 && (
              <div className="flex justify-between text-xs text-red-400">
                <span>Descuento aplicado:</span>
                <span>-{formatCurrency(finalDiscount)}</span>
              </div>
            )}
            {loyaltyDiscount > 0 && (
              <div className="flex justify-between text-xs text-[var(--primary-color)]">
                <span>Descuento lealtad:</span>
                <span>-{formatCurrency(loyaltyDiscount)}</span>
              </div>
            )}
            {finalTip > 0 && (
              <div className="flex justify-between text-xs text-[var(--primary-color)]">
                <span>Propina agregada:</span>
                <span>+{formatCurrency(finalTip)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-xinuco-text pt-1.5 border-t border-zinc-900">
              <span>Total a Pagar:</span>
              <span className="text-base text-[var(--primary-color)]">{formatCurrency(totalAmount)}</span>
            </div>
          </div>

          {loyaltyWarning && (
            <div className="space-y-3 animate-fade-in">
              <div className="p-3 bg-amber-950/40 border border-amber-900/30 rounded-xl text-amber-400 text-xs leading-relaxed">
                {loyaltyWarning}
              </div>
              <button
                type="button"
                onClick={onSuccess}
                className="btn-primary w-full flex items-center justify-center gap-2 h-11 text-sm font-bold shrink-0"
              >
                Entendido
              </button>
            </div>
          )}

          {paymentMethod !== 'mercadopago' && !loyaltyWarning && (
            <button
              onClick={handleConfirmCheckout}
              disabled={isPending}
              className="btn-primary w-full flex items-center justify-center gap-2 h-11 text-sm font-bold shrink-0"
            >
              {isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Procesando cobro...
                </>
              ) : (
                <>
                  Confirmar Cobro
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
