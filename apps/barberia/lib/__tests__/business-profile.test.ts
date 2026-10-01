import {
  formatPhoneDisplay,
  instagramUrl,
  isColombianMobile,
  isValidInstagram,
  isValidMapsUrl,
  isValidPhoneDigits,
  normalizeInstagram,
  normalizePhoneCO,
  validateBusinessProfile,
  whatsappLink,
  type BusinessProfileInput,
} from '../business-profile'

const base: BusinessProfileInput = {
  name: 'Barbería El Patrón',
  address: '', city: '', whatsapp: '', phone: '', instagram: '', maps_url: '', tax_id: '', legal_name: '',
}

describe('normalizePhoneCO', () => {
  it('deja solo dígitos', () => {
    expect(normalizePhoneCO('300 123-4567')).toBe('3001234567')
    expect(normalizePhoneCO('(300) 123 4567')).toBe('3001234567')
  })

  it('quita el 57 solo si queda un celular de 10 dígitos que empieza en 3', () => {
    expect(normalizePhoneCO('+57 300 123 4567')).toBe('3001234567')
    expect(normalizePhoneCO('573001234567')).toBe('3001234567')
    expect(normalizePhoneCO('0057 300 123 4567')).toBe('00573001234567')
  })

  it('no quita el 57 de fijos ni de números que no cuadran', () => {
    expect(normalizePhoneCO('57 601 234 5678')).toBe('576012345678')
    expect(normalizePhoneCO('5712345')).toBe('5712345')
    expect(normalizePhoneCO('573001234')).toBe('573001234')
  })

  it('números de otros países quedan intactos', () => {
    expect(normalizePhoneCO('+1 305 555 0100')).toBe('13055550100')
  })

  it('vacío o nulo → cadena vacía', () => {
    expect(normalizePhoneCO('')).toBe('')
    expect(normalizePhoneCO(null)).toBe('')
    expect(normalizePhoneCO(undefined)).toBe('')
  })
})

describe('isValidPhoneDigits / isColombianMobile', () => {
  it('acepta 7 a 15 dígitos', () => {
    expect(isValidPhoneDigits('1234567')).toBe(true)
    expect(isValidPhoneDigits('123456789012345')).toBe(true)
    expect(isValidPhoneDigits('123456')).toBe(false)
    expect(isValidPhoneDigits('1234567890123456')).toBe(false)
    expect(isValidPhoneDigits('300 123')).toBe(false)
  })

  it('reconoce el celular colombiano', () => {
    expect(isColombianMobile('3001234567')).toBe(true)
    expect(isColombianMobile('6012345678')).toBe(false)
    expect(isColombianMobile('300123456')).toBe(false)
  })
})

describe('whatsappLink / formatPhoneDisplay', () => {
  it('celular colombiano → wa.me/57…', () => {
    expect(whatsappLink('3001234567')).toBe('https://wa.me/573001234567')
  })

  it('otro número → wa.me tal cual', () => {
    expect(whatsappLink('13055550100')).toBe('https://wa.me/13055550100')
    expect(whatsappLink('576012345678')).toBe('https://wa.me/576012345678')
  })

  it('sin número válido → null', () => {
    expect(whatsappLink(null)).toBeNull()
    expect(whatsappLink('123')).toBeNull()
  })

  it('agrupa el celular para mostrarlo', () => {
    expect(formatPhoneDisplay('3001234567')).toBe('300 123 4567')
    expect(formatPhoneDisplay('6012345678')).toBe('6012345678')
    expect(formatPhoneDisplay(null)).toBe('')
  })
})

describe('normalizeInstagram', () => {
  it('quita la arroba y espacios', () => {
    expect(normalizeInstagram('@mibarberia')).toBe('mibarberia')
    expect(normalizeInstagram('  @@mi.barberia_1 ')).toBe('mi.barberia_1')
    expect(normalizeInstagram('mibarberia')).toBe('mibarberia')
  })

  it('extrae el usuario de un enlace', () => {
    expect(normalizeInstagram('https://www.instagram.com/mibarberia/')).toBe('mibarberia')
    expect(normalizeInstagram('https://instagram.com/mibarberia?igsh=abc')).toBe('mibarberia')
    expect(normalizeInstagram('instagram.com/mi.barberia')).toBe('mi.barberia')
    expect(normalizeInstagram('http://m.instagram.com/mibarberia/#x')).toBe('mibarberia')
  })

  it('un enlace a una publicación no se convierte en usuario', () => {
    expect(isValidInstagram(normalizeInstagram('https://instagram.com/p/AbC123/'))).toBe(false)
    expect(isValidInstagram(normalizeInstagram('https://instagram.com/reel/AbC123/'))).toBe(false)
  })

  it('vacío → cadena vacía', () => {
    expect(normalizeInstagram('')).toBe('')
    expect(normalizeInstagram(null)).toBe('')
  })
})

