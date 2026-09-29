# Farmacias TKL — Sistema de Supervisión Operativa

Plataforma web interna que unifica la gestión de RRHH (operativa diaria de
sucursales) con un dashboard ejecutivo de ventas y saldos bancarios para
Dirección.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 14 (App Router) |
| Auth | NextAuth v5 beta (JWT, Credentials con bcrypt) |
| ORM | Prisma 5 |
| Base de datos | PostgreSQL (Neon en producción) |
| UI | Tailwind CSS |
| State cliente | TanStack Query v5 |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| PDFs | @react-pdf/renderer |
| Excel parsing | xlsx |
| Drive | googleapis (Service Account) |
| Cron | GitHub Actions (3× por día) → webhook a Vercel |
| Deploy | Vercel |
| Runtime | Node.js 20+ |

---

## Módulos principales

### 1. Plataforma operativa (`/dashboard`)
Gestión diaria de RRHH y operación de sucursales:

- **Empleados** — alta, baja, asignación de sucursal
- **Ausencias** — registro, justificación, certificados médicos
- **Vacaciones** — solicitud, aprobación, conflictos con cobertura
- **Rotativas y coberturas** — asignar personal de cobertura ante ausencias
- **Horas extras** — reporte y aprobación
- **Planes de acción** — seguimiento de incidencias por empleado, con PDF
- **Mantenimiento** — tickets por sucursal, asignación, seguimiento
- **Tareas de supervisión** — checklist por sucursal
- **WhatsApp** — vista de mensajes operativos
- **Alertas** — centro de notificaciones operativas

### 2. Dashboard Ejecutivo (`/executive`)
Vista de Dirección con datos del día:

- **5 KPIs**: ventas del día, ticket promedio, unidades, tickets, saldo bancario total
- **Saldos por sucursal**: leído desde un Excel en Google Drive (lo sube
  Administración cada mañana). Expandible por banco/cuenta
- **Ventas por sucursal**: tabla con desglose por Obra Social y Vendedor (datos SIAF)
- **Comparativo**: períodos 7d/14d/21d/30d y mensuales 3m/6m/12m vs año anterior

### 3. Sincronización SIAF (Sistema de Ventas)
Pipeline diario que extrae datos del sistema SIAF (DBF) y los carga en Neon:

- **Servidor de TKL**: script Python (`scripts/server/siaf_to_drive.py`) corre a las 03:00 AM y genera 33 CSVs (11 sucursales × 3 tipos: ventas, vendedores, obras_sociales)
- **Drive**: el script sube los CSVs a una carpeta de Google Drive
- **Webhook**: GitHub Actions dispara 3× por día (09:00, 09:30, 10:00 ART) un sync que lee los CSVs y los inserta en `SalesSnapshot`
- **Idempotencia**: por `modifiedTime` del archivo en Drive — si no cambió, skip

### 4. Panel Dirección (`/owner`) — solo OWNER
Configuración sensible:

- **Accesos al Dashboard Ejecutivo**: otorgar/revocar `executiveAccess` a usuarios específicos
- **Gestión de usuarios**: alta/baja/edición de cualquier rol (incluido OWNER y ADMIN)
- **Catálogo de puestos** (compartido con ADMIN en `/puestos`): asignar permisos operativos granulares por puesto

### 5. Panel Administración (`/admin`) — solo ADMIN
- **Usuarios operativos**: alta/baja/edición. ADMIN no puede crear ni editar usuarios OWNER ni otros ADMIN
- **Puestos**: ver y gestionar el catálogo (compartido con OWNER)

---

## Roles del sistema

| Rol | Acceso operativo | Dashboard ejecutivo | Panel `/owner` | Panel `/admin` |
|---|---|---|---|---|
| **OWNER** | Total | Sí (siempre) | Sí | No |
| **ADMIN** | Total + admin usuarios operativos | Solo si `executiveAccess=true` | No | Sí |
| **SUPERVISOR** | Amplio (todas las sucursales) | Solo si `executiveAccess=true` | No | No |
| **BRANCH_MANAGER** (Encargada) | Su sucursal | Solo si `executiveAccess=true` | No | No |
| **HR** (RRHH) | Empleados + vacaciones + rotativas | Solo si `executiveAccess=true` | No | No |
| **MAINTENANCE** | Solo mantenimiento | No | No | No |

