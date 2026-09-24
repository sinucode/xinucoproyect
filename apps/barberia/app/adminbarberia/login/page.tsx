import { redirect } from 'next/navigation'
import { adminLoginUrl, BARBERIA_URL } from '@xinuco/utils'

/**
 * AdminBarberiaLoginPage — el login del super_admin vive en apps/web (/admin/login).
 * Esta ruta solo redirige para no romper bookmarks ni tests e2e existentes.
 */
export default function AdminBarberiaLoginPage() {
  redirect(adminLoginUrl(`${BARBERIA_URL}/adminbarberia`))
}
