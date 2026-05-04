# DEPLOYMENT — Farmacias TKL

Guía operativa de producción. Cubre arquitectura, configuración de servicios
externos, flujo de sincronización, carga inicial y troubleshooting.

> Para descripción del producto y setup local ver **[README.md](./README.md)**.

---

## Arquitectura de producción

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USUARIOS                                     │
└──────────┬──────────────────────────────────────┬───────────────────┘
           │                                      │
           ▼                                      ▼
   ┌───────────────────┐                  ┌──────────────────────┐
   │   Operativa       │                  │ Dashboard Ejecutivo  │
   │   YOUR_DOMAIN     │                  │ dashboard.YOUR_DOMAIN│
   └─────────┬─────────┘                  └──────────┬───────────┘
             │ same Vercel project, host routing en middleware
             └──────────────┬─────────────────────────┘
                            │
                            ▼
                ┌──────────────────────┐
                │  Vercel (Next.js 14) │
                │  - app operativa     │
                │  - app ejecutivo     │
                │  - APIs              │
                │  - sync webhook      │
                └────┬───────────┬─────┘
                     │           │
             ┌───────┘           └──────────┐
             ▼                              ▼
   ┌───────────────────┐         ┌──────────────────────┐
   │   Neon Postgres   │         │   Google Drive       │
   │   (DB principal)  │         │   - Excel saldos     │
   │                   │         │   - 33 CSVs SIAF     │
   └───────────────────┘         └──────────┬───────────┘
                                            │
                                            ▼
                                ┌────────────────────────┐
                                │ Servidor TKL (Windows) │
                                │  - script Python 03:00 │
                                │  - extrae DBF SIAF     │
                                │  - sube CSVs a Drive   │
                                └────────────────────────┘
                                            ▲
                                            │
   ┌────────────────────────────────────────┘
   │  GitHub Actions (3× por día)
   │  - 09:00 ART → POST /api/sync/trigger
   │  - 09:30 ART → POST /api/sync/trigger
   │  - 10:00 ART → POST /api/sync/trigger
```

**Componentes:**
- **Vercel** — hosting de Next.js. Single project con dos hosts (operativo y ejecutivo) discriminados por `host` en `middleware.ts`.
- **Neon Postgres** — DB serverless. Schema gestionado vía Prisma `db push`.
- **Google Drive** — buzón intermedio entre fuentes (Excel manual + CSVs Python) y Vercel. El sync los lee usando un Service Account de Google.
- **GitHub Actions** — cron que dispara el webhook de sync (Vercel cron también podría usarse, pero GitHub Actions es free y suficiente).
- **Servidor TKL Windows** — host del SIAF (sistema de ventas en DBF). Corre el script Python diariamente para exportar a CSV y subirlos a Drive.

---

## Variables de entorno en Vercel

Configurar en **Vercel → Settings → Environment Variables**.
Aplicar a **Production** y **Preview** (no a Development salvo que se use el mismo Neon).

### Auth y app

| Variable | Descripción | Ejemplo |
|---|---|---|
| `AUTH_SECRET` | Secret para firmar JWTs (NextAuth v5). Generar con `openssl rand -base64 32`. **No usar `NEXTAUTH_SECRET`** — el código lee `AUTH_SECRET` | `YOUR_AUTH_SECRET` |
| `NEXTAUTH_URL` | URL pública del operativo | `https://YOUR_DOMAIN` |
| `NODE_ENV` | Siempre `production` en Vercel | `production` |

### Base de datos

| Variable | Descripción | Ejemplo |
|---|---|---|
| `DATABASE_URL` | Connection string de Neon, con `?sslmode=require` | `postgresql://USER:PASS@HOST.neon.tech/DBNAME?sslmode=require` |

### Google Drive integration

| Variable | Descripción | Ejemplo |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON entero del Service Account, en una sola línea | `{"type":"service_account","project_id":"YOUR_PROJECT",...}` |
| `GOOGLE_DRIVE_FOLDER_ID` | ID de la carpeta Drive donde Administración sube el Excel `SALDOS.xlsx` | `YOUR_DRIVE_FOLDER_ID` |
| `GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID` | ID de la carpeta `diario/` donde el script Python sube los CSVs SIAF | `YOUR_DRIVE_FOLDER_ID` |

