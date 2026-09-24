'use client'

import { useState, useTransition, useEffect } from 'react'
import {
  X, Loader2, CheckCircle2, AlertCircle, Pipette,
  Mail, MessageSquare, Percent, Wallet, BarChart3, ShoppingBag,
  Award, Armchair, Users, ClipboardList, Shield, Package, WrenchIcon,
  Power, Palette,
} from 'lucide-react'
import type { Business, BusinessFeatures, BrandConfig } from '@xinuco/types'
import { toggleBusinessFeature, updateBusinessTheme } from '@/actions/businesses'
import { toggleTenantStatus } from '@/actions/admin'
import { BusinessUsersPanel } from '@/components/admin/BusinessUsersPanel'

// ────────────────────────────────────────────────────────────
// Tipos
// ────────────────────────────────────────────────────────────
interface TenantDetailDrawerProps {
  business: Business | null
  onClose: () => void
}

interface ActionResult {
  success?: boolean
  error?: string
}

// ────────────────────────────────────────────────────────────
// Grupos de Feature Flags
// ────────────────────────────────────────────────────────────
const FEATURE_GROUPS: {
  label: string
  color: string
  features: { key: keyof BusinessFeatures; label: string; icon: React.ElementType; desc: string }[]
}[] = [
  {
    label: 'Comunicación',
    color: '#3B82F6',
    features: [
      { key: 'notifications_email',    label: 'Email',      icon: Mail,           desc: 'Confirmaciones y recordatorios por correo (Resend)' },
      { key: 'notifications_whatsapp', label: 'WhatsApp',   icon: MessageSquare,  desc: 'Notificaciones automáticas por WhatsApp Cloud API' },
    ],
  },
  {
    label: 'Finanzas',
    color: '#10B981',
    features: [
      { key: 'commissions',  label: 'Comisiones',  icon: Percent,      desc: 'Motor de comisiones variables por servicio y empleado' },
      { key: 'staff_ledger', label: 'Billetera',   icon: Wallet,       desc: 'Billetera digital del staff — saldo y anticipos' },
      { key: 'expenses_pgl', label: 'P&G',         icon: BarChart3,    desc: 'Registro de gastos y estado de resultados' },
      { key: 'retail_sales', label: 'Retail',      icon: ShoppingBag,  desc: 'Ventas directas de productos sin cita asociada' },
      { key: 'loyalty',      label: 'Lealtad',     icon: Award,        desc: 'Programa de puntos de fidelización de clientes' },
    ],
  },
  {
    label: 'Operaciones',
    color: '#F59E0B',
    features: [
      { key: 'workstations', label: 'Puestos',     icon: Armchair,       desc: 'Gestión de sillas y puestos de trabajo' },
      { key: 'walk_ins',     label: 'Walk-ins',    icon: Users,          desc: 'Cola de clientes sin cita previa' },
      { key: 'crm',          label: 'CRM',         icon: ClipboardList,  desc: 'Expediente completo del cliente' },
    ],
  },
  {
    label: 'Compliance',
    color: '#8B5CF6',
    features: [
      { key: 'audit_logs',    label: 'Auditoría',  icon: Shield,       desc: 'Logs de auditoría inmutables (RF19)' },
      { key: 'fixed_assets',  label: 'Activos',    icon: WrenchIcon,   desc: 'Gestión de activos fijos con depreciación' },
      { key: 'inventory',     label: 'Inventario', icon: Package,      desc: 'Control de inventario de productos' },
      { key: 'advanced_reports', label: 'Reportes Avanzados', icon: BarChart3, desc: 'Reportes premium con análisis profundo' },
    ],
  },
]

