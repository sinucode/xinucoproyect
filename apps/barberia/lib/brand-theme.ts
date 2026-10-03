// lib/brand-theme.ts — Modo claro/oscuro de la página de reservas y helpers de color del tema.
// El modo SOLO aplica al portal del cliente (/[slug], /[slug]/book, login, cancelar): el dashboard
// (admin y barberos) es siempre oscuro (ver app/[slug]/dashboard/layout.tsx).

import type { ThemeMode } from '@xinuco/types'

export const THEME_MODES: readonly ThemeMode[] = ['dark', 'light'] as const

export function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'dark' || v === 'light'
}

/** Normaliza un valor guardado (cualquier cosa) a un modo válido; por defecto oscuro. */
export function resolveThemeMode(v: unknown): ThemeMode {
  return v === 'light' ? 'light' : 'dark'
}

/** Colores base de cada modo (fondo, superficie/tarjetas y texto). El usuario puede afinarlos después. */
export const THEME_PRESETS: Record<ThemeMode, { bgColor: string; secondaryColor: string; textColor: string }> = {
  dark:  { bgColor: '#080808', secondaryColor: '#1A1A1A', textColor: '#F4F4F4' },
  light: { bgColor: '#FFFFFF', secondaryColor: '#F3F4F6', textColor: '#111111' },
}

/** Color de texto secundario ("muted") por modo. */
export const MUTED_COLORS: Record<ThemeMode, string> = {
  dark:  '#6B6B6B',
  light: '#6B7280',
}

/** Velo de superficie de las tarjetas del portal: en oscuro un blanco translúcido; en claro la superficie. */
export function bookingSurface(mode: ThemeMode, secondaryColor: string): string {
  return mode === 'light' ? secondaryColor : 'rgba(255,255,255,0.03)'
}

/** Luminancia relativa (0–1) de un hex de 3, 6 u 8 dígitos; null si no es un hex válido. */
export function hexLuminance(hex: string): number | null {
  let h = (hex ?? '').trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6)
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  const lin = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4)
}

/** Color de texto legible sobre un fondo `primary` (botones primarios): el de mayor contraste, casi negro o blanco. */
export function onPrimaryColor(primary: string): string {
  const l = hexLuminance(primary)
  if (l === null) return '#080808'
  // Punto de cruce de contraste entre #080808 y #FFFFFF ≈ luminancia 0.18
  return l > 0.18 ? '#080808' : '#FFFFFF'
}