### Sync webhook

| Variable | Descripción | Ejemplo |
|---|---|---|
| `SYNC_WEBHOOK_SECRET` | Bearer token que valida `POST /api/sync/trigger`. Debe coincidir con el secret de GitHub Actions. Generar con `openssl rand -base64 32` | `YOUR_WEBHOOK_SECRET` |

### URLs cross-app

| Variable | Descripción | Ejemplo |
|---|---|---|
| `EXECUTIVE_DASHBOARD_URL` | URL del dashboard ejecutivo (server-side) | `https://dashboard.YOUR_DOMAIN` |
| `NEXT_PUBLIC_EXECUTIVE_DASHBOARD_URL` | Misma URL pero accesible desde el cliente (botón "Dashboard Ejecutivo" del TopBar) | `https://dashboard.YOUR_DOMAIN` |

### Cómo configurarlas

1. Vercel dashboard → proyecto → **Settings** → **Environment Variables**.
2. Para cada variable: nombre + valor + scope (`Production`, `Preview`, `Development`).
3. **Producción solamente** para secrets reales. Los Preview deploys (de PRs) deberían apuntar a un Neon branch separado o a la misma Production con cuidado.
4. Después de cambiar variables: redeploy desde Vercel (`Deployments` → último deploy → `Redeploy`).

---

## GitHub Actions secrets

Configurar en **GitHub repo → Settings → Secrets and variables → Actions**.

| Secret | Descripción | Ejemplo |
|---|---|---|
| `DASHBOARD_URL` | URL base del operativo en Vercel (donde está `/api/sync/trigger`) | `https://YOUR_DOMAIN` |
| `SYNC_WEBHOOK_SECRET` | Bearer token. **Debe ser idéntico al de Vercel** | `YOUR_WEBHOOK_SECRET` |

El workflow `.github/workflows/daily-sync.yml` los usa así:

```bash
curl -X POST "${DASHBOARD_URL}/api/sync/trigger" \
  -H "Authorization: Bearer ${SYNC_WEBHOOK_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"source":"all"}'
```

---

## Servidor SIAF (Windows) — script Python

El servidor de TKL corre Windows con el sistema SIAF de ventas (DBF).
Daily, un script Python extrae los DBF, genera CSVs y los sube a Drive.

### Instalación inicial

Ver `scripts/server/INSTALACION.md` para guía detallada. Resumen:

1. **Python 3.10+** instalado en el servidor.
2. **Dependencias**: `pip install -r scripts/server/requirements.txt` (solo `dbfread`).
3. **Service Account credentials**: copiar el JSON del SA a `C:\TKL\siaf_sync\credentials.json` (NO commitear este archivo).
4. **Script principal**: `scripts/server/siaf_to_drive.py`.

### Configuración de carpetas Drive

El SA debe tener acceso a dos carpetas en Drive:

```
TKL-SIAF-CSV/
├── historico/   ← acumulativo, se usa solo en --full-reset y carga inicial
└── diario/      ← solo los días procesados en el run actual (sobreescribe)
```

Pasos:
1. Crear las dos subcarpetas en Drive.
2. Compartir ambas con el email del SA (`SA_EMAIL@PROJECT.iam.gserviceaccount.com`) con permiso de editor.
3. Copiar el ID de `diario/` y configurarlo como `GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID` en Vercel.

### Cron en Windows (Task Scheduler)

