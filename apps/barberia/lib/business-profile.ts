// lib/business-profile.ts — validación y normalización de los "Datos del negocio".
//
// Puro (sin servidor ni React): lo usan la Server Action y el formulario.
// Refleja los CHECK de la migración 20260930240000_business_profile_closures.sql:
//   address ≤160 · city ≤80 · whatsapp/phone solo dígitos 7–15 ·
//   instagram [A-Za-z0-9._]{1,30} · maps_url https:// ≤300 · tax_id ≤30 · legal_name ≤120

export const BUSINESS_PROFILE_LIMITS = {
  name:       80,
  address:    160,
  city:       80,
  mapsUrl:    300,
  taxId:      30,
  legalName:  120,
  instagram:  30,
} as const

const PHONE_DIGITS_RE = /^[0-9]{7,15}$/
const INSTAGRAM_RE = /^[A-Za-z0-9._]{1,30}$/

// ── Teléfonos ────────────────────────────────────────────────────────────────

/**
 * Deja solo dígitos. Quita el indicativo 57 al inicio únicamente si lo que queda es un celular
 * colombiano (10 dígitos que empiezan en 3). Así "+57 300 123 4567" y "300 123 4567" quedan igual.
 */
export function normalizePhoneCO(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.startsWith('57')) {
    const rest = digits.slice(2)
    if (rest.length === 10 && rest.startsWith('3')) return rest
  }
  return digits
}

/** ¿Son 7–15 dígitos? (mismo CHECK de la base). */
export function isValidPhoneDigits(digits: string): boolean {
  return PHONE_DIGITS_RE.test(digits)
}

/** ¿Es un celular colombiano de 10 dígitos que empieza en 3? */
export function isColombianMobile(digits: string): boolean {
  return /^3[0-9]{9}$/.test(digits)
}

/** Enlace de WhatsApp: celular colombiano → wa.me/57…; cualquier otro número → wa.me/… tal cual. */
export function whatsappLink(whatsapp: string | null | undefined): string | null {
  const digits = String(whatsapp ?? '').replace(/\D/g, '')
  if (!isValidPhoneDigits(digits)) return null
  return isColombianMobile(digits) ? `https://wa.me/57${digits}` : `https://wa.me/${digits}`
}

/** '3001234567' → '300 123 4567'; otros números se devuelven tal cual. */
export function formatPhoneDisplay(digits: string | null | undefined): string {
  const d = String(digits ?? '')
  if (isColombianMobile(d)) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`
  return d
}

// ── Instagram ────────────────────────────────────────────────────────────────

const INSTAGRAM_RESERVED_PATHS = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'tv', 'accounts'])

/**
 * Acepta '@usuario', 'usuario', 'instagram.com/usuario' o un enlace completo de Instagram y
 * devuelve solo el usuario (sin @, sin enlace). Vacío → ''. Un valor que no se pueda reducir a un
 * usuario se devuelve recortado para que `isValidInstagram` lo rechace.
 */
export function normalizeInstagram(raw: string | null | undefined): string {
  let value = String(raw ?? '').trim()
  if (!value) return ''

  const urlMatch = value.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/(.*)$/i)
  if (urlMatch) {
    const segment = urlMatch[1].split(/[/?#]/)[0]
    if (!segment || INSTAGRAM_RESERVED_PATHS.has(segment.toLowerCase())) return value
    value = segment
  }

  return value.replace(/^@+/, '')
}

export function isValidInstagram(handle: string): boolean {
  return INSTAGRAM_RE.test(handle)
}

export function instagramUrl(handle: string | null | undefined): string | null {
  const h = String(handle ?? '')
  return isValidInstagram(h) ? `https://instagram.com/${h}` : null
}

// ── Enlace de mapa ───────────────────────────────────────────────────────────

/** https:// obligatorio, máx. 300 caracteres, sin espacios y con formato de URL válido. */
export function isValidMapsUrl(url: string | null | undefined): boolean {
  const value = String(url ?? '')
  if (!value.startsWith('https://') || value.length > BUSINESS_PROFILE_LIMITS.mapsUrl) return false
  if (/\s/.test(value)) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.hostname.includes('.')
  } catch {
    return false
  }
}

// ── Validación del formulario completo ───────────────────────────────────────

export interface BusinessProfileInput {
  name:       string
  address:    string
  city:       string
  whatsapp:   string
  phone:      string
  instagram:  string
  maps_url:   string
  tax_id:     string
  legal_name: string
}

export interface BusinessProfileValue {
  name:       string
  address:    string | null
  city:       string | null
  whatsapp:   string | null
  phone:      string | null
  instagram:  string | null
  maps_url:   string | null
  tax_id:     string | null
  legal_name: string | null
}

const PHONE_ERROR = 'debe tener entre 7 y 15 dígitos.'

function cleanText(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
}

/**
 * Valida y normaliza los datos del negocio. Vacío → null (la columna queda sin dato).
 * Devuelve el primer error en español, o los valores listos para guardar.
 */
export function validateBusinessProfile(
  input: BusinessProfileInput,
): { ok: true; value: BusinessProfileValue } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Datos inválidos.' }
  const L = BUSINESS_PROFILE_LIMITS

  const name = cleanText(input.name)
  if (!name) return { ok: false, error: 'El nombre del negocio no puede estar vacío.' }
  if (name.length > L.name) return { ok: false, error: `El nombre no puede superar ${L.name} caracteres.` }

  const address = cleanText(input.address)
  if (address.length > L.address) return { ok: false, error: `La dirección no puede superar ${L.address} caracteres.` }

  const city = cleanText(input.city)
  if (city.length > L.city) return { ok: false, error: `La ciudad no puede superar ${L.city} caracteres.` }

  const whatsapp = normalizePhoneCO(typeof input.whatsapp === 'string' ? input.whatsapp : '')
  if (whatsapp && !isValidPhoneDigits(whatsapp)) return { ok: false, error: `El WhatsApp ${PHONE_ERROR}` }

  const phone = normalizePhoneCO(typeof input.phone === 'string' ? input.phone : '')
  if (phone && !isValidPhoneDigits(phone)) return { ok: false, error: `El teléfono ${PHONE_ERROR}` }

  const instagram = normalizeInstagram(typeof input.instagram === 'string' ? input.instagram : '')
  if (instagram && !isValidInstagram(instagram)) {
    return { ok: false, error: 'El Instagram no es válido. Escribe tu usuario, por ejemplo @mibarberia.' }
  }

  const mapsUrl = typeof input.maps_url === 'string' ? input.maps_url.trim() : ''
  if (mapsUrl && !isValidMapsUrl(mapsUrl)) {
    return { ok: false, error: 'El enlace del mapa debe empezar por https:// (copia el enlace desde Google Maps).' }
  }

  const taxId = cleanText(input.tax_id)
  if (taxId.length > L.taxId) return { ok: false, error: `El NIT o cédula no puede superar ${L.taxId} caracteres.` }

  const legalName = cleanText(input.legal_name)
  if (legalName.length > L.legalName) {
    return { ok: false, error: `La razón social no puede superar ${L.legalName} caracteres.` }
  }

  return {
    ok: true,
    value: {
      name,
      address:    address || null,
      city:       city || null,
      whatsapp:   whatsapp || null,
      phone:      phone || null,
      instagram:  instagram || null,
      maps_url:   mapsUrl || null,
      tax_id:     taxId || null,
      legal_name: legalName || null,
    },
  }
}
