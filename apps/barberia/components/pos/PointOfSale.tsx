'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  Gift,
  Loader2,
  Lock,
  MessageCircle,
  Minus,
  Percent,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
} from 'lucide-react'
import { createPosSale } from '@/actions/retail'
import { formatMoney, formatUnits } from '@/lib/loyalty-utils'
import { waLink } from '@/lib/team-payments'
import {
  POS_METHOD_LABELS,
  cartSubtotal,
  categoryLabel,
  computePosTotals,
  effectiveLoyaltyUnits,
  receiptText,
  type CartLine,
  type PosCatalog,
  type PosPaymentMethod,
  type PosProduct,
  type ReceiptData,
} from '@/lib/pos-utils'
import { AccountPicker } from '@/components/finance/AccountPicker'
import { useCheckoutAccounts } from '@/components/finance/useCheckoutAccounts'
import { accountIdOrNull, posMethodForAccount } from '@/lib/money-accounts'
import { CashReceivedInput } from './CashReceivedInput'
import { PosCustomerPicker, type PosSelectedCustomer } from './PosCustomerPicker'

interface PointOfSaleProps {
  slug:     string
  catalog:  PosCatalog
  /** Disposición compacta (dentro de un modal): menos columnas y sin sticky. */
  compact?: boolean
  /** Se llama después de cada venta (p. ej. para recargar el catálogo dentro del modal). */
  onSold?:  () => void
}

const sectionLabel = 'text-xs font-bold uppercase tracking-wider text-xinuco-muted mb-2'
const fieldClass =
  'w-full text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-700'