Programar `python C:\TKL\siaf_sync\siaf_to_drive.py` para ejecutarse:
- **Trigger**: diario a las 03:00 AM, todos los días (incluido domingo).
- **Acción**: `python.exe` con argumento `C:\TKL\siaf_sync\siaf_to_drive.py`.
- **Working directory**: `C:\TKL\siaf_sync\`.
- **Run as**: usuario con permisos de lectura sobre las DBF y red.

### Carga inicial vs sync diario

El script tiene dos modos:

| Modo | Comando | Comportamiento |
|---|---|---|
| **Diario** (default) | `python siaf_to_drive.py` | Procesa días pendientes desde `control.json` hasta ayer. Sobreescribe los CSVs en `diario/` |
| **Backfill un día** | `python siaf_to_drive.py --date 2026-04-20` | Solo esa fecha. NO actualiza `control.json` |
| **Reset completo** | `python siaf_to_drive.py --full-reset` | Borra `control.json` y reprocesa TODO el historial. Escribe en `historico/`. Pide confirmación interactiva |

`control.json` (ubicado en `C:\TKL\siaf_sync\tkl_sync_control.json`) registra hasta qué fecha se procesó cada sucursal — **NO BORRAR NI EDITAR MANUALMENTE**.

---

## Proceso de sync diario — flujo completo

```
03:00 ART  ┌─ Servidor TKL ─────────────────────────────────────┐
           │ - Task Scheduler dispara siaf_to_drive.py          │
           │ - Lee DBF del SIAF                                 │
           │ - Genera CSVs en \\192.168.0.250\TKL_sync_IA\...\diario\ │
           │ - Drive Desktop sincroniza esa carpeta a Drive    │
           └────────────────────────────────────────────────────┘

08:30 ART  ┌─ Administración ───────────────────────────────────┐
           │ - Sube SALDOS.xlsx actualizado a Drive            │
           └────────────────────────────────────────────────────┘

09:00 ART  ┌─ GitHub Actions ───────────────────────────────────┐
12:00 UTC  │ - Cron dispara workflow daily-sync.yml             │
           │ - POST DASHBOARD_URL/api/sync/trigger              │
           │   {"source":"all"}                                 │
           │   Authorization: Bearer SYNC_WEBHOOK_SECRET        │
           └─────────────┬──────────────────────────────────────┘
                         ▼
           ┌─ Vercel /api/sync/trigger ─────────────────────────┐
           │ - Valida Bearer token                              │
           │ - Llama syncBalances()                             │
           │   - Lee Excel de Drive                             │
           │   - Si modifiedTime no es hoy → STALE, skip        │
           │   - Si ya procesado con mismo modifiedTime → skip  │
           │   - Sino: parse + upsert en BankBalanceSnapshot    │
           │ - Llama syncSales()                                │
           │   - Lee CSVs de la carpeta diario/                 │
           │   - Insert en SalesSnapshot (incremental)          │
           │ - Devuelve { ok: true, results: { ... } }         │
           └────────────────────────────────────────────────────┘

