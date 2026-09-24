import {
  setBusinessUserActive,
  setBusinessUserPassword,
  updateBusinessUser,
} from '../business-users'
import { createClient, createAdminClient } from '@xinuco/supabase/server'
import { revalidatePath } from 'next/cache'

jest.mock('@xinuco/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

describe('business-users Server Actions', () => {
  let mockSupabase: any
  let mockAdminClient: any

  const asSuperAdmin = () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { app_metadata: { role: 'super_admin' } } },
    })
  }

  const asNonSuperAdmin = () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { app_metadata: { role: 'admin' } } },
    })
  }

  const mockProfile = (profile: { id: string; role: string; business_id: string } | null) => {
    mockAdminClient.single.mockResolvedValueOnce({ data: profile, error: profile ? null : new Error('not found') })
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockSupabase = {
      auth: { getUser: jest.fn() },
    }

    mockAdminClient = {
      from:   jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq:     jest.fn().mockReturnThis(),
      order:  jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      single: jest.fn(),
      auth: {
        admin: {
          getUserById:    jest.fn().mockResolvedValue({
            data: { user: { id: 'user1', email: 'user1@test.com', app_metadata: {} } },
          }),
          createUser:     jest.fn(),
          updateUserById: jest.fn(),
          deleteUser:     jest.fn(),
        },
      },
    }

    ;(createClient as jest.Mock).mockResolvedValue(mockSupabase)
    ;(createAdminClient as jest.Mock).mockResolvedValue(mockAdminClient)
  })

  it('rejects a non-super_admin caller without touching the admin client', async () => {
    asNonSuperAdmin()

    const result = await setBusinessUserActive('biz1', 'user1', true)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Acceso denegado. Se requiere rol super_admin.')
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('rejects a target user belonging to another business (IDOR)', async () => {
    asSuperAdmin()
    mockProfile({ id: 'user1', role: 'barber', business_id: 'other-biz' })

    const result = await setBusinessUserActive('biz1', 'user1', true)

    expect(result.success).toBe(false)
    expect(result.error).toBe('El usuario no pertenece a este negocio.')
    expect(mockAdminClient.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('rejects a super_admin target', async () => {
    asSuperAdmin()
    mockProfile({ id: 'user1', role: 'super_admin', business_id: 'biz1' })

    const result = await setBusinessUserActive('biz1', 'user1', true)

    expect(result.success).toBe(false)
    expect(result.error).toBe('No se puede modificar una cuenta super_admin.')
    expect(mockAdminClient.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('rejects a password shorter than 8 characters', async () => {
    asSuperAdmin()
    mockProfile({ id: 'user1', role: 'barber', business_id: 'biz1' })

    const result = await setBusinessUserPassword('biz1', 'user1', 'short')

    expect(result.success).toBe(false)
    expect(result.error).toBe('La contraseña debe tener al menos 8 caracteres.')
    expect(mockAdminClient.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('deactivates a user with ban_duration 876600h', async () => {
    asSuperAdmin()
    mockProfile({ id: 'user1', role: 'barber', business_id: 'biz1' })
    mockAdminClient.auth.admin.updateUserById.mockResolvedValueOnce({ error: null })

    const result = await setBusinessUserActive('biz1', 'user1', false)

    expect(result.success).toBe(true)
    expect(mockAdminClient.auth.admin.updateUserById).toHaveBeenCalledWith('user1', { ban_duration: '876600h' })
    expect(revalidatePath).toHaveBeenCalledWith('/adminbarberia')
  })

  it('activates a user with ban_duration none', async () => {
    asSuperAdmin()
    mockProfile({ id: 'user1', role: 'barber', business_id: 'biz1' })
    mockAdminClient.auth.admin.updateUserById.mockResolvedValueOnce({ error: null })

    const result = await setBusinessUserActive('biz1', 'user1', true)

    expect(result.success).toBe(true)
    expect(mockAdminClient.auth.admin.updateUserById).toHaveBeenCalledWith('user1', { ban_duration: 'none' })
  })

  it('updates a user password on the happy path', async () => {
    asSuperAdmin()
    mockProfile({ id: 'user1', role: 'barber', business_id: 'biz1' })
    mockAdminClient.auth.admin.updateUserById.mockResolvedValueOnce({ error: null })

    const result = await setBusinessUserPassword('biz1', 'user1', 'longenoughpassword')

    expect(result.success).toBe(true)
    expect(mockAdminClient.auth.admin.updateUserById).toHaveBeenCalledWith('user1', { password: 'longenoughpassword' })
  })

  it('rejects updateBusinessUser with a non-assignable role', async () => {
    asSuperAdmin()
    mockProfile({ id: 'user1', role: 'barber', business_id: 'biz1' })

    const result = await updateBusinessUser('biz1', 'user1', {
      fullName: 'Juan Pérez',
      email: 'juan@example.com',
      role: 'super_admin' as any,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Rol inválido.')
    expect(mockAdminClient.update).not.toHaveBeenCalled()
    expect(mockAdminClient.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('rejects a super_admin (by app_metadata) even if its profile row has a staff role', async () => {
    asSuperAdmin()
    mockProfile({ id: 'user1', role: 'admin', business_id: 'biz1' })
    mockAdminClient.auth.admin.getUserById.mockResolvedValueOnce({
      data: { user: { id: 'user1', app_metadata: { role: 'super_admin' } } },
    })

    const result = await setBusinessUserPassword('biz1', 'user1', 'nuevaClave123')

    expect(result.success).toBe(false)
    expect(result.error).toBe('No se puede modificar una cuenta super_admin.')
    expect(mockAdminClient.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('does not touch the profile when the email update fails (no partial write)', async () => {
    asSuperAdmin()
    mockProfile({ id: 'user1', role: 'barber', business_id: 'biz1' })
    mockAdminClient.auth.admin.updateUserById.mockResolvedValueOnce({
      error: { message: 'A user with this email address has already been registered' },
    })

    const result = await updateBusinessUser('biz1', 'user1', {
      fullName: 'Nuevo Nombre', email: 'ocupado@test.com', role: 'admin',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Ese correo ya está en uso.')
    expect(mockAdminClient.update).not.toHaveBeenCalled()
  })
})
