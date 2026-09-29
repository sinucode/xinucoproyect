// ============================================================
// lib/roles.ts — Etiquetas de rol en español
// Módulo plano (sin 'use client'): usable desde Server y Client Components.
// Fuente única para mostrar el rol del usuario en la UI.
// ============================================================

import type { UserRole } from '@xinuco/types'

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin:       'Administrador',
  barber:      'Barbero',
  manicurist:  'Manicurista',
}

export function roleLabel(role: string | null | undefined): string {
  return (role && ROLE_LABELS[role as UserRole]) || 'Usuario'
}
