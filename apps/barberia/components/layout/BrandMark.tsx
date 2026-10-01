import type { Business } from '@xinuco/types'

export type BrandBusiness = Pick<Business, 'name' | 'branding'> & Partial<Pick<Business, 'brand_config'>>

/** URL del logo del negocio (branding legado o brand_config), o null. */
export function businessLogoUrl(business?: BrandBusiness | null): string | null {
  return business?.branding?.logo_url || business?.brand_config?.logoUrl || null
}

/** Inicial del negocio para el cuadrado de marca cuando no hay logo. */
export function businessInitial(business?: BrandBusiness | null): string {
  const name = business?.name?.trim()
  return name ? name[0].toUpperCase() : 'X'
}

/**
 * Logo del negocio (si existe) o su inicial en un cuadrado redondeado.
 * `size` en px (el cuadrado es size × size).
 */
export function BrandMark({ business, size = 36 }: { business?: BrandBusiness | null; size?: number }) {
  const logo = businessLogoUrl(business)
  const dim = { width: size, height: size }
  if (logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        aria-hidden="true"
        style={dim}
        className="shrink-0 rounded-xl object-cover border border-xinuco-border"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      style={{
        ...dim,
        backgroundColor: 'color-mix(in srgb, var(--primary-color) 14%, transparent)',
        borderColor:     'color-mix(in srgb, var(--primary-color) 28%, transparent)',
        color:           'var(--primary-color)',
        fontSize:        Math.round(size * 0.45),
      }}
      className="shrink-0 rounded-xl border flex items-center justify-center font-bold"
    >
      {businessInitial(business)}
    </span>
  )
}