// ────────────────────────────────────────────────────────────
// Componente: Toggle individual de feature
// ────────────────────────────────────────────────────────────
function FeatureRow({
  businessId,
  featureKey,
  label,
  desc,
  icon: Icon,
  accentColor,
  initialValue,
}: {
  businessId: string
  featureKey: string
  label: string
  desc: string
  icon: React.ElementType
  accentColor: string
  initialValue: boolean
}) {
  const [enabled, setEnabled] = useState(initialValue)
  const [isPending, startTransition] = useTransition()

  const handle = () => {
    const next = !enabled
    setEnabled(next)
    startTransition(async () => {
      const res = await toggleBusinessFeature(businessId, featureKey, next)
      if (res.error) {
        setEnabled(!next)
        alert(res.error)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={isPending}
      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-all text-left
        ${enabled ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'}
        ${isPending ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
    >
      <Icon size={15} style={{ color: enabled ? accentColor : '#6B6B6B' }} />
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold ${enabled ? 'text-xinuco-text' : 'text-xinuco-muted'}`}>
          {label}
        </p>
        <p className="text-[10px] text-xinuco-muted leading-tight mt-0.5 truncate">{desc}</p>
      </div>
      {/* Toggle pill */}
      <div
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200"
        style={{ backgroundColor: enabled ? accentColor : '#2A2A2A' }}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
            enabled ? 'translate-x-4' : 'translate-x-1'
          }`}
        />
      </div>
    </button>
  )
}

// ────────────────────────────────────────────────────────────
// Componente: Editor de colores
// ────────────────────────────────────────────────────────────
function ColorPicker({
  label, id, value, onChange,
}: { label: string; id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[10px] font-medium text-xinuco-muted uppercase tracking-wider">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <label
          htmlFor={id}
          className="w-8 h-8 rounded-lg border border-xinuco-border cursor-pointer hover:scale-105 transition-transform shrink-0 relative overflow-hidden"
          style={{ background: value }}
        >
          <input
            id={id}
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          />
        </label>
        <div className="flex items-center gap-1.5 flex-1 bg-xinuco-surface border border-xinuco-border rounded-lg px-2.5 py-1.5">
          <Pipette size={11} className="text-xinuco-muted shrink-0" />
          <input
            type="text"
            value={value}
            onChange={(e) => {
              const v = e.target.value
              if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) onChange(v)
            }}
            maxLength={7}
            className="bg-transparent outline-none text-xinuco-text text-xs font-mono flex-1 min-w-0"
          />
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Drawer principal
// ────────────────────────────────────────────────────────────
export function TenantDetailDrawer({ business, onClose }: TenantDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<'users' | 'flags' | 'branding' | 'status'>('users')
  const [brandResult, setBrandResult] = useState<ActionResult | null>(null)
  const [isBrandPending, startBrandTransition] = useTransition()
  const [isStatusPending, startStatusTransition] = useTransition()
  const [isActive, setIsActive] = useState(business?.is_active ?? true)

  // Branding state
  const initial = business?.brand_config ?? {
    primaryColor: '#C5A059', secondaryColor: '#1A1A1A',
    bgColor: '#080808', textColor: '#F4F4F4', fontFamily: 'inter',
  }
  const [primary,   setPrimary]   = useState(initial.primaryColor)
  const [secondary, setSecondary] = useState(initial.secondaryColor)
  const [bg,        setBg]        = useState(initial.bgColor)
  const [text,      setText]      = useState(initial.textColor)
  const [font,      setFont]      = useState(initial.fontFamily)

  // Cerrar con Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!business) return null

  const handleSaveBranding = () => {
    setBrandResult(null)
    startBrandTransition(async () => {
      const config: BrandConfig = {
        primaryColor:   primary,
        secondaryColor: secondary,
        bgColor:        bg,
        textColor:      text,
        fontFamily:     font,
      }
      const res = await updateBusinessTheme(business.id, config)
      setBrandResult(res as ActionResult)
    })
  }

  const handleToggleStatus = () => {
    startStatusTransition(async () => {
      const res = await toggleTenantStatus(business.id, isActive)
      if (res.success) setIsActive((v) => !v)
      else alert(res.error)
    })
  }

  const features = business.features_enabled ?? {}

  const TABS = [
    { id: 'users',    label: 'Usuarios' },
    { id: 'flags',    label: 'Módulos' },
    { id: 'branding', label: 'Branding' },
    { id: 'status',   label: 'Estado' },
  ] as const

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-xinuco-bg border-l border-xinuco-border
                   flex flex-col shadow-2xl overflow-hidden"
        style={{ animation: 'slideInRight 0.25s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-xinuco-border shrink-0">
          <div>
            <h2 id="drawer-title" className="text-sm font-bold text-xinuco-text">{business.name}</h2>
            <p className="text-[10px] text-xinuco-muted font-mono mt-0.5">/{business.slug}</p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                isActive
                  ? 'bg-green-500/10 text-green-400 border-green-500/20'
                  : 'bg-red-500/10 text-red-400 border-red-500/20'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-400' : 'bg-red-400'}`} />
              {isActive ? 'Activo' : 'Inactivo'}
            </span>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xinuco-muted
                         hover:text-xinuco-text hover:bg-xinuco-surface transition-all"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-xinuco-border shrink-0 px-5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-xs font-semibold border-b-2 transition-all -mb-px ${
                activeTab === tab.id
                  ? 'border-b-2 text-xinuco-text'
                  : 'border-transparent text-xinuco-muted hover:text-xinuco-text'
              }`}
              style={activeTab === tab.id ? { borderBottomColor: 'var(--primary-color)' } : {}}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── TAB: Usuarios ── */}
          {activeTab === 'users' && (
            <BusinessUsersPanel businessId={business.id} />
          )}

          {/* ── TAB: Módulos ── */}
          {activeTab === 'flags' && (
            <div className="p-5 space-y-5">
              {FEATURE_GROUPS.map((group) => (
                <div key={group.label}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: group.color }} />
                    <p className="text-[10px] font-bold uppercase tracking-widest text-xinuco-muted">
                      {group.label}
                    </p>
                  </div>
                  <div className="space-y-1">
                    {group.features.map((f) => (
                      <FeatureRow
                        key={f.key}
                        businessId={business.id}
                        featureKey={f.key}
                        label={f.label}
                        desc={f.desc}
                        icon={f.icon}
                        accentColor={group.color}
                        initialValue={!!(features as unknown as Record<string, boolean>)[f.key]}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── TAB: Branding ── */}
          {activeTab === 'branding' && (
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <ColorPicker label="Color Primario"   id="dp-primary"   value={primary}   onChange={setPrimary} />
                <ColorPicker label="Color Secundario" id="dp-secondary" value={secondary} onChange={setSecondary} />
                <ColorPicker label="Color de Fondo"   id="dp-bg"        value={bg}        onChange={setBg} />
                <ColorPicker label="Color de Texto"   id="dp-text"      value={text}      onChange={setText} />
              </div>

              {/* Font */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="dp-font" className="text-[10px] font-medium text-xinuco-muted uppercase tracking-wider">
                  Tipografía
                </label>
                <select
                  id="dp-font"
                  value={font}
                  onChange={(e) => setFont(e.target.value)}
                  className="bg-xinuco-surface border border-xinuco-border rounded-lg px-3 py-2 text-xs text-xinuco-text outline-none focus:border-xinuco-primary"
                >
                  <option value="inter">Inter</option>
                  <option value="playfair">Playfair Display</option>
                  <option value="oswald">Oswald</option>
                  <option value="bebas">Bebas Neue</option>
                  <option value="poppins">Poppins</option>
                </select>
              </div>

              {/* Preview */}
              <div className="rounded-xl p-4 border border-xinuco-border" style={{ background: bg }}>
                <p className="text-[10px] text-xinuco-muted mb-3 uppercase tracking-wider">Preview</p>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl" style={{ background: primary }} />
                  <div>
                    <p className="text-sm font-bold" style={{ color: text }}>{business.name}</p>
                    <p className="text-[10px]" style={{ color: '#6B6B6B' }}>xinuco.app/{business.slug}</p>
                  </div>
                </div>
                <div
                  className="h-8 rounded-lg flex items-center justify-center text-xs font-semibold"
                  style={{ background: primary, color: bg }}
                >
                  Botón Primario
                </div>
              </div>

              {brandResult && (
                <div
                  role="alert"
                  className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs ${
                    brandResult.success
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                      : 'bg-red-500/10 border border-red-500/30 text-red-400'
                  }`}
                >
                  {brandResult.success ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                  {brandResult.success ? '¡Branding actualizado!' : brandResult.error}
                </div>
              )}

              <button
                type="button"
                onClick={handleSaveBranding}
                disabled={isBrandPending}
                id="btn-save-branding"
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all
                           disabled:opacity-60 hover:scale-[1.01] active:scale-95"
                style={{ background: 'var(--primary-color)', color: 'var(--bg-color)' }}
              >
                {isBrandPending ? <><Loader2 size={14} className="animate-spin" /> Guardando...</> : <>
                  <Palette size={14} /> Guardar Branding
                </>}
              </button>
            </div>
          )}

          {/* ── TAB: Estado ── */}
          {activeTab === 'status' && (
            <div className="p-5 space-y-4">
              {/* Métricas del tenant */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-xinuco-surface border border-xinuco-border rounded-xl p-4">
                  <p className="text-[10px] text-xinuco-muted uppercase tracking-wider">Creado</p>
                  <p className="text-sm font-semibold text-xinuco-text mt-1">
                    {new Date(business.created_at).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </p>
                </div>
                <div className="bg-xinuco-surface border border-xinuco-border rounded-xl p-4">
                  <p className="text-[10px] text-xinuco-muted uppercase tracking-wider">Slug</p>
                  <p className="text-sm font-semibold text-xinuco-text mt-1 font-mono">/{business.slug}</p>
                </div>
                <div className="bg-xinuco-surface border border-xinuco-border rounded-xl p-4">
                  <p className="text-[10px] text-xinuco-muted uppercase tracking-wider">Módulos activos</p>
                  <p className="text-2xl font-bold mt-1" style={{ color: 'var(--primary-color)' }}>
                    {Object.values(features as unknown as Record<string, boolean>).filter(Boolean).length}
                  </p>
                </div>
                <div className="bg-xinuco-surface border border-xinuco-border rounded-xl p-4">
                  <p className="text-[10px] text-xinuco-muted uppercase tracking-wider">Estado</p>
                  <p className={`text-sm font-semibold mt-1 ${isActive ? 'text-green-400' : 'text-red-400'}`}>
                    {isActive ? '● Activo' : '● Inactivo'}
                  </p>
                </div>
              </div>

              {/* Zona de peligro */}
              <div className="border border-red-500/20 rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-red-400 uppercase tracking-wider">Zona de Control</p>
                <p className="text-xs text-xinuco-muted">
                  {isActive
                    ? 'Desactivar este negocio impedirá que sus clientes accedan a la plataforma de reservas.'
                    : 'Activar este negocio restaurará el acceso completo a la plataforma para este tenant.'}
                </p>
                <button
                  type="button"
                  onClick={handleToggleStatus}
                  disabled={isStatusPending}
                  id="btn-toggle-tenant-status"
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold
                              transition-all disabled:opacity-60 hover:scale-[1.01] active:scale-95 border ${
                    isActive
                      ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                      : 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
                  }`}
                >
                  {isStatusPending
                    ? <><Loader2 size={14} className="animate-spin" /> Procesando...</>
                    : <><Power size={14} /> {isActive ? 'Desactivar Negocio' : 'Activar Negocio'}</>
                  }
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  )
}
