# Arquitectura del sistema

Este documento describe la arquitectura técnica del sistema Farmacias
TKL: las piezas que la componen, cómo se conectan, qué responsabilidad
tiene cada una y por qué se eligió cada decisión.

---

## Vista de 10.000 metros

```
                    ┌──────────────────┐
                    │   USUARIOS       │
                    │  (Browser/PWA)   │
                    └────────┬─────────┘
                             │ HTTPS
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                                 ▼
    ┌──────────────┐                  ┌──────────────────┐
    │ Operativa    │                  │ Dashboard Ejec.  │
    │ YOUR_DOMAIN  │                  │ dashboard.YOUR_  │
    └──────┬───────┘                  └──────────┬───────┘
           │  (mismo Vercel project, host routing en middleware)
           └──────────────┬─────────────────────┘
                          ▼
            ┌────────────────────────┐
            │  Vercel — Next.js 14   │
            │  - App Router (server) │
            │  - API routes          │
            │  - Middleware (edge)   │
            │  - PWA manifest        │
            └─────┬────────┬─────────┘
                  │        │
        ┌─────────┘        └──────────┐
        ▼                             ▼
  ┌──────────┐              ┌─────────────────┐
  │   Neon   │              │  Google Drive   │
  │ Postgres │              │  - SALDOS.xlsx  │
  │ (DB)     │              │  - 33 CSVs SIAF │
  └──────────┘              └────────┬────────┘
                                     │
                                     ▼
                          ┌──────────────────────────┐
                          │ Servidor TKL (Windows)   │
                          │ - SIAF (DBF)             │
                          │ - script Python diario   │
                          │ - sube CSVs a Drive      │
                          └──────────────────────────┘

                                ▲
                                │ POST /api/sync/trigger
                                │ Bearer auth
                                │
                          ┌─────────────────┐
                          │ GitHub Actions  │
                          │ cron 3× por día │
                          └─────────────────┘
```

---

## Componentes

### 1. Frontend / Backend monolítico — Next.js 14 (App Router)

**Stack**:
- Next.js 14.2 (App Router)
- React 18
- TypeScript 5
- Tailwind CSS
- TanStack Query v5 (cliente)
- React Hook Form + Zod (formularios)
- Recharts (gráficos)
- @react-pdf/renderer (PDFs server-side)

**Hosting**: Vercel.

**Una sola app, dos hosts**: el proyecto se sirve bajo dos dominios:
- `YOUR_DOMAIN` — operativa (RRHH, sucursales, etc.)
- `dashboard.YOUR_DOMAIN` — dashboard ejecutivo

El `middleware.ts` discrimina por `host` y permite/restringe rutas
según el dominio. Esto evita gestionar dos proyectos separados con
sus propias env vars y deploys.

**Estructura de routing** (`src/app/`):

| Grupo | Hosts | Contenido |
|---|---|---|
| `(auth)` | ambos | login, cambiar-password |
| `(dashboard)` | operativa | módulos RRHH, panel `/owner`, panel `/admin` |
| `(executive)` | dashboard | dashboard ejecutivo |
| `api/` | ambos | endpoints (operativos, ejecutivos, sync) |

### 2. Base de datos — Neon Postgres

**Stack**:
- PostgreSQL 15+
- Neon serverless (compute autosuspende cuando idle)
- Prisma 5 como ORM
- Connection pooler de Neon (URL con `-pooler` en hostname)

**Schema**: ver [database/neon-schema.md](../database/neon-schema.md).

**Modo de deploy del schema**: `prisma db push` (sin migrations).
**Por qué**: el schema todavía está en flujo activo, las migrations
añaden overhead que no compensa en esta etapa. Cuando estabilice,
considerar migrar a `prisma migrate`.

**Idle wakeup**: Neon suspende el compute después de ~5 min sin queries.
La primera query post-idle puede tardar 5-10s. Ver
[TROUBLESHOOTING.md](../TROUBLESHOOTING.md).

### 3. Auth — NextAuth v5 + bcrypt

**Stack**:
- `next-auth@^5.0.0-beta.22`
- Strategy: JWT (no DB sessions consultadas)
- Provider: Credentials (email + password)
- Hash: `bcryptjs`

Detalle completo en [SECURITY.md](../SECURITY.md).

### 4. Sincronización de datos externos

Pipeline diario:

```
03:00 ART  Servidor TKL Windows
           ├─ Task Scheduler ejecuta siaf_to_drive.py
           ├─ Lee DBF de SIAF (sistema de ventas legacy)
           ├─ Genera 33 CSVs (11 sucursales × 3 archivos)
           └─ Sube CSVs a Drive (carpeta `diario/`)

04:00 ART  GitHub Actions cron #1
           ├─ POST /api/sync/trigger {"source":"all"}
           ├─ Vercel: syncBalances() (NO_FILE → STALE en domingo)
           └─ Vercel: syncSales() lee CSVs y carga incremental

08:30 ART  Administración manual
           └─ Sube SALDOS.xlsx actualizado a Drive

08:50 ART  GitHub Actions cron #2
           └─ Mismo trigger; saldos detecta nuevo modifiedTime y carga

09:30 ART  GitHub Actions cron #3
           └─ Captura updates posteriores en SALDOS.xlsx
```