**Reglas clave:**
- Acceso al Dashboard Ejecutivo = `role === "OWNER"` OR `executiveAccess === true`. El flag lo otorga el OWNER desde `/owner/accesos`.
- ADMIN no puede tocar usuarios OWNER ni a otros ADMIN — solo OWNER puede gestionar esos roles.
- OWNER no puede desactivarse a sí mismo. Tampoco se puede dejar 0 OWNER activos.

**Sistema de permisos por puesto** (Universo B): cada puesto (Cajera, Cadete, Encargada, etc.) puede tener un set de permisos operativos granulares (`vencidos.upload_remito`, `caja.create_close`, etc.) con scope `OWN_BRANCH` o `ALL_BRANCHES`. La infraestructura está completa (Fase 3) — la migración de cada módulo a este sistema es gradual.

---

## Setup local

### Requisitos
- Node.js 20+
- PostgreSQL 14+ corriendo localmente (o usar Neon dev branch)
- npm 10+

### Pasos

```bash
# 1. Clonar
git clone <REPO_URL>
cd farmacias-tkl

# 2. Dependencias
npm install

# 3. Variables de entorno
cp .env.example .env.local
# Editar .env.local con valores reales (ver tabla abajo)

# 4. Base de datos
npm run db:push      # Aplica el schema a la DB local
npm run db:seed      # Carga usuarios y datos de ejemplo

# 5. Dev server
npm run dev
# → http://localhost:3000
```

### Usuarios seed (solo dev)
El `db:seed` crea usuarios con contraseña genérica `TKL.Dev.2025!`. En el primer login se les pide cambiarla.

| Email | Rol |
|---|---|
| `admin@COMPANY_DOMAIN` | ADMIN |
| `dueno@COMPANY_DOMAIN` | OWNER |
| `supervisor@COMPANY_DOMAIN` | SUPERVISOR |
| `rrhh@COMPANY_DOMAIN` | HR |
| `mantenimiento@COMPANY_DOMAIN` | MAINTENANCE |
| `tekiel@COMPANY_DOMAIN`, `galesa@COMPANY_DOMAIN`, etc. | BRANCH_MANAGER |

En producción **nunca** se usa el seed: cada usuario se crea desde `/admin/usuarios` o `/owner/usuarios` y recibe una contraseña temporal única (visible una sola vez).

### Scripts npm

| Script | Acción |
|---|---|
| `npm run dev` | Dev server con hot-reload |
| `npm run build` | Build de producción (verifica TS) |
| `npm run start` | Server de producción local |
| `npm run lint` | ESLint |
| `npm run db:generate` | Regenerar cliente Prisma |
| `npm run db:push` | Aplicar schema a DB (sin migration history) |
| `npm run db:seed` | Cargar datos iniciales (solo dev) |
| `npm run db:studio` | Prisma Studio (UI de DB) |
| `npm run db:reset` | Reset completo + push + seed (DESTRUCTIVO) |

---

## Variables de entorno

Lista de variables requeridas. Sin valores reales — copiar `.env.example` y completar.

