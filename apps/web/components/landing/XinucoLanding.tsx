'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  Scissors,
  ArrowRight,
  Building2,
  Zap,
  Shield,
  BarChart3,
  Calendar,
  Package,
  ChevronRight,
  Menu,
  X,
  Sparkles,
  Users,
  Globe,
  Lock,
  Crown,
  Star,
} from 'lucide-react'
import { PLAN_PRICES_COP } from '@xinuco/billing-catalog'

// ─── Brand colors ────────────────────────────────────────────────────────────
const CYAN     = '#00CFCF'
const BLUE     = '#1261FF'
const I_DOT    = CYAN        // Color oficial del puntico de la 'i' del wordmark
const NAVY     = '#0B132B'
const NAVY2    = '#0D1635'

// ─── Tipografía global ───────────────────────────────────────────────────────
// Sora SemiBold 0.12em — aplica a CTAs, precios, badges, stats
const SORA: React.CSSProperties = {
  fontFamily: 'var(--font-sora), Sora, sans-serif',
  fontWeight: 600,
  letterSpacing: '0.12em',
}
// Michroma — nombres de plan, headings de sección, ribbons
const MICHROMA: React.CSSProperties = {
  fontFamily: 'var(--font-michroma), Michroma, sans-serif',
  letterSpacing: '0.08em',
}

// ─── Xinuco Wordmark — Michroma + puntico custom ────────────────────────
// Renderiza "x[ı]nuco" con dotless i, y un cuadradito de color CYAN
// posicionado encima como el puntico oficial del logo.
// `size` controla el font-size en px del wordmark.
function XinucoWordmark({
  size = 56,
  className = '',
  taglineSize,
  showTagline = false,
}: {
  size?: number
  className?: string
  taglineSize?: number
  showTagline?: boolean
}) {
  return (
    <div className={`inline-flex flex-col items-stretch gap-2 ${className}`}>
      {/* Wordmark — define el ancho del bloque */}
      <div
        className="text-white leading-none flex items-baseline justify-center"
        style={{
          fontFamily: 'var(--font-michroma), Michroma, sans-serif',
          fontWeight: 600, // SemiBold
          fontSize: `${size}px`,
          letterSpacing: '0.12em',
          textTransform: 'lowercase',
        }}
      >
        <span>x</span>
        {/* "ı" (dotless i) con puntico custom CYAN encima */}
        <span style={{ position: 'relative', display: 'inline-block' }}>
          ı
          <span
            aria-hidden
            style={{
              position: 'absolute',
              bottom: '0.78em',
              left: '32%',
              transform: 'translateX(-50%)',
              width: '0.22em',
              height: '0.22em',
              background: I_DOT,
              borderRadius: '0.04em',
            }}
          />
        </span>
        <span>nuco</span>
      </div>
      {/* Tagline — width:100% del wordmark + justify para alinearlo de X a O */}
      {showTagline && (
        <p
          className="uppercase text-white/55 w-full"
          style={{
            fontFamily: 'var(--font-sora), Sora, sans-serif',
            fontSize: `${taglineSize ?? Math.max(9, size * 0.15)}px`,
            letterSpacing: '0.18em',
            textAlign: 'justify',
            textAlignLast: 'justify',
            MozTextAlignLast: 'justify',
          }}
        >
          Tecnología · Inteligencia · Impacto
        </p>
      )}
    </div>
  )
}

// ─── Xinuco Mark — imagen oficial del isotipo ─────────────────────────────────
// CSS mask radial: el centro (logo mark) es opaco, los bordes del PNG
// se disuelven suavemente → el fondo oscuro del PNG desaparece sin blending.
function XinucoMark({ size = 56 }: { size?: number }) {
  // El isotipo ocupa ~75% del área del PNG; la máscara cubre ese radio
  const fadeStart = Math.round(size * 0.44)  // inicio de fade (~44% del size)
  const fadeEnd   = Math.round(size * 0.54)  // borde totalmente transparente

  return (
    <Image
      src="https://rymlwtijbtokpqharrig.supabase.co/storage/v1/object/public/assets/landing/xinuco-isotipo.png"
      alt="Xinuco"
      width={size}
      height={size}
      className="object-contain"
      style={{
        maskImage: `radial-gradient(circle ${fadeStart}px at center, black 60%, transparent 100%)`,
        WebkitMaskImage: `radial-gradient(circle ${fadeEnd}px at center, black 60%, transparent 100%)`,
      }}
      priority
    />
  )
}

