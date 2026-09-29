import {
  AUDIENCE_ORDER,
  normalizeAudiences,
  serviceAudienceOf,
  isServiceVisible,
  filterVisibleServices,
  servicesForAudience,
  groupServicesForSelect,
} from '../service-audience'

const svc = (id: string, audience?: string | null) => ({ id, audience })

describe('normalizeAudiences', () => {
  it('mantiene válidos, deduplica y ordena', () => {
    expect(normalizeAudiences(['kids', 'men', 'kids'])).toEqual(['men', 'kids'])
    expect(normalizeAudiences(['women', 'men'])).toEqual(['men', 'women'])
  })

  it('vacío o inválido → ["men"]', () => {
    expect(normalizeAudiences([])).toEqual(['men'])
    expect(normalizeAudiences(null)).toEqual(['men'])
    expect(normalizeAudiences(undefined)).toEqual(['men'])
    expect(normalizeAudiences('men')).toEqual(['men'])
    expect(normalizeAudiences(['all', 'foo', 1])).toEqual(['men'])
  })

  it('descarta valores inválidos pero conserva los válidos', () => {
    expect(normalizeAudiences(['foo', 'women'])).toEqual(['women'])
    expect(AUDIENCE_ORDER).toEqual(['men', 'women', 'kids'])
  })
})

describe('serviceAudienceOf', () => {
  it('devuelve el valor válido o "men"', () => {
    expect(serviceAudienceOf({ audience: 'women' })).toBe('women')
    expect(serviceAudienceOf({ audience: 'all' })).toBe('all')
    expect(serviceAudienceOf({})).toBe('men')
    expect(serviceAudienceOf({ audience: null })).toBe('men')
    expect(serviceAudienceOf({ audience: 'xyz' })).toBe('men')
  })
})

describe('visibilidad', () => {
  const list = [svc('a', 'men'), svc('b', 'women'), svc('c', 'kids'), svc('d', 'all'), svc('e')]

  it('isServiceVisible: coincide o es unisex', () => {
    expect(isServiceVisible(svc('x', 'women'), ['men'])).toBe(false)
    expect(isServiceVisible(svc('x', 'women'), ['men', 'women'])).toBe(true)
    expect(isServiceVisible(svc('x', 'all'), ['kids'])).toBe(true)
    expect(isServiceVisible(svc('x'), ['men'])).toBe(true)
  })

  it('filterVisibleServices oculta los de públicos desactivados', () => {
    expect(filterVisibleServices(list, ['men']).map(s => s.id)).toEqual(['a', 'd', 'e'])
    expect(filterVisibleServices(list, ['women', 'kids']).map(s => s.id)).toEqual(['b', 'c', 'd'])
  })

  it('servicesForAudience incluye los unisex', () => {
    expect(servicesForAudience(list, 'women').map(s => s.id)).toEqual(['b', 'd'])
    expect(servicesForAudience(list, 'men').map(s => s.id)).toEqual(['a', 'd', 'e'])
  })
})

describe('groupServicesForSelect', () => {
  const list = [svc('a', 'men'), svc('b', 'women'), svc('c', 'kids'), svc('d', 'all')]

  it('con varios públicos: grupos en orden, sin vacíos', () => {
    const groups = groupServicesForSelect(list, ['men', 'women'])
    expect(groups.map(g => g.key)).toEqual(['men', 'women', 'all'])
    expect(groups.map(g => g.label)).toEqual(['Caballeros', 'Damas', 'Todos (unisex)'])
    expect(groups[0].items.map(s => s.id)).toEqual(['a'])
  })

  it('omite grupos vacíos', () => {
    const groups = groupServicesForSelect([svc('a', 'men')], ['men', 'kids'])
    expect(groups.map(g => g.key)).toEqual(['men'])
  })

  it('con un solo público: un grupo plano sin etiqueta con los visibles', () => {
    const groups = groupServicesForSelect(list, ['men'])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('all')
    expect(groups[0].label).toBe('')
    expect(groups[0].items.map(s => s.id)).toEqual(['a', 'd'])
  })
})