| Variable | Descripción | Placeholder |
|---|---|---|
| `DATABASE_URL` | Connection string Postgres | `<CONNECTION_STRING_POSTGRES>` — esquema `postgresql`, con usuario, password, host y base; terminada en `?sslmode=require` |
| `AUTH_SECRET` | Secret para firmar JWTs (NextAuth v5). Generar con `openssl rand -base64 32` | `YOUR_AUTH_SECRET` |
| `NEXTAUTH_URL` | URL pública de la app | `https://YOUR_DOMAIN` |
| `NODE_ENV` | `development`, `production` o `test` | `development` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON del Service Account de Google (en una sola línea) | `{"type":"service_account",...}` |
| `GOOGLE_DRIVE_FOLDER_ID` | ID de la carpeta Drive del Excel de saldos | `YOUR_DRIVE_FOLDER_ID` |
| `GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID` | ID de la carpeta Drive donde el script Python sube los CSVs SIAF | `YOUR_DRIVE_FOLDER_ID` |
| `SYNC_WEBHOOK_SECRET` | Bearer token que valida `/api/sync/trigger`. Generar con `openssl rand -base64 32` | `YOUR_WEBHOOK_SECRET` |
| `EXECUTIVE_DASHBOARD_URL` | URL del dashboard ejecutivo (server-side) | `https://dashboard.YOUR_DOMAIN` |
| `NEXT_PUBLIC_EXECUTIVE_DASHBOARD_URL` | URL del dashboard ejecutivo (cliente) | `https://dashboard.YOUR_DOMAIN` |

> ⚠️ **Nota sobre `AUTH_SECRET` vs `NEXTAUTH_SECRET`:** NextAuth v5 cambió la convención. El código usa `AUTH_SECRET`. Si copiás `.env.example`, asegurate de usar el nombre `AUTH_SECRET` y no `NEXTAUTH_SECRET`.

---

## Estructura del proyecto

```
src/
├── app/
│   ├── (auth)/         — login, cambiar-password
│   ├── (dashboard)/    — plataforma operativa (todos los roles)
│   │   ├── owner/      — panel Dirección (solo OWNER)
│   │   ├── admin/      — panel Administración (solo ADMIN)
│   │   └── ...         — empleados, ausencias, vacaciones, etc.
│   ├── (executive)/    — dashboard ejecutivo
│   ├── api/            — endpoints
│   │   ├── owner/      — APIs solo OWNER
│   │   ├── admin/      — APIs solo ADMIN
│   │   ├── permissions/    — catálogo de permisos
│   │   ├── positions/      — puestos + permisos por puesto
│   │   ├── sync/           — webhook de sincronización (Bearer auth)
│   │   └── dashboard/      — APIs del ejecutivo
│   └── layout.tsx
├── components/
│   ├── layout/         — Sidebar, TopBar, DashboardShell
│   ├── executive/      — KPICard, BalanceTable, SalesTable, ComparativeSection
│   └── ConfirmModal.tsx
├── lib/
│   ├── auth.ts         — config NextAuth
│   ├── prisma.ts       — cliente Prisma singleton
│   ├── permissions.ts  — ROUTE_PERMISSIONS + helpers legacy + canViewExecutive
│   ├── permissions/
│   │   └── position-permissions.ts  — sistema de permisos por puesto
│   ├── passwords.ts    — generador de passwords aleatorios
│   ├── sync/           — lógica de sincronización
│   │   ├── sync-balances.ts  — Excel Drive → BankBalanceSnapshot
│   │   └── sync-sales.ts     — CSVs SIAF Drive → SalesSnapshot
│   └── integrations/   — google-drive, excel-parser, csv-sales-parser
├── middleware.ts       — host routing + canAccessRoute + canViewExecutive
└── types/

prisma/
├── schema.prisma       — modelo de datos
└── seed.ts             — datos iniciales (solo dev)

scripts/
├── server/             — scripts del servidor SIAF (Python)
│   ├── siaf_to_drive.py        — extrae DBF → CSVs → Drive
│   ├── INSTALACION.md
│   └── requirements.txt
├── load-sales-history.ts       — carga inicial del histórico SIAF
├── seed-permissions.ts         — seed idempotente de permisos
├── backfill-executive-access.ts — backfill OWNER
└── test-position-permissions.ts — validación helpers de permisos

.github/
└── workflows/
    └── daily-sync.yml  — cron 3× por día
```

---

## Deploy en producción

Ver **[DEPLOYMENT.md](./DEPLOYMENT.md)** para la guía completa: arquitectura,
env vars de Vercel, GitHub Actions secrets, configuración del script Python
del servidor SIAF, proceso de sync diario, carga histórica inicial y
troubleshooting.

---

## Soporte

Sistema construido para Farmacias TKL.
Repositorio privado, acceso restringido al equipo autorizado.
