// ============================================================
// lib/features/config.ts — Feature catalog + plan bundles
// Fuente única de verdad para nombres, descripciones y planes
// ============================================================

import type { BusinessFeatures } from '@xinuco/types'

// ── Catálogo de features ──────────────────────────────────────────────────────

export type FeatureCategory = 'comunicacion' | 'finanzas' | 'operaciones' | 'compliance'

export interface FeatureMeta {
  label:       string
  description: string
  icon:        string   // lucide icon name as string
  category:    FeatureCategory
}

export const FEATURE_CATALOG: Record<keyof BusinessFeatures, FeatureMeta> = {
  notifications_email:    { label: 'Email Notifications',    description: 'Confirmación y recordatorio de citas por correo',          icon: 'Mail',       category: 'comunicacion' },
  notifications_whatsapp: { label: 'WhatsApp Notifications', description: 'Mensajes automáticos por WhatsApp Cloud API',               icon: 'MessageCircle', category: 'comunicacion' },
  commissions:            { label: 'Comisiones',             description: 'Motor de comisiones variables por barbero y servicio',     icon: 'Percent',    category: 'finanzas' },
  staff_ledger:           { label: 'Billetera Staff',        description: 'Saldos y liquidaciones del equipo en tiempo real',         icon: 'Wallet',     category: 'finanzas' },
  expenses_pgl:           { label: 'Gastos y P&G',           description: 'Registro de gastos y estado de resultados',               icon: 'Receipt',    category: 'finanzas' },
  retail_sales:           { label: 'Ventas Retail',          description: 'Venta rápida de productos sin cita asociada',             icon: 'ShoppingBag', category: 'finanzas' },
  loyalty:                { label: 'Programa de Lealtad',    description: 'Puntos y recompensas para clientes frecuentes',           icon: 'Gift',       category: 'finanzas' },
  workstations:           { label: 'Puestos de Trabajo',     description: 'Gestión de sillas, cabinas y workstations',              icon: 'LayoutGrid', category: 'operaciones' },
  walk_ins:               { label: 'Fila de espera',          description: 'Fila de turnos de clientes sin cita previa',                    icon: 'Users',      category: 'operaciones' },
  crm:                    { label: 'CRM Clientes',           description: 'Expediente técnico y notas por cliente',                 icon: 'BookUser',   category: 'operaciones' },
  audit_logs:             { label: 'Auditoría',              description: 'Trail de auditoría inmutable de todas las acciones',     icon: 'Shield',     category: 'compliance' },
  fixed_assets:           { label: 'Activos Fijos',          description: 'Inventario y depreciación de equipos',                   icon: 'Package',    category: 'compliance' },
  inventory:              { label: 'Inventario',             description: 'Control de stock de productos',                         icon: 'Archive',    category: 'operaciones' },
  advanced_reports:       { label: 'Reportes Avanzados',     description: 'Reportes financieros y de rendimiento',                 icon: 'BarChart2',  category: 'finanzas' },
  mercadopago_pos:        { label: 'MP — POS',               description: 'Cobro con MercadoPago en caja presencial',              icon: 'QrCode',     category: 'finanzas' },
  mercadopago_booking:    { label: 'MP — Reservas Online',   description: 'Pago anticipado con MercadoPago al reservar cita',     icon: 'CreditCard', category: 'finanzas' },
  mercadopago_saas:       { label: 'MP — Suscripción SaaS',  description: 'Cobro del plan Xinuco vía MercadoPago PreApproval',    icon: 'Repeat',     category: 'finanzas' },
}

// ── Precios SaaS en COP (enteros, pagos mensuales vía MP PreApproval) ─────────

// Precios mensuales en COP (enteros — NUNCA float).
// Anual = mensual × 10 (psicología "Paga 10, lleva 12").
// Semestral = mensual × 6 sin descuento (efecto señuelo).
export const PLAN_PRICES_COP: Record<'esencial' | 'profesional' | 'elite', number> = {
  esencial:    57_900,   // ~$14 USD
  profesional: 79_900,   // ~$19 USD
  elite:       97_900,   // ~$24 USD
}