export function PointOfSale({ slug, catalog, compact = false, onSold }: PointOfSaleProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [cart, setCart] = useState<CartLine[]>([])

  const [customer, setCustomer] = useState<PosSelectedCustomer | null>(null)
  const [useLoyalty, setUseLoyalty] = useState(false)
  const [pointsInput, setPointsInput] = useState<number | ''>('')
  const [sellerId, setSellerId] = useState('')
  const [discountInput, setDiscountInput] = useState<number | ''>('')
  // Medio de pago del negocio; sin elegir se usa Efectivo (la caja)
  const { accounts, loaded: accountsLoaded } = useCheckoutAccounts()
  const [accountId, setAccountId] = useState<string | null>(null)
  const account = accounts.find((a) => a.id === accountId) ?? accounts.find((a) => a.is_cash_drawer) ?? null
  // El POS solo acepta efectivo, tarjeta o transferencia (Mercado Pago cuenta como transferencia)
  const method: PosPaymentMethod = account ? posMethodForAccount(account) : 'cash'
  const [received, setReceived] = useState<number | ''>('')

  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<(ReceiptData & { customerPhone: string | null }) | null>(null)

  const productById = useMemo(() => new Map(catalog.products.map((p) => [p.id, p])), [catalog.products])

  // Las líneas se derivan del catálogo vigente: si cambió lo disponible, la cantidad se ajusta.
  const lines = useMemo(
    () =>
      cart.flatMap((l) => {
        const product = productById.get(l.itemId)
        if (!product) return []
        const quantity = Math.min(l.quantity, product.available)
        return quantity > 0 ? [{ product, quantity }] : []
      }),
    [cart, productById],
  )
  const quantityOf = (id: string) => lines.find((l) => l.product.id === id)?.quantity ?? 0

  // ── Totales ────────────────────────────────────────────────────────────────
  const subtotal = cartSubtotal(lines.map((l) => ({ unit_price: l.product.unit_price, quantity: l.quantity })))
  const discountNum = Math.min(Math.max(0, Math.round(Number(discountInput) || 0)), subtotal)

  const loy = customer?.loyalty ?? null
  const pointsAvailable =
    catalog.loyalty.enabled && !!loy && loy.enabled && loy.mode === 'points' && loy.balance > 0
  const { max: pointsMax, units: pointsUnits } = pointsAvailable && loy
    ? effectiveLoyaltyUnits({
        requested:     useLoyalty ? (pointsInput === '' ? null : Number(pointsInput)) : null,
        balance:       loy.balance,
        pointValueCop: loy.point_value_cop,
        minRedeem:     loy.min_redeem,
        amountCop:     subtotal - discountNum,
      })
    : { max: 0, units: 0 }
  const loyaltyUnits = useLoyalty && pointsAvailable ? pointsUnits : 0

  const totals = computePosTotals({
    subtotal,
    discount:      discountNum,
    loyaltyUnits,
    pointValueCop: loy?.point_value_cop ?? 0,
  })
  const total = totals.total

  const receivedNum = Number(received) || 0
  const cashShort = method === 'cash' && total > 0 && receivedNum > 0 && receivedNum < total
  const canCharge = !!catalog.shiftId && lines.length > 0 && !isPending && !cashShort && accountsLoaded

  // ── Catálogo filtrado ──────────────────────────────────────────────────────
  const categories = useMemo(
    () => Array.from(new Set(catalog.products.map((p) => p.category))).sort((a, b) => a.localeCompare(b, 'es')),
    [catalog.products],
  )
  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return catalog.products.filter(
      (p) => (category === 'all' || p.category === category) && (!q || p.name.toLowerCase().includes(q)),
    )
  }, [catalog.products, search, category])

  // ── Carrito ────────────────────────────────────────────────────────────────
  const changeQuantity = (product: PosProduct, delta: number) => {
    setError(null)
    setCart((prev) =>
      prev
        .map((l) =>
          l.itemId === product.id
            ? { ...l, quantity: Math.min(Math.min(l.quantity, product.available) + delta, product.available) }
            : l,
        )
        .filter((l) => l.quantity > 0),
    )
  }

  const addProduct = (product: PosProduct) => {
    if (product.available <= 0 || product.unit_price <= 0) return
    setError(null)
    setCart((prev) => {
      const current = Math.min(prev.find((l) => l.itemId === product.id)?.quantity ?? 0, product.available)
      if (current >= product.available) return prev
      return prev.some((l) => l.itemId === product.id)
        ? prev.map((l) => (l.itemId === product.id ? { ...l, quantity: current + 1 } : l))
        : [...prev, { itemId: product.id, quantity: 1 }]
    })
  }

  const removeProduct = (id: string) => {
    setError(null)
    setCart((prev) => prev.filter((l) => l.itemId !== id))
  }

  const changeCustomer = (next: PosSelectedCustomer | null) => {
    setCustomer(next)
    setUseLoyalty(false)
    setPointsInput('')
    setError(null)
  }

  const resetSale = () => {
    setCart([])
    setCustomer(null)
    setUseLoyalty(false)
    setPointsInput('')
    setSellerId('')
    setDiscountInput('')
    setAccountId(null)
    setReceived('')
    setError(null)
  }

  // ── Cobro ──────────────────────────────────────────────────────────────────
  const handleCharge = () => {
    if (!canCharge) return
    setError(null)

    const snapshotLines = lines.map((l) => ({
      name: l.product.name, quantity: l.quantity, unit_price: l.product.unit_price,
    }))
    const snapshotCustomer = customer

    startTransition(async () => {
      const res = await createPosSale({
        customerId:     customer?.id ?? null,
        sellerStaffId:  sellerId || null,
        paymentMethod:  method,
        accountId:      accountIdOrNull(account?.id),
        discount:       discountNum,
        items:          lines.map((l) => ({ itemId: l.product.id, quantity: l.quantity })),
        loyaltyUnits,
        receivedAmount: method === 'cash' && receivedNum > 0 ? receivedNum : undefined,
      })

      if (!res.success) {
        setError(res.error ?? 'No se pudo registrar la venta.')
        // Lo disponible pudo cambiar (otra venta o una reserva): se recarga el catálogo
        router.refresh()
        onSold?.()
        return
      }

      setReceipt({
        lines:           snapshotLines,
        subtotal:        res.subtotal ?? totals.subtotal,
        discount:        res.discount ?? totals.discount,
        loyaltyDiscount: res.loyaltyDiscount ?? totals.loyaltyDiscount,
        total:           res.total ?? total,
        method,
        accountName:     account && !account.is_cash_drawer ? account.name : null,
        received:        method === 'cash' && receivedNum > 0 ? receivedNum : null,
        change:          res.change ?? 0,
        customerName:    snapshotCustomer?.full_name ?? null,
        customerPhone:   snapshotCustomer?.phone ?? null,
      })
      resetSale()
      router.refresh()
      onSold?.()
    })
  }

  // ── Sin caja abierta ───────────────────────────────────────────────────────
  if (!catalog.shiftId && !receipt) {
    return (
      <div
        className="rounded-2xl border p-8 flex flex-col items-center text-center gap-3"
        style={{ borderColor: 'var(--border-color)', background: 'var(--surface-color)' }}
      >
        <Lock size={28} className="text-xinuco-muted" />
        <p className="font-semibold text-xinuco-text">Abre la caja desde el inicio para vender.</p>
        <p className="text-sm text-xinuco-muted max-w-sm">
          Las ventas se registran en el turno de caja abierto.
        </p>
        <Link
          href={`/${slug}/dashboard`}
          className="mt-1 text-sm font-semibold px-4 py-2 rounded-lg bg-[var(--primary-color)] text-black hover:opacity-90"
        >
          Ir al inicio
        </Link>
      </div>
    )
  }

  // ── Recibo ─────────────────────────────────────────────────────────────────
  if (receipt) {
    return (
      <div
        className="rounded-2xl border p-5 sm:p-6 max-w-md mx-auto w-full space-y-4"
        style={{ borderColor: 'var(--border-color)', background: 'var(--surface-color)' }}
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 size={28} className="text-emerald-500 shrink-0" />
          <div>
            <p className="font-bold text-xinuco-text">Venta registrada</p>
            <p className="text-xs text-xinuco-muted">
              {receipt.customerName ? `Cliente: ${receipt.customerName}` : 'Sin cliente'}
            </p>
          </div>
        </div>

        <ul className="divide-y text-sm" style={{ borderColor: 'var(--border-color)' }}>
          {receipt.lines.map((l, i) => (
            <li key={i} className="flex items-start justify-between gap-3 py-2">
              <span className="text-xinuco-text min-w-0">{l.quantity} × {l.name}</span>
              <span className="font-semibold text-xinuco-text shrink-0">{formatMoney(l.unit_price * l.quantity)}</span>
            </li>
          ))}
        </ul>

        <dl className="space-y-1 text-sm">
          {(receipt.discount > 0 || receipt.loyaltyDiscount > 0) && (
            <div className="flex justify-between text-xinuco-muted">
              <dt>Subtotal</dt><dd>{formatMoney(receipt.subtotal)}</dd>
            </div>
          )}
          {receipt.discount > 0 && (
            <div className="flex justify-between text-xinuco-muted">
              <dt>Descuento</dt><dd>-{formatMoney(receipt.discount)}</dd>
            </div>
          )}
          {receipt.loyaltyDiscount > 0 && (
            <div className="flex justify-between text-xinuco-muted">
              <dt>Descuento por puntos</dt><dd>-{formatMoney(receipt.loyaltyDiscount)}</dd>
            </div>
          )}
          <div className="flex justify-between text-base font-bold text-xinuco-text pt-1">
            <dt>Total</dt><dd>{formatMoney(receipt.total)}</dd>
          </div>
          <div className="flex justify-between text-xinuco-muted">
            <dt>Medio de pago</dt><dd>{receipt.accountName || POS_METHOD_LABELS[receipt.method]}</dd>
          </div>
          {receipt.method === 'cash' && receipt.received !== null && (
            <>
              <div className="flex justify-between text-xinuco-muted">
                <dt>Recibido</dt><dd>{formatMoney(receipt.received)}</dd>
              </div>
              <div className="flex justify-between font-semibold text-[var(--primary-color)]">
                <dt>Cambio</dt><dd>{formatMoney(receipt.change)}</dd>
              </div>
            </>
          )}
        </dl>

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <button
            type="button"
            onClick={() => setReceipt(null)}
            className="flex-1 text-sm font-bold py-2.5 rounded-lg bg-[var(--primary-color)] text-black hover:opacity-90"
          >
            Nueva venta
          </button>
          <a
            href={waLink(receipt.customerPhone, receiptText(receipt))}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold py-2.5 rounded-lg border border-zinc-800 text-zinc-200 hover:border-zinc-700"
          >
            <MessageCircle size={15} /> Enviar por WhatsApp
          </a>
        </div>
      </div>
    )
  }

  // ── Venta ──────────────────────────────────────────────────────────────────
  const gridCols = compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'

  return (
    <div
      className={`grid gap-6 items-start ${
        compact ? 'md:grid-cols-[minmax(0,1fr)_320px]' : 'lg:grid-cols-[minmax(0,1fr)_380px]'
      }`}
    >
      {/* ── Productos ── */}
      <section aria-label="Productos" className="min-w-0 space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-500" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto"
            aria-label="Buscar producto"
            className={`${fieldClass} pl-8`}
          />
        </div>

        {categories.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {[{ id: 'all', label: 'Todos' }, ...categories.map((c) => ({ id: c, label: categoryLabel(c) }))].map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                aria-pressed={category === c.id}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                  category === c.id
                    ? 'border-[var(--primary-color)] bg-[var(--primary-color)]/[0.1] text-[var(--primary-color)]'
                    : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {catalog.products.length === 0 ? (
          <div
            className="rounded-xl border p-6 text-center text-sm text-xinuco-muted"
            style={{ borderColor: 'var(--border-color)' }}
          >
            No hay productos en el inventario.{' '}
            <Link href={`/${slug}/dashboard/inventory`} className="text-[var(--primary-color)] hover:underline">
              Agrégalos en Inventario
            </Link>
            .
          </div>
        ) : visibleProducts.length === 0 ? (
          <p className="text-sm text-xinuco-muted py-6 text-center">Ningún producto coincide con la búsqueda.</p>
        ) : (
          <ul className={`grid gap-2.5 ${gridCols}`}>
            {visibleProducts.map((p) => {
              const inCart = quantityOf(p.id)
              const noPrice = p.unit_price <= 0
              const soldOut = p.available <= 0
              const disabled = noPrice || soldOut || inCart >= p.available
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => addProduct(p)}
                    disabled={disabled}
                    aria-label={`Agregar ${p.name}`}
                    className="w-full h-full text-left rounded-xl border p-3 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed hover:border-[var(--primary-color)] disabled:hover:border-[var(--border-color)]"
                    style={{
                      borderColor: inCart > 0 ? 'var(--primary-color)' : 'var(--border-color)',
                      background:  'var(--surface-color)',
                    }}
                  >
                    <p className="text-sm font-semibold text-xinuco-text leading-snug line-clamp-2">{p.name}</p>
                    <p className="text-[11px] text-xinuco-muted mt-0.5">{categoryLabel(p.category)}</p>
                    <p className="text-sm font-bold mt-2" style={{ color: 'var(--primary-color)' }}>
                      {noPrice ? 'Sin precio' : formatMoney(p.unit_price)}
                    </p>
                    <p className={`text-xs mt-1 ${soldOut ? 'text-red-400 font-semibold' : 'text-xinuco-muted'}`}>
                      {soldOut ? 'Agotado' : `Quedan ${formatUnits(p.available)}`}
                      {p.reserved > 0 && (
                        <span className="text-amber-400"> · {formatUnits(p.reserved)} apartadas</span>
                      )}
                    </p>
                    {inCart > 0 && (
                      <p className="text-[11px] font-semibold text-xinuco-text mt-1">En el carrito: {inCart}</p>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ── Carrito y cobro ── */}
      <section
        aria-label="Venta actual"
        className={`space-y-4 rounded-2xl border p-4 ${compact ? '' : 'lg:sticky lg:top-4'}`}
        style={{ borderColor: 'var(--border-color)', background: 'var(--surface-color)' }}
      >
        <div>
          <h3 className={sectionLabel}>Carrito</h3>
          {lines.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-6 text-center text-xinuco-muted">
              <ShoppingBag size={22} />
              <p className="text-sm">Toca un producto para agregarlo.</p>
            </div>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
              {lines.map(({ product, quantity }) => (
                <li key={product.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-xinuco-text truncate">{product.name}</p>
                    <p className="text-xs text-xinuco-muted">{formatMoney(product.unit_price)} c/u</p>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 shrink-0">
                    <button
                      type="button"
                      onClick={() => changeQuantity(product, -1)}
                      aria-label={`Quitar una unidad de ${product.name}`}
                      disabled={quantity <= 1}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center text-zinc-400 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Minus size={12} />
                    </button>
                    <span className="min-w-[1.25rem] text-center text-xs font-semibold text-zinc-100">{quantity}</span>
                    <button
                      type="button"
                      onClick={() => changeQuantity(product, 1)}
                      aria-label={`Agregar una unidad de ${product.name}`}
                      disabled={quantity >= product.available}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center text-zinc-400 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                  <span className="text-sm font-bold text-xinuco-text w-20 text-right shrink-0">
                    {formatMoney(product.unit_price * quantity)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeProduct(product.id)}
                    aria-label={`Quitar ${product.name} del carrito`}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-zinc-500 hover:text-red-400 hover:bg-fg/[0.05] transition-colors shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className={sectionLabel}>Cliente (opcional)</h3>
          <PosCustomerPicker value={customer} onChange={changeCustomer} disabled={isPending} />

          {pointsAvailable && loy && (
            <div
              className="mt-2 rounded-xl border p-3 space-y-2"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm text-xinuco-text min-w-0">
                  <Gift size={15} className="shrink-0" style={{ color: 'var(--primary-color)' }} />
                  <span>
                    Tiene {formatUnits(loy.balance)} {loy.balance === 1 ? 'punto' : 'puntos'}{' '}
                    <span className="text-xinuco-muted">
                      ({formatMoney(loy.value_cop ?? loy.balance * loy.point_value_cop)})
                    </span>
                  </span>
                </p>
                {pointsMax > 0 && (
                  <label className="flex items-center gap-2 text-xs font-semibold text-xinuco-text cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={useLoyalty}
                      disabled={isPending}
                      onChange={(e) => {
                        setUseLoyalty(e.target.checked)
                        setPointsInput(e.target.checked ? pointsMax : '')
                      }}
                    />
                    Usar puntos
                  </label>
                )}
              </div>
              {pointsMax === 0 && (
                <p className="text-xs text-xinuco-muted">
                  {loy.min_redeem > 0
                    ? `Necesita al menos ${formatUnits(loy.min_redeem)} puntos y algo por cobrar para canjear.`
                    : 'Agrega productos para poder canjear puntos.'}
                </p>
              )}
              {useLoyalty && pointsMax > 0 && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={pointsMax}
                    value={pointsInput}
                    disabled={isPending}
                    onChange={(e) => setPointsInput(e.target.value === '' ? '' : Number(e.target.value))}
                    aria-label="Puntos a usar"
                    className={`${fieldClass} w-28`}
                  />
                  <span className="text-xs text-xinuco-muted">
                    de {formatUnits(pointsMax)} · descuenta {formatMoney(totals.loyaltyDiscount)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <h3 className={sectionLabel}>¿Quién vendió? (opcional)</h3>
          <select
            value={sellerId}
            onChange={(e) => setSellerId(e.target.value)}
            disabled={isPending}
            aria-label="Profesional que vendió"
            className={fieldClass}
          >
            <option value="">Sin asignar</option>
            {catalog.staff.map((s) => (
              <option key={s.id} value={s.id}>{s.full_name}</option>
            ))}
          </select>
          {sellerId && (
            <p className="text-xs text-xinuco-muted mt-1">Gana su comisión de productos.</p>
          )}
        </div>

        <div>
          <h3 className={sectionLabel}>Descuento (COP)</h3>
          <div className="relative">
            <Percent size={14} className="absolute left-2.5 top-2.5 text-zinc-500" />
            <input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="0"
              value={discountInput}
              disabled={isPending}
              onChange={(e) => setDiscountInput(e.target.value === '' ? '' : Number(e.target.value))}
              aria-label="Descuento en pesos"
              className={`${fieldClass} pl-8`}
            />
          </div>
        </div>

        <dl className="space-y-1 text-sm border-t pt-3" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex justify-between text-xinuco-muted">
            <dt>Subtotal</dt><dd>{formatMoney(totals.subtotal)}</dd>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between text-xinuco-muted">
              <dt>Descuento</dt><dd>-{formatMoney(totals.discount)}</dd>
            </div>
          )}
          {totals.loyaltyDiscount > 0 && (
            <div className="flex justify-between text-xinuco-muted">
              <dt>Descuento lealtad</dt><dd>-{formatMoney(totals.loyaltyDiscount)}</dd>
            </div>
          )}
          <div className="flex justify-between text-lg font-extrabold text-xinuco-text pt-1">
            <dt>Total</dt><dd>{formatMoney(total)}</dd>
          </div>
        </dl>

        <div>
          <h3 className={sectionLabel}>Medio de pago</h3>
          {!accountsLoaded ? (
            <p className="flex items-center gap-2 text-xs text-xinuco-muted">
              <Loader2 size={14} className="animate-spin" /> Cargando medios de pago…
            </p>
          ) : (
            <AccountPicker
              accounts={accounts}
              value={account?.id ?? null}
              disabled={isPending}
              onChange={(id) => { setAccountId(id); setError(null) }}
            />
          )}
        </div>

        {method === 'cash' && total > 0 && (
          <CashReceivedInput
            total={total}
            value={received}
            onChange={setReceived}
            changeLabel="Cambio:"
            disabled={isPending}
          />
        )}

        {error && (
          <div role="alert" className="p-3 bg-red-950/40 border border-red-900/30 rounded-xl text-red-400 text-xs leading-relaxed">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleCharge}
          disabled={!canCharge}
          className="w-full flex items-center justify-center gap-2 text-sm font-bold py-3 rounded-xl bg-[var(--primary-color)] text-black hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending && <Loader2 size={15} className="animate-spin" />}
          Cobrar {formatMoney(total)}
        </button>
      </section>
    </div>
  )
}
