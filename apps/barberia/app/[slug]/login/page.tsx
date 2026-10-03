'use client'

import { useState, useRef, useEffect, useTransition, use, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Scissors, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { loginWithPassword, logout as signOut, signInWithGoogle } from '@/actions/auth'

const HCAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ?? ''

function LoginErrorAlert() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')

  if (error !== 'unauthorized' && error !== 'auth_failed') return null

  return (
    <div className="mb-4 p-3 rounded-sm border border-[#ef4444]/20 bg-[#ef4444]/10 text-[#ef4444] text-sm text-center font-medium">
      Esta cuenta de Google no está autorizada para este negocio.
    </div>
  )
}
import { createClient } from '@xinuco/supabase/client'
import { Skeleton } from '@xinuco/ui'

interface LoginPageProps {
  params: Promise<{ slug: string }>
}

type SessionState = 'loading' | 'conflict' | 'none'

export default function LoginPage({ params }: LoginPageProps) {
  const { slug } = use(params)
  const router = useRouter()

  const [showPassword, setShowPassword] = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [isPending, startTransition]    = useTransition()
  const [isGooglePending, startGoogleTransition] = useTransition()

  const [sessionState, setSessionState] = useState<SessionState>('loading')
  const [userSlug, setUserSlug]         = useState<string | null>(null)

  // hCaptcha
  const captchaRef                      = useRef<HCaptcha>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  useEffect(() => {
    async function checkSession() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        // 🛡️ SECURITY: Leer slug desde app_metadata (solo el servidor puede escribirlo).
        // user_metadata es editable por el cliente → vulnerable a redirects manipulados.
        const metadataSlug = user.app_metadata?.slug as string | undefined

        if (metadataSlug === slug) {
          // Caso A: Match -> Redirige al dashboard del tenant
          router.push(`/${slug}/dashboard`)
        } else if (metadataSlug) {
          // Caso B: Conflicto -> Sesión de otro tenant
          setUserSlug(metadataSlug)
          setSessionState('conflict')
        } else {
          // Fallback si por alguna razón no tiene slug en metadata
          setSessionState('none')
        }
      } else {
        // Caso C: No hay sesión
        setSessionState('none')
      }
    }

    checkSession()
  }, [slug, router])

  async function handleSubmit(formData: FormData) {
    setError(null)

    // En producción (SITE_KEY configurado) requerimos el token
    if (HCAPTCHA_SITE_KEY && !captchaToken) {
      setError('Por favor completa la verificación de seguridad.')
      return
    }

    if (captchaToken) {
      formData.set('captcha_token', captchaToken)
    }

    startTransition(async () => {
      const result = await loginWithPassword(formData)
      if (result?.error) {
        setError(result.error)
        // Resetear captcha para que el usuario deba resolver de nuevo
        captchaRef.current?.resetCaptcha()
        setCaptchaToken(null)
      }
    })
  }

  function handleSignOut() {
    startTransition(async () => {
      await signOut()
    })
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-16">
      {/* Fondo con gradiente radial que usa el color del tenant */}
      <div
        aria-hidden
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% -10%, color-mix(in srgb, var(--primary-color) 18%, transparent), transparent)',
        }}
      />

      <div className="w-full max-w-sm animate-slide-up">
        {/* Logo / Brand / Skeletons */}
        <div className="flex flex-col items-center mb-8 gap-3">
          {sessionState === 'loading' ? (
            <Skeleton className="w-16 h-16" rounded="lg" />
          ) : (
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center glow-primary"
              style={{ background: 'var(--primary-color)' }}
            >
              <Scissors size={28} color="var(--on-primary, #080808)" strokeWidth={2} />
            </div>
          )}

          <div className="text-center">
            {sessionState === 'loading' ? (
              <>
                <Skeleton className="h-8 w-32 mb-2 mx-auto" />
                <Skeleton className="h-4 w-48 mx-auto" />
              </>
            ) : sessionState === 'conflict' ? (
              <h1 className="text-2xl font-bold tracking-tight text-xinuco-text">
                Acceso Restringido
              </h1>
            ) : (
              <>
                <h1 className="text-2xl font-bold tracking-tight text-xinuco-text">
                  Bienvenido
                </h1>
                <p className="text-sm text-xinuco-muted mt-1">
                  Accede a tu panel de gestión
                </p>
              </>
            )}
          </div>
        </div>

        {/* Card de contenido principal */}
        <div className="card">
          {sessionState === 'loading' ? (
            /* Estado de Carga (Skeletons) */
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-11 w-full" rounded="md" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-11 w-full" rounded="md" />
              </div>
              <Skeleton className="h-12 w-full mt-2" rounded="md" />
            </div>
          ) : sessionState === 'conflict' ? (
            /* Estado de Conflicto Multi-tenant */
            <div className="flex flex-col items-center gap-6 py-4 text-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'color-mix(in srgb, var(--primary-color) 15%, transparent)' }}
              >
                <AlertCircle size={32} style={{ color: 'var(--primary-color)' }} />
              </div>

              <div>
                <p className="text-lg font-bold text-xinuco-text">Sesión activa en otro local</p>
                <p className="text-sm text-xinuco-muted mt-2">
                  Actualmente tienes una sesión iniciada en la barbería{' '}
                  <span className="font-semibold text-xinuco-text">/{userSlug}</span>.
                </p>
              </div>

              <div className="w-full flex flex-col gap-3">
                <button
                  onClick={() => router.push(`/${userSlug}/dashboard`)}
                  className="btn-primary w-full !py-6"
                >
                  Ir a mi Dashboard ({userSlug})
                </button>
                <button
                  onClick={handleSignOut}
                  disabled={isPending}
                  className="btn-ghost w-full !py-6"
                >
                  {isPending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    'Cerrar sesión e ingresar aquí'
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* Formulario de Login Normal */
            <>
              <Suspense fallback={null}>
                <LoginErrorAlert />
              </Suspense>

              <form action={handleSubmit} className="flex flex-col gap-4">
                <input type="hidden" name="slug" value={slug} />
              {/* Email */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="email"
                  className="text-xs font-medium text-xinuco-muted uppercase tracking-wider"
                >
                  Correo electrónico
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="admin@barberia.com"
                  className="input-base"
                />
              </div>

              {/* Password */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="password"
                  className="text-xs font-medium text-xinuco-muted uppercase tracking-wider"
                >
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    placeholder="••••••••"
                    className="input-base pr-11"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xinuco-muted hover:text-xinuco-primary transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* hCaptcha — solo visible si SITE_KEY está configurado */}
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

              {/* Error */}
              {error && (
                <p role="alert" className="text-xs text-red-400 light:text-red-700 text-center px-2 animate-fade-in">
                  {error}
                </p>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isPending || isGooglePending || (!!HCAPTCHA_SITE_KEY && !captchaToken)}
                id="btn-login"
                className="btn-primary mt-2 !py-6"
              >
                {isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Ingresando…
                  </>
                ) : (
                  'Ingresar'
                )}
              </button>
            </form>

            {/* Divisor y Google Login */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-xinuco-border" style={{ borderColor: 'var(--border-color)' }} />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 text-xinuco-muted" style={{ backgroundColor: 'var(--bg-color)' }}>O</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => startGoogleTransition(async () => { await signInWithGoogle(slug) })}
              disabled={isPending || isGooglePending}
              className="flex items-center justify-center gap-3 w-full !py-6 rounded-md border text-xinuco-text font-sans font-medium transition-colors hover:tint-5 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ borderColor: 'var(--border-color)' }}
            >
              {isGooglePending ? (
                <>
                  <Loader2 size={18} className="animate-spin text-xinuco-muted" />
                  <span>Conectando con Google...</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <span>Continuar con Google</span>
                </>
              )}
            </button>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-xinuco-muted mt-6">
          Powered by{' '}
          <span className="font-semibold" style={{ color: 'var(--primary-color)' }}>
            Xinuco
          </span>
        </p>
      </div>
    </main>
  )
}
