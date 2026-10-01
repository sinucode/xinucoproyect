// ============================================================
// lib/navigation.ts — Fuente única de la navegación del back-office
// La usan el sidebar de escritorio, la barra inferior móvil y la hoja "Más".
// ============================================================

import {
  Home, CalendarDays, UserPlus, ShoppingBag, BookUser, Gift, Users, Wallet,
  Scissors, Archive, Receipt, BookOpen, Package, BarChart2, Shield, Settings,
  CalendarPlus, ArrowLeftRight, type LucideIcon,
} from 'lucide-react'
import type { BusinessFeatures } from '@xinuco/types'

export type FeatureKey = keyof BusinessFeatures
export type NavRole = 'admin' | 'barber'

export type NavGroupId = 'hoy' | 'clientes' | 'equipo' | 'catalogo' | 'dinero' | 'analisis' | 'footer'

export interface NavItem {
  id:          string
  group:       NavGroupId
  href:        (slug: string) => string
  icon:        LucideIcon
  label:       string
  /** Etiqueta corta (solo barra inferior). El aria-label usa siempre `label`. */
  shortLabel?: string
  feature:     FeatureKey | null   // null = siempre disponible
  roles:       NavRole[]
  /** Etiqueta para administradores cuando el mismo ítem lo ven también otros roles. */
  adminLabel?: string
}

export const NAV_GROUP_LABELS: Record<Exclude<NavGroupId, 'footer'>, string> = {
  hoy:      'Hoy',
  clientes: 'Clientes',
  equipo:   'Equipo',
  catalogo: 'Catálogo',
  dinero:   'Dinero',
  analisis: 'Análisis',
}

/** Orden de los grupos (el footer no es un grupo visible). */
export const NAV_GROUP_ORDER: Exclude<NavGroupId, 'footer'>[] = [
  'hoy', 'clientes', 'equipo', 'catalogo', 'dinero', 'analisis',
]

const dash = (path: string) => (slug: string) => `/${slug}/dashboard${path}`

const BOTH: NavRole[]  = ['admin', 'barber']
const ADMIN: NavRole[] = ['admin']

export const NAV_ITEMS: NavItem[] = [
  // ── HOY ──────────────────────────────────────────────────────
  { id: 'nav-home',         group: 'hoy',      href: dash(''),               icon: Home,         label: 'Inicio',              feature: null,               roles: BOTH },
  { id: 'nav-appointments', group: 'hoy',      href: dash('/appointments'),  icon: CalendarDays, label: 'Agenda',              feature: null,               roles: BOTH },
  { id: 'nav-walk-ins',     group: 'hoy',      href: dash('/walk-ins'),      icon: UserPlus,     label: 'Fila de espera',      shortLabel: 'Fila', feature: 'walk_ins', roles: BOTH },
  { id: 'nav-retail',       group: 'hoy',      href: dash('/retail'),        icon: ShoppingBag,  label: 'Venta de productos',  feature: 'retail_sales',     roles: ADMIN },
  // ── CLIENTES ─────────────────────────────────────────────────
  { id: 'nav-crm',          group: 'clientes', href: dash('/crm'),           icon: BookUser,     label: 'Clientes',            feature: 'crm',              roles: BOTH },
  { id: 'nav-loyalty',      group: 'clientes', href: dash('/loyalty'),       icon: Gift,         label: 'Lealtad',             feature: 'loyalty',          roles: ADMIN },
  // ── EQUIPO ───────────────────────────────────────────────────
  { id: 'nav-staff',        group: 'equipo',   href: dash('/staff'),         icon: Users,        label: 'Equipo',              feature: null,               roles: ADMIN },
  // Admin: gestiona los pagos de todo el equipo. Barbero/manicurista: ve solo su cuenta.
  { id: 'nav-ledger',       group: 'equipo',   href: dash('/ledger'),        icon: Wallet,       label: 'Mi cuenta',           adminLabel: 'Pagos al equipo', feature: 'staff_ledger', roles: BOTH },
  // ── CATÁLOGO ─────────────────────────────────────────────────
  { id: 'nav-services',     group: 'catalogo', href: dash('/services'),      icon: Scissors,     label: 'Servicios',           feature: null,               roles: ADMIN },
  { id: 'nav-inventory',    group: 'catalogo', href: dash('/inventory'),     icon: Archive,      label: 'Inventario',          feature: 'inventory',        roles: ADMIN },
  // ── DINERO ───────────────────────────────────────────────────
  { id: 'nav-expenses',     group: 'dinero',   href: dash('/expenses'),      icon: Receipt,      label: 'Gastos',              feature: 'expenses_pgl',     roles: ADMIN },
  { id: 'nav-accounting',   group: 'dinero',   href: dash('/accounting'),    icon: BookOpen,     label: 'Contabilidad',        feature: 'advanced_reports', roles: ADMIN },
  { id: 'nav-fixed-assets', group: 'dinero',   href: dash('/fixed-assets'),  icon: Package,      label: 'Activos fijos',       feature: 'fixed_assets',     roles: ADMIN },
  // ── ANÁLISIS ─────────────────────────────────────────────────
  { id: 'nav-reports',      group: 'analisis', href: dash('/reports'),       icon: BarChart2,    label: 'Reportes',            feature: null,               roles: ADMIN },
  { id: 'nav-audit',        group: 'analisis', href: dash('/audit'),         icon: Shield,       label: 'Auditoría',           feature: 'audit_logs',       roles: ADMIN },
  // ── FOOTER ───────────────────────────────────────────────────
  { id: 'nav-settings',     group: 'footer',   href: dash('/settings'),      icon: Settings,     label: 'Configuración',       feature: null,               roles: ADMIN },
]

