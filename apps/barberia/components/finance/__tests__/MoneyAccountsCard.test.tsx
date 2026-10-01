import { render, screen, fireEvent } from '@testing-library/react'
import type { MoneyAccountsStatus } from '@xinuco/types'
import { MoneyAccountsCard } from '../MoneyAccountsCard'

const replace = jest.fn()
let search = ''
let cachedParams: { key: string; value: URLSearchParams } | null = null
jest.mock('next/navigation', () => ({
  usePathname: () => '/b/dashboard',
  useParams: () => ({ slug: 'b' }),
  useRouter: () => ({ refresh: jest.fn(), replace: (...a: unknown[]) => replace(...a), push: jest.fn() }),
  // Como en Next: el mismo objeto mientras la URL no cambie
  useSearchParams: () => {
    if (!cachedParams || cachedParams.key !== search) cachedParams = { key: search, value: new URLSearchParams(search) }
    return cachedParams.value
  },
}))
jest.mock('@/actions/money-accounts', () => ({
  getMoneyAccountsStatus: jest.fn().mockResolvedValue({}),
  recordAccountMovement: jest.fn(),
}))

const STATUS: MoneyAccountsStatus = {
  today: '2026-10-01',
  open_shift_id: null,
  owner_loans_pending: 120_000,
  accounts: [
    { id: 'c', name: 'Efectivo', method_kind: 'cash', is_cash_drawer: true, opening_balance: 0, opening_date: '2026-10-01', today_in: 50_000, today_out: 20_000, today_net: 30_000, balance: 80_000 },
    { id: 't', name: 'Nequi', method_kind: 'transfer', is_cash_drawer: false, opening_balance: 0, opening_date: '2026-10-01', today_in: 0, today_out: 0, today_net: 0, balance: -15_000 },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  search = ''
  window.matchMedia = jest.fn().mockImplementation(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })) as any
})

describe('MoneyAccountsCard', () => {
  it('muestra cada medio con su saldo, el total y la deuda con el dueño', () => {
    render(<MoneyAccountsCard initialStatus={STATUS} />)
    expect(screen.getByText('Tu plata')).toBeInTheDocument()
    expect(screen.getByText('Lo que tienes en cada medio y cómo va hoy')).toBeInTheDocument()
    expect(screen.getByText('Caja')).toBeInTheDocument()
    expect(screen.getByText('$80.000')).toBeInTheDocument()
    expect(screen.getByText('−$15.000')).toHaveClass('text-red-400')
    expect(screen.getByLabelText('Saldo negativo')).toBeInTheDocument()
    expect(screen.getByText('Sin movimientos hoy')).toBeInTheDocument()
    expect(screen.getByText('Total en todos los medios')).toBeInTheDocument()
    expect(screen.getByText('$65.000')).toBeInTheDocument()
    expect(screen.getByText(/El negocio le debe al dueño/)).toHaveTextContent('$120.000')
    expect(screen.getByText('Caja cerrada: saldo del último cierre')).toBeInTheDocument()
  })

  it('sin deuda no muestra la línea ámbar', () => {
    render(<MoneyAccountsCard initialStatus={{ ...STATUS, owner_loans_pending: 0 }} />)
    expect(screen.queryByText(/El negocio le debe al dueño/)).toBeNull()
  })

  it('"Mover plata" abre la hoja y "Devolver" salta a devolver préstamo', () => {
    render(<MoneyAccountsCard initialStatus={STATUS} />)
    fireEvent.click(screen.getByRole('button', { name: /Mover plata/ }))
    expect(screen.getByRole('dialog', { name: 'Mover plata' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))

    fireEvent.click(screen.getByRole('button', { name: 'Devolver' }))
    expect(screen.getByText('Devolver préstamo')).toBeInTheDocument()
    expect((screen.getByLabelText(/Monto/) as HTMLInputElement).value).toBe('120.000')
  })

  it('?mover=1&hacia=…&monto=… abre la hoja con el medio y el monto y limpia la URL', () => {
    search = 'mover=1&hacia=t&monto=30000'
    render(<MoneyAccountsCard initialStatus={STATUS} />)
    expect(screen.getByRole('dialog', { name: 'Mover plata' })).toBeInTheDocument()
    expect(replace).toHaveBeenCalledWith('/b/dashboard', { scroll: false })
    fireEvent.click(screen.getByText('Aporte del dueño'))
    expect((screen.getByLabelText(/Monto/) as HTMLInputElement).value).toBe('30.000')
    expect((screen.getByLabelText(/Entra a/) as HTMLSelectElement).value).toBe('t')
  })
})
