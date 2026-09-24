import { signUp, loginWithPassword, logout, signInWithGoogle } from '../auth'
import { redirect } from 'next/navigation'
import { createClient } from '@xinuco/supabase/server'
import { headers } from 'next/headers'

// Mocking dependencies
jest.mock('next/navigation', () => ({
  redirect: jest.fn(() => { throw new Error('NEXT_REDIRECT') }),
}))

jest.mock('next/headers', () => ({
  headers: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

describe('Auth Server Actions', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockSupabase = {
      auth: {
        signUp: jest.fn(),
        signInWithPassword: jest.fn(),
        signOut: jest.fn(),
        refreshSession: jest.fn(),
        getUser: jest.fn(),
        signInWithOAuth: jest.fn(),
      },
      rpc: jest.fn(),
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
    ;(headers as jest.Mock).mockResolvedValue(new Map([['host', 'localhost:3000']]))
  })

  describe('signUp', () => {
    it('returns error if missing fields', async () => {
      const formData = new FormData()
      formData.append('email', 'test@test.com')
      // Missing password, fullName, etc.

      const result = await signUp(formData)
      expect(result).toEqual({ error: 'Todos los campos son obligatorios.' })
    })

    it('redirects to login on success', async () => {
      const formData = new FormData()
      formData.append('email', 'test@test.com')
      formData.append('password', 'password123')
      formData.append('full_name', 'Test User')
      formData.append('business_id', '123')
      formData.append('slug', 'my-barber')

      mockSupabase.auth.signUp.mockResolvedValueOnce({ data: {}, error: null })

      try {
        await signUp(formData)
      } catch (e: any) {
        if (e.message !== 'NEXT_REDIRECT') throw e
      }

      expect(mockSupabase.auth.signUp).toHaveBeenCalledWith({
        email: 'test@test.com',
        password: 'password123',
        options: {
          data: {
            full_name: 'Test User',
            business_id: '123',
            slug: 'my-barber',
          },
        },
      })
      expect(redirect).toHaveBeenCalledWith('/my-barber/login')
    })
  })

  describe('loginWithPassword', () => {
    it('returns error on missing fields', async () => {
      const formData = new FormData()
      const result = await loginWithPassword(formData)
      expect(result).toEqual({ error: 'Por favor ingresa tu correo y contraseña.' })
    })

    it('handles super_admin login redirect', async () => {
      const formData = new FormData()
      formData.append('email', 'admin@xinuco.com')
      formData.append('password', 'secure123')
      formData.append('slug', 'admin')

      mockSupabase.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: { app_metadata: { role: 'super_admin' } } },
        error: null,
      })

      try {
        await loginWithPassword(formData)
      } catch (e: any) {
        if (e.message !== 'NEXT_REDIRECT') throw e
      }

      expect(redirect).toHaveBeenCalledWith('/admin')
    })

    it('handles tenant login correctly with secure_set_user_context', async () => {
      const formData = new FormData()
      formData.append('email', 'user@test.com')
      formData.append('password', 'pass123')
      formData.append('slug', 'my-barber')

      mockSupabase.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: { app_metadata: { role: 'tenant_admin' } } },
        error: null,
      })
      mockSupabase.rpc.mockResolvedValueOnce({ error: null })

      try {
        await loginWithPassword(formData)
      } catch (e: any) {
        if (e.message !== 'NEXT_REDIRECT') throw e
      }

      expect(mockSupabase.rpc).toHaveBeenCalledWith('secure_set_user_context', { business_slug: 'my-barber' })
      expect(mockSupabase.auth.refreshSession).toHaveBeenCalled()
      expect(redirect).toHaveBeenCalledWith('/my-barber/dashboard')
    })

    it('signs out if secure_set_user_context fails (unauthorized)', async () => {
      const formData = new FormData()
      formData.append('email', 'hacker@test.com')
      formData.append('password', 'pass123')
      formData.append('slug', 'my-barber')

      mockSupabase.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: { app_metadata: { role: 'tenant_admin' } } },
        error: null,
      })
      mockSupabase.rpc.mockResolvedValueOnce({ error: 'Unauthorized' })

      const result = await loginWithPassword(formData)

      expect(mockSupabase.auth.signOut).toHaveBeenCalled()
      expect(result).toEqual({ error: 'No estás autorizado para acceder a esta barbería.' })
    })
  })
})
