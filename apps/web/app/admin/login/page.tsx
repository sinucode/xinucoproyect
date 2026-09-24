'use client'

import { useState, useRef, useTransition } from 'react'
import { Globe, Eye, EyeOff, Loader2 } from 'lucide-react'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { loginWithPassword, requestPasswordReset } from '@/actions/auth'

const HCAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ?? ''

/**
 * AdminLoginPage — Login del Super Admin para el panel GLOBAL Xinuco.
 *
 * Ruta: /admin/login  (servida por apps/web)
 * El mismo super_admin puede navegar a /adminbarberia desde aquí
 * gracias al SSO por cookies del mismo dominio.
 */
export default function AdminLoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [isPending, startTransition]    = useTransition()

  const [mode, setMode]                 = useState<'login' | 'forgot'>('login')
  const [resetMessage, setResetMessage] = useState<string | null>(null)
  const [isResetPending, startResetTransition] = useTransition()

  // hCaptcha — un solo widget compartido: solo un formulario está visible a la vez.
  const captchaRef                      = useRef<HCaptcha>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  function switchMode(next: 'login' | 'forgot') {
    setMode(next)
    setError(null)
    setResetMessage(null)
    setCaptchaToken(null)
  }

  async function handleSubmit(formData: FormData) {
    setError(null)

    formData.set('next', new URLSearchParams(window.location.search).get('next') ?? '')

    if (HCAPTCHA_SITE_KEY && !captchaToken) {
      setError('Por favor completa la verificación de seguridad.')
      return
    }
    if (captchaToken) formData.set('captcha_token', captchaToken)

    startTransition(async () => {
      const result = await loginWithPassword(formData)
      if (result?.error) {
        setError(result.error)
        captchaRef.current?.resetCaptcha()
        setCaptchaToken(null)
      }
    })
  }

  async function handleResetSubmit(formData: FormData) {
    setResetMessage(null)

    if (HCAPTCHA_SITE_KEY && !captchaToken) {
      setResetMessage('Por favor completa la verificación de seguridad.')
      return
    }
    if (captchaToken) formData.set('captcha_token', captchaToken)

    startResetTransition(async () => {
      const result = await requestPasswordReset(formData)
      if (result?.error) {
        setResetMessage(result.error)
      } else if (result?.success) {
        setResetMessage(result.success)
      }
      captchaRef.current?.resetCaptcha()
      setCaptchaToken(null)
    })
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-16 bg-[#080808]">
      <div
        aria-hidden
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% -10%, rgba(197, 160, 89, 0.10), transparent)',
        }}
      />

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg"
            style={{ background: 'linear-gradient(135deg, #C5A059, #A88642)' }}
          >
            <Globe size={28} color="#080808" strokeWidth={2} />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-[#F4F4F4]">
              Admin Global
            </h1>
            <p className="text-sm text-[#6B6B6B] mt-1">
              Xinuco — Todas las verticales
            </p>
          </div>
        </div>

        <div
          className="rounded-xl p-6 border"
          style={{ backgroundColor: '#0D0D0D', borderColor: '#1A1A1A' }}
        >
          {mode === 'forgot' ? (
            <form action={handleResetSubmit} className="flex flex-col gap-4">
              <p className="text-xs text-[#6B6B6B]">
                Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.
              </p>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="reset-email" className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider">
                  Correo electrónico
                </label>
                <input
                  id="reset-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="admin@xinuco.com"
                  className="w-full px-4 py-3 rounded-lg text-sm text-[#F4F4F4] placeholder-[#444] outline-none transition-all focus:ring-2 focus:ring-[#C5A059]/40"
                  style={{ backgroundColor: '#141414', border: '1px solid #222' }}
                />
              </div>

              {HCAPTCHA_SITE_KEY && (
                <div className="flex justify-center">
                  <HCaptcha
                    ref={captchaRef}
                    sitekey={HCAPTCHA_SITE_KEY}
                    theme="dark"
                    onVerify={(token) => setCaptchaToken(token)}
                    onExpire={() => setCaptchaToken(null)}
                  />
                </div>
              )}

              {resetMessage && (
                <p role="status" className="text-xs text-[#C5A059] text-center px-2">
                  {resetMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={isResetPending || (!!HCAPTCHA_SITE_KEY && !captchaToken)}
                className="w-full mt-2 py-3 rounded-lg text-sm font-semibold transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ backgroundColor: '#C5A059', color: '#080808' }}
              >
                {isResetPending ? (
                  <><Loader2 size={16} className="animate-spin" />Enviando…</>
                ) : (
                  'Enviar enlace de recuperación'
                )}
              </button>

              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-xs text-[#6B6B6B] hover:text-[#C5A059] transition-colors text-center"
              >
                ← Volver al inicio de sesión
              </button>
            </form>
          ) : (
          <form action={handleSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="slug" value="admin" />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="admin-email" className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider">
                Correo electrónico
              </label>
              <input
                id="admin-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="admin@xinuco.com"
                className="w-full px-4 py-3 rounded-lg text-sm text-[#F4F4F4] placeholder-[#444] outline-none transition-all focus:ring-2 focus:ring-[#C5A059]/40"
                style={{ backgroundColor: '#141414', border: '1px solid #222' }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="admin-password" className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider">
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-11 rounded-lg text-sm text-[#F4F4F4] placeholder-[#444] outline-none transition-all focus:ring-2 focus:ring-[#C5A059]/40"
                  style={{ backgroundColor: '#141414', border: '1px solid #222' }}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B6B6B] hover:text-[#C5A059] transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="self-end text-xs text-[#6B6B6B] hover:text-[#C5A059] transition-colors"
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            {HCAPTCHA_SITE_KEY && (
              <div className="flex justify-center">
                <HCaptcha
                  ref={captchaRef}
                  sitekey={HCAPTCHA_SITE_KEY}
                  theme="dark"
                  onVerify={(token) => setCaptchaToken(token)}
                  onExpire={() => setCaptchaToken(null)}
                />
              </div>
            )}

            {error && (
              <p role="alert" className="text-xs text-red-400 text-center px-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isPending || (!!HCAPTCHA_SITE_KEY && !captchaToken)}
              id="btn-admin-login"
              className="w-full mt-2 py-3 rounded-lg text-sm font-semibold transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{ backgroundColor: '#C5A059', color: '#080808' }}
            >
              {isPending ? (
                <><Loader2 size={16} className="animate-spin" />Verificando…</>
              ) : (
                'Acceder al Admin Global'
              )}
            </button>
          </form>
          )}
        </div>

        <p className="text-center text-xs text-[#444] mt-6">
          Powered by <span className="font-semibold text-[#C5A059]">Xinuco</span>
        </p>
      </div>
    </main>
  )
}
