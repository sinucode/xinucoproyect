import {
  AUDIT_CATEGORIES,
  auditCategoryOf,
  auditDayLabel,
  auditSentence,
  bogotaDayRange,
  diffRows,
  formatAuditClock,
  formatAuditTime,
  parseActorFilter,
  summarizeAlerts,
} from '../audit-utils'

const log = (over: Record<string, unknown> = {}) => ({
  action: 'x.y',
  summary: null,
  old_value: null,
  new_value: null,
  ...over,
}) as any

describe('auditSentence', () => {
  it('prefiere el summary guardado', () => {
    expect(auditSentence(log({ action: 'sale.voided', summary: 'anuló una venta de $35.000' })))
      .toBe('anuló una venta de $35.000')
  })

  it('ignora un summary vacío y cae al respaldo', () => {
    expect(auditSentence(log({ action: 'shift.opened', summary: '  ' }))).toBe('abrió la caja')
  })

  it('cita de estado antiguo', () => {
    expect(auditSentence(log({
      action: 'appointment.status_changed',
      old_value: { status: 'scheduled' },
      new_value: { status: 'in_progress' },
    }))).toBe('cambió el estado de una cita: agendada → en atención')
    expect(auditSentence(log({ action: 'appointment.status_changed' }))).toBe('cambió el estado de una cita')
  })

  it('equipo antiguo', () => {
    expect(auditSentence(log({ action: 'staff.created' }))).toBe('agregó un profesional al equipo')
    expect(auditSentence(log({ action: 'staff.created', new_value: { full_name: 'Luis' } })))
      .toBe('agregó a Luis al equipo')
    expect(auditSentence(log({ action: 'staff.updated' }))).toBe('editó los datos de un profesional')
    expect(auditSentence(log({ action: 'staff.updated', new_value: { full_name: 'Luis' } })))
      .toBe('editó los datos de Luis')
    expect(auditSentence(log({ action: 'staff.services_changed', new_value: { full_name: 'Luis' } })))
      .toBe('cambió los servicios que hace Luis')
  })

  it('caja antigua', () => {
    expect(auditSentence(log({ action: 'shift.opened' }))).toBe('abrió la caja')
    expect(auditSentence(log({ action: 'shift.opened', new_value: { opening_balance: 50000 } })))
      .toBe('abrió la caja con una base de $50.000')
    expect(auditSentence(log({ action: 'shift.closed' }))).toBe('cerró la caja')
    expect(auditSentence(log({ action: 'shift.closed', new_value: { actual_closing_balance: 120000 } })))
      .toBe('cerró la caja contando $120.000')
  })

  it('inventario y activos fijos antiguos', () => {
    expect(auditSentence(log({ action: 'inventory_item.created', new_value: { name: 'Cera' } })))
      .toBe('creó el producto "Cera"')
    expect(auditSentence(log({ action: 'inventory_item.updated' }))).toBe('editó el producto')
    expect(auditSentence(log({ action: 'inventory_item.deactivated' }))).toBe('desactivó el producto')
    expect(auditSentence(log({ action: 'fixed_asset.created', new_value: { name: 'Silla' } })))
      .toBe('registró el activo fijo "Silla"')
    expect(auditSentence(log({ action: 'fixed_asset.updated', new_value: { name: 'Silla' } })))
      .toBe('editó el activo fijo "Silla"')
    expect(auditSentence(log({ action: 'fixed_asset.deactivated' }))).toBe('dio de baja el activo fijo')
  })

  it('acción desconocida', () => {
    expect(auditSentence(log({ action: 'otra.cosa' }))).toBe('realizó una acción en el sistema')
  })
})

