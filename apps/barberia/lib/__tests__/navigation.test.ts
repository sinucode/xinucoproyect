import { bottomBar, isNavActive, visibleNav, visibleQuickActions } from '../navigation'
import type { BusinessFeatures } from '@xinuco/types'

const ALL_ON: BusinessFeatures = {
  notifications_email: true, notifications_whatsapp: true, commissions: true, staff_ledger: true,
  expenses_pgl: true, retail_sales: true, loyalty: true, workstations: true, walk_ins: true, crm: true,
  audit_logs: true, fixed_assets: true, inventory: true, advanced_reports: true,
}
const off = (...keys: (keyof BusinessFeatures)[]): BusinessFeatures => {
  const f = { ...ALL_ON }
  for (const k of keys) (f as unknown as Record<string, boolean>)[k] = false
  return f
}
const labels = (items: { label: string }[]) => items.map((i) => i.label)

describe('visibleNav · admin', () => {
  const nav = visibleNav('admin', ALL_ON)

  it('agrupa en el orden HOY, CLIENTES, EQUIPO, CATÁLOGO, DINERO, ANÁLISIS', () => {
    expect(nav.groups.map((g) => g.label)).toEqual(['Hoy', 'Clientes', 'Equipo', 'Catálogo', 'Dinero', 'Análisis'])
  })

  it('respeta el orden y las etiquetas de cada grupo', () => {
    const byGroup = Object.fromEntries(nav.groups.map((g) => [g.id, labels(g.items)]))
    expect(byGroup.hoy).toEqual(['Inicio', 'Agenda', 'Fila de espera', 'Venta de productos'])
    expect(byGroup.clientes).toEqual(['Clientes', 'Lealtad'])
    expect(byGroup.equipo).toEqual(['Equipo', 'Pagos al equipo'])
    expect(byGroup.catalogo).toEqual(['Servicios', 'Inventario'])
    expect(byGroup.dinero).toEqual(['Gastos', 'Contabilidad', 'Activos fijos'])
    expect(byGroup.analisis).toEqual(['Reportes', 'Auditoría'])
  })

  it('Configuración va en el footer y no hay Comisiones ni Estaciones', () => {
    expect(labels(nav.footer)).toEqual(['Configuración'])
    const all = labels(nav.groups.flatMap((g) => g.items))
    expect(all).not.toContain('Comisiones')
    expect(all).not.toContain('Estaciones')
  })

  it('con una feature apagada mantiene el ítem bloqueado (upsell)', () => {
    const n = visibleNav('admin', off('loyalty', 'walk_ins'))
    const items = n.groups.flatMap((g) => g.items)
    expect(items.find((i) => i.label === 'Lealtad')?.locked).toBe(true)
    expect(items.find((i) => i.label === 'Fila de espera')?.locked).toBe(true)
    expect(items.find((i) => i.label === 'Agenda')?.locked).toBe(false)
  })

  it('las rutas se construyen con el slug', () => {
    const items = nav.groups.flatMap((g) => g.items)
    expect(items.find((i) => i.id === 'nav-home')?.href('mi-barber')).toBe('/mi-barber/dashboard')
    expect(items.find((i) => i.id === 'nav-retail')?.href('mi-barber')).toBe('/mi-barber/dashboard/retail')
    expect(nav.footer[0].href('x')).toBe('/x/dashboard/settings')
  })
})

describe('visibleNav · barbero', () => {
  it('sin encabezados: Inicio · Agenda · Fila de espera · Clientes · Mi cuenta', () => {
    const nav = visibleNav('barber', ALL_ON)
    expect(nav.groups).toHaveLength(1)
    expect(nav.groups[0].label).toBeNull()
    expect(labels(nav.groups[0].items)).toEqual(['Inicio', 'Agenda', 'Fila de espera', 'Clientes', 'Mi cuenta'])
    expect(nav.footer).toEqual([])
  })

  it('oculta (no bloquea) lo que el plan no incluye', () => {
    const nav = visibleNav('barber', off('walk_ins', 'staff_ledger'))
    expect(labels(nav.groups[0].items)).toEqual(['Inicio', 'Agenda', 'Clientes'])
  })
})

describe('bottomBar', () => {
  it('admin: Inicio · Agenda · Fila + "+" + Más', () => {
    const bar = bottomBar('admin', ALL_ON)
    expect(bar.showQuick).toBe(true)
    expect(labels(bar.items)).toEqual(['Inicio', 'Agenda', 'Fila de espera'])
    expect(bar.items[2].shortLabel).toBe('Fila')
    // La hoja Más no repite lo que ya está en la barra
    const sheet = bar.moreGroups.flatMap((g) => g.items.map((i) => i.id))
    expect(sheet).not.toContain('nav-home')
    expect(sheet).not.toContain('nav-walk-ins')
    expect(sheet).toContain('nav-crm')
    expect(bar.moreFooter.map((i) => i.label)).toEqual(['Configuración'])
  })

  it('admin sin fila de espera usa Clientes', () => {
    const bar = bottomBar('admin', off('walk_ins'))
    expect(labels(bar.items)).toEqual(['Inicio', 'Agenda', 'Clientes'])
  })

  it('barbero: 5 ítems, sin "+" y sin Más', () => {
    const bar = bottomBar('barber', ALL_ON)
    expect(bar.showQuick).toBe(false)
    expect(labels(bar.items)).toEqual(['Inicio', 'Agenda', 'Fila de espera', 'Clientes', 'Mi cuenta'])
    expect(bar.moreGroups).toEqual([])
  })
})

describe('visibleQuickActions', () => {
  it('muestra las cinco acciones con todo activo', () => {
    expect(visibleQuickActions(ALL_ON).map((a) => a.label)).toEqual([
      'Nueva cita', 'Nuevo turno en fila', 'Vender producto', 'Registrar gasto', 'Mover plata',
    ])
  })
  it('solo muestra las acciones cuya feature está activa', () => {
    expect(visibleQuickActions(off('walk_ins', 'expenses_pgl')).map((a) => a.label)).toEqual([
      'Nueva cita', 'Vender producto', 'Mover plata',
    ])
  })
  it('las rutas llevan el slug', () => {
    const a = visibleQuickActions(ALL_ON)
    expect(a[0].href('b')).toBe('/b/book')
    expect(a[3].href('b')).toBe('/b/dashboard/expenses?nuevo=1')
    expect(a[4].href('b')).toBe('/b/dashboard?mover=1')
  })
})

describe('isNavActive', () => {
  it('Inicio solo coincide exacto', () => {
    expect(isNavActive('/b/dashboard', '/b/dashboard')).toBe(true)
    expect(isNavActive('/b/dashboard/crm', '/b/dashboard')).toBe(false)
  })
  it('los demás coinciden con subrutas pero no con prefijos parecidos', () => {
    expect(isNavActive('/b/dashboard/crm/123', '/b/dashboard/crm')).toBe(true)
    expect(isNavActive('/b/dashboard/crmx', '/b/dashboard/crm')).toBe(false)
  })
})
