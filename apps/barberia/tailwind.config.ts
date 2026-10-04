/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Neutros theme-aware: la escala zinc es de variables CSS (valores por defecto = paleta zinc de
        //    Tailwind, definidos en globals.css :root → render oscuro idéntico). El dashboard en modo claro
        //    la invierte (ver [data-dashboard-theme][data-theme-mode="light"] en globals.css).
        //    No se definen pasos inexistentes en Tailwind (550/650/850/150): esas clases siguen sin generar CSS.
        zinc: {
          50:  'rgb(var(--zinc-50) / <alpha-value>)',
          100: 'rgb(var(--zinc-100) / <alpha-value>)',
          200: 'rgb(var(--zinc-200) / <alpha-value>)',
          300: 'rgb(var(--zinc-300) / <alpha-value>)',
          400: 'rgb(var(--zinc-400) / <alpha-value>)',
          500: 'rgb(var(--zinc-500) / <alpha-value>)',
          600: 'rgb(var(--zinc-600) / <alpha-value>)',
          700: 'rgb(var(--zinc-700) / <alpha-value>)',
          800: 'rgb(var(--zinc-800) / <alpha-value>)',
          900: 'rgb(var(--zinc-900) / <alpha-value>)',
          950: 'rgb(var(--zinc-950) / <alpha-value>)',
        },
        // Color de "tinta" neutra: blanco en oscuro, negro en claro. Reemplaza white/ en velos translúcidos
        // del dashboard (bg-fg/[0.05], border-fg/10…). Por defecto = blanco → idéntico al actual.
        fg: 'rgb(var(--fg) / <alpha-value>)',
        // ── Token dinámico del tenant (brand_config.primaryColor) ──
        brand: {
          DEFAULT: 'var(--brand-primary, #C5A059)',
          foreground: 'var(--brand-foreground, #080808)',
        },
        // ── Tokens legacy (branding JSONB) ──
        xinuco: {
          primary:     'var(--primary-color, #C5A059)',
          primaryDark: 'var(--primary-dark, #A8843A)',
          bg:          'var(--bg-color, #080808)',
          text:        'var(--text-color, #F4F4F4)',
          surface:     'var(--secondary-color, #1A1A1A)',
          border:      'var(--border-color, #2A2A2A)',
          muted:       'var(--muted-color, #6B6B6B)',
        },
      },
      fontFamily: {
        sans: ['var(--font-family, Inter)', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':  'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      animation: {
        'fade-in':        'fadeIn 0.3s ease-in-out',
        'slide-up':       'slideUp 0.4s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'pulse-soft':     'pulseSoft 2s ease-in-out infinite',
        'shimmer':        'shimmer 1.5s linear infinite',
      },
      keyframes: {
        fadeIn:      { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp:     { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        slideInRight:{ '0%': { opacity: '0', transform: 'translateX(100%)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        pulseSoft:   { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.6' } },
        shimmer:     { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
    },
  },
  plugins: [
    // Variante `light:` — aplica cuando el negocio eligió modo claro (el layout del tenant y el wrapper
    // del dashboard marcan data-theme-mode="light"): portal de reservas y dashboard.
    function ({ addVariant }: { addVariant: (name: string, selector: string) => void }) {
      addVariant('light', '[data-theme-mode="light"] &')
    },
  ],
}
