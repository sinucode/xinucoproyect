'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react'
import { createClient } from '@xinuco/supabase/client'

type Status = 'verifying' | 'ready' | 'invalid' | 'submitting' | 'done'

/**
 * ResetPasswordPage — Destino del link de recuperación de contraseña
 * enviado por Supabase Auth al Admin Global (super_admin).
 *
 * Ruta: /admin/reset-password (apps/web)
 *
 * El proyecto usa el flujo PKCE de Supabase. El canje real del `code` por
 * una sesión ocurre del lado del servidor en /admin/auth/callback (necesita las
 * cookies donde vive el code_verifier — el cliente de navegador no tiene
 * acceso a ellas). Esta página solo se abre DESPUÉS de ese canje, así que
 * únicamente confirma que la sesión quedó activa.
 *
 * El "Site URL" del proyecto Supabase debe apuntar solo al origen
 * (sin ruta), y /admin/auth/callback debe estar en Redirect URLs, para que el
 * link del correo de recuperación no caiga en la landing.
 */
export default function ResetPasswordPage() {
  const router = useRouter()
  const [status, setStatus]     = useState<Status>('verifying')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    async function checkSession() {
      // /admin/auth/callback marca el link roto/expirado con ?error=invalid_link
      // en vez de intentar redirigir con una sesión que nunca se estableció.
      if (new URLSearchParams(window.location.search).get('error')) {
        setStatus('invalid')
        return
      }

      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      setStatus(session ? 'ready' : 'invalid')
    }
    checkSession()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setStatus('submitting')
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setStatus('ready')
      return
    }

    // Cerrar la sesión de recuperación; el usuario inicia sesión de nuevo con la clave nueva.
    await supabase.auth.signOut()
    setStatus('done')
    setTimeout(() => router.push('/admin/login'), 2000)
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
        <div className="flex flex-col items-center mb-8 gap-3">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg"
            style={{ background: 'linear-gradient(135deg, #C5A059, #A88642)' }}
          >
            <KeyRound size={28} color="#080808" strokeWidth={2} />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-[#F4F4F4]">
              Nueva contraseña
            </h1>
            <p className="text-sm text-[#6B6B6B] mt-1">
              Admin Global — Xinuco
            </p>
          </div>
        </div>

        <div
          className="rounded-xl p-6 border"
          style={{ backgroundColor: '#0D0D0D', borderColor: '#1A1A1A' }}
        >
          {status === 'verifying' && (
            <div className="flex flex-col items-center gap-3 py-6 text-[#6B6B6B]">
              <Loader2 size={22} className="animate-spin" />
              <p className="text-sm">Verificando el enlace…</p>
            </div>
          )}

          {status === 'invalid' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <p className="text-sm text-red-400">
                Este enlace de recuperación no es válido o ya expiró.
              </p>
              <p className="text-xs text-[#6B6B6B]">
                Solicita un nuevo correo de recuperación e inténtalo de nuevo.
              </p>
            </div>
          )}

          {status === 'done' && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 size={28} className="text-[#C5A059]" />
              <p className="text-sm text-[#F4F4F4]">Contraseña actualizada.</p>
              <p className="text-xs text-[#6B6B6B]">Redirigiendo al login…</p>
            </div>
          )}

          {(status === 'ready' || status === 'submitting') && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="new-password"
                  className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider"
                >
                  Nueva contraseña
                </label>
                <div className="relative">
                  <input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="confirm-password"
                  className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider"
                >
                  Confirmar contraseña
                </label>
                <input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 rounded-lg text-sm text-[#F4F4F4] placeholder-[#444] outline-none transition-all focus:ring-2 focus:ring-[#C5A059]/40"
                  style={{ backgroundColor: '#141414', border: '1px solid #222' }}
                />
              </div>

              {error && (
                <p role="alert" className="text-xs text-red-400 text-center px-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={status === 'submitting'}
                className="w-full mt-2 py-3 rounded-lg text-sm font-semibold transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ backgroundColor: '#C5A059', color: '#080808' }}
              >
                {status === 'submitting' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Guardando…
                  </>
                ) : (
                  'Guardar nueva contraseña'
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
