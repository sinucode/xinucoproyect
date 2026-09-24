# Xinuco · apps/web — Plataforma

Sirve `xinuco.com/` (landing) y `xinuco.com/admin` (panel GENERAL de **todas** las verticales).  
Puerto de desarrollo: **3000**.

## ¿Qué NO está aquí?
La lógica operativa de barbería (citas, caja, staff, comisiones…) vive en `apps/barberia`.  
Aquí solo lo transversal/global: la plataforma y el admin general.

## Mapa de carpetas
```
app/
  page.tsx              ← landing pública (xinuco.com/)
  layout.tsx            ← root layout de la plataforma
  globals.css
  admin/
    login/page.tsx      ← login del super_admin
    layout.tsx          ← guard super_admin + nav del admin global
    page.tsx            ← redirige a /admin/verticales
    verticales/         ← lista de verticales (home del admin global)
    businesses/         ← listado y gestión de negocios de TODAS las verticales
      [businessId]/     ← detalle de un negocio (features, trial, usuarios)
components/
  landing/              ← landing page (XinucoLanding.tsx, VERTICALES, etc.)
  admin/                ← componentes del panel admin global
  super-admin/          ← componentes de gestión avanzada (TrialManager, UserManager…)
  ui/                   ← primitivas UI (Button, Input, Skeleton…) — se moverán a packages/ui en Fase 2
actions/
  auth.ts               ← login/logout del super_admin
  admin.ts              ← acciones del admin global (guard super_admin)
  super-admin.ts        ← gestión de negocios, features, trials, usuarios
lib/
  supabase/             ← cliente Supabase (se moverá a packages/supabase en Fase 2)
  features/config.ts    ← FEATURE_CATALOG, PLAN_BUNDLES (se moverá a packages/billing-catalog)
  utils/                ← utilidades (se moverán a packages/utils)
  verticals.ts          ← registro de verticales — agregar aquí cada vertical nueva
types/                  ← tipos de BD (se moverán a packages/types en Fase 2)
middleware.ts           ← guard de /admin + refresco de sesión
```

## Base de datos
**Supabase CONTROL** — auth/identidad del super_admin + registro maestro de negocios.  
En Fase 1 comparte la misma base que `apps/barberia` (separación en Fase 4).

## Seguridad
- Todas las rutas bajo `/admin` exigen `app_metadata.role === 'super_admin'` (guard en layout + middleware).
- `app_metadata` solo es modificable por el service role del servidor (no por el cliente).

## Comandos
```bash
npm run dev      # inicia en :3000
npm run build
npm run test
tsc --noEmit     # typecheck
```

## Variables de entorno clave
Ver `.env.example`. Para Fase 1: mismas credenciales de Supabase que `apps/barberia`.