// ── Resultado resuelto para un rol + features ───────────────────────────────

export interface VisibleNavItem extends NavItem {
  /** Etiqueta final (aplica adminLabel). */
  label:  string
  /** true = feature restringida por plan (solo admins ven el ítem bloqueado). */
  locked: boolean
}

export interface VisibleNavGroup {
  id:    NavGroupId
  /** null = sin encabezado (barbero). */
  label: string | null
  items: VisibleNavItem[]
}

export interface VisibleNav {
  groups: VisibleNavGroup[]
  footer: VisibleNavItem[]
}

/**
 * Ítems visibles según rol y features.
 * - Admin: ve todo; los ítems con feature apagada salen `locked` (upsell).
 * - Barbero: sin encabezados de grupo y los ítems con feature apagada se ocultan.
 */
export function visibleNav(role: NavRole, features: Partial<BusinessFeatures>): VisibleNav {
  const resolve = (item: NavItem): VisibleNavItem | null => {
    if (!item.roles.includes(role)) return null
    const locked = item.feature !== null && features[item.feature] !== true
    if (locked && role !== 'admin') return null
    return {
      ...item,
      label:  role === 'admin' && item.adminLabel ? item.adminLabel : item.label,
      locked,
    }
  }

  const all = NAV_ITEMS.map(resolve).filter((i): i is VisibleNavItem => i !== null)
  const footer = all.filter((i) => i.group === 'footer')
  const body = all.filter((i) => i.group !== 'footer')

  if (role !== 'admin') {
    // Barbero: una sola lista plana, en el orden de los grupos.
    const flat = NAV_GROUP_ORDER.flatMap((g) => body.filter((i) => i.group === g))
    return { groups: flat.length ? [{ id: 'hoy', label: null, items: flat }] : [], footer }
  }

  const groups: VisibleNavGroup[] = NAV_GROUP_ORDER
    .map((g) => ({ id: g as NavGroupId, label: NAV_GROUP_LABELS[g], items: body.filter((i) => i.group === g) }))
    .filter((g) => g.items.length > 0)

  return { groups, footer }
}

/** Convierte el rol de sesión (admin | super_admin | barber | manicurist) en NavRole. */
export function toNavRole(isAdmin: boolean): NavRole {
  return isAdmin ? 'admin' : 'barber'
}