// ─── Gradient text helper ─────────────────────────────────────────────────────
function GradientText({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={className}
      style={{ background: `linear-gradient(135deg, ${CYAN}, ${BLUE})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
    >
      {children}
    </span>
  )
}

// ─── Navbar ───────────────────────────────────────────────────────────────────
function Navbar() {
  const [open, setOpen] = useState(false)

  const links = [
    { label: 'Inicio',     href: '#hero'       },
    { label: 'Verticales', href: '#verticales'  },
    { label: 'Precios',    href: '#precios'     },
    { label: 'Aliados',    href: '#aliados'     },
    { label: 'Nosotros',   href: '#nosotros'    },
  ]

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50"
      style={{
        background: `rgba(11,19,43,0.82)`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        boxShadow: '0 1px 32px rgba(0,0,0,0.35)',
      }}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-3.5">

        {/* ── Logo ── */}
        <a href="#hero" className="flex items-center gap-2.5 leading-none group">
          <XinucoMark size={36} />
          <XinucoWordmark size={17} />
        </a>

        {/* ── Desktop nav ── */}
        <nav className="hidden md:flex items-center gap-1">
          {links.map(l => (
            <a
              key={l.href}
              href={l.href}
              className="relative px-4 py-2 text-[13px] font-medium text-white/50 hover:text-white/90 rounded-lg transition-all duration-200 hover:bg-white/[0.04]"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* ── CTAs ── */}
        <div className="hidden md:flex items-center gap-2">
          {/* Portal Aliados — ghost pill */}
          <a
            href="#aliados"
            className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-xl transition-all duration-200"
            style={{
              color: CYAN,
              border: `1px solid ${CYAN}30`,
              background: `${CYAN}08`,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLAnchorElement).style.background = `${CYAN}14`
              ;(e.currentTarget as HTMLAnchorElement).style.borderColor = `${CYAN}55`
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLAnchorElement).style.background = `${CYAN}08`
              ;(e.currentTarget as HTMLAnchorElement).style.borderColor = `${CYAN}30`
            }}
          >
            <Lock size={11} />
            Portal Aliados
          </a>

          {/* Admin — gradient pill */}
          <a
            href="/admin/login"
            className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold text-white rounded-xl transition-all duration-200 hover:scale-[1.03] active:scale-[0.97]"
            style={{
              background: `linear-gradient(135deg, ${CYAN}, ${BLUE})`,
              boxShadow: `0 0 18px ${CYAN}30, 0 2px 8px rgba(0,0,0,0.3)`,
            }}
          >
            Admin
          </a>
        </div>

        {/* ── Mobile hamburger ── */}
        <button
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/[0.06] transition-all"
          onClick={() => setOpen(o => !o)}
          aria-label="Menú"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* ── Mobile menu ── */}
      {open && (
        <div
          className="md:hidden px-6 pb-5 pt-2 flex flex-col gap-1"
          style={{
            background: 'rgba(10,15,35,0.97)',
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          {links.map(l => (
            <a
              key={l.href}
              href={l.href}
              className="px-3 py-2.5 text-sm text-white/60 hover:text-white rounded-lg hover:bg-white/[0.04] transition-all"
              onClick={() => setOpen(false)}
            >
              {l.label}
            </a>
          ))}
          <div className="flex flex-col gap-2 mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <a
              href="#aliados"
              className="text-center py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ color: CYAN, border: `1px solid ${CYAN}35`, background: `${CYAN}08` }}
              onClick={() => setOpen(false)}
            >
              Portal Aliados
            </a>
            <a
              href="/admin/login"
              className="text-center py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: `linear-gradient(135deg, ${CYAN}, ${BLUE})` }}
              onClick={() => setOpen(false)}
            >
              Admin
            </a>
          </div>
        </div>
      )}
    </header>
  )
}

// ─── Phone mockup — tipos y helpers ──────────────────────────────────────────
type CitaItem  = { time: string; name: string; service: string; price: string; dot: string }
type NotifItem = { emoji: string; title: string; desc: string; time: string; accent: string }

function PhoneCitaRow({ cita, compact = false }: { cita: CitaItem; compact?: boolean }) {
  return (
    <div style={{
      margin: `0 14px ${compact ? 5 : 7}px`,
      background: 'rgba(255,255,255,0.025)',
      borderRadius: 10, padding: compact ? '6px 9px' : '7px 10px',
      border: '1px solid rgba(255,255,255,0.05)',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <p style={{ minWidth: 30, fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>{cita.time}</p>
      <div style={{ width: 2, height: 24, borderRadius: 99, background: cita.dot, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 10, fontWeight: 700, lineHeight: 1.2, marginBottom: 1 }}>{cita.name}</p>
        <p style={{ fontSize: 8, color: 'rgba(255,255,255,0.33)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cita.service}</p>
      </div>
      <p style={{ fontSize: 10, fontWeight: 700, flexShrink: 0, color: cita.dot.startsWith('rgba') ? 'rgba(255,255,255,0.3)' : cita.dot }}>{cita.price}</p>
    </div>
  )
}

function PhoneTabIcon({ icon, active }: { icon: string; active: boolean }) {
  const c = active ? CYAN : 'rgba(255,255,255,0.28)'
  const p: React.SVGProps<SVGSVGElement> = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none' }
  const l = { stroke: c, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (icon === 'home') return (
    <svg {...p}>
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" {...l}/>
      <polyline points="9 22 9 12 15 12 15 22" {...l}/>
    </svg>
  )
  if (icon === 'cal') return (
    <svg {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" {...l}/>
      <line x1="16" y1="2" x2="16" y2="6" {...l}/>
      <line x1="8" y1="2" x2="8" y2="6" {...l}/>
      <line x1="3" y1="10" x2="21" y2="10" {...l}/>
    </svg>
  )
  if (icon === 'cash') return (
    <svg {...p}>
      <rect x="2" y="5" width="20" height="14" rx="2" {...l}/>
      <line x1="2" y1="10" x2="22" y2="10" {...l}/>
    </svg>
  )
  return (
    <svg {...p}>
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" {...l}/>
      <path d="M13.73 21a2 2 0 01-3.46 0" {...l}/>
    </svg>
  )
}

// ─── Phone Dashboard UI — interactivo ─────────────────────────────────────────
// 4 tabs funcionales: Inicio · Agenda · Caja · Alertas
// Cada pestaña renderiza una pantalla distinta de la app de Xinuco Barbería.
function PhoneDashboardUI() {
  const [tab, setTab] = useState<'inicio' | 'agenda' | 'caja' | 'notif'>('inicio')

  const CITAS: CitaItem[] = [
    { time: '9:00',  name: 'Sebastián R.', service: 'Corte + Barba',  price: '$40k', dot: '#22C55E' },
    { time: '10:30', name: 'Miguel A.',     service: 'Fade bajo',       price: '$25k', dot: '#22C55E' },
    { time: '12:00', name: 'Juan C.',       service: 'Barba completa',  price: '$20k', dot: '#F59E0B' },
    { time: '14:00', name: 'Pedro L.',      service: 'Corte clásico',   price: '$30k', dot: 'rgba(255,255,255,0.18)' },
    { time: '16:30', name: 'Andrés M.',     service: 'Corte + diseño',  price: '$35k', dot: '#7EB3FF' },
  ]

  const NOTIFS: NotifItem[] = [
    { emoji: '📅', title: 'Nueva cita',     desc: 'Sebastián · 9:00 am',  time: 'hace 2 min',  accent: CYAN      },
    { emoji: '💳', title: 'Pago recibido',  desc: '$45.000 COP',           time: 'hace 15 min', accent: '#22C55E' },
    { emoji: '⭐', title: 'Reseña nueva',   desc: 'Diego · 5.0 ★★★★★',   time: 'hace 1 h',    accent: '#F59E0B' },
    { emoji: '📅', title: 'Cita cancelada', desc: 'Marco · 11:00 am',      time: 'hace 2 h',    accent: '#EF4444' },
    { emoji: '💳', title: 'Pago recibido',  desc: '$25.000 COP',           time: 'ayer',         accent: '#22C55E' },
  ]

  const TABS = [
    { key: 'inicio' as const, label: 'Inicio',  icon: 'home' },
    { key: 'agenda' as const, label: 'Agenda',  icon: 'cal'  },
    { key: 'caja'   as const, label: 'Caja',    icon: 'cash' },
    { key: 'notif'  as const, label: 'Alertas', icon: 'bell' },
  ]

  const DAYS: [string, string, boolean][] = [
    ['L','26',false],['M','27',false],['X','28',true],['J','29',false],['V','30',false],
  ]

  // ── Pantalla Inicio ──────────────────────────────────────────────────────
  const screenInicio = (
    <>
      <div style={{ padding: '4px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Buenos días</p>
          <p style={{ fontSize: 13, fontWeight: 700 }}>Carlos Mendoza</p>
        </div>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: `linear-gradient(135deg, ${CYAN}, ${BLUE})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800 }}>CM</div>
      </div>
      <div style={{ padding: '0 16px 10px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: CYAN, background: `${CYAN}14`, padding: '4px 10px', borderRadius: 99, border: `1px solid ${CYAN}28` }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: CYAN, display: 'inline-block' }} />
          Mié 28 May · 5 citas hoy
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '0 14px 12px' }}>
        <div style={{ flex: 1, borderRadius: 11, padding: '8px 11px', background: `linear-gradient(135deg, ${CYAN}18, ${BLUE}14)`, border: `1px solid ${CYAN}28` }}>
          <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>Hoy</p>
          <p style={{ fontSize: 15, fontWeight: 800, color: CYAN, lineHeight: 1 }}>$150k</p>
          <p style={{ fontSize: 8, color: `${CYAN}99`, marginTop: 2 }}>3 de 5 cobrados</p>
        </div>
        <div style={{ flex: 1, borderRadius: 11, padding: '8px 11px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>Semana</p>
          <p style={{ fontSize: 15, fontWeight: 800, color: '#7EB3FF', lineHeight: 1 }}>$420k</p>
          <p style={{ fontSize: 8, color: 'rgba(126,179,255,0.55)', marginTop: 2 }}>↑ 12% vs ant.</p>
        </div>
      </div>
      <div style={{ padding: '0 14px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Agenda de hoy</p>
        <button onClick={() => setTab('agenda')} style={{ fontSize: 9, color: CYAN, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Ver todo →</button>
      </div>
      {CITAS.slice(0, 3).map((c, i) => <PhoneCitaRow key={i} cita={c} />)}
      <button onClick={() => setTab('agenda')} style={{ display: 'block', margin: '3px auto 0', fontSize: 9, color: 'rgba(255,255,255,0.28)', background: 'none', border: 'none', cursor: 'pointer' }}>
        +2 citas más →
      </button>
    </>
  )

  // ── Pantalla Agenda ──────────────────────────────────────────────────────
  const screenAgenda = (
    <>
      <div style={{ padding: '6px 14px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: 14, fontWeight: 800 }}>Agenda</p>
        <span style={{ fontSize: 9, color: CYAN, background: `${CYAN}14`, padding: '3px 8px', borderRadius: 99 }}>Hoy</span>
      </div>
      <div style={{ display: 'flex', gap: 5, padding: '0 14px 12px' }}>
        {DAYS.map(([d, n, active]) => (
          <div key={n} style={{ flex: 1, textAlign: 'center', padding: '5px 2px', borderRadius: 9, background: active ? `linear-gradient(135deg, ${CYAN}, ${BLUE})` : 'rgba(255,255,255,0.04)', border: `1px solid ${active ? 'transparent' : 'rgba(255,255,255,0.06)'}` }}>
            <p style={{ fontSize: 8, color: active ? 'white' : 'rgba(255,255,255,0.4)', marginBottom: 2 }}>{d}</p>
            <p style={{ fontSize: 12, fontWeight: 700, color: active ? 'white' : 'rgba(255,255,255,0.6)' }}>{n}</p>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: 4 }}>
        {CITAS.map((c, i) => <PhoneCitaRow key={i} cita={c} compact />)}
      </div>
    </>
  )

  // ── Pantalla Caja ────────────────────────────────────────────────────────
  const screenCaja = (
    <>
      <div style={{ padding: '6px 14px 8px' }}>
        <p style={{ fontSize: 14, fontWeight: 800 }}>Caja</p>
        <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>Miércoles 28 de mayo</p>
      </div>
      <div style={{ margin: '0 14px 12px', borderRadius: 14, padding: '14px', background: `linear-gradient(135deg, ${CYAN}22, ${BLUE}18)`, border: `1px solid ${CYAN}35`, textAlign: 'center' }}>
        <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Total del día</p>
        <p style={{ fontSize: 28, fontWeight: 900, color: CYAN, lineHeight: 1, letterSpacing: '-0.02em' }}>$150k</p>
        <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>5 servicios · 3 cobrados</p>
      </div>
      <div style={{ padding: '0 14px', marginBottom: 12 }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 9 }}>Desglose</p>
        {([
          { label: 'Cortes',  amount: '$90k', pct: 60, color: CYAN      },
          { label: 'Barbas',  amount: '$40k', pct: 27, color: '#7EB3FF' },
          { label: 'Diseños', amount: '$20k', pct: 13, color: BLUE      },
        ] as const).map(item => (
          <div key={item.label} style={{ marginBottom: 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>{item.label}</p>
              <p style={{ fontSize: 9, fontWeight: 700, color: item.color }}>{item.amount}</p>
            </div>
            <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.07)' }}>
              <div style={{ height: '100%', borderRadius: 99, width: `${item.pct}%`, background: item.color }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: '0 14px' }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 7 }}>Pagos recientes</p>
        {[
          { name: 'Sebastián R.', amt: '+$40k' },
          { name: 'Miguel A.',    amt: '+$25k' },
        ].map((t, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>{t.name}</p>
            <p style={{ fontSize: 11, fontWeight: 800, color: '#22C55E' }}>{t.amt}</p>
          </div>
        ))}
      </div>
    </>
  )

  // ── Pantalla Alertas ─────────────────────────────────────────────────────
  const screenNotif = (
    <>
      <div style={{ padding: '6px 14px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: 14, fontWeight: 800 }}>Notificaciones</p>
        <span style={{ fontSize: 8, background: '#EF444428', color: '#EF4444', padding: '2px 8px', borderRadius: 99, fontWeight: 700 }}>3 nuevas</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {NOTIFS.map((n, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: i < 3 ? `${n.accent}07` : 'transparent' }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, background: `${n.accent}18`, border: `1px solid ${n.accent}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{n.emoji}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: 'white' }}>{n.title}</p>
                <p style={{ fontSize: 8, color: 'rgba(255,255,255,0.28)', marginLeft: 4, flexShrink: 0 }}>{n.time}</p>
              </div>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>{n.desc}</p>
            </div>
            {i < 3 && <div style={{ width: 6, height: 6, borderRadius: '50%', background: n.accent, flexShrink: 0, marginTop: 3 }} />}
          </div>
        ))}
      </div>
    </>
  )

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#07101E', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-sora), Sora, system-ui, sans-serif', overflow: 'hidden', color: 'white' }}>
      {/* Espacio bajo Dynamic Island */}
      <div style={{ height: 54, flexShrink: 0 }} />

      {/* Área de contenido — cada pantalla ocupa flex:1 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        {tab === 'inicio' && screenInicio}
        {tab === 'agenda' && screenAgenda}
        {tab === 'caja'   && screenCaja}
        {tab === 'notif'  && screenNotif}
      </div>

      {/* Bottom navigation */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '8px 0 18px', background: 'rgba(7,16,30,0.98)', flexShrink: 0 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 10px', position: 'relative' }}
          >
            {/* Badge de notificaciones sin leer */}
            {t.key === 'notif' && (
              <span style={{ position: 'absolute', top: 0, right: 6, width: 7, height: 7, borderRadius: '50%', background: '#EF4444', border: '1.5px solid #07101E' }} />
            )}
            <PhoneTabIcon icon={t.icon} active={tab === t.key} />
            <p style={{ fontSize: 8, color: tab === t.key ? CYAN : 'rgba(255,255,255,0.25)', fontWeight: tab === t.key ? 700 : 400 }}>{t.label}</p>
            {/* Indicador activo */}
            {tab === t.key && (
              <div style={{ position: 'absolute', bottom: -1, width: 16, height: 2, borderRadius: 99, background: CYAN }} />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Sprint 2 helpers — scroll reveal + contadores + grano ───────────────────

/** Detecta cuando el elemento entra al viewport. Dispara una sola vez. */
function useInView(threshold = 0.14) {
  const ref  = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect() } },
      { threshold },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return { ref, inView }
}

/** Wrapper que hace fade-up al entrar al viewport. */
function FadeUp({
  children, delay = 0, className = '',
}: { children: React.ReactNode; delay?: number; className?: string }) {
  const { ref, inView } = useInView()
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity:    inView ? 1 : 0,
        transform:  inView ? 'translateY(0)' : 'translateY(22px)',
        transition: `opacity 0.65s ease ${delay}ms, transform 0.65s ease ${delay}ms`,
        willChange: 'opacity, transform',
      }}
    >
      {children}
    </div>
  )
}

/** Cuenta de 0 al valor `to` con ease-out cuando entra al viewport. */
function AnimatedCounter({ to, suffix = '', duration = 1600 }: { to: number; suffix?: string; duration?: number }) {
  const { ref, inView } = useInView(0.5)
  const [count, setCount] = useState(0)
  const started = useRef(false)
  useEffect(() => {
    if (!inView || started.current) return
    started.current = true
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)   // ease-out cubic
      setCount(Math.round(eased * to))
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [inView, to, duration])
  return <span ref={ref}>{count}{suffix}</span>
}

/** Overlay de ruido/grano sobre toda la página. SVG inline, sin carga extra. */
function GrainOverlay() {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.78' numOctaves='4' stitchTiles='stitch'/></filter><rect width='220' height='220' filter='url(%23n)' opacity='1'/></svg>`
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[999]"
      style={{
        backgroundImage: `url("data:image/svg+xml,${svg}")`,
        backgroundRepeat: 'repeat',
        opacity: 0.032,
        mixBlendMode: 'overlay',
      }}
    />
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
type LandingStats = { citasTotal: number; barberias: number; clientes: number }

function Hero({ stats }: { stats: LandingStats }) {
  return (
    <section
      id="hero"
      className="relative min-h-screen flex items-center px-6 pt-24 pb-16 overflow-hidden"
      style={{ background: NAVY }}
    >
      {/* Background glows */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-0 right-0 w-[700px] h-[600px] rounded-full opacity-15 blur-3xl"
          style={{ background: `radial-gradient(ellipse, ${CYAN}, transparent 65%)` }}
        />
        <div
          className="absolute bottom-0 left-0 w-[500px] h-[400px] rounded-full opacity-12 blur-3xl"
          style={{ background: `radial-gradient(ellipse, ${BLUE}, transparent 65%)` }}
        />
        {/* Dot grid */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.035]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="dots" width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.5" fill="white"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)"/>
        </svg>
      </div>

      {/* Two-column layout */}
      <div className="relative z-10 max-w-6xl mx-auto w-full grid md:grid-cols-2 gap-16 items-center">

        {/* ══ Columna izquierda ══ */}
        <div className="flex flex-col items-center gap-8 text-center">

          {/* Badge */}
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border"
            style={{ borderColor: `${CYAN}50`, background: `${CYAN}10`, color: CYAN, ...SORA, fontSize: 11 }}
          >
            <Sparkles size={11} />
            Software IA para barberías LATAM
          </div>

          {/* Logo — componentes nítidos (vector/font) en lugar de PNG raster */}
          <div className="relative flex flex-col items-center gap-5 py-4">
            {/* Halo de brillo radial detrás */}
            <div
              className="absolute pointer-events-none"
              style={{
                width: '110%', height: '130%',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                background: `radial-gradient(ellipse at center, ${CYAN}28 0%, ${BLUE}18 42%, transparent 70%)`,
                filter: 'blur(48px)',
              }}
            />

            {/* Isotipo — PNG separado, mucho más pequeño → no pixela */}
            <div className="relative z-10">
              <XinucoMark size={172} />
            </div>

            {/* Wordmark — 100% CSS / Michroma font → infinitamente nítido */}
            <XinucoWordmark
              size={58}
              showTagline
              taglineSize={10}
              className="relative z-10"
            />
          </div>

          {/* Descripción */}
          <p className="text-base md:text-lg text-white/55 leading-relaxed max-w-sm">
            De la primera cita al cierre de caja — un solo sistema que{' '}
            <GradientText>gestiona tu agenda, paga a tu equipo</GradientText>{' '}
            y protege cada peso de tu negocio.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
            <a
              href="#aliados"
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-white w-full sm:w-auto transition-all hover:scale-105 active:scale-95"
              style={{
                ...SORA,
                fontSize: 13,
                background: `linear-gradient(135deg, ${CYAN}, ${BLUE})`,
                boxShadow: `0 0 32px ${CYAN}45, 0 4px 16px rgba(0,0,0,0.4)`,
              }}
            >
              Empieza hoy <ArrowRight size={15} />
            </a>
            <a
              href="#precios"
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-white/65 hover:text-white w-full sm:w-auto border border-white/10 hover:border-white/25 transition-all"
              style={{ ...SORA, fontSize: 12 }}
            >
              Ver planes <ChevronRight size={15} />
            </a>
          </div>

          {/* Stats — contadores animados */}
          <div className="flex items-center gap-0 pt-4 border-t border-white/8 w-full justify-center">
            {[
              { to: stats.citasTotal, suffix: '+', label: 'Citas registradas' },
              { to: stats.barberias,  suffix: '',  label: 'Barberías activas' },
              { to: stats.clientes,   suffix: '+', label: 'Clientes únicos'   },
            ].map((s, i) => (
              <div key={s.label} className="flex items-center">
                {i > 0 && <div className="w-px h-8 bg-white/10 mx-6" />}
                <div className="text-center">
                  <p className="text-xl leading-none" style={{ color: CYAN, ...SORA }}>
                    <AnimatedCounter to={s.to} suffix={s.suffix} />
                  </p>
                  <p className="text-[10px] text-white/35 mt-1 uppercase tracking-widest">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Trust strip */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
            {['Sin contratos', 'Soporte en español', 'Datos en Colombia'].map((t, i) => (
              <span key={t} className="flex items-center gap-1.5 text-[11px] text-white/30">
                {i > 0 && <span className="text-white/15 hidden sm:inline">·</span>}
                <span
                  className="w-1 h-1 rounded-full flex-shrink-0"
                  style={{ background: CYAN }}
                />
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* ══ Columna derecha: celular ══ */}
        <div className="flex justify-center items-center">
          {/* Todo el grupo (teléfono + tarjetas) flota como una unidad */}
          <div
            className="relative"
            style={{ animation: 'phoneFloat 3.5s ease-in-out infinite' }}
          >
            {/* Halo pulsante detrás del teléfono */}
            <div
              className="absolute pointer-events-none"
              style={{
                width: 360, height: 500,
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                background: `radial-gradient(ellipse at center, ${BLUE}55 0%, ${CYAN}30 40%, transparent 70%)`,
                filter: 'blur(48px)',
                animation: 'glowPulse 2.5s ease-in-out infinite',
              }}
            />

            {/* Reflejo sutil en el suelo */}
            <div
              className="absolute -bottom-8 left-1/2 -translate-x-1/2 pointer-events-none"
              style={{
                width: 200, height: 40,
                background: `radial-gradient(ellipse, ${CYAN}40, transparent 70%)`,
                filter: 'blur(16px)',
              }}
            />

            {/* Marco del teléfono */}
            <div
              className="relative rounded-[2.8rem] overflow-hidden"
              style={{
                width: 285,
                height: 616,
                background: '#07101E',
                border: '1.5px solid rgba(255,255,255,0.18)',
                boxShadow: [
                  '0 48px 96px rgba(0,0,0,0.7)',
                  '0 0 0 1px rgba(255,255,255,0.06)',
                  'inset 0 1px 0 rgba(255,255,255,0.12)',
                  `0 0 60px ${BLUE}30`,
                ].join(', '),
              }}
            >
              {/* Dynamic Island */}
              <div
                className="absolute top-4 left-1/2 -translate-x-1/2 z-10 rounded-full"
                style={{ width: 96, height: 28, background: '#000' }}
              />
              {/* Pantalla — UI real del dashboard */}
              <PhoneDashboardUI />
              {/* Brillo de pantalla (reflejo superior) */}
              <div
                className="absolute top-0 left-0 right-0 h-40 pointer-events-none z-20"
                style={{
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 100%)',
                  borderRadius: '2.8rem 2.8rem 0 0',
                }}
              />
            </div>

            {/* Botones laterales */}
            <div className="absolute top-24 -right-[3px] rounded-full" style={{ width: 3, height: 56, background: 'rgba(255,255,255,0.2)' }} />
            <div className="absolute top-32 -left-[3px] rounded-full" style={{ width: 3, height: 36, background: 'rgba(255,255,255,0.15)' }} />
            <div className="absolute top-44 -left-[3px] rounded-full" style={{ width: 3, height: 36, background: 'rgba(255,255,255,0.15)' }} />

          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-white/20 animate-bounce">
        <span className="text-xs tracking-widest uppercase">Scroll</span>
        <ChevronRight size={14} className="rotate-90" />
      </div>
    </section>
  )
}

// ─── Verticales ───────────────────────────────────────────────────────────────
const VERTICALES = [
  {
    icon: <Scissors size={26} />,
    name: 'Barbería',
    slug: 'barberia',
    tagline: 'Ya disponible',
    description: 'Agenda online, caja registradora, comisiones automáticas y programa de lealtad. Todo lo que necesita tu barbería, desde el día 1.',
    status: 'active' as const,
    features: ['Reservas online 24/7', 'Liquidación de comisiones', 'Bot WhatsApp anti-ausencias', 'Punto de venta integrado', 'Programa de lealtad'],
    color: '#C5A059',
  },
  {
    icon: <Building2 size={26} />,
    name: 'Lavandería',
    slug: 'lavanderia',
    tagline: 'Próximamente',
    description: 'Control de órdenes, seguimiento en tiempo real y facturación automática para lavanderías que quieren dejar el cuaderno atrás.',
    status: 'soon' as const,
    features: ['Órdenes digitales', 'Seguimiento por estado', 'Facturación automática'],
    color: CYAN,
  },
  {
    icon: <Zap size={26} />,
    name: 'Fumigación',
    slug: 'fumigacion',
    tagline: 'Próximamente',
    description: 'Programación de visitas, rutas optimizadas y reportes PDF para empresas de control de plagas que manejan múltiples clientes.',
    status: 'soon' as const,
    features: ['Programación de visitas', 'Rutas optimizadas', 'Reportes PDF'],
    color: BLUE,
  },
]

function Verticales() {
  return (
    <section
      id="verticales"
      className="py-24 px-6"
      style={{ background: `linear-gradient(180deg, ${NAVY} 0%, ${NAVY2} 100%)` }}
    >
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <FadeUp className="text-center mb-16">
          <p
            className="text-[11px] uppercase mb-3"
            style={{ color: CYAN, ...SORA, letterSpacing: '0.3em' }}
          >
            Verticales de negocio
          </p>
          <h2
            className="text-3xl md:text-5xl font-bold text-white"
            style={{ fontFamily: 'var(--font-sora), Sora, sans-serif' }}
          >
            Empieza en barberías.{' '}
            <GradientText>Escala a un ecosistema.</GradientText>
          </h2>
          <p className="mt-4 text-white/50 text-lg max-w-2xl mx-auto">
            El mismo núcleo tecnológico adaptado a cada industria.
            Un sistema que crece contigo.
          </p>
        </FadeUp>

        {/* Cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {VERTICALES.map((v, i) => {
            const isActive = v.status === 'active'
            return (
              <FadeUp key={v.slug} delay={i * 120} className="flex flex-col">
                <div
                  className="relative rounded-2xl overflow-hidden border flex-1 flex flex-col transition-all duration-300 hover:-translate-y-1"
                  style={{
                    background: isActive
                      ? `linear-gradient(160deg, #0f1c30 0%, #07101e 100%)`
                      : NAVY2,
                    borderColor: isActive ? `${v.color}35` : 'rgba(255,255,255,0.06)',
                    boxShadow: isActive ? `0 0 48px ${v.color}14, 0 2px 0 ${v.color}40 inset` : 'none',
                  }}
                >
                  {/* Stripe superior de color */}
                  <div
                    className="absolute top-0 left-0 right-0 h-[2px]"
                    style={{
                      background: isActive
                        ? `linear-gradient(90deg, transparent, ${v.color}, transparent)`
                        : 'transparent',
                    }}
                  />

                  <div className="p-6 flex flex-col flex-1">
                    {/* Badge de estado */}
                    <div className="flex items-center justify-between mb-5">
                      {/* Icon */}
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center"
                        style={{
                          background: `${v.color}16`,
                          color: v.color,
                          border: `1px solid ${v.color}28`,
                        }}
                      >
                        {v.icon}
                      </div>

                      <span
                        className="text-[10px] px-2.5 py-1 rounded-full"
                        style={
                          isActive
                            ? { background: `${v.color}20`, color: v.color, ...SORA, fontSize: 9 }
                            : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)', ...SORA, fontSize: 9 }
                        }
                      >
                        {v.tagline.toUpperCase()}
                      </span>
                    </div>

                    <h3
                      className="text-xl text-white mb-2"
                      style={{ ...MICHROMA, fontSize: 18 }}
                    >
                      {v.name}
                    </h3>
                    <p className="text-white/48 text-sm leading-relaxed mb-5 flex-1">{v.description}</p>

                    {/* Features */}
                    <ul className="flex flex-col gap-2 mb-5">
                      {v.features.map(f => (
                        <li key={f} className="flex items-center gap-2.5 text-sm" style={{ color: isActive ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.35)' }}>
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ background: isActive ? v.color : 'rgba(255,255,255,0.2)' }}
                          />
                          {f}
                        </li>
                      ))}
                    </ul>

                    {/* CTA */}
                    {isActive ? (
                      <a
                        href="#aliados"
                        className="mt-auto flex items-center gap-2 text-sm transition-colors hover:opacity-80"
                        style={{ color: v.color, ...SORA, fontSize: 11 }}
                      >
                        Acceder como aliado <ArrowRight size={13} />
                      </a>
                    ) : (
                      <p className="mt-auto text-[11px] text-white/25 italic">
                        Sé el primero en enterarte cuando esté disponible →{' '}
                        <a href="mailto:hola@xinuco.com" className="underline underline-offset-2 hover:text-white/50 transition-colors">
                          hola@xinuco.com
                        </a>
                      </p>
                    )}
                  </div>
                </div>
              </FadeUp>
            )
          })}
        </div>

        {/* Bottom strip */}
        <FadeUp delay={360} className="mt-10 text-center">
          <p className="text-sm text-white/30">
            ¿Tu industria no está aquí?{' '}
            <a
              href="mailto:hola@xinuco.com"
              className="text-white/50 hover:text-white underline underline-offset-2 transition-colors"
            >
              Cuéntanos tu caso
            </a>{' '}
            — evaluamos nuevas verticales cada trimestre.
          </p>
        </FadeUp>
      </div>
    </section>
  )
}

// ─── Features ─────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: <Calendar size={22} />,
    num: '01',
    title: 'Agenda que trabaja por ti',
    desc: 'Citas online 24/7, confirmaciones automáticas y cero doble-reservas. Tu cliente agenda mientras duermes.',
    color: CYAN,
  },
  {
    icon: <BarChart3 size={22} />,
    num: '02',
    title: 'Cierre de mes sin sorpresas',
    desc: 'P&G, comisiones del equipo y flujo de caja en tiempo real. Un clic — no una tarde de hojas de cálculo.',
    color: '#6366F1',
  },
  {
    icon: <Users size={22} />,
    num: '03',
    title: 'Tu equipo, en orden',
    desc: 'Liquidación automática de comisiones. Sin peleas de fin de mes, sin errores, sin excusas.',
    color: '#10B981',
  },
  {
    icon: <Package size={22} />,
    num: '04',
    title: 'Punto de venta integrado',
    desc: 'Vende servicios y productos desde la misma pantalla. Stock, caja y reportes siempre sincronizados.',
    color: '#F59E0B',
  },
  {
    icon: <Globe size={22} />,
    num: '05',
    title: 'WhatsApp que recupera dinero',
    desc: 'Bot anti-ausencias que confirma citas y avisa cuando alguien cancela. Menos "no shows", más ingresos.',
    color: '#22C55E',
  },
  {
    icon: <Shield size={22} />,
    num: '06',
    title: 'Anti-robo hormiga',
    desc: 'Auditoría inmutable y seguridad por local (RLS). Cada peso que entra o sale queda registrado para siempre.',
    color: '#EF4444',
  },
]

function Features() {
  return (
    <section className="py-24 px-6" style={{ background: NAVY2 }}>
      <div className="max-w-6xl mx-auto">

        <FadeUp className="text-center mb-14">
          <p
            className="text-[11px] uppercase mb-3"
            style={{ color: BLUE, ...SORA, letterSpacing: '0.3em' }}
          >
            Por qué Xinuco
          </p>
          <h2
            className="text-3xl md:text-4xl font-bold text-white"
            style={{ fontFamily: 'var(--font-sora), Sora, sans-serif' }}
          >
            Todo lo que tu negocio necesita,{' '}
            <GradientText>en un solo lugar</GradientText>
          </h2>
          <p className="mt-4 text-white/45 text-base max-w-xl mx-auto">
            Sin integraciones de terceros, sin hojas de cálculo paralelas.
            Un sistema que lo hace todo.
          </p>
        </FadeUp>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <FadeUp key={f.title} delay={i * 80}>
              <div
                className="group relative p-6 rounded-2xl border transition-all duration-300 hover:-translate-y-0.5 h-full flex flex-col"
                style={{
                  background: 'rgba(255,255,255,0.018)',
                  borderColor: 'rgba(255,255,255,0.06)',
                }}
              >
                {/* Glow on hover via pseudo-element simulation */}
                <div
                  className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                  style={{ boxShadow: `0 0 32px ${f.color}18`, border: `1px solid ${f.color}25` }}
                />

                {/* Número + icono */}
                <div className="flex items-start justify-between mb-4">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background: `${f.color}16`,
                      color: f.color,
                      border: `1px solid ${f.color}28`,
                    }}
                  >
                    {f.icon}
                  </div>
                  <span
                    className="text-[10px] tabular-nums"
                    style={{ color: 'rgba(255,255,255,0.18)', ...SORA, fontSize: 10 }}
                  >
                    {f.num}
                  </span>
                </div>

                <h4
                  className="text-white mb-2"
                  style={{ fontFamily: 'var(--font-sora), Sora, sans-serif', fontWeight: 600, fontSize: 15 }}
                >
                  {f.title}
                </h4>
                <p className="text-white/42 text-sm leading-relaxed flex-1">{f.desc}</p>
              </div>
            </FadeUp>
          ))}
        </div>

        {/* Bridge to pricing */}
        <FadeUp delay={500} className="mt-10 text-center">
          <a
            href="#precios"
            className="inline-flex items-center gap-2 text-sm transition-colors"
            style={{ color: 'rgba(255,255,255,0.35)', ...SORA, fontSize: 11 }}
          >
            <span className="hover:text-white/60 transition-colors">
              Ver qué incluye cada plan <ChevronRight size={13} className="inline -mt-px" />
            </span>
          </a>
        </FadeUp>
      </div>
    </section>
  )
}

// ─── Precios ──────────────────────────────────────────────────────────────────

// Solo display — NUNCA usados en cálculos de billing real
function fmtCOP(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  }).format(n)
}

type BillingPeriod = 'mensual' | 'semestral' | 'anual'

const PLAN_ICONS: Record<string, React.ReactNode> = {
  esencial:    <Zap    size={16} />,
  profesional: <Star   size={16} />,
  elite:       <Crown  size={16} />,
}

// Tabla de comparación detallada (accordion)
const FEATURE_ROWS: { label: string; cat: string; esencial: boolean; profesional: boolean; elite: boolean }[] = [
  { label: 'Agenda + Citas Core (24/7)',      cat: 'Base',          esencial: true,  profesional: true,  elite: true  },
  { label: 'CRM — Expediente de clientes',    cat: 'Base',          esencial: true,  profesional: true,  elite: true  },
  { label: 'MP — Caja POS presencial',        cat: 'Pagos',         esencial: true,  profesional: true,  elite: true  },
  { label: 'Comisiones automáticas',          cat: 'Finanzas',      esencial: false, profesional: true,  elite: true  },
  { label: 'Billetera Staff',                 cat: 'Finanzas',      esencial: false, profesional: true,  elite: true  },
  { label: 'Gastos & P&G',                    cat: 'Finanzas',      esencial: false, profesional: true,  elite: true  },
  { label: 'Ventas Retail',                   cat: 'Finanzas',      esencial: false, profesional: true,  elite: true  },
  { label: 'Reportes financieros avanzados',  cat: 'Finanzas',      esencial: false, profesional: true,  elite: true  },
  { label: 'Control de estaciones',           cat: 'Operaciones',   esencial: false, profesional: true,  elite: true  },
  { label: 'Confirmaciones por Email',        cat: 'Comunicación',  esencial: false, profesional: true,  elite: true  },
  { label: 'MP — Pago online al reservar',    cat: 'Pagos',         esencial: false, profesional: true,  elite: true  },
  { label: 'Bot WhatsApp anti-ausencias',     cat: 'Comunicación',  esencial: false, profesional: false, elite: true  },
  { label: 'Programa de Lealtad',             cat: 'Marketing',     esencial: false, profesional: false, elite: true  },
  { label: 'Walk-ins (cola sin cita)',         cat: 'Operaciones',   esencial: false, profesional: false, elite: true  },
  { label: 'Auditoría inmutable',              cat: 'Compliance',    esencial: false, profesional: false, elite: true  },
  { label: 'Activos Fijos & depreciación',    cat: 'Compliance',    esencial: false, profesional: false, elite: true  },
  { label: 'Inventario de productos',         cat: 'Operaciones',   esencial: false, profesional: false, elite: true  },
]

const PRICING_CARDS: {
  key: string; name: string; desc: string
  price: number; color: string; highlight: boolean; badge: string | null
  cta: string; ctaHref: string
  sectionLabel: string; features: string[]
}[] = [
  {
    key: 'esencial', name: 'Esencial',
    desc: 'Para el barbero que da el primer paso hacia la digitalización.',
    price: PLAN_PRICES_COP.esencial, color: '#A1A1AA',
    highlight: false, badge: null,
    cta: 'Organiza tu negocio', ctaHref: '#aliados',
    sectionLabel: 'Incluye',
    features: ['Agenda + Citas Core (24 / 7)', 'CRM — Base de clientes', 'Caja registradora / MP POS'],
  },
  {
    key: 'profesional', name: 'Profesional',
    desc: 'El CFO virtual de tu barbería. Liquida la nómina del equipo en segundos.',
    price: PLAN_PRICES_COP.profesional, color: CYAN,
    highlight: true, badge: 'EL MÁS ELEGIDO',
    cta: 'Asume el control hoy', ctaHref: '#aliados',
    sectionLabel: 'Todo Esencial, más:',
    features: [
      'Comisiones automáticas del equipo',
      'Gastos & P&G — estado de resultados',
      'Ventas Retail — productos sin cita',
      'Reportes financieros avanzados',
      'Notificaciones por Email',
      'Reserva con pago online (MP)',
    ],
  },
  {
    key: 'elite', name: 'Élite',
    desc: 'Paz mental y marketing automático para cadenas y alto tráfico.',
    price: PLAN_PRICES_COP.elite, color: '#C5A059',
    highlight: false, badge: null,
    cta: 'Domina el mercado', ctaHref: '#aliados',
    sectionLabel: 'Todo Profesional, más:',
    features: [
      'Bot WhatsApp anti-ausencias',
      'Auditoría inmutable (anti-robo hormiga)',
      'Programa de Lealtad',
      'Inventario de productos',
      'Activos Fijos & depreciación',
      'Walk-ins — cola sin cita',
    ],
  },
]

function Pricing() {
  const [billing, setBilling]     = useState<BillingPeriod>('mensual')
  const [matrixOpen, setMatrix]   = useState(false)

  const TOGGLE: { val: BillingPeriod; label: string; badge: string | null }[] = [
    { val: 'mensual',   label: 'Mensual',   badge: null },
    { val: 'semestral', label: 'Semestral', badge: null },
    { val: 'anual',     label: 'Anual',     badge: 'Ahorra 2 meses + Onboarding VIP' },
  ]

  function displayPrice(base: number) {
    if (billing === 'anual') return Math.round((base * 10) / 12)
    return base
  }

  function noteText(base: number): { main: string; sub: string | null; green: boolean } {
    if (billing === 'mensual')
      return { main: 'Cobro mensual · sin permanencia', sub: null, green: false }
    if (billing === 'semestral')
      return { main: `Total semestral: ${fmtCOP(base * 6)} · 1 sola factura`, sub: null, green: false }
    return {
      main:  `Pago único: ${fmtCOP(base * 10)}`,
      sub:   'Paga 10 meses, llévate 12 · Onboarding VIP incluido',
      green: true,
    }
  }

  return (
    <section
      id="precios"
      className="py-24 px-6"
      style={{ background: `linear-gradient(180deg, ${NAVY2} 0%, ${NAVY} 100%)` }}
    >
      <div className="max-w-6xl mx-auto">

        {/* ── Header ── */}
        <FadeUp className="text-center mb-14">
          <p className="text-xs font-semibold tracking-[0.3em] uppercase mb-3" style={{ color: CYAN }}>
            Planes
          </p>
          <h2
            className="text-3xl md:text-5xl font-bold text-white mb-4"
            style={{ fontFamily: 'var(--font-michroma), Michroma, sans-serif' }}
          >
            Precios <GradientText>transparentes</GradientText>
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto mb-10">
            Sin sorpresas ni contratos. Cancela cuando quieras.
          </p>

          {/* Toggle */}
          <div
            className="inline-flex items-center gap-1 p-1 rounded-full"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {TOGGLE.map(opt => (
              <button
                key={opt.val}
                onClick={() => setBilling(opt.val)}
                className="relative flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-all duration-200"
                style={{
                  ...SORA,
                  ...(billing === opt.val
                    ? { background: `linear-gradient(135deg, ${CYAN}35, ${BLUE}35)`, color: 'white', border: `1px solid ${CYAN}45` }
                    : { color: 'rgba(255,255,255,0.38)', border: '1px solid transparent' }),
                }}
              >
                {opt.label}
                {opt.badge && (
                  <span
                    className="text-[8px] px-2 py-0.5 rounded-full whitespace-nowrap"
                    style={{
                      fontFamily: 'var(--font-sora), Sora, sans-serif',
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      background: 'linear-gradient(135deg, #D4B46A, #C5A059)',
                      color: '#1a0e00',
                    }}
                  >
                    {opt.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </FadeUp>

        {/* ── Cards — Efecto Ricitos de Oro ── */}
        <div className="grid md:grid-cols-3 gap-6 items-center">
          {PRICING_CARDS.map((card, i) => {
            const note  = noteText(card.price)
            const price = displayPrice(card.price)
            return (
              <FadeUp
                key={card.key}
                delay={i * 80}
                className={card.highlight ? 'md:scale-[1.05] md:z-10' : ''}
              >
                <div
                  className="relative rounded-2xl flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1"
                  style={{
                    background: card.highlight
                      ? `linear-gradient(150deg, #0d1e3a, #071020)`
                      : card.key === 'elite'
                        ? `linear-gradient(150deg, #1a120a, #0e0b05)`
                        : NAVY2,
                    border: card.highlight
                      ? `1.5px solid ${CYAN}65`
                      : card.key === 'elite'
                        ? `1px solid ${card.color}45`
                        : '1px solid rgba(255,255,255,0.07)',
                    boxShadow: card.highlight
                      ? `0 0 0 1px ${CYAN}15, 0 0 55px ${CYAN}22, 0 24px 48px rgba(0,0,0,0.55)`
                      : card.key === 'elite'
                        ? `0 0 38px ${card.color}18, 0 8px 32px rgba(0,0,0,0.4)`
                        : '0 4px 24px rgba(0,0,0,0.28)',
                  }}
                >
                  {/* Acento superior */}
                  <div style={{
                    height: card.highlight ? 4 : 3,
                    background: card.highlight
                      ? `linear-gradient(90deg, ${CYAN}80, ${BLUE}, ${CYAN}80)`
                      : `linear-gradient(90deg, transparent, ${card.color}55, transparent)`,
                    boxShadow: card.highlight ? `0 0 14px ${CYAN}55` : 'none',
                  }} />

                  {/* Badge — ribbon superior */}
                  {card.badge && (
                    <div className="flex justify-center pt-4">
                      <span
                        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full"
                        style={{
                          fontFamily: 'var(--font-michroma), Michroma, sans-serif',
                          fontSize: '10px',
                          fontWeight: 700,
                          letterSpacing: '0.15em',
                          textTransform: 'uppercase',
                          background: `linear-gradient(135deg, ${CYAN}28, ${BLUE}28)`,
                          border: `1px solid ${CYAN}55`,
                          color: CYAN,
                          boxShadow: `0 0 18px ${CYAN}30`,
                        }}
                      >
                        ✦ {card.badge}
                      </span>
                    </div>
                  )}

                  {/* Header del plan */}
                  <div className={`px-7 ${card.badge ? 'pt-4' : 'pt-7'} pb-5`}>

                    {/* Nombre — Michroma */}
                    <div className="flex items-center gap-2.5 mb-1" style={{ color: card.color }}>
                      {PLAN_ICONS[card.key]}
                      <span
                        className="text-sm font-semibold uppercase tracking-[0.18em]"
                        style={{ fontFamily: 'var(--font-michroma), Michroma, sans-serif' }}
                      >
                        {card.name}
                      </span>
                    </div>
                    <p className="text-white/35 text-xs leading-relaxed mb-4">{card.desc}</p>

                    {/* Precio — Sora SemiBold 0.12em */}
                    <div className="flex items-baseline gap-1">
                      <span
                        className="text-[2.5rem] font-semibold leading-none"
                        style={{ ...SORA, color: card.highlight ? card.color : 'white' }}
                      >
                        {fmtCOP(price)}
                      </span>
                      <span className="text-sm text-white/28 ml-1">/mes</span>
                    </div>
                    {billing === 'anual' && (
                      <p className="text-[10px] text-white/28 mt-0.5 line-through">{fmtCOP(card.price)}/mes</p>
                    )}

                    {/* Nota facturación */}
                    <div className="h-10 flex flex-col justify-center mt-1 mb-5">
                      <p className="text-xs" style={{ color: note.green ? '#22C55E' : 'rgba(255,255,255,0.26)' }}>
                        {note.main}
                      </p>
                      {note.sub && (
                        <p className="text-[10px] text-white/22 mt-0.5">{note.sub}</p>
                      )}
                    </div>

                    {/* CTA — Sora SemiBold 0.12em */}
                    <a
                      href={card.ctaHref}
                      className="w-full py-3 rounded-xl text-sm text-center block transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                      style={{
                        ...SORA,
                        ...(card.highlight
                          ? {
                              background: `linear-gradient(135deg, ${CYAN}, ${BLUE})`,
                              color: 'white',
                              boxShadow: `0 0 28px ${CYAN}45`,
                            }
                          : card.key === 'elite'
                            ? {
                                background: `${card.color}15`,
                                color: card.color,
                                border: `1px solid ${card.color}50`,
                              }
                            : {
                                background: 'rgba(255,255,255,0.05)',
                                color: card.color,
                                border: `1px solid ${card.color}38`,
                              }
                        ),
                      }}
                    >
                      {card.cta}
                    </a>

                    {/* Micro-copy */}
                    <p className="text-center text-[10px] text-white/22 mt-2">
                      Cancela cuando quieras · Sin comisiones ocultas
                    </p>
                  </div>

                  {/* Divider */}
                  <div style={{
                    height: 1, margin: '0 28px',
                    background: `linear-gradient(90deg, transparent, ${card.color}35, transparent)`,
                  }} />

                  {/* Features */}
                  <div className="px-7 py-6 flex-1">
                    <p
                      className="text-[10px] font-bold uppercase tracking-[0.22em] mb-4"
                      style={{ color: `${card.color}99` }}
                    >
                      {card.sectionLabel}
                    </p>
                    <ul className="flex flex-col gap-3">
                      {card.features.map(f => (
                        <li key={f} className="flex items-start gap-2.5">
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="flex-shrink-0 mt-[2px]">
                            <circle cx="12" cy="12" r="10"
                              fill={card.color + '1E'} stroke={card.color + '55'} strokeWidth="1.5"/>
                            <path d="M8 12l3 3 5-5" stroke={card.color} strokeWidth="2"
                              strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <span className="text-sm leading-snug" style={{ color: 'rgba(255,255,255,0.70)' }}>
                            {f}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                </div>
              </FadeUp>
            )
          })}
        </div>

        {/* ── Tabla Rayos X — accordion ── */}
        <FadeUp className="mt-12 text-center">
          <button
            onClick={() => setMatrix(o => !o)}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full border transition-all duration-200 hover:bg-white/[0.04]"
            style={{
              ...SORA,
              fontSize: '13px',
              color: 'rgba(255,255,255,0.45)',
              borderColor: 'rgba(255,255,255,0.10)',
            }}
          >
            {matrixOpen ? 'Ocultar comparación' : 'Ver comparación detallada de funciones'}
            <span style={{ display: 'inline-block', transition: 'transform 0.3s', transform: matrixOpen ? 'rotate(180deg)' : 'none' }}>
              ⬇️
            </span>
          </button>

          {matrixOpen && (
            <div
              className="mt-8 rounded-2xl overflow-x-auto text-left"
              style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
            >
              {/* Cabecera */}
              <div
                className="grid grid-cols-4 min-w-[520px]"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
              >
                <div className="px-5 py-4 text-xs text-white/30 uppercase tracking-[0.2em]">Función</div>
                {PRICING_CARDS.map(c => (
                  <div key={c.key} className="px-3 py-4 text-center">
                    <span
                      className="text-[11px] font-bold uppercase tracking-[0.15em]"
                      style={{ fontFamily: 'var(--font-michroma), Michroma, sans-serif', color: c.color }}
                    >
                      {c.name}
                    </span>
                  </div>
                ))}
              </div>

              {/* Filas agrupadas por categoría */}
              {Array.from(new Set(FEATURE_ROWS.map(r => r.cat))).map(cat => (
                <div key={cat}>
                  <div
                    className="px-5 py-1.5 text-[9px] font-bold uppercase tracking-[0.28em] min-w-[520px]"
                    style={{ color: `${CYAN}65`, background: `${CYAN}07`, borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    {cat}
                  </div>
                  {FEATURE_ROWS.filter(r => r.cat === cat).map((row, idx) => (
                    <div
                      key={row.label}
                      className="grid grid-cols-4 min-w-[520px]"
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.012)',
                      }}
                    >
                      <div className="px-5 py-3 text-xs text-white/50">{row.label}</div>
                      {(['esencial', 'profesional', 'elite'] as const).map(plan => (
                        <div key={plan} className="px-3 py-3 flex justify-center items-center">
                          {row[plan]
                            ? (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                <circle cx="12" cy="12" r="10" fill="#22C55E18" stroke="#22C55E55" strokeWidth="1.5"/>
                                <path d="M8 12l3 3 5-5" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )
                            : <span className="text-white/18 text-base leading-none">—</span>
                          }
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </FadeUp>

      </div>
    </section>
  )
}

// ─── Portal de Aliados ────────────────────────────────────────────────────────
type BusinessItem = { id: string; name: string; slug: string; branding: { primary_color?: string } | null }

function Aliados({ businesses = [] }: { businesses: BusinessItem[] }) {
  const router = useRouter()
  const [mode, setMode]           = useState<'dashboard' | 'book'>('dashboard')
  const [selected, setSelected]   = useState<BusinessItem | null>(null)
  const [open, setOpen]           = useState(false)
  const [search, setSearch]       = useState('')
  const [error, setError]         = useState('')
  const dropdownRef               = useRef<HTMLDivElement>(null)
  const searchRef                 = useRef<HTMLInputElement>(null)

  // Cerrar al hacer click fuera
  useEffect(() => {
    function onClickOut(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', onClickOut)
    return () => document.removeEventListener('mousedown', onClickOut)
  }, [])

  // Focus en buscador al abrir
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open])

  const filtered = businesses.filter(b =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    b.slug.toLowerCase().includes(search.toLowerCase())
  )

  function handleSelect(b: BusinessItem) {
    setSelected(b)
    setOpen(false)
    setSearch('')
    setError('')
  }

  function handleAccess() {
    if (!selected) { setError('Selecciona tu negocio de la lista.'); return }
    setError('')
    router.push(mode === 'dashboard' ? `/${selected.slug}/login` : `/${selected.slug}/book`)
  }

  const dotColor = (b: BusinessItem) => b.branding?.primary_color ?? CYAN

  return (
    <section
      id="aliados"
      className="py-24 px-6 relative overflow-x-hidden"
      style={{ background: `linear-gradient(180deg, ${NAVY2} 0%, ${NAVY} 100%)` }}
    >
      {/* Glow de fondo */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(ellipse 60% 50% at 50% 100%, ${BLUE}20, transparent)` }}
      />

      <div className="max-w-2xl mx-auto relative z-10 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold mb-8"
          style={{ background: `${BLUE}18`, border: `1px solid ${BLUE}40`, color: '#7EB3FF' }}
        >
          <Lock size={14} />
          Portal exclusivo para aliados
        </div>

        <h2 className="text-3xl md:text-5xl font-bold text-white mb-4" style={{ fontFamily: 'Sora, sans-serif' }}>
          Accede a tu <GradientText>negocio</GradientText>
        </h2>
        <p className="text-white/50 mb-12 text-lg">
          Selecciona tu negocio para acceder al panel de gestión
          o para que tus clientes agenden una cita.
        </p>

        {/* Card */}
        <div className="rounded-2xl p-8 text-left"
          style={{ background: '#0D1635', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}
        >
          {/* Tabs modo */}
          <div className="flex rounded-lg p-1 mb-6" style={{ background: 'rgba(255,255,255,0.04)' }}>
            {[
              { key: 'dashboard', label: 'Panel de gestión', icon: <BarChart3 size={14} /> },
              { key: 'book',      label: 'Agendar cita',     icon: <Calendar size={14} /> },
            ].map(tab => (
              <button key={tab.key}
                onClick={() => setMode(tab.key as 'dashboard' | 'book')}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-md transition-all"
                style={mode === tab.key
                  ? { background: `linear-gradient(135deg, ${CYAN}30, ${BLUE}30)`, color: 'white', border: `1px solid ${CYAN}40` }
                  : { color: 'rgba(255,255,255,0.4)' }}
              >
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          {/* Dropdown selector */}
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2 block">
                Selecciona tu negocio
              </label>

              <div ref={dropdownRef} className="relative">
                {/* Trigger */}
                <button
                  type="button"
                  onClick={() => setOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-sm text-left transition-all"
                  style={{
                    background: '#111827',
                    border: `1px solid ${open ? CYAN + '60' : 'rgba(255,255,255,0.08)'}`,
                    boxShadow: open ? `0 0 0 3px ${CYAN}15` : 'none',
                  }}
                >
                  <span className="flex items-center gap-3">
                    {selected ? (
                      <>
                        {/* Dot con color del negocio */}
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: dotColor(selected), boxShadow: `0 0 6px ${dotColor(selected)}80` }}
                        />
                        <span className="text-white font-medium">{selected.name}</span>
                        <span className="text-white/30 text-xs">/{selected.slug}</span>
                      </>
                    ) : (
                      <span className="text-white/30">— Elige tu negocio —</span>
                    )}
                  </span>
                  <ChevronRight
                    size={16}
                    className="text-white/30 flex-shrink-0 transition-transform duration-200"
                    style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  />
                </button>

                {/* Panel desplegable */}
                {open && (
                  <div
                    className="absolute top-full left-0 right-0 mt-2 rounded-xl z-50"
                    style={{
                      background: '#0a0f1e',
                      border: '1px solid rgba(255,255,255,0.10)',
                      boxShadow: `0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px ${CYAN}15`,
                      borderRadius: '0.75rem',
                      overflow: 'visible',
                    }}
                  >
                    {/* Buscador */}
                    <div className="p-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/30 flex-shrink-0">
                          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                        </svg>
                        <input
                          ref={searchRef}
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                          placeholder="Buscar negocio..."
                          className="flex-1 bg-transparent text-white text-sm outline-none placeholder-white/25"
                        />
                        {search && (
                          <button onClick={() => setSearch('')} className="text-white/30 hover:text-white/60">
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Lista — scrollable con fade inferior */}
                    <div className="relative">
                    <div
                      className="max-h-72 overflow-y-auto"
                      style={{ scrollbarWidth: 'thin', scrollbarColor: `${CYAN}40 transparent` }}
                    >
                      {filtered.length === 0 ? (
                        <div className="px-4 py-6 text-center text-white/30 text-sm">
                          {businesses.length === 0
                            ? 'Aún no hay negocios registrados.'
                            : 'No se encontró ningún negocio.'}
                        </div>
                      ) : (
                        filtered.map((b, i) => (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => handleSelect(b)}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all group"
                            style={{
                              borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                              background: selected?.id === b.id ? `${CYAN}10` : 'transparent',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = `${CYAN}08`)}
                            onMouseLeave={e => (e.currentTarget.style.background = selected?.id === b.id ? `${CYAN}10` : 'transparent')}
                          >
                            {/* Color dot */}
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0 transition-all"
                              style={{ background: dotColor(b), boxShadow: `0 0 8px ${dotColor(b)}60` }}
                            />
                            {/* Info */}
                            <span className="flex-1 min-w-0">
                              <span className="text-white text-sm font-medium block truncate">{b.name}</span>
                              <span className="text-white/30 text-xs">xinuco.com/{b.slug}</span>
                            </span>
                            {/* Check si seleccionado */}
                            {selected?.id === b.id && (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={CYAN} strokeWidth="2.5">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                    {/* Fade inferior — indica que hay más items */}
                    <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none rounded-b-xl"
                      style={{ background: 'linear-gradient(to top, #0a0f1e, transparent)' }} />
                    </div>

                    {/* Footer del panel */}
                    <div className="px-4 py-2.5 border-t text-center" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                      <span className="text-[11px] text-white/20">
                        {filtered.length} negocio{filtered.length !== 1 ? 's' : ''} disponible{filtered.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
            </div>

            {/* Botón acción */}
            <button
              type="button"
              onClick={handleAccess}
              disabled={!selected}
              className="w-full py-4 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={selected
                ? { background: `linear-gradient(135deg, ${CYAN}, ${BLUE})`, boxShadow: `0 0 30px ${CYAN}35` }
                : { background: 'rgba(255,255,255,0.06)' }
              }
            >
              {mode === 'dashboard'
                ? <><BarChart3 size={16} /> Ir al panel de gestión</>
                : <><Calendar size={16} /> Agendar mi cita</>}
            </button>
          </div>

          {/* Info contacto */}
          <p className="text-xs text-white/25 text-center mt-5">
            ¿Tu negocio no aparece? Escríbenos a{' '}
            <a href="mailto:hola@xinuco.com" className="underline" style={{ color: `${CYAN}90` }}>
              hola@xinuco.com
            </a>
          </p>
        </div>
      </div>
    </section>
  )
}

// ─── Nosotros ─────────────────────────────────────────────────────────────────
function Nosotros() {
  return (
    <section
      id="nosotros"
      className="py-24 px-6"
      style={{ background: NAVY }}
    >
      <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-16 items-center">
        {/* Left */}
        <div>
          <p className="text-xs font-semibold tracking-[0.3em] uppercase mb-4" style={{ color: CYAN }}>
            Quiénes somos
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-white leading-tight mb-6" style={{ fontFamily: 'Sora, sans-serif' }}>
            Innovamos para <GradientText>impulsar el futuro</GradientText> de los negocios LATAM
          </h2>
          <p className="text-white/50 leading-relaxed mb-8">
            Xinuco nació para democratizar la tecnología empresarial en Latinoamérica.
            Creemos que cada pequeño negocio merece las mismas herramientas que usan
            las grandes corporaciones — sin la complejidad ni el costo.
          </p>

          <div className="grid grid-cols-2 gap-6">
            {[
              { title: 'Innovamos',   desc: 'Impulsando el futuro con tecnología que realmente funciona.' },
              { title: 'Conectamos',  desc: 'Tecnología, negocios y personas en un ecosistema.' },
              { title: 'Inteligencia', desc: 'Datos que se transforman en decisiones más inteligentes.' },
              { title: 'Impacto Real', desc: 'Resultados medibles desde el primer día de uso.' },
            ].map(i => (
              <div key={i.title}>
                <h4 className="font-bold text-white text-sm mb-1" style={{ color: CYAN }}>{i.title}</h4>
                <p className="text-white/40 text-xs leading-relaxed">{i.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right — app icon */}
        <div className="flex justify-center">
          <div className="relative">
            {/* Glow detrás */}
            <div
              className="absolute inset-0 -m-6 rounded-full blur-2xl opacity-35 pointer-events-none"
              style={{ background: `radial-gradient(circle, ${CYAN} 0%, ${BLUE} 55%, transparent 75%)` }}
            />
            <Image
              src="https://rymlwtijbtokpqharrig.supabase.co/storage/v1/object/public/assets/landing/xinuco-app-icon.png"
              alt="Xinuco App"
              width={260}
              height={260}
              className="relative z-10 rounded-[3rem] shadow-2xl"
              style={{ boxShadow: `0 32px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)` }}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer
      className="py-10 px-6 border-t"
      style={{ background: NAVY2, borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <XinucoMark size={28} />
          <div>
            <XinucoWordmark size={15} />
            <p className="text-white/30 text-xs mt-1">Tecnología · Inteligencia · Impacto</p>
          </div>
        </div>

        <div className="flex items-center gap-6 text-xs text-white/30">
          <a href="#verticales" className="hover:text-white/60 transition-colors">Verticales</a>
          <a href="#aliados"    className="hover:text-white/60 transition-colors">Aliados</a>
          <a href="mailto:hola@xinuco.com" className="hover:text-white/60 transition-colors">Contacto</a>
          <a href="/admin/login" className="hover:text-white/60 transition-colors">Admin</a>
        </div>

        <p className="text-white/20 text-xs">© {new Date().getFullYear()} Xinuco. Todos los derechos reservados.</p>
      </div>
    </footer>
  )
}

// ─── Main export ─────────────────────────────────────────────────────────────
const DEFAULT_STATS: LandingStats = { citasTotal: 0, barberias: 0, clientes: 0 }

export default function XinucoLanding({
  businesses = [],
  stats = DEFAULT_STATS,
}: {
  businesses: BusinessItem[]
  stats?: LandingStats
}) {
  return (
    <div className="antialiased" style={{ background: NAVY, color: 'white' }}>
      <GrainOverlay />
      <Navbar />
      <Hero stats={stats} />
      <Verticales />
      <Features />
      <Pricing />
      <Aliados businesses={businesses} />
      <Nosotros />
      <Footer />
    </div>
  )
}
