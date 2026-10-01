import { render, screen, fireEvent } from '@testing-library/react'
import type { CheckoutAccount } from '@xinuco/types'
import { AccountPicker } from '../AccountPicker'

const ACCOUNTS: CheckoutAccount[] = [
  { id: 'c', name: 'Caja', method_kind: 'cash', is_cash_drawer: true },
  { id: 'n', name: 'Nequi', method_kind: 'transfer', is_cash_drawer: false },
  { id: 'd', name: 'Datáfono', method_kind: 'card', is_cash_drawer: false },
  { id: 'm', name: 'Mercado Pago', method_kind: 'mercadopago', is_cash_drawer: false },
]

describe('AccountPicker', () => {
  it('muestra un botón por medio (la caja se llama Efectivo) y marca el elegido', () => {
    render(<AccountPicker accounts={ACCOUNTS} value="n" onChange={jest.fn()} />)
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByRole('radio', { name: 'Efectivo' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'Nequi' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText(/Otro medio/)).toBeNull()
  })

  it('avisa con el id del medio elegido', () => {
    const onChange = jest.fn()
    render(<AccountPicker accounts={ACCOUNTS} value={null} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Datáfono' }))
    expect(onChange).toHaveBeenCalledWith('d')
  })

  it('ofrece "Otro medio" solo si se pide', () => {
    const onChange = jest.fn()
    render(<AccountPicker accounts={ACCOUNTS} value="other" onChange={onChange} allowOther />)
    const other = screen.getByRole('radio', { name: /Otro medio \(fuera de tus cuentas\)/ })
    expect(other).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'Nequi' }))
    expect(onChange).toHaveBeenCalledWith('n')
  })

  it('muestra el saldo cuando se entregan saldos y marca los negativos', () => {
    render(<AccountPicker accounts={ACCOUNTS} value={null} onChange={jest.fn()} balances={{ c: 80_000, n: -15_000 }} />)
    expect(screen.getByText('$80.000')).toBeInTheDocument()
    expect(screen.getByText('−$15.000')).toHaveClass('text-red-400')
  })

  it('un medio deshabilitado no se puede elegir', () => {
    const onChange = jest.fn()
    render(<AccountPicker accounts={ACCOUNTS} value={null} onChange={onChange} disabledIds={['c']} />)
    expect(screen.getByRole('radio', { name: 'Efectivo' })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'Efectivo' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
