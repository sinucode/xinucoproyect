import {
  AUDIT_RETENTION_OPTIONS,
  DEFAULT_AUDIT_RETENTION_MONTHS,
  isValidRetention,
  retentionLabel,
  retentionNotice,
} from '../audit-retention'

describe('audit-retention', () => {
  it('expone las opciones y el valor por defecto', () => {
    expect([...AUDIT_RETENTION_OPTIONS]).toEqual([12, 24, 36, 60, 120])
    expect(DEFAULT_AUDIT_RETENTION_MONTHS).toBe(36)
    expect(isValidRetention(DEFAULT_AUDIT_RETENTION_MONTHS)).toBe(true)
  })

  it('isValidRetention acepta solo los plazos permitidos', () => {
    for (const m of [12, 24, 36, 60, 120]) expect(isValidRetention(m)).toBe(true)
    for (const m of [0, 6, 11, 18, 37, 121, -12, 36.5, NaN, Infinity]) expect(isValidRetention(m)).toBe(false)
    for (const m of ['36', null, undefined, {}, [36]]) expect(isValidRetention(m)).toBe(false)
  })

  it('retentionLabel', () => {
    expect(retentionLabel(12)).toBe('1 año')
    expect(retentionLabel(24)).toBe('2 años')
    expect(retentionLabel(36)).toBe('3 años')
    expect(retentionLabel(60)).toBe('5 años')
    expect(retentionLabel(120)).toBe('10 años')
    expect(retentionLabel(18)).toBe('18 meses')
  })

  it('retentionNotice maneja el singular de 12 meses', () => {
    expect(retentionNotice(12)).toBe('Se conservan los registros del último año.')
    expect(retentionNotice(36)).toBe('Se conservan los registros de los últimos 3 años.')
    expect(retentionNotice(120)).toBe('Se conservan los registros de los últimos 10 años.')
  })
})
