# Documentación técnica — Farmacias TKL

Bienvenido a la documentación técnica del sistema Farmacias TKL. Esta carpeta
es el punto de partida para cualquier persona que necesite entender,
operar, modificar o extender la plataforma.

> **Audiencia objetivo**: desarrolladores, devops, dueños del producto.
> Para una visión funcional rápida ver `/README.md` en la raíz del repo.
> Para guía operativa de deploy ver `/DEPLOYMENT.md` en la raíz.

---

## Mapa de la documentación

### Cross-cutting (raíz de `/docs`)

| Archivo | Contenido |
|---|---|
| [README.md](./README.md) | Este índice |
| [CHANGELOG.md](./CHANGELOG.md) | Historial de cambios agrupado por mes y tipo |
| [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) | Catálogo completo de variables de entorno |
| [SECURITY.md](./SECURITY.md) | Modelo de seguridad, auth, roles, secrets |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Diagnóstico de problemas conocidos |

### Por área

| Área | Documento |
|---|---|
| Arquitectura general | [architecture/system-architecture.md](./architecture/system-architecture.md) |
| Schema de base de datos | [database/neon-schema.md](./database/neon-schema.md) |
| Sincronización SIAF | [integrations/siaf-sync.md](./integrations/siaf-sync.md) |
| Dashboard ejecutivo | [frontend/dashboard-executive.md](./frontend/dashboard-executive.md) |
| Sistema de permisos por puesto | [permissions/permission-system.md](./permissions/permission-system.md) |
| Deploy en Vercel | [deploy/vercel-deploy.md](./deploy/vercel-deploy.md) |
| Operaciones diarias | [operations/daily-operations.md](./operations/daily-operations.md) |
| Bugs y limitaciones | [known-issues/current-known-issues.md](./known-issues/current-known-issues.md) |
| Roadmap | [future-roadmap/planned-modules.md](./future-roadmap/planned-modules.md) |

---

## ¿Por dónde empezar?

**Si sos nuevo al proyecto**, leé en este orden:

1. `/README.md` (raíz) — visión funcional de 5 minutos.
2. [architecture/system-architecture.md](./architecture/system-architecture.md) — qué piezas existen y cómo se conectan.
3. [database/neon-schema.md](./database/neon-schema.md) — modelo de datos.
4. [SECURITY.md](./SECURITY.md) — quién puede ver qué.
5. [permissions/permission-system.md](./permissions/permission-system.md) — universo A vs universo B.

**Si vas a operar producción**, leé:

1. [deploy/vercel-deploy.md](./deploy/vercel-deploy.md)
2. [operations/daily-operations.md](./operations/daily-operations.md)
3. [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
4. [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md)

**Si vas a tocar el sync SIAF**, leé:

1. [integrations/siaf-sync.md](./integrations/siaf-sync.md)
2. `scripts/server/INSTALACION.md` (en el repo)
3. [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) sección "Sync"

**Si vas a tocar el dashboard ejecutivo**, leé:

1. [frontend/dashboard-executive.md](./frontend/dashboard-executive.md)
2. [database/neon-schema.md](./database/neon-schema.md) modelos `SalesSnapshot` y `BankBalanceSnapshot`.

---

## Convenciones

- **Lenguaje**: español técnico. Los identificadores de código se mantienen en inglés.
- **Placeholders de credenciales**: jamás aparecen valores reales. Se usa `YOUR_DATABASE_URL`, `YOUR_AUTH_SECRET`, `YOUR_GOOGLE_SERVICE_ACCOUNT_JSON`, `YOUR_DASHBOARD_URL`, etc.
- **Estado de implementación**: cuando algo es placeholder o está pendiente, se marca explícitamente.
- **Cross-links**: cada doc enlaza a otros relevantes.

---

## Estado del proyecto

- **Stack**: Next.js 14 App Router + Prisma 5 + Neon Postgres + NextAuth v5 (JWT) + Tailwind + Vercel.
- **Producción**: deployada en Vercel, una única app con dos hosts (operativo y ejecutivo) discriminados por `host` en `middleware.ts`.
- **Sync SIAF**: pipeline diario activo (Python script en servidor TKL → CSV en Drive → webhook a Vercel → Neon).
- **PWA**: configurada con manifest y íconos generados desde el logo real.
- **Permisos**: dos universos coexistiendo (legacy por rol + granular por puesto). Migración módulo a módulo en curso.

Para el detalle por módulo de qué está funcional vs placeholder ver
[future-roadmap/planned-modules.md](./future-roadmap/planned-modules.md).