describe('auditCategoryOf', () => {
  it('usa la categoría guardada', () => {
    expect(auditCategoryOf({ action: 'sale.voided', category: 'cash' } as any)).toBe('cash')
  })

  it('deriva por prefijo cuando no hay categoría (o es inválida)', () => {
    const c = (action: string, category: string | null = null) => auditCategoryOf({ action, category } as any)
    expect(c('appointment.status_changed')).toBe('appointments')
    expect(c('staff.created')).toBe('team')
    expect(c('shift.closed')).toBe('cash')
    expect(c('inventory_item.updated')).toBe('inventory')
    expect(c('product.price_changed')).toBe('inventory')
    expect(c('inventory.purchase')).toBe('inventory')
    expect(c('fixed_asset.created')).toBe('money')
    expect(c('sale.voided')).toBe('money')
    expect(c('ledger.advance')).toBe('money')
    expect(c('expense.deleted')).toBe('money')
    expect(c('commission_rule.updated')).toBe('money')
    expect(c('service.price_changed')).toBe('settings')
    expect(c('business.settings_changed')).toBe('settings')
    expect(c('loyalty.adjusted')).toBe('customers')
    expect(c('sale.voided', 'basura')).toBe('money')
  })

  it('expone las 7 categorías con etiqueta en español', () => {
    expect(AUDIT_CATEGORIES.map(c => c.label)).toEqual([
      'Dinero', 'Caja', 'Inventario', 'Citas', 'Equipo', 'Configuración', 'Clientes',
    ])
  })
})

describe('bogotaDayRange', () => {
  it('desde = inicio del día, hasta = inicio del día siguiente (exclusivo)', () => {
    expect(bogotaDayRange('2026-09-01', '2026-09-30')).toEqual({
      fromIso: '2026-09-01T00:00:00-05:00',
      toIso:   '2026-10-01T00:00:00-05:00',
    })
  })

  it('cruza fin de año y acepta solo un extremo', () => {
    expect(bogotaDayRange(undefined, '2026-12-31')).toEqual({ toIso: '2027-01-01T00:00:00-05:00' })
    expect(bogotaDayRange('2026-02-28')).toEqual({ fromIso: '2026-02-28T00:00:00-05:00' })
  })

  it('ignora fechas inválidas', () => {
    expect(bogotaDayRange('2026-02-30', 'hola')).toEqual({})
    expect(bogotaDayRange(undefined, undefined)).toEqual({})
  })
})

describe('fechas en hora de Bogotá', () => {
  it('formatea fecha y hora de Colombia (UTC−5)', () => {
    expect(formatAuditTime('2026-09-30T19:05:00+00:00')).toBe('30 sep 2026 · 14:05')
    expect(formatAuditClock('2026-09-30T19:05:00.123456+00:00')).toBe('14:05')
  })

  it('muestra el día local cuando en UTC ya es el siguiente', () => {
    expect(formatAuditTime('2026-10-01T03:30:00Z')).toBe('30 sep 2026 · 22:30')
    expect(formatAuditClock('2026-10-01T05:00:00Z')).toBe('00:00')
  })

  it('etiqueta de día: Hoy, Ayer o día de la semana', () => {
    expect(auditDayLabel('2026-09-30', '2026-09-30')).toBe('Hoy')
    expect(auditDayLabel('2026-09-29', '2026-09-30')).toBe('Ayer')
    expect(auditDayLabel('2026-09-28', '2026-09-30')).toBe('lun 28 sep')
    expect(auditDayLabel('2025-12-31', '2026-01-05')).toBe('mié 31 dic 2025')
  })
})

describe('parseActorFilter', () => {
  it('reconoce id y nombre', () => {
    expect(parseActorFilter('id:123e4567-e89b-12d3-a456-426614174000'))
      .toEqual({ id: '123e4567-e89b-12d3-a456-426614174000' })
    expect(parseActorFilter('name:Cliente (en línea)')).toEqual({ name: 'Cliente (en línea)' })
  })

  it('rechaza valores raros', () => {
    expect(parseActorFilter('id:no-uuid')).toBeNull()
    expect(parseActorFilter('name:  ')).toBeNull()
    expect(parseActorFilter('x')).toBeNull()
    expect(parseActorFilter(undefined)).toBeNull()
  })
})

