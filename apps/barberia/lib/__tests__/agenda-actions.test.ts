import {
  APPT_ACTION_NEXT_STATUS,
  apptActionConfirmText,
  apptStatusLabel,
  availableApptActions,
} from '../agenda-status'

describe('availableApptActions', () => {
  it('programada: iniciar, no asistió y cancelar (admin y barbero igual)', () => {
    expect(availableApptActions('scheduled', true)).toEqual(['start', 'no_show', 'cancel'])
    expect(availableApptActions('scheduled', false)).toEqual(['start', 'no_show', 'cancel'])
  })

  it('en curso: terminar cita', () => {
    expect(availableApptActions('in_progress', false)).toEqual(['finish'])
    expect(availableApptActions('in_progress', true)).toEqual(['finish'])
  })

  it('lista para pagar: cobrar solo para el admin; el barbero nunca', () => {
    expect(availableApptActions('ready_to_pay', true)).toEqual(['checkout'])
    expect(availableApptActions('ready_to_pay', false)).toEqual([])
  })

  it('pago pendiente: solo cancelar', () => {
    expect(availableApptActions('payment_pending', false)).toEqual(['cancel'])
  })

  it('estados finales y desconocidos: sin acciones', () => {
    for (const s of ['completed', 'cancelled', 'no_show', 'otro']) {
      expect(availableApptActions(s, true)).toEqual([])
      expect(availableApptActions(s, false)).toEqual([])
    }
  })

  it('el barbero nunca ve "checkout" en ningún estado', () => {
    for (const s of ['scheduled', 'payment_pending', 'in_progress', 'ready_to_pay', 'completed', 'cancelled', 'no_show']) {
      expect(availableApptActions(s, false)).not.toContain('checkout')
    }
  })
})

describe('apptStatusLabel', () => {
  it('etiquetas en español por estado', () => {
    expect(apptStatusLabel('scheduled', true)).toBe('Programada')
    expect(apptStatusLabel('in_progress', false)).toBe('En curso')
    expect(apptStatusLabel('completed', false)).toBe('Completada')
    expect(apptStatusLabel('no_show', false)).toBe('No asistió')
    expect(apptStatusLabel('cancelled', true)).toBe('Cancelada')
    expect(apptStatusLabel('payment_pending', true)).toBe('Pago Pendiente')
  })

  it('lista para pagar: el barbero ve "pasa por caja", el admin "Lista para Pagar"', () => {
    expect(apptStatusLabel('ready_to_pay', true)).toBe('Lista para Pagar')
    expect(apptStatusLabel('ready_to_pay', false)).toBe('Lista para pagar · pasa por caja')
  })

  it('estado desconocido: devuelve el valor tal cual', () => {
    expect(apptStatusLabel('raro', false)).toBe('raro')
  })
})

describe('transiciones y confirmaciones', () => {
  it('cada acción lleva al estado correcto', () => {
    expect(APPT_ACTION_NEXT_STATUS).toEqual({
      start: 'in_progress',
      finish: 'ready_to_pay',
      no_show: 'no_show',
      cancel: 'cancelled',
    })
  })

  it('solo "No asistió" y "Cancelar" piden confirmación', () => {
    expect(apptActionConfirmText('no_show', 'Ana')).toBe('¿Marcar que Ana no asistió?')
    expect(apptActionConfirmText('cancel', 'Ana')).toBe('¿Cancelar la cita de Ana?')
    expect(apptActionConfirmText('start', 'Ana')).toBeNull()
    expect(apptActionConfirmText('finish', 'Ana')).toBeNull()
    expect(apptActionConfirmText('checkout', 'Ana')).toBeNull()
  })
})
