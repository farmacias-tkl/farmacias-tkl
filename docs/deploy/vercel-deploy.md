# Deployment en Vercel

Este documento describe cómo el sistema se desplea en producción y cómo
operar el deploy día a día.

> Para guía de troubleshooting de problemas en producción ver
> [TROUBLESHOOTING.md](../TROUBLESHOOTING.md). Para arquitectura general
> ver [architecture/system-architecture.md](../architecture/system-architecture.md).

---

## Proveedor

**Vercel** — hosting de Next.js. Plan necesario: Hobby es suficiente
para empezar, pero **Pro** es recomendado por:
- Function timeout 300s (vs 60s en Hobby) — relevante para el sync inicial.
- Más bandwidth y builds.
- Mejor logs de Functions.
- Soporte de teams.

---

## Estructura del proyecto Vercel

**Un solo proyecto** Vercel sirve dos hosts:
- `YOUR_DOMAIN` (operativa)
- `dashboard.YOUR_DOMAIN` (dashboard ejecutivo)

El `middleware.ts` de Next discrimina por `host` y redirige/restringe
en consecuencia. No hay dos proyectos separados.

**Region**: configurar la closest a usuarios + DB. Recomendado
`gru1` (São Paulo) o `iad1` (US East) — Neon también está en US East,
así que `iad1` minimiza latencia DB.

---

## Configuración inicial del proyecto

### Importar el repo

1. Vercel dashboard → New Project → Import Git Repository.
2. Seleccionar el repo de GitHub.
3. **Framework Preset**: Next.js (auto-detected).
4. **Root Directory**: `./` (raíz del repo).
5. **Build Command**: `npm run build` (default, OK).
6. **Output Directory**: `.next` (default, OK).
7. **Install Command**: `npm install` (default — esto corre `postinstall` que ejecuta `prisma generate`).

### Variables de entorno

Configurar **antes** del primer deploy. Ver
[ENVIRONMENT_VARIABLES.md](../ENVIRONMENT_VARIABLES.md) para el listado
completo.

Setup básico:

| Variable | Production |
|---|---|
| `DATABASE_URL` | URL de Neon producción |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://YOUR_DOMAIN` |
| `NODE_ENV` | `production` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON del SA en una sola línea |
| `GOOGLE_DRIVE_FOLDER_ID` | ID de la carpeta del Excel saldos |
| `GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID` | ID de la carpeta `diario/` |
| `SYNC_WEBHOOK_SECRET` | `openssl rand -base64 32` |
| `EXECUTIVE_DASHBOARD_URL` | `https://dashboard.YOUR_DOMAIN` |
| `NEXT_PUBLIC_EXECUTIVE_DASHBOARD_URL` | idem |

**Scope**: Production y Preview. Para Preview se recomienda usar Neon
**branch separado** (Neon soporta branching de DB) o limitar la
configuración a una env var distinta.

### Custom domains

Settings → Domains:

1. Agregar `YOUR_DOMAIN`.
2. Agregar `dashboard.YOUR_DOMAIN`.
3. Configurar registros DNS según indique Vercel (CNAME apuntando a
   `cname.vercel-dns.com`).
4. Esperar verificación SSL (~minutos).

Ambos hosts apuntarán al mismo proyecto. El middleware discriminará.

---

## Aplicar el schema a Neon

Después del primer deploy, la DB de Neon está vacía. Aplicar el schema:

```bash
# Crear .env.neon temporal con DATABASE_URL de producción
echo 'DATABASE_URL="YOUR_DATABASE_URL"' > .env.neon

# Aplicar schema
npx dotenv-cli -e .env.neon -- npx prisma db push

# Borrar
rm .env.neon
```

> ⚠️ NO commitear `.env.neon`. Está en `.gitignore` pero verificá.

### Crear primer OWNER

Ejecutar el script `scripts/create-owner.ts` (verificar que existe; si
no, hacerlo manualmente vía Prisma Studio o un script puntual):

```bash
npx dotenv-cli -e .env.neon -- npx tsx scripts/create-owner.ts
```

O crearlo desde la UI **antes** que sea posible (paradoja del huevo y
la gallina): la primera vez requiere intervención manual. Una vez creado
el OWNER, todo el resto se gestiona desde `/owner/usuarios`.

### Seed de permisos operativos

```bash
npx dotenv-cli -e .env.neon -- npx tsx scripts/seed-permissions.ts
```

Idempotente. Crea ~44 permisos en la tabla `Permission`. Ver
[permissions/permission-system.md](../permissions/permission-system.md).

### Carga inicial del histórico de ventas (opcional)

Solo si querés tener data desde el principio. Ver
[integrations/siaf-sync.md](../integrations/siaf-sync.md) sección
"Recargar histórico completo".

---

## Configurar GitHub Actions

### Secrets

`repo → Settings → Secrets and variables → Actions → New secret`:

| Secret | Valor |
|---|---|
| `DASHBOARD_URL` | `https://YOUR_DOMAIN` |
| `SYNC_WEBHOOK_SECRET` | **Idéntico** al de Vercel |

### Workflow

`.github/workflows/daily-sync.yml` ya está committed. Verificar que el
schedule actual sea el deseado (3 crons: 04:00 ART ventas + 08:50/09:30
ART saldos).

Para verificar el setup:

`repo → Actions → Daily Sync — Saldos Bancarios → Run workflow`

Esto dispara un run manual. Verificá:
- Status del workflow = success.
- En Vercel logs: aparece la request a `/api/sync/trigger`.
- En la DB: `SELECT * FROM "SyncLog" ORDER BY "createdAt" DESC LIMIT 5;` muestra el run.

