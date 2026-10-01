import { appointmentConfirmationEmail, appointmentReminderEmail } from '../email/templates'

const base = {
  customerName: 'Juan', businessName: 'El Patrón', serviceName: 'Corte', staffName: 'Carlos',
  startTime: '2026-10-12T15:00:00Z', durationMinutes: 30, priceCop: 30000,
}

describe('correos con datos de contacto', () => {
  const brand = {
    name: 'El Patrón',
    address: 'Calle 1 # 2-3, Medellín',
    mapsUrl: 'https://maps.app.goo.gl/abc',
    whatsappUrl: 'https://wa.me/573001234567',
    whatsappLabel: '300 123 4567',
  }

  it('la confirmación incluye dirección, cómo llegar y WhatsApp', () => {
    const html = appointmentConfirmationEmail({ ...base, brand })
    expect(html).toContain('Calle 1 # 2-3, Medellín')
    expect(html).toContain('https://maps.app.goo.gl/abc')
    expect(html).toContain('Cómo llegar')
    expect(html).toContain('https://wa.me/573001234567')
    expect(html).toContain('300 123 4567')
  })

  it('el recordatorio también', () => {
    const html = appointmentReminderEmail({ ...base, brand })
    expect(html).toContain('Cómo llegar')
    expect(html).toContain('wa.me/573001234567')
  })

  it('sin datos no agrega filas', () => {
    const html = appointmentConfirmationEmail({ ...base, brand: { name: 'El Patrón' } })
    expect(html).not.toContain('Dirección')
    expect(html).not.toContain('WhatsApp')
  })

  it('ignora enlaces que no sean https', () => {
    const html = appointmentConfirmationEmail({ ...base, brand: { name: 'x', mapsUrl: 'javascript:alert(1)', whatsappUrl: 'http://wa.me/1' } })
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('http://wa.me')
  })
})
