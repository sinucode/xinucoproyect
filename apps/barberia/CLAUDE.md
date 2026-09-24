# Xinuco · apps/barberia — Vertical Barbería

Es la **zona raíz** del dominio `xinuco.com`. Sirve:
- `xinuco.com/adminbarberia` — consola de la vertical (el `super_admin` gestiona **todas** las barberías)
- `xinuco.com/[slug]/...` — back-office de cada barbería (dueño/staff) + reservas públicas

Puerto de desarrollo: **3001**.

## Mapa de carpetas
```
app/
  adminbarberia/
    login/              ← solo redirige al login único /admin/login (apps/web)
    (dashboard)/        ← consola de la vertical (negocios de barbería)
  [slug]/
    page.tsx            ← vitrina pública / redirección a book
    login/              ← login del dueño/staff
    book/               ← wizard de reservas públicas
    dashboard/          ← back-office (appointments, accounting, crm, inventory…)
      settings/         ← config del negocio (branding, billing, availability…)
  book/result/          ← resultado de pago MercadoPago
  auth/callback/        ← OAuth Google
  api/
    webhooks/mercadopago/
    cron/send-reminders/
components/
  dashboard/            ← todos los módulos del back-office (agenda, caja, staff…)
  booking/              ← wizard de reservas públicas
  finance/              ← POS, checkout modal
  pos/                  ← punto de venta
  layout/               ← Header, BottomNav, DashboardSidebar, UserDropdown
  ui/                   ← primitivas UI (se moverán a packages/ui en Fase 2)
actions/
  auth.ts               ← login/logout de tenants y super_admin (barbería)
  appointments.ts, staff.ts, commissions.ts, … ← operaciones de la vertical
  businesses.ts         ← operaciones de negocio (getBusinessBySlug, etc.)
lib/
  supabase/             ← cliente + middleware multi-tenant Zero-DB
  features/             ← feature flags (config.ts, context.tsx, role-context.tsx)
  email/                ← plantillas y notificaciones Resend
  mercadopago/          ← helpers de pagos
  hooks/                ← hooks React compartidos de la vertical
  utils/
types/                  ← tipos de BD (Database, Business, UserRole…)
supabase/migrations/    ← esquema de barbería (multi-tenant, RLS, etc.)
e2e/                    ← tests Playwright
middleware.ts           ← RESERVED_SLUGS, /[slug]→/book, bloqueo cross-tenant,
                           rewrite de / y /admin hacia apps/web
```

## Base de datos
**Supabase BARBERÍA** — datos + auth de tenants. Multi-tenant por `business_id`.  
RLS con `auth.jwt() ->> 'business_id'`; slug inyectado por RPC `secure_set_user_context`.  
El super_admin valida su identidad contra CONTROL (misma cookie/dominio → SSO).  
En Fase 1 comparte la misma base que `apps/web` (separación en Fase 4).

## Multi-zone (zona raíz del dominio)
`next.config.mjs` reescribe `/` y `/admin/*` hacia `apps/web` (porta 3000 en dev, `WEB_ZONE_URL` en prod).  
`middleware.ts` gestiona el catch-all de `/[slug]` y los slugs reservados; deja pasar `/admin*` sin tocarlo (el middleware corre antes que los rewrites).
El login del super_admin es único: `/admin/login` en apps/web. Para enlaces/redirects entre zonas usar `adminLoginUrl()` / `BARBERIA_URL` de `@xinuco/utils` (`NEXT_PUBLIC_WEB_URL` / `NEXT_PUBLIC_BARBERIA_URL`, vacías en prod).

## Comandos
```bash
npm run dev         # inicia en :3001 (necesita apps/web en :3000 para / y /admin)
npm run build
npm run test        # jest
npm run test:e2e    # playwright
tsc --noEmit
```

## Variables de entorno clave
Ver `.env.example`. `WEB_ZONE_URL=http://localhost:3000` en desarrollo.