describe('summarizeAlerts', () => {
  it('sin filas relevantes no devuelve nada', () => {
    expect(summarizeAlerts([])).toEqual([])
    expect(summarizeAlerts([
      { action: 'expense.created', amount: 5000, severity: 'info' },
      { action: 'shift.closed', amount: 0, severity: 'info' },
      { action: 'shift.closed', amount: 2000, severity: 'warning' },
    ])).toEqual([])
  })

  it('agrega, cuenta y suma cada tipo', () => {
    const items = summarizeAlerts([
      { action: 'sale.voided', amount: 35000, severity: 'warning' },
      { action: 'sale.voided', amount: 35000, severity: 'warning' },
      { action: 'sale.discount', amount: 5000, severity: 'info' },
      { action: 'sale.discount', amount: 5000, severity: 'info' },
      { action: 'sale.discount', amount: 5000, severity: 'warning' },
      { action: 'shift.closed', amount: -5000, severity: 'warning' },
      { action: 'shift.closed', amount: 1000, severity: 'warning' },
      { action: 'ledger.advance', amount: 40000, severity: 'warning' },
      { action: 'ledger.advance', amount: 60000, severity: 'warning' },
      { action: 'expense.deleted', amount: 9000, severity: 'warning' },
      { action: 'service.price_changed', amount: 30000, severity: 'warning' },
      { action: 'product.price_changed', amount: 10000, severity: 'warning' },
      { action: 'commission_rule.updated', amount: null, severity: 'warning' },
    ])
    expect(items.map(i => i.label)).toEqual([
      '2 anulaciones · $70.000',
      '3 descuentos · $15.000',
      '1 cierre con faltante · $5.000',
      '2 anticipos · $100.000',
      '1 gasto eliminado',
      '2 cambios de precio',
      '1 cambio de comisiones',
    ])
    expect(items.find(i => i.key === 'voided')).toMatchObject({ count: 2, amount: 70000, tone: 'warning' })
    expect(items.find(i => i.key === 'discount')?.tone).toBe('info')
  })

  it('singular y plural', () => {
    expect(summarizeAlerts([{ action: 'sale.voided', amount: 1000, severity: 'warning' }])[0].label)
      .toBe('1 anulación · $1.000')
    expect(summarizeAlerts([
      { action: 'expense.deleted', amount: 1, severity: 'warning' },
      { action: 'expense.deleted', amount: 1, severity: 'warning' },
    ])[0].label).toBe('2 gastos eliminados')
  })
})

describe('diffRows', () => {
  it('traduce campos de un gasto borrado y la categoría por defecto', () => {
    const rows = diffRows({ category: 'rent', is_recurring: false, auto_registered: false, amount: 1000 }, null)
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ campo: 'Categoría', antes: 'Arriendo' }),
      expect.objectContaining({ campo: 'Gasto fijo mensual', antes: 'No' }),
      expect.objectContaining({ campo: 'Registrado automáticamente', antes: 'No' }),
      expect.objectContaining({ campo: 'Monto', antes: '$1.000' }),
    ]))
  })

  it('omite ids, marcas de tiempo, uuids y lo que no cambió', () => {
    const rows = diffRows(
      { id: 'a', business_id: 'b', created_at: 'x', usuario: '123e4567-e89b-12d3-a456-426614174000', nombre: 'Cera', precio: 10000, estado: 'open' },
      { id: 'a', business_id: 'b', created_at: 'x', usuario: '123e4567-e89b-12d3-a456-426614174001', nombre: 'Cera', precio: 12500, estado: 'closed' },
    )
    expect(rows).toEqual([
      { campo: 'Precio', antes: '$10.000', despues: '$12.500' },
      { campo: 'Estado', antes: 'abierta', despues: 'cerrada' },
    ])
  })

  it('formatea dinero, etiquetas y valores sueltos', () => {
    const rows = diffRows(null, {
      subtotal: 35000, descuento: 5000, total: 30000, cambio: -2, motivo: 'error',
      commission_percentage: 40, nested: { a: 1 }, flag: true, vacio: null,
    })
    expect(rows).toEqual([
      { campo: 'Subtotal', antes: '—', despues: '$35.000' },
      { campo: 'Descuento', antes: '—', despues: '$5.000' },
      { campo: 'Total', antes: '—', despues: '$30.000' },
      { campo: 'Cambio', antes: '—', despues: '-2' },
      { campo: 'Motivo', antes: '—', despues: 'error' },
      { campo: 'Comisión %', antes: '—', despues: '40' },
      { campo: 'Nested', antes: '—', despues: '{"a":1}' },
      { campo: 'Flag', antes: '—', despues: 'Sí' },
      { campo: 'Vacio', antes: '—', despues: '—' },
    ])
  })

  it('sin datos devuelve vacío', () => {
    expect(diffRows(null, null)).toEqual([])
  })
})