/** ¿La ruta actual pertenece al ítem? Inicio solo coincide exacto. */
export function isNavActive(pathname: string, href: string): boolean {
  if (href.endsWith('/dashboard')) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

// ── Barra inferior móvil ────────────────────────────────────────────────────

export interface BottomBar {
  /** Ítems de la barra (sin el "+" ni "Más"). */
  items:      VisibleNavItem[]
  /** Admin: la barra lleva el botón central "+". */
  showQuick:  boolean
  /** Ítems/grupos que van dentro de la hoja "Más" (vacío = no hay botón Más). */
  moreGroups: VisibleNavGroup[]
  /** Configuración (footer) dentro de la hoja. */
  moreFooter: VisibleNavItem[]
}

export const MAX_BAR_ITEMS_BARBER = 5

/**
 * Admin: Inicio · Agenda · [+] · Fila (o Clientes si no hay fila) · Más.
 * Barbero: Inicio · Agenda · Fila · Clientes · Mi cuenta (sin Más si caben en 5).
 */
export function bottomBar(role: NavRole, features: Partial<BusinessFeatures>): BottomBar {
  const nav = visibleNav(role, features)
  const all = nav.groups.flatMap((g) => g.items)
  const unlocked = (id: string) => all.find((i) => i.id === id && !i.locked)

  if (role === 'admin') {
    const fila = unlocked('nav-walk-ins') ?? unlocked('nav-crm')
    const items = [unlocked('nav-home'), unlocked('nav-appointments'), fila].filter(
      (i): i is VisibleNavItem => Boolean(i),
    )
    const inBar = new Set(items.map((i) => i.id))
    const moreGroups = nav.groups
      .map((g) => ({ ...g, items: g.items.filter((i) => !inBar.has(i.id)) }))
      .filter((g) => g.items.length > 0)
    return { items, showQuick: true, moreGroups, moreFooter: nav.footer }
  }

  const items = all.slice(0, MAX_BAR_ITEMS_BARBER)
  const rest = all.slice(MAX_BAR_ITEMS_BARBER)
  return {
    items,
    showQuick: false,
    moreGroups: rest.length ? [{ id: 'hoy', label: null, items: rest }] : [],
    moreFooter: [],
  }
}

// ── Acciones rápidas ("+") ──────────────────────────────────────────────────

export interface QuickAction {
  id:      string
  label:   string
  hint:    string
  icon:    LucideIcon
  href:    (slug: string) => string
  feature: FeatureKey | null
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'qa-appointment', label: 'Nueva cita',            hint: 'Reservar una cita en la agenda',  icon: CalendarPlus, href: (s) => `/${s}/book`,                       feature: null },
  { id: 'qa-walk-in',     label: 'Nuevo turno en fila',   hint: 'Anotar a un cliente sin cita',    icon: UserPlus,     href: (s) => `/${s}/dashboard/walk-ins?nuevo=1`, feature: 'walk_ins' },
  { id: 'qa-retail',      label: 'Vender producto',       hint: 'Venta directa de productos',      icon: ShoppingBag,  href: (s) => `/${s}/dashboard/retail`,           feature: 'retail_sales' },
  { id: 'qa-expense',     label: 'Registrar gasto',       hint: 'Anotar un gasto del negocio',     icon: Receipt,      href: (s) => `/${s}/dashboard/expenses?nuevo=1`, feature: 'expenses_pgl' },
  // Aportes, préstamos y traslados entre medios: abre la hoja "Mover plata" de Inicio
  { id: 'qa-move-money',  label: 'Mover plata',           hint: 'Aportes, préstamos y traslados',  icon: ArrowLeftRight, href: (s) => `/${s}/dashboard?mover=1`,         feature: null },
]

export function visibleQuickActions(features: Partial<BusinessFeatures>): QuickAction[] {
  return QUICK_ACTIONS.filter((a) => a.feature === null || features[a.feature] === true)
}
