import { createClient }   from '@xinuco/supabase/server'
import { redirect }        from 'next/navigation'
import { ExternalLink, Pencil, ToggleLeft, ToggleRight } from 'lucide-react'
import { toggleTenantStatus }  from '@/actions/admin'
import { FeatureToggles }      from './FeatureToggles'
import type { Business }       from '@xinuco/types'

// ── Toggle de estado (inline Server Action) ───────────────────────────────────
function ToggleStatusButton({ id, isActive }: { id: string; isActive: boolean }) {
  const toggle = async () => {
    'use server'
    await toggleTenantStatus(id, isActive)
  }
  return (
    <form action={toggle}>
      <button
        type="submit"
        title={isActive ? 'Desactivar' : 'Activar'}
        className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all duration-200 border cursor-pointer
          ${isActive
            ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20'
            : 'text-xinuco-muted border-xinuco-border bg-xinuco-surface hover:border-xinuco-muted'
          }`}
      >
        {isActive
          ? <><ToggleRight size={14} /> Activo</>
          : <><ToggleLeft  size={14} /> Inactivo</>
        }
      </button>
    </form>
  )
}

/**
 * BusinessTable — async Server Component.
 * Obtiene todos los negocios de Supabase y los muestra en una tabla.
 * Se envuelve en <Suspense> en la page para mostrar el skeleton mientras carga.
 */
export async function BusinessTable() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/admin/login')

  const { data, error } = await supabase
    .from('businesses')
    .select('id, name, slug, is_active, branding, created_at')
    .order('created_at', { ascending: false })

  const businesses: Business[] = (data ?? []) as Business[]

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-400">
        Error al cargar los negocios: {error.message}
      </div>
    )
  }

  if (businesses.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-xinuco-border p-12 text-center">
        <p className="text-sm font-medium text-xinuco-text mb-1">Sin negocios registrados</p>
        <p className="text-xs text-xinuco-muted">Crea tu primera barbería con el botón de arriba.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-xinuco-border">
      <table className="w-full text-sm" aria-label="Lista de negocios registrados">
        <thead>
          <tr className="border-b border-xinuco-border bg-xinuco-surface/60">
            <th className="px-5 py-3.5 text-left text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
              Negocio
            </th>
            <th className="px-5 py-3.5 text-left text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
              Slug / URL
            </th>
            <th className="px-5 py-3.5 text-left text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
              Branding
            </th>
            <th className="px-5 py-3.5 text-left text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
              Estado
            </th>
            <th className="px-5 py-3.5 text-left text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
              Módulos
            </th>
            <th className="px-5 py-3.5 text-right text-xs font-semibold text-xinuco-muted uppercase tracking-wider">
              Acciones
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-xinuco-border">
          {businesses.map((biz) => (
            <tr
              key={biz.id}
              className="bg-xinuco-bg hover:bg-xinuco-surface/40 transition-colors duration-150 group"
            >
              {/* Nombre */}
              <td className="px-5 py-4">
                <div className="flex items-center gap-3">
                  {/* Swatch del color primario */}
                  <div
                    className="w-7 h-7 rounded-lg shrink-0 border border-white/10"
                    style={{ background: biz.branding?.primary_color ?? '#C5A059' }}
                    title={`Color primario: ${biz.branding?.primary_color}`}
                  />
                  <span className="font-semibold text-xinuco-text">{biz.name}</span>
                </div>
              </td>

              {/* Slug + link al dashboard */}
              <td className="px-5 py-4">
                <a
                  href={`/${biz.slug}/dashboard`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-mono text-xs text-xinuco-primary
                             hover:underline hover:text-xinuco-primaryDark transition-colors"
                  aria-label={`Ir al dashboard de ${biz.name}`}
                >
                  /{biz.slug}
                  <ExternalLink size={11} />
                </a>
              </td>

              {/* Branding preview */}
              <td className="px-5 py-4">
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-md border border-white/10"
                    style={{ background: biz.branding?.primary_color ?? '#C5A059' }}
                    title={`Primary: ${biz.branding?.primary_color}`}
                  />
                  <div
                    className="w-5 h-5 rounded-md border border-white/10"
                    style={{ background: biz.branding?.bg_color ?? '#080808' }}
                    title={`BG: ${biz.branding?.bg_color}`}
                  />
                  <span className="text-xs text-xinuco-muted font-mono">
                    {biz.branding?.font_family ?? 'Inter'}
                  </span>
                </div>
              </td>

              {/* Estado con toggle */}
              <td className="px-5 py-4">
                <ToggleStatusButton id={biz.id} isActive={biz.is_active} />
              </td>

              {/* Módulos */}
              <td className="px-5 py-4">
                <FeatureToggles businessId={biz.id} initialFeatures={biz.features_enabled || { loyalty: false, inventory: false, advanced_reports: false }} />
              </td>

              {/* Acciones */}
              <td className="px-5 py-4 text-right">
                <button
                  id={`btn-edit-${biz.id}`}
                  aria-label={`Editar ${biz.name}`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg
                             border border-xinuco-border text-xinuco-muted bg-transparent
                             hover:border-xinuco-primary hover:text-xinuco-primary transition-all duration-200 cursor-pointer"
                >
                  <Pencil size={12} />
                  Editar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-xinuco-border bg-xinuco-surface/40">
            <td colSpan={6} className="px-5 py-3 text-xs text-xinuco-muted">
              {businesses.length} negocio{businesses.length !== 1 ? 's' : ''} registrado{businesses.length !== 1 ? 's' : ''}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
