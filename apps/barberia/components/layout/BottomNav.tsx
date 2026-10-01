'use client'

import { useCallback, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Plus, MoreHorizontal, Lock, LogOut, Loader2 } from 'lucide-react'
import { useFeatures } from '@/lib/features/context'
import { useIsAdmin } from '@/lib/features/role-context'
import { logout } from '@/actions/auth'
import {
  bottomBar, isNavActive, toNavRole, visibleQuickActions,
  type VisibleNavItem,
} from '@/lib/navigation'
import { BottomSheet } from '@/components/layout/BottomSheet'

interface BottomNavProps {
  slug: string
}

const TAB_BASE =
  'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 transition-colors'

/**
 * BottomNav — navegación móvil (<768px).
 *
 * Admin:  Inicio · Agenda · [+] · Fila (o Clientes) · Más
 * Barbero: Inicio · Agenda · Fila · Clientes · Mi cuenta (según features)
 * Toda la información viene de lib/navigation.ts (misma fuente que el sidebar).
 */
export function BottomNav({ slug }: BottomNavProps) {
  const pathname = usePathname()
  const features = useFeatures()
  const isAdmin  = useIsAdmin()
  const [moreOpen, setMoreOpen]   = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const closeMore  = useCallback(() => setMoreOpen(false), [])
  const closeQuick = useCallback(() => setQuickOpen(false), [])

  const bar = bottomBar(toNavRole(isAdmin), features)
  const quickActions = visibleQuickActions(features)
  const hasMore = bar.moreGroups.length > 0 || bar.moreFooter.length > 0 || isAdmin

  const sheetItems = [...bar.moreGroups.flatMap((g) => g.items), ...bar.moreFooter]
  const moreActive = sheetItems.some((i) => !i.locked && isNavActive(pathname, i.href(slug)))

  // Admin: los ítems se reparten a ambos lados del "+" (Inicio · Agenda | Fila).
  const leftItems  = bar.showQuick ? bar.items.slice(0, 2) : bar.items
  const rightItems = bar.showQuick ? bar.items.slice(2) : []

  const renderTab = (item: VisibleNavItem) => {
    const href = item.href(slug)
    const active = isNavActive(pathname, href)
    return (
      <li key={item.id} className="flex-1 min-w-0">
        <Link
          id={item.id}
          href={href}
          aria-label={item.label}
          aria-current={active ? 'page' : undefined}
          className={`${TAB_BASE} ${active ? 'text-xinuco-primary' : 'text-xinuco-muted active:text-xinuco-text'}`}
        >
          <item.icon size={22} strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
          <span className="max-w-full truncate text-xs font-medium leading-tight">{item.shortLabel ?? item.label}</span>
        </Link>
      </li>
    )
  }

  return (
    <>
      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-xinuco-border bg-xinuco-bg/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto flex max-w-xl items-center justify-around px-1">
          {leftItems.map(renderTab)}

          {bar.showQuick && (
            <li className="flex flex-1 min-w-0 items-center justify-center">
              <button
                type="button"
                id="nav-quick-actions"
                onClick={() => setQuickOpen(true)}
                aria-label="Acciones rápidas"
                aria-haspopup="dialog"
                aria-expanded={quickOpen}
                className="-mt-5 flex h-[52px] w-[52px] items-center justify-center rounded-full shadow-lg active:scale-95 transition-transform"
                style={{ backgroundColor: 'var(--primary-color)', color: 'var(--bg-color)' }}
              >
                <Plus size={26} strokeWidth={2.25} aria-hidden="true" />
              </button>
            </li>
          )}

          {rightItems.map(renderTab)}

          {hasMore && (
            <li className="flex-1 min-w-0">
              <button
                type="button"
                id="nav-more"
                onClick={() => setMoreOpen(true)}
                aria-label="Más opciones"
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                aria-current={moreActive ? 'page' : undefined}
                className={`${TAB_BASE} ${moreActive ? 'text-xinuco-primary' : 'text-xinuco-muted active:text-xinuco-text'}`}
              >
                <MoreHorizontal size={22} strokeWidth={moreActive ? 2.25 : 1.75} aria-hidden="true" />
                <span className="text-xs font-medium leading-tight">Más</span>
              </button>
            </li>
          )}
        </ul>
      </nav>

      {/* ── Acciones rápidas ─────────────────────────────── */}
      <BottomSheet open={quickOpen} onClose={closeQuick} title="Acciones rápidas">
        <ul className="flex flex-col gap-2 pt-1">
          {quickActions.map((a) => (
            <li key={a.id}>
              <Link
                href={a.href(slug)}
                onClick={closeQuick}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-xinuco-border bg-xinuco-surface px-3 py-2 active:bg-white/[0.06]"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'color-mix(in srgb, var(--primary-color) 15%, transparent)', color: 'var(--primary-color)' }}
                >
                  <a.icon size={20} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-xinuco-text">{a.label}</span>
                  <span className="block text-xs text-xinuco-muted">{a.hint}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </BottomSheet>

      {/* ── Más ──────────────────────────────────────────── */}
      <BottomSheet open={moreOpen} onClose={closeMore} title="Menú">
        {bar.moreGroups.map((group) => (
          <section key={group.id} aria-label={group.label ?? 'Más'} className="pt-2">
            {group.label && (
              <h3 className="px-1 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-xinuco-muted">
                {group.label}
              </h3>
            )}
            <ul className="grid grid-cols-3 gap-2">
              {group.items.map((item) => {
                const href = item.href(slug)
                const active = isNavActive(pathname, href) && !item.locked
                return (
                  <li key={item.id}>
                    <Link
                      href={href}
                      onClick={closeMore}
                      aria-current={active ? 'page' : undefined}
                      className={`relative flex min-h-[84px] h-full w-full flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-center transition-colors
                        ${item.locked ? 'opacity-50' : ''}
                        ${active
                          ? 'border-[color-mix(in_srgb,var(--primary-color)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary-color)_10%,transparent)] text-xinuco-text'
                          : 'border-xinuco-border bg-xinuco-surface text-xinuco-muted active:bg-white/[0.06]'}`}
                    >
                      <item.icon
                        size={22}
                        strokeWidth={1.75}
                        aria-hidden="true"
                        style={active ? { color: 'var(--primary-color)' } : undefined}
                      />
                      <span className="line-clamp-2 text-xs font-medium leading-tight">{item.label}</span>
                      {item.locked && (
                        <Lock size={12} aria-label="Restringido" className="absolute right-1.5 top-1.5 opacity-70" />
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        <div className="mt-4 flex flex-col gap-2 border-t border-xinuco-border pt-3">
          {bar.moreFooter.map((item) => {
            const href = item.href(slug)
            const active = isNavActive(pathname, href)
            return (
              <Link
                key={item.id}
                href={href}
                onClick={closeMore}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium
                  ${active ? 'bg-[color-mix(in_srgb,var(--primary-color)_10%,transparent)] text-xinuco-text' : 'text-xinuco-text active:bg-white/[0.06]'}`}
              >
                <item.icon size={22} strokeWidth={1.75} aria-hidden="true" />
                {item.label}
              </Link>
            )
          })}
          <button
            type="button"
            onClick={() => startTransition(async () => { await logout() })}
            disabled={isPending}
            className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium text-red-500 active:bg-red-500/10 disabled:opacity-50"
          >
            {isPending ? <Loader2 size={22} className="animate-spin" /> : <LogOut size={22} strokeWidth={1.75} />}
            {isPending ? 'Saliendo...' : 'Cerrar sesión'}
          </button>
        </div>
      </BottomSheet>
    </>
  )
}