describe('isValidInstagram / instagramUrl', () => {
  it('valida el formato de la base', () => {
    expect(isValidInstagram('mi.barberia_1')).toBe(true)
    expect(isValidInstagram('a'.repeat(30))).toBe(true)
    expect(isValidInstagram('a'.repeat(31))).toBe(false)
    expect(isValidInstagram('mi barberia')).toBe(false)
    expect(isValidInstagram('mi-barberia')).toBe(false)
    expect(isValidInstagram('')).toBe(false)
  })

  it('arma el enlace', () => {
    expect(instagramUrl('mibarberia')).toBe('https://instagram.com/mibarberia')
    expect(instagramUrl('no válido')).toBeNull()
    expect(instagramUrl(null)).toBeNull()
  })
})

describe('isValidMapsUrl', () => {
  it('exige https', () => {
    expect(isValidMapsUrl('https://maps.app.goo.gl/AbCdEf123')).toBe(true)
    expect(isValidMapsUrl('https://www.google.com/maps/place/Barberia')).toBe(true)
    expect(isValidMapsUrl('http://maps.google.com/?q=x')).toBe(false)
    expect(isValidMapsUrl('javascript:alert(1)')).toBe(false)
    expect(isValidMapsUrl('maps.google.com')).toBe(false)
  })

  it('rechaza espacios, formato roto y más de 300 caracteres', () => {
    expect(isValidMapsUrl('https://maps.google.com/ mi sitio')).toBe(false)
    expect(isValidMapsUrl('https://')).toBe(false)
    expect(isValidMapsUrl('https://localhost')).toBe(false)
    expect(isValidMapsUrl(`https://maps.google.com/${'a'.repeat(300)}`)).toBe(false)
    expect(isValidMapsUrl(null)).toBe(false)
  })
})

describe('validateBusinessProfile', () => {
  it('solo el nombre es obligatorio; el resto vacío → null', () => {
    const r = validateBusinessProfile(base)
    expect(r).toEqual({
      ok: true,
      value: {
        name: 'Barbería El Patrón',
        address: null, city: null, whatsapp: null, phone: null,
        instagram: null, maps_url: null, tax_id: null, legal_name: null,
      },
    })
  })

  it('normaliza teléfonos, instagram y espacios', () => {
    const r = validateBusinessProfile({
      ...base,
      name: '  Barbería   El Patrón ',
      address: ' Calle 10 # 5-20 ',
      city: 'Medellín',
      whatsapp: '+57 300 123 4567',
      phone: '(604) 444 1234',
      instagram: 'https://instagram.com/elpatron/',
      maps_url: ' https://maps.app.goo.gl/abc ',
      tax_id: '900.123.456-7',
      legal_name: 'El Patrón S.A.S.',
    })
    expect(r).toEqual({
      ok: true,
      value: {
        name: 'Barbería El Patrón',
        address: 'Calle 10 # 5-20',
        city: 'Medellín',
        whatsapp: '3001234567',
        phone: '6044441234',
        instagram: 'elpatron',
        maps_url: 'https://maps.app.goo.gl/abc',
        tax_id: '900.123.456-7',
        legal_name: 'El Patrón S.A.S.',
      },
    })
  })

  it('rechaza nombre vacío', () => {
    const r = validateBusinessProfile({ ...base, name: '   ' })
    expect(r.ok).toBe(false)
  })

  it('rechaza WhatsApp o teléfono con pocos dígitos', () => {
    expect(validateBusinessProfile({ ...base, whatsapp: '12345' }).ok).toBe(false)
    expect(validateBusinessProfile({ ...base, phone: '1234567890123456' }).ok).toBe(false)
  })

  it('rechaza Instagram y mapa inválidos', () => {
    expect(validateBusinessProfile({ ...base, instagram: 'mi barberia' }).ok).toBe(false)
    expect(validateBusinessProfile({ ...base, maps_url: 'http://maps.google.com' }).ok).toBe(false)
  })

  it('respeta los largos máximos de la base', () => {
    expect(validateBusinessProfile({ ...base, address: 'a'.repeat(161) }).ok).toBe(false)
    expect(validateBusinessProfile({ ...base, city: 'a'.repeat(81) }).ok).toBe(false)
    expect(validateBusinessProfile({ ...base, tax_id: '1'.repeat(31) }).ok).toBe(false)
    expect(validateBusinessProfile({ ...base, legal_name: 'a'.repeat(121) }).ok).toBe(false)
    expect(validateBusinessProfile({ ...base, address: 'a'.repeat(160) }).ok).toBe(true)
  })
})