Detalle: [integrations/siaf-sync.md](../integrations/siaf-sync.md) +
[operations/daily-operations.md](../operations/daily-operations.md).

### 5. Cron — GitHub Actions

**Por qué GitHub Actions y no Vercel Cron**:
- GitHub Actions es free para repos privados (con cuota generosa).
- Vercel Cron está disponible en Pro+, suma costo.
- GitHub Actions da retry y manual dispatch (workflow_dispatch).

**Workflow**: `.github/workflows/daily-sync.yml`. Tres `cron:` schedules
y un `workflow_dispatch` para retry manual.

### 6. Servidor TKL — Windows + Python

El sistema legacy SIAF corre en un servidor Windows interno con archivos
DBF. Un script Python (`scripts/server/siaf_to_drive.py`) extrae los
datos y los sube a Drive.

**Componentes en el servidor**:
- `python.exe` 3.10+ con `dbfread`.
- `C:\TKL\siaf_sync\siaf_to_drive.py` — script principal.
- `C:\TKL\siaf_sync\credentials.json` — Service Account de Google.
- `C:\TKL\siaf_sync\tkl_sync_control.json` — registro de hasta qué fecha procesó cada sucursal.
- `C:\TKL\siaf_sync\tkl_sync.log` — log rotativo.
- Carpeta de red `\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\` — destino temporal antes de upload a Drive.

**Distribución**: ZIP `TKL-SIAF-Setup.zip` con instalación en
`scripts/server/INSTALACION.md`. Se regenera localmente cada vez que
se cambia el script.

### 7. PWA

`public/manifest.json` + íconos generados desde `public/logo-source.jpeg`
con `scripts/generate-pwa-icons.ts` (usa `sharp`).

Iconos:
- `icon-192.png`
- `icon-512.png`
- `apple-touch-icon.png`

---

## Decisiones arquitecturales clave

### ¿Por qué un solo proyecto Vercel para dos hosts?

Operativa y ejecutivo comparten:
- Auth (mismos usuarios, misma DB).
- Componentes UI (Sidebar, TopBar, modales).
- Conexión a DB.

Tener dos proyectos separados duplicaría env vars, deploys, builds y
complicaría el linkeo cross-app (botón "Dashboard Ejecutivo" en operativa
y viceversa). El `middleware.ts` de Next se ejecuta en edge y discrimina
por `host` con bajo costo.

### ¿Por qué Drive como buzón intermedio?

El sistema SIAF vive en una red corporativa interna (no expuesta a
internet). Vercel no puede consultarlo directamente. Drive funciona
como buffer:
- Servidor TKL escribe a Drive (push).
- Vercel lee de Drive (pull).
- No hay conexiones inbound al servidor TKL — minimiza superficie de ataque.

### ¿Por qué idempotencia por modifiedTime y no por fecha de procesamiento?

El admin a veces sube el Excel y luego lo corrige (errores de carga,
saldos faltantes, etc.). Si la idempotencia fuera "ya procesé esto hoy
→ skip", el segundo run perdería las correcciones.

`SourceFile.modifiedTime` registra el `modifiedTime` del archivo Drive
al momento de procesar. Si entre dos runs el admin modifica el Excel,
el `modifiedTime` cambia y reprocesamos. Si no cambió, skip.

### ¿Por qué dos índices `cpbt_meta` y `cpbt_meta_by_numero`?

En el script Python, al cruzar líneas de DETMOV con CPBTEMI, a veces
las fechas no coinciden (cierres tardíos, líneas registradas al día
siguiente). El índice exacto `(NUMERO, fecha_yyyymmdd)` cubre el 99%
de los casos; el fallback `by_numero` (sin fecha) rescata el resto.
Si hay colisión de NUMERO entre fechas, la última gana — aceptable
para nuestro uso.

Más en [integrations/siaf-sync.md](../integrations/siaf-sync.md).

### ¿Por qué dos tipos de stale (saldos vs ventas)?

Los saldos los sube manualmente Administración (humano → posible
olvido). Las ventas las genera automáticamente el script Python (raro
que falle sin avisar).

**Stale "real"**: el dato es anterior a ayer. Hay que actuar.
**Stale "legítimo"**: el dato es de ayer y hoy es domingo o feriado.
Es lo más reciente posible — no actuar, solo informar.

La lógica vive en `src/app/(executive)/executive/page.tsx`:

```ts
if (isStaleSales && sales.length > 0 && salesDate.getTime() >= yesterdayArt.getTime()) {
  isStaleSales = false;  // ayer es OK, no es realmente stale
}
```

### ¿Por qué dos universos de permisos (rol vs puesto)?

- **Rol** (Universo A): decide a qué módulos podés entrar. Pocos roles
  (6), agnóstico de la sucursal.
- **Puesto** (Universo B): decide qué acciones granulares podés hacer.
  Muchos puestos (cajera, cadete, encargada, ...), por sucursal.

El sistema legacy era todo por rol y se hacía inmanejable cuando
"cajera de Tekiel puede hacer X pero cajera de Galesa no". El sistema
de permisos por puesto modela esto naturalmente.

Coexisten porque la migración es módulo a módulo. Ver
[permissions/permission-system.md](../permissions/permission-system.md).

### ¿Por qué no usamos Vercel Cron?

- Más caro (Pro+).
- GitHub Actions provee `workflow_dispatch` para retry manual sin
  tener que apuntar `curl` a Vercel.
- Logs y retry tracking más estables en GitHub.

### ¿Por qué no usamos Prisma migrations?

Schema en flujo activo. `db push` es más rápido y no genera artifacts
de migration que después rotan al modificar otro campo. Cuando el
modelo estabilice (>1 año sin cambios significativos), considerar
migrate.

---

## Diagrama de flujo de datos para una request típica

### Caso: usuario carga `/executive` en producción

```
1. Browser envía GET https://dashboard.YOUR_DOMAIN/executive
   ├─ Cookie: next-auth.session-token=<JWT>
   │
