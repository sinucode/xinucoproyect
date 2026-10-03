import React from 'react'
import { createClient } from '@xinuco/supabase/server'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { BrandConfig } from '@xinuco/types'
import { Inter, Playfair_Display, Oswald } from 'next/font/google'
import { resolveThemeMode, onPrimaryColor, MUTED_COLORS, bookingSurface } from '@/lib/brand-theme'

// ── Fuentes SSR (pre-cargadas en build-time, Zero-Flicker) ──────────────────
const inter    = Inter({           subsets: ['latin'], display: 'swap', variable: '--font-inter' })
const playfair = Playfair_Display({ subsets: ['latin'], display: 'swap', variable: '--font-playfair' })
const oswald   = Oswald({          subsets: ['latin'], display: 'swap', variable: '--font-oswald' })

// ── Diccionario de fuentes: string BD → instancia next/font ─────────────────
const FONTS: Record<string, typeof inter> = {
  inter,
  playfair,
  oswald,
}

// Normaliza el string del BD y devuelve la fuente correspondiente (fallback: Inter)
function resolveFont(key?: string) {
  if (!key) return inter
  const normalized = key.trim().toLowerCase().replace(/[\s_-]+/g, '')
  const match = Object.keys(FONTS).find(k => normalized.startsWith(k))
  return match ? FONTS[match] : inter
}

// ── Defaults seguros ─────────────────────────────────────────────────────────
const DEFAULTS: BrandConfig = {
  primaryColor:   '#C5A059',
  secondaryColor: '#1A1A1A',
  bgColor:        '#080808',
  textColor:      '#F4F4F4',
  fontFamily:     'inter',
}

// ── Oscurece un color hex (negativo = más oscuro) ────────────────────────────
function shadeColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.max(0, Math.min(255, (num >> 16) + amount))
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amount))
  const b = Math.max(0, Math.min(255, (num & 0x0000ff) + amount))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

// ── Fila devuelta por la RPC pública get_public_business (solo campos seguros) ─
interface PublicBusinessRow {
  id:           string
  name:         string
  slug:         string
  is_active:    boolean
  brand_config: unknown
}

// ── Props ────────────────────────────────────────────────────────────────────
interface TenantLayoutProps {
  children: React.ReactNode
  params:   Promise<{ slug: string }>
}

// ── Metadata dinámica (SEO por tenant) ───────────────────────────────────────
export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const supabase  = await createClient()

  // Lectura pública vía RPC SECURITY DEFINER (la tabla businesses no es legible por anon)
  const { data } = await supabase
    .rpc('get_public_business', { p_slug: slug })
    .maybeSingle<PublicBusinessRow>()

  if (!data) return { title: 'Xinuco' }

  return {
    title:       `${data.name} — Xinuco`,
    description: `Reserva tu cita en ${data.name}.`,
  }
}

// ── Layout principal del tenant ──────────────────────────────────────────────
export default async function TenantLayout({ children, params }: TenantLayoutProps) {
  const { slug } = await params
  const supabase  = await createClient()

  // brand_config es la FUENTE ÚNICA DE VERDAD
  const { data: business, error } = await supabase
    .rpc('get_public_business', { p_slug: slug })
    .maybeSingle<PublicBusinessRow>()

  if (error || !business || !business.is_active) notFound()

  // Extraer config con defaults seguros
  const bc             = (business.brand_config as BrandConfig) ?? DEFAULTS
  const primaryColor   = bc.primaryColor   || DEFAULTS.primaryColor
  const secondaryColor = bc.secondaryColor || DEFAULTS.secondaryColor
  const bgColor        = bc.bgColor        || DEFAULTS.bgColor
  const textColor      = bc.textColor      || DEFAULTS.textColor
  const font           = resolveFont(bc.fontFamily)
  // Modo claro/oscuro: solo afecta al portal del cliente (el dashboard fuerza oscuro en su propio layout)
  const themeMode      = resolveThemeMode(bc.themeMode)

  // CSS Variables inyectadas en el servidor (Zero-Flicker)
  const cssVars = {
    '--brand-primary':   primaryColor,
    '--primary-color':   primaryColor,
    '--primary-dark':    shadeColor(primaryColor, -20),
    '--secondary-color': secondaryColor,
    '--bg-color':        bgColor,
    '--text-color':      textColor,
    '--border-color':    `${secondaryColor}CC`,
    '--muted-color':     MUTED_COLORS[themeMode],
    '--booking-surface': bookingSurface(themeMode, secondaryColor),
    '--on-primary':      onPrimaryColor(primaryColor),
    colorScheme:         themeMode,
    // Fondo y texto del portal (el body global es oscuro): sin esto el modo claro dejaría fondo negro
    backgroundColor:     bgColor,
    color:               textColor,
    '--font-family':     bc.fontFamily || 'inter',
  } as React.CSSProperties

  return (
    <div
      data-tenant-theme=""
      data-theme-mode={themeMode}
      className={`${font.className} ${font.variable} min-h-screen antialiased flex flex-col`}
      style={cssVars}
    >
      {children}
    </div>
  )
}
