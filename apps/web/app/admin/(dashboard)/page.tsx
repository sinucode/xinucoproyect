import { redirect } from 'next/navigation'

/**
 * /admin — Home del panel global.
 * El listado de verticales vive en /admin/verticales; esta ruta
 * solo redirige ahí para que el destino de login (`redirect('/admin')`)
 * caiga en una página real en vez de 404.
 */
export default function AdminHomePage() {
  redirect('/admin/verticales')
}
