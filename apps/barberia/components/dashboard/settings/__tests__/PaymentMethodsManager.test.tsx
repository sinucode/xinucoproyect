import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { MoneyAccount } from '@xinuco/types'
import { PaymentMethodsManager } from '../PaymentMethodsManager'
import { reorderMoneyAccounts, saveMoneyAccount } from '@/actions/money-accounts'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({
  usePathname: () => '/b/dashboard/settings/payment-methods',
  useRouter: () => ({ refresh: (...a: unknown[]) => refresh(...a) }),
}))
jest.mock('@/actions/money-accounts', () => ({
  saveMoneyAccount: jest.fn(),
  reorderMoneyAccounts: jest.fn(),
}))

const base = { business_id: 'biz', is_active: true, opening_date: '2026-09-01' }
const ACCOUNTS: MoneyAccount[] = [
  { ...base, id: 'c', name: 'Efectivo', method_kind: 'cash', is_cash_drawer: true, sort_order: 0, opening_balance: 0 },
  { ...base, id: 't', name: 'Bancolombia', method_kind: 'transfer', is_cash_drawer: false, sort_order: 1, opening_balance: 250_000 },
  { ...base, id: 'n', name: 'Nequi', method_kind: 'transfer', is_cash_drawer: false, sort_order: 2, opening_balance: 0, is_active: false },
]

beforeEach(() => {
  jest.clearAllMocks()
  ;(saveMoneyAccount as jest.Mock).mockResolvedValue({ success: true })
  ;(reorderMoneyAccounts as jest.Mock).mockResolvedValue({ success: true })
  window.matchMedia = jest.fn().mockImplementation(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })) as any
})

const renderIt = () => render(<PaymentMethodsManager accounts={ACCOUNTS} today="2026-10-01" />)

describe('PaymentMethodsManager', () => {
  it('explica para qué sirven los medios y que Efectivo es la caja', () => {
    renderIt()
    expect(screen.getByText(/Los medios que configures aquí son los que verás al cobrar y al pagar/)).toBeInTheDocument()
    expect(screen.getByText('Efectivo es la caja.')).toBeInTheDocument()
  })

  it('Efectivo no se puede apagar y su saldo lo maneja la caja', () => {
    renderIt()
    expect(screen.getByText('Saldo: lo maneja la caja')).toBeInTheDocument()
    expect(screen.getByText('Siempre activo')).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: /Efectivo/ })).toBeNull()
    expect(screen.getByRole('switch', { name: 'Apagar Bancolombia' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Activar Nequi' })).toBeInTheDocument()
  })

  it('apagar un medio conserva sus datos', async () => {
    renderIt()
    fireEvent.click(screen.getByRole('switch', { name: 'Apagar Bancolombia' }))
    await waitFor(() => expect(saveMoneyAccount).toHaveBeenCalledWith({
      id: 't', name: 'Bancolombia', method_kind: 'transfer', opening_balance: 250_000, opening_date: '2026-09-01', is_active: false,
    }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('subir y bajar guarda el nuevo orden; los extremos están deshabilitados', async () => {
    renderIt()
    expect(screen.getByRole('button', { name: 'Subir Efectivo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bajar Nequi' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Subir Nequi' }))
    await waitFor(() => expect(reorderMoneyAccounts).toHaveBeenCalledWith(['c', 'n', 't']))
  })

  it('agrega un medio con saldo inicial y fecha de hoy', async () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: /Agregar medio/ }))
    expect(screen.getByPlaceholderText('Nequi, Bancolombia, Daviplata…')).toBeInTheDocument()
    expect(screen.getByText('¿Cuánto tienes hoy en este medio? *')).toBeInTheDocument()
    expect((screen.getByLabelText(/Saldo a la fecha/) as HTMLInputElement).value).toBe('2026-10-01')

    fireEvent.change(screen.getByPlaceholderText('Nequi, Bancolombia, Daviplata…'), { target: { value: ' Daviplata ' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Tarjeta (datáfono)' }))
    fireEvent.change(screen.getByLabelText(/¿Cuánto tienes hoy/), { target: { value: '120000' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Agregar medio' }).pop()!)

    await waitFor(() => expect(saveMoneyAccount).toHaveBeenCalledWith({
      id: null, name: 'Daviplata', method_kind: 'card', opening_balance: 120_000, opening_date: '2026-10-01', is_active: true,
    }))
  })

  it('valida antes de guardar', () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: /Agregar medio/ }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Agregar medio' }).pop()!)
    expect(screen.getByRole('alert')).toHaveTextContent('El nombre debe tener entre 2 y 40 caracteres.')
    expect(saveMoneyAccount).not.toHaveBeenCalled()
  })

  it('editar Efectivo solo deja cambiar el nombre', async () => {
    renderIt()
    fireEvent.click(screen.getAllByRole('button', { name: /Editar/ })[0])
    expect(screen.queryByLabelText(/¿Cuánto tienes hoy/)).toBeNull()
    fireEvent.change(screen.getByDisplayValue('Efectivo'), { target: { value: 'Efectivo caja' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(saveMoneyAccount).toHaveBeenCalledWith(expect.objectContaining({
      id: 'c', name: 'Efectivo caja', method_kind: 'cash', opening_balance: 0, is_active: true,
    })))
  })
})