09:30 ART  Idem (catches updates posteriores en el Excel de saldos)
10:00 ART  Idem (margen para Administración tardía)
```

**Idempotencia:**
- **Saldos**: por `modifiedTime` del archivo Drive. Si el admin corrige el Excel a las 09:15, el run de las 09:30 detecta el cambio y reprocesa. Si no cambió, skip.
- **Ventas**: incremental por `lastSnap` por sucursal. Solo inserta filas con fecha posterior al último snapshot ya cargado.

---

## Carga histórica inicial

Una sola vez al instalar el sistema en producción.

### 1. Generar el histórico SIAF en el servidor

```bash
# En el servidor TKL Windows
python C:\TKL\siaf_sync\siaf_to_drive.py --full-reset
```

Esto borra `control.json`, reprocesa todos los DBF desde el principio y deja todos los CSVs históricos en la carpeta `historico/` de Drive.

### 2. Cargar el histórico a Neon desde local

Crear `.env.neon` en la raíz del repo (NO commitear):

```env
DATABASE_URL="postgresql://USER:PASS@HOST.neon.tech/DBNAME?sslmode=require"
GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID="ID_DE_LA_CARPETA_HISTORICO"
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```

> ⚠️ Apuntar `GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID` a `historico/`, NO a `diario/`, durante la carga inicial.

Ejecutar:

```bash
npx dotenv-cli -e .env.neon -- npx tsx scripts/load-sales-history.ts
```

El script lee los 33 CSVs históricos y los inserta en `SalesSnapshot`. Tarda 2-5 minutos según volumen.

### 3. Volver a configurar para sync diario

Después de la carga inicial:

1. Volver a configurar `GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID` (en **Vercel**, no en `.env.neon`) apuntando a `diario/` para el sync diario.
2. Borrar `.env.neon` (es un archivo sensible, nunca debe quedar en disco).

### 4. Backfill executive access

Una sola vez para asegurar que los usuarios OWNER existentes queden con `executiveAccess=true`:

```bash
# Reusar .env.neon (con DATABASE_URL solo)
npx dotenv-cli -e .env.neon -- npx tsx scripts/backfill-executive-access.ts
```

### 5. Seed del catálogo de permisos

```bash
npx dotenv-cli -e .env.neon -- npx tsx scripts/seed-permissions.ts
```

Crea/actualiza los ~44 permisos operativos en la tabla `Permission`. Idempotente — se puede correr N veces.

### 6. Borrar `.env.neon` al terminar

```bash
rm .env.neon
```

---

## Troubleshooting

### El sync diario no corre

**Síntomas:** dashboard ejecutivo muestra datos viejos. Banner "Saldos sin actualizar" o "Ventas sin actualizar".

**Diagnóstico:**
1. **Ver últimos runs en GitHub Actions**: repo → tab `Actions` → workflow `Daily Sync`. Si los runs muestran error de status, revisar el log.
2. **Logs en Vercel**: dashboard → proyecto → **Functions** logs. Buscar requests a `/api/sync/trigger` en horario del cron.
3. **SyncLog en Neon**: la tabla `SyncLog` registra cada ejecución del sync. Query:
   ```sql
   SELECT createdAt, source, status, message, "rowsProcessed"
   FROM "SyncLog"
   ORDER BY createdAt DESC
   LIMIT 20;
   ```

**Causas comunes:**
- **Status `STALE`**: Excel de saldos no fue subido hoy. **Acción**: confirmar con Administración que sube el archivo.
- **Status `NO_FILE`**: la carpeta Drive está vacía o el SA perdió permisos. **Acción**: verificar que el SA siga compartido con la carpeta.
- **HTTP 401 desde GitHub Actions**: `SYNC_WEBHOOK_SECRET` desincronizado entre Vercel y GitHub. **Acción**: regenerar y actualizar en ambos lados.
- **HTTP 500**: ver logs de Vercel para el error específico (problema de DB, SA con keys vencidas, etc.).

### Dashboard ejecutivo no actualiza

**Síntomas:** se ve el sitio pero datos no son del día.

**Diagnóstico:**
1. **¿Cargó el sync hoy?** → revisar `SyncLog` (query arriba).
2. **¿Hay snapshot en `BankBalanceSnapshot` para hoy?**
   ```sql
   SELECT "snapshotDate", COUNT(*)
   FROM "BankBalanceSnapshot"
   WHERE "snapshotDate" >= CURRENT_DATE - INTERVAL '7 days'
   GROUP BY "snapshotDate"
   ORDER BY "snapshotDate" DESC;
   ```
3. **¿La página carga server-side?** Limpiar caché del navegador. Las páginas tienen `revalidate = 300` (5 min).

### Sucursal aparece como "STALE" en saldos

**Causa:** el archivo Excel de saldos en Drive es de un día anterior. El sync detecta `modifiedTime < hoy` y skipea.

**Acción:** confirmar con Administración que actualice y re-suba el archivo. El próximo run del sync (próximas 09:30 o 10:00 ART) lo detectará.

### Ventas de una sucursal no aparecen

**Causa:** el script Python falló para esa sucursal. Posibles motivos:
- DBF corrupto o bloqueado por SIAF.
- Carpeta de red `\\192.168.0.250\...\nombre-sucursal` no accesible.
- Permisos del usuario que corre la tarea programada.

**Diagnóstico:**
1. Ver `C:\TKL\siaf_sync\tkl_sync.log` en el servidor — registra errores por sucursal.
2. Correr manualmente `python siaf_to_drive.py` y observar.

**Acción:** según el error, escalar al equipo de infra de TKL para destrabar el archivo o repermisar.

### Usuario no puede acceder al Dashboard Ejecutivo

**Causa:** no tiene `executiveAccess=true` y su rol no es OWNER.

**Acción:**
1. OWNER entra a `/owner/accesos`.
2. Busca el usuario, toggle "Otorgar".
3. **El usuario debe relogearse** para que el flag se refleje en su JWT (puede tardar hasta 8h si no relogea — el JWT no se refresca automáticamente).

### Error "Solo el OWNER puede gestionar usuarios con rol Direccion o Administrador"

**Causa:** un ADMIN intentó editar/desactivar/resetear-password de un usuario OWNER o ADMIN.

**Esto es comportamiento esperado.** Solo OWNER puede gestionar esos roles. Si se necesita la operación, hacerla desde un usuario OWNER.

### `prisma db push` pide `--accept-data-loss`

**Causa:** el cambio de schema involucra eliminación de un valor de enum o columna. Prisma exige confirmación explícita.

**Acción antes de aceptar:**
1. Verificar que ningún row use el valor a eliminar (ej: cuando se eliminó `CO_SUPERVISOR`, primero se reasignaron todos los users a `SUPERVISOR`).
2. Solo después correr `prisma db push --accept-data-loss`.

### Necesito rotar `SYNC_WEBHOOK_SECRET`

1. Generar nuevo secret: `openssl rand -base64 32`.
2. Actualizar en Vercel (Production env vars) → **Redeploy**.
3. Actualizar en GitHub (repo → Settings → Secrets) — debe ser idéntico.
4. Disparar workflow_dispatch desde GitHub Actions para confirmar que funciona.

### Necesito rotar el Service Account de Google

1. Google Cloud Console → IAM → Service Accounts → seleccionar SA → **Keys** → "Add Key" → JSON.
2. Descargar el nuevo JSON.
3. **NO borrar la key vieja todavía** — primero actualizar y verificar.
4. Actualizar `GOOGLE_SERVICE_ACCOUNT_JSON` en Vercel (todo el JSON en una sola línea).
5. Subir el nuevo `credentials.json` al servidor TKL en `C:\TKL\siaf_sync\`.
6. Verificar que sync funciona: dispatch manual del workflow.
7. **Recién después borrar la key vieja** desde Google Cloud Console.

### Necesito rotar password de Neon

1. Neon dashboard → proyecto → Roles → seleccionar role (`neondb_owner`) → **Reset password**.
2. Copiar nuevo `DATABASE_URL` que muestra Neon.
3. Actualizar en Vercel (Production env vars) → **Redeploy**.
4. Actualizar localmente cualquier `.env.local`/`.env.neon` activo.
5. Verificar que la app responde OK después del redeploy.

---

## Operaciones recurrentes

### Agregar un permiso operativo nuevo al catálogo

1. Editar `scripts/seed-permissions.ts`, agregar entry en el array.
2. Commit + push.
3. Crear `.env.neon` localmente con `DATABASE_URL` de Neon.
4. `npx dotenv-cli -e .env.neon -- npx tsx scripts/seed-permissions.ts`.
5. Borrar `.env.neon`.
6. OWNER/ADMIN puede asignar el permiso desde `/puestos`.

### Cambiar el horario del sync diario

Editar `.github/workflows/daily-sync.yml`. Recordar que GitHub Actions usa **UTC**, ART es UTC-3 (sin DST).

### Forzar re-sync de un día específico

```bash
# En el servidor TKL Windows
python C:\TKL\siaf_sync\siaf_to_drive.py --date 2026-04-20
```

Y luego disparar el sync manual desde GitHub Actions para que Vercel lo levante.

### Despliegue de hotfix

1. Commit + push a `main`.
2. Vercel deploya automáticamente (~1-2 min).
3. Verificar logs y funcionamiento.

Si necesitás revertir: `git revert <commit>` + push, o desde Vercel rollback al deploy anterior.

---

## Contacto y soporte

Sistema construido para Farmacias TKL.
Para acceso al repositorio o credenciales, contactar al administrador del proyecto.
