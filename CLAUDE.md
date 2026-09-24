# Xinuco — Monorepo

Plataforma SaaS multi-vertical. **Un repo, cada proyecto físicamente separado** para aislar el contexto de Claude Code.

## Estructura
| Carpeta | Qué es | Supabase |
|---|---|---|
| `apps/web` | Plataforma: landing `xinuco.com/` + `/admin` (admin GENERAL de todas las verticales) | CONTROL |
| `apps/barberia` | Vertical Barbería: `/adminbarberia` (consola de vertical) + `/[slug]` (back-office de cada negocio) | BARBERÍA |
| `packages/*` | Código compartido (`@xinuco/types`, `utils`, `supabase`, `ui`, `billing-catalog`) | — |
| `templates/siguiente-vertical` | Esqueleto copiable para crear una nueva vertical | — |

## Regla de oro — Contexto de Claude Code
**Para trabajar en una vertical, abre Claude con el `cwd` DENTRO de su app:**
```
# Trabajar en barbería:
cd apps/barberia   ← Claude carga apps/barberia/CLAUDE.md únicamente

# Trabajar en la plataforma/web:
cd apps/web        ← Claude carga apps/web/CLAUDE.md únicamente
```
No edites otras apps salvo cambios transversales en `packages/*`.

## Flujo de trabajo — Planificar con Opus, ejecutar con Sonnet
Todo cambio no trivial sigue este flujo:
1. **Planificar con Opus** — investigar el código, diseñar el enfoque y aprobarlo con el usuario antes de tocar nada.
2. **Ejecutar con Sonnet** — la implementación la hace un subagente con `model: sonnet`, con el plan completo en su prompt (archivos, cambios exactos, verificación).
3. **Verificar con Opus** — revisar el diff real del subagente, correr tsc/tests/curl y recién entonces commit + push.

Los agentes a medida de `.claude/agents/` ya declaran `model: sonnet`.

## Comandos (npm workspaces + Turborepo)
```bash
# Instalar (siempre desde la raíz)
npm install

# Dev — cada app en su puerto
turbo run dev --filter=web       # puerto 3000
turbo run dev --filter=barberia  # puerto 3001
turbo run dev                    # ambas en paralelo

# Build, lint, test por app
turbo run build --filter=barberia
turbo run test  --filter=web
turbo run lint  --filter=barberia

# Solo lo afectado desde el último commit
turbo run build --filter=...[HEAD^1]
```

## Convenciones
- Alias `@/*` = raíz de **cada app** (no del monorepo). Lo compartido se importa como `@xinuco/<paquete>` (Fase 2).
- Server Actions (`'use server'`) viven DENTRO de cada app; nunca en `packages/`.
- Una Supabase por vertical. El super_admin se autentica contra CONTROL y tiene SSO bajo `xinuco.com`.
- Fase 1: las apps comparten la misma base Supabase. El split físico es Fase 4.

## Doble Admin
| URL | App | Descripción |
|---|---|---|
| `xinuco.com/admin/login` | `apps/web` | Login ÚNICO del super_admin para todas las verticales |
| `xinuco.com/admin/verticales` | `apps/web` | Admin GENERAL — lista las verticales; cada una abre su consola |
| `xinuco.com/adminbarberia` | `apps/barberia` | Consola BARBERÍA — gestiona las barberías en la base de barbería |

Mismo `super_admin` (una sola cuenta). SSO por cookies del mismo dominio `xinuco.com`.
Nueva vertical → agregarla al registro `apps/web/lib/verticals.ts` para que aparezca en `/admin/verticales`.

## Roadmap de fases
- ✅ **Fase 1** — Monorepo + doble admin + CLAUDE.md por app
- ✅ **Fase 2** — Extraer `packages/*` reales (supabase, types, ui, utils, billing-catalog) y actualizar imports
- 🔲 **Fase 3** — Scaffolding de nuevas verticales desde `templates/siguiente-vertical`
- 🔲 **Fase 4** — Split físico de Supabase por vertical (CONTROL + BARBERÍA)