// ── Bundles de plan predefinidos ──────────────────────────────────────────────

export type PlanName = 'esencial' | 'profesional' | 'elite'

export interface PlanBundle {
  label:       string
  description: string
  color:       string   // Tailwind/CSS color name
  features:    Partial<BusinessFeatures>
}

export const PLAN_BUNDLES: Record<PlanName, PlanBundle> = {
  esencial: {
    label:       'Esencial',
    description: 'Agenda, base de clientes y punto de venta de servicios.',
    color:       'zinc',
    features: {
      // ── Las 3 únicas funciones del plan Esencial ──────────────────────────
      // Agenda + Citas Core: siempre incluida en la plataforma (no es feature flag)
      crm:                    true,   // ✅ Base de Clientes
      mercadopago_pos:        true,   // ✅ Punto de Venta Básico (Servicios)
      // ── Todo lo demás bloqueado hasta Profesional o Élite ─────────────────
      notifications_email:    false,
      notifications_whatsapp: false,
      commissions:            false,
      staff_ledger:           false,
      expenses_pgl:           false,
      retail_sales:           false,
      loyalty:                false,
      workstations:           false,
      walk_ins:               false,
      audit_logs:             false,
      fixed_assets:           false,
      inventory:              false,
      advanced_reports:       false,
      mercadopago_booking:    false,
      mercadopago_saas:       false,
    },
  },
  profesional: {
    label:       'Profesional',
    description: 'CFO Virtual: comisiones automáticas, retail y control de estaciones.',
    color:       'blue',
    features: {
      // ── Hereda Esencial ───────────────────────────────────────────────────
      crm:                    true,
      mercadopago_pos:        true,
      // ── Módulos CFO Virtual ───────────────────────────────────────────────
      commissions:            true,   // ✅ Comisiones automáticas
      staff_ledger:           true,   // ✅ Billetera del staff
      expenses_pgl:           true,   // ✅ Gastos y P&G
      retail_sales:           true,   // ✅ Ventas retail
      workstations:           true,   // ✅ Control de estaciones
      advanced_reports:       true,   // ✅ Reportes financieros
      notifications_email:    true,   // ✅ Confirmaciones por email
      mercadopago_booking:    true,   // ✅ Pago online al reservar
      // ── Bloqueado hasta Élite ─────────────────────────────────────────────
      notifications_whatsapp: false,
      loyalty:                false,
      walk_ins:               false,
      audit_logs:             false,
      fixed_assets:           false,
      inventory:              false,
      mercadopago_saas:       false,
    },
  },
  elite: {
    label:       'Élite',
    description: 'Todas las funciones habilitadas. Auditoría, WhatsApp y fidelidad.',
    color:       'amber',
    features: {
      notifications_email:    true,
      notifications_whatsapp: true,   // ✅ Bot de WhatsApp
      commissions:            true,
      staff_ledger:           true,
      expenses_pgl:           true,
      retail_sales:           true,
      loyalty:                true,   // ✅ Programa de fidelidad
      workstations:           true,
      walk_ins:               true,
      crm:                    true,
      audit_logs:             true,   // ✅ Auditoría avanzada
      fixed_assets:           true,
      inventory:              true,
      advanced_reports:       true,
      mercadopago_pos:        true,
      mercadopago_booking:    true,
      mercadopago_saas:       true,
    },
  },
}

// ── Helper: detecta el plan actual de un negocio ──────────────────────────────
// Basado en qué features tiene activas — puede devolver 'custom' si no cuadra.

export function detectCurrentPlan(features: BusinessFeatures): PlanName | 'custom' {
  for (const [planName, bundle] of Object.entries(PLAN_BUNDLES) as [PlanName, PlanBundle][]) {
    const keys = Object.keys(bundle.features) as (keyof BusinessFeatures)[]
    const matches = keys.every((k) => features[k] === bundle.features[k])
    if (matches) return planName
  }
  return 'custom'
}