2. Vercel edge: middleware.ts
   ├─ Verifica session (JWT)
   ├─ host empieza con "dashboard." → branch executive
   ├─ canViewExecutive(user) → true (OWNER o flag)
   └─ NextResponse.next() con header x-host-type
   │
3. Vercel server: app/(executive)/executive/page.tsx
   ├─ getArtToday() → 2026-05-06 00:00 UTC
   ├─ Prisma queries:
   │   ├─ bankBalanceSnapshot.findMany({ snapshotDate: today, ... })
   │   ├─ salesSnapshot.findMany({ snapshotDate: today, ... })
   │   ├─ branch.findMany({ active: true })
   │   └─ syncLog.findFirst({ source: GOOGLE_DRIVE })
   ├─ Procesa y agrupa
   ├─ Renderiza ExecutiveDashboard con datos
   │
4. Browser recibe HTML server-rendered
   ├─ Hidratación React
   └─ Tabs interactivos disponibles
```

### Caso: GitHub Actions dispara sync

```
04:00 ART (07:00 UTC)
   │
1. GitHub Actions inicia workflow daily-sync.yml
   ├─ Reads secrets DASHBOARD_URL, SYNC_WEBHOOK_SECRET
   │
2. curl POST $DASHBOARD_URL/api/sync/trigger
   ├─ Authorization: Bearer $SYNC_WEBHOOK_SECRET
   ├─ Body: {"source":"all"}
   │
3. Vercel: api/sync/trigger
   ├─ Valida Bearer token (vs SYNC_WEBHOOK_SECRET env)
   ├─ Si "all": llama a syncBalances() y syncSales() en paralelo
   │
4. syncBalances():
   ├─ Drive API: getBalancesFileBuffer(GOOGLE_DRIVE_FOLDER_ID)
   ├─ Si NO_FILE → log y return
   ├─ Si modifiedTime != hoy → STALE, skip
   ├─ Si SourceFile.modifiedTime == fileModifiedTime → idempotente, skip
   ├─ parseBalancesExcel(buffer)
   ├─ for each row: prisma.bankBalanceSnapshot.upsert()
   ├─ prisma.sourceFile.upsert({ modifiedTime: ... })
   └─ writeSyncLog(...)
   │
5. syncSales():
   ├─ Drive API: downloadSalesCSVs(GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID)
   ├─ Devuelve sets agrupados por sucursal (ventas, vendedores, ossocial)
   ├─ for each set:
   │   ├─ resolveBranchId(name)
   │   ├─ parseSalesCSV() / parseSalesVendedoresCSV() / parseSalesOSSocialCSV()
   │   ├─ Filtrar > lastSnap por sucursal
   │   ├─ Construir batch
   │   └─ prisma.salesSnapshot.createMany({ skipDuplicates: true })
   └─ writeSyncLog(...)
   │
6. Response: 200 OK { results: { balances, sales } }
```

---

## Versionamiento y compatibilidad

- **Next.js**: pinned en 14.2.35.
- **Prisma**: 5.22.0.
- **NextAuth**: beta de v5 — atención a breaking changes en futuros
  bumps.
- **Node**: 20+ requerido (Vercel default).
- **PostgreSQL**: 14+ (Neon corre 15+).

---

## Referencias cruzadas

- [database/neon-schema.md](../database/neon-schema.md) — modelo de datos.
- [SECURITY.md](../SECURITY.md) — auth y autorización.
- [integrations/siaf-sync.md](../integrations/siaf-sync.md) — pipeline SIAF.
- [permissions/permission-system.md](../permissions/permission-system.md) — universos A/B.
- [deploy/vercel-deploy.md](../deploy/vercel-deploy.md) — deployment.