---

## Connection pooling de Neon

Neon ofrece dos endpoints por DB:
- **Direct**: `ep-xxx.us-east-1.aws.neon.tech` — conexión TCP directa.
- **Pooler**: `ep-xxx-pooler.c-N.us-east-1.aws.neon.tech` — pgBouncer enfrente.

**Para Vercel siempre usar el pooler.** Razón: Vercel Functions son
serverless con concurrencia variable. Sin pooler, cada cold start abre
una nueva conexión TCP — Neon tiene límite de conexiones concurrentes
y se agota rápido.

El connection string del pooler queda así:

```
postgresql://USER:PASS@ep-xxx-pooler.c-N.us-east-1.aws.neon.tech/DBNAME?sslmode=require&channel_binding=require
```

Notar el `-pooler` en el hostname. Eso lo provee Neon dashboard cuando
copiás el connection string.

---

## Logs y monitoring

### Logs de Functions (runtime)

`Vercel dashboard → proyecto → Deployments → [último deploy] → Functions`.

- Filtrar por nombre de función (`/api/sync/trigger`, `/api/dashboard/...`).
- Logs en tiempo real disponibles vía CLI: `vercel logs --follow`.

### Logs de build

`Vercel dashboard → Deployments → [deploy específico] → Build Logs`.

Si el build falla, revisar acá. Errores comunes:
- TypeScript no pasa.
- `prisma generate` falla (problema con `DATABASE_URL`).

### Logs del cron

GitHub Actions: `repo → Actions → Daily Sync → [run específico]`.

Cada run muestra:
- HTTP status del POST.
- Response body (mensaje, rows procesadas).

### `SyncLog` en Neon

La tabla `SyncLog` es el log persistente de cada ejecución del sync.
Útil para historiales y stats:

```sql
SELECT
  date_trunc('hour', "createdAt") as hour,
  source,
  status,
  COUNT(*) as runs,
  AVG("durationMs") as avg_ms
FROM "SyncLog"
WHERE "createdAt" > now() - interval '7 days'
GROUP BY hour, source, status
ORDER BY hour DESC;
```

---

## Deploys

### Continuous deployment

Vercel deploya automáticamente:
- **Push a `main`** → deploy a Production.
- **Push a otra branch** → Preview deploy con URL única.
- **PR abierto** → Preview deploy linked en el PR.

### Preview deploys

Útiles para testear cambios antes de merge. Por default usan las env
vars con scope "Preview" (configurar en Vercel).

⚠️ Si Preview usa la **misma** Neon que Production, cualquier mutación
en Preview impacta producción. Mejor:
- Apuntar Preview a un Neon branch separado.
- O tener Preview en read-only.

### Rollback

`Vercel dashboard → Deployments → [deploy anterior] → ... → Promote to Production`.

O via git: `git revert <commit>` + push.

### Deploys manuales

```bash
vercel --prod
```

Requiere `vercel CLI` instalado y login (`vercel login`).

### Hotfixes

1. `git commit -m "fix: ..."` + push.
2. Vercel deploya automáticamente (~1-2 min).
3. Verificar logs y comportamiento.

Si el hotfix falla:
- Revertir y pushear de nuevo, OR
- Rollback al deploy anterior desde Vercel UI.

---

## Limites y costos

### Vercel Hobby (free)

- Function timeout: 60s (puede romper sync inicial).
- 100GB bandwidth/mes.
- 6.000 build minutes/mes.
- Sin SLA.

### Vercel Pro

- Function timeout: 300s.
- 1TB bandwidth/mes.
- Builds ilimitados (con fair use).
- Soporte teams.

### Neon

- Free tier: 0.5GB storage, 100h compute/mes.
- Pro tier: storage e historial mucho mayor + autoscale.

Para producción con uso real recomendado: Vercel Pro + Neon Pro.

### Drive API

- Quota gratuita: 1.000 req/100s/usuario.
- Las dos llamadas por sync (saldos + ventas) están bien lejos del
  límite. Solo problema si hubiera muchos workspaces.

---

## Variables públicas (NEXT_PUBLIC_*)

Cualquier env var con prefijo `NEXT_PUBLIC_` es visible para el cliente
(JavaScript del browser). **Nunca poner secretos ahí**.

En este proyecto, la única `NEXT_PUBLIC_*` es:
- `NEXT_PUBLIC_EXECUTIVE_DASHBOARD_URL` — solo URL pública, no es secreto.

---

## Custom build settings (opcional)

Si necesitás customizar el build, en `vercel.json`:

```json
{
  "regions": ["iad1"],
  "functions": {
    "src/app/api/sync/trigger/route.ts": {
      "maxDuration": 300
    }
  }
}
```

`maxDuration` por function te permite extender el timeout solo donde
hace falta (ej: el sync que puede tardar 2-3 min).

---

## Salud del deploy — checklist diario

1. **Vercel UI**: último deploy verde. Sin errors recientes en Functions.
2. **GitHub Actions**: los 3 runs del día están en verde (Daily Sync workflow).
3. **`SyncLog`**: filas recientes con `status=SUCCESS` (no `STALE` ni `ERROR` recurrentes).
4. **Dashboard ejecutivo**: visible en `https://dashboard.YOUR_DOMAIN/executive`, KPIs no en 0.

---

## Referencias cruzadas

- [ENVIRONMENT_VARIABLES.md](../ENVIRONMENT_VARIABLES.md) — todas las vars.
- [operations/daily-operations.md](../operations/daily-operations.md) — operación diaria.
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) — diagnóstico de fallas.
- [SECURITY.md](../SECURITY.md) — rotación de secrets.
