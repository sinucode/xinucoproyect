import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { MoneyAccountStatus } from '@xinuco/types'
import { MoveMoneySheet } from '../MoveMoneySheet'
import { FundsWarning, useFundsCheck } from '../FundsWarning'
import { getMoneyAccountsStatus, recordAccountMovement } from '@/actions/money-accounts'

jest.mock('next/navigation', () => ({
  usePathname: () => '/b/dashboard',
  useParams: () => ({ slug: 'b' }),
  useRouter: () => ({ refresh: jest.fn(), replace: jest.fn(), push: jest.fn() }),
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}))
jest.mock('@/actions/money-accounts', () => ({
  getMoneyAccountsStatus: jest.fn(),
  recordAccountMovement: jest.fn(),
}))

const acc = (id: string, name: string, kind: MoneyAccountStatus['method_kind'], balance: number): MoneyAccountStatus => ({
  id, name, method_kind: kind, is_cash_drawer: kind === 'cash', opening_balance: 0, opening_date: '2026-10-01',
  today_in: 0, today_out: 0, today_net: 0, balance,
})
const ACCOUNTS = [acc('c', 'Efectivo', 'cash', 100_000), acc('t', 'Bancolombia', 'transfer', 20_000)]

function mockMatchMedia(matches: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches, media: query, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  })) as any
}

beforeEach(() => {
  jest.clearAllMocks()
  mockMatchMedia(false)
})

describe('MoveMoneySheet', () => {
  const baseProps = { open: true, onClose: jest.fn(), accounts: ACCOUNTS, ownerLoansPending: 0, hasOpenShift: true, onDone: jest.fn() }

  it('ofrece los seis movimientos y deshabilita devolver sin deuda', () => {
    render(<MoveMoneySheet {...baseProps} />)
    expect(screen.getByText('Aporte del dueño')).toBeInTheDocument()
    expect(screen.getByText('Ajuste de saldo')).toBeInTheDocument()
    expect(screen.getByText('Devolver préstamo').closest('button')).toBeDisabled()
    expect(screen.getByText('Traslado entre medios').closest('button')).not.toBeDisabled()
  })

  it('registra un aporte con el medio elegido y avisa al terminar', async () => {
    ;(recordAccountMovement as jest.Mock).mockResolvedValue({ success: true, id: 'm1' })
    const onDone = jest.fn()
    render(<MoveMoneySheet {...baseProps} onDone={onDone} preset={{ toId: 't', amount: 30_000 }} />)

    fireEvent.click(screen.getByText('Aporte del dueño'))
    expect((screen.getByLabelText(/Monto/) as HTMLInputElement).value).toBe('30.000')
    expect((screen.getByLabelText(/Entra a/) as HTMLSelectElement).value).toBe('t')
    // Vista previa: 20.000 → 50.000
    expect(screen.getByText('$50.000')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    await waitFor(() => expect(recordAccountMovement).toHaveBeenCalledWith({
      kind: 'owner_contribution', amount: 30_000, from: null, to: 't', notes: null,
    }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.stringContaining('$30.000')))
  })

  it('el ajuste exige motivo y permite subir o bajar el saldo', async () => {
    ;(recordAccountMovement as jest.Mock).mockResolvedValue({ success: true })
    render(<MoveMoneySheet {...baseProps} />)
    fireEvent.click(screen.getByText('Ajuste de saldo'))
    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Bajar saldo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    expect(await screen.findByText('Cuéntanos el motivo del ajuste.')).toBeInTheDocument()
    expect(recordAccountMovement).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Cobro del banco' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    await waitFor(() => expect(recordAccountMovement).toHaveBeenCalledWith({
      kind: 'adjustment', amount: 5000, from: 'c', to: null, notes: 'Cobro del banco',
    }))
  })

  it('devolver préstamo arranca con el monto de la deuda', () => {
    render(<MoveMoneySheet {...baseProps} ownerLoansPending={80_000} preset={{ kind: 'loan_repayment', amount: 80_000 }} />)
    expect((screen.getByLabelText(/Monto/) as HTMLInputElement).value).toBe('80.000')
    expect(screen.getByLabelText(/Sale de/)).toBeInTheDocument()
  })

  it('en escritorio usa un diálogo', () => {
    mockMatchMedia(true)
    render(<MoveMoneySheet {...baseProps} />)
    expect(screen.getByRole('dialog', { name: 'Mover plata' })).toBeInTheDocument()
  })
})

describe('FundsWarning', () => {
  function Harness({ method, amount }: { method: string; amount: number }) {
    const funds = useFundsCheck({ method, amount })
    return (
      <div>
        <FundsWarning check={funds} />
        <button disabled={funds.blocked}>Guardar</button>
      </div>
    )
  }

  const status = { data: { today: '2026-10-01', accounts: ACCOUNTS, owner_loans_pending: 0, open_shift_id: null } }

  it('muestra lo disponible y no bloquea si alcanza', async () => {
    ;(getMoneyAccountsStatus as jest.Mock).mockResolvedValue(status)
    render(<Harness method="transfer" amount={15_000} />)
    expect(await screen.findByText(/Disponible en Bancolombia/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Guardar' })).not.toBeDisabled()
  })

  it('avisa lo que falta, ofrece el aporte y exige confirmar', async () => {
    ;(getMoneyAccountsStatus as jest.Mock).mockResolvedValue(status)
    render(<Harness method="transfer" amount={50_000} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No tienes suficiente en Bancolombia (faltan $30.000)')
    expect(screen.getByRole('link', { name: 'Registrar aporte o préstamo' }))
      .toHaveAttribute('href', '/b/dashboard?mover=1&hacia=t&monto=30000')
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()

    fireEvent.click(screen.getByLabelText('Registrar de todas formas'))
    expect(screen.getByRole('button', { name: 'Guardar' })).not.toBeDisabled()
  })

  it('"Otro medio" no muestra saldo ni bloquea', async () => {
    ;(getMoneyAccountsStatus as jest.Mock).mockResolvedValue(status)
    render(<Harness method="other" amount={999_999_999} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText(/Disponible en/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Guardar' })).not.toBeDisabled()
  })

  it('si los saldos no cargan (no es admin) no estorba', async () => {
    ;(getMoneyAccountsStatus as jest.Mock).mockResolvedValue({ error: 'Solo un administrador' })
    render(<Harness method="cash_register" amount={500_000} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText(/Disponible en/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Guardar' })).not.toBeDisabled()
  })
})
