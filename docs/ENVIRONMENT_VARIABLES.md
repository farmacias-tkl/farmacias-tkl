# Variables de entorno

Catálogo completo de variables que utiliza el sistema. Esta lista es la
fuente de verdad — si agregás o renombrás una variable, actualizá este doc.

> **Nunca commitees archivos con valores reales**. El `.gitignore`
> excluye `.env*` excepto `.env.example`. Para producción, las variables
> se setean en Vercel y en GitHub Actions. Ver
> [deploy/vercel-deploy.md](./deploy/vercel-deploy.md).

---

## Resumen ejecutivo

| Variable | Obligatoria | Dónde se usa | Categoría |
|---|---|---|---|
| `DATABASE_URL` | Sí | App + scripts | DB |
| `AUTH_SECRET` | Sí | NextAuth (server) | Auth |
| `NEXTAUTH_URL` | Sí | NextAuth (server) | Auth |
| `NODE_ENV` | Sí | Toda la app | App |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Sí (sync) | sync-balances + sync-sales | Drive |
| `GOOGLE_DRIVE_FOLDER_ID` | Sí (saldos) | sync-balances | Drive |
| `GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID` | Sí (ventas) | sync-sales | Drive |
| `SYNC_WEBHOOK_SECRET` | Sí (sync) | `/api/sync/trigger` | Sync |
| `EXECUTIVE_DASHBOARD_URL` | Recomendada | server-side | App |
| `NEXT_PUBLIC_EXECUTIVE_DASHBOARD_URL` | Recomendada | client-side | App |

---

## Detalle por variable

### DATABASE_URL

**Categoría**: base de datos.
**Obligatoria**: sí (la app no levanta sin esto).

**Descripción**: connection string PostgreSQL. En producción apunta a Neon
(serverless Postgres). En desarrollo, típicamente a un Postgres local.

**Formato Neon (con pooler y SSL)**:

```
postgresql://USER:PASS@HOST.neon.tech/DBNAME?sslmode=require&channel_binding=require
```

**Formato local**:

```
postgresql://postgres:PASSWORD@localhost:5432/tkl_dev
```

**Dónde se usa**:
- `prisma/schema.prisma` (datasource).
- `src/lib/prisma.ts` (cliente Prisma singleton).
- Cualquier script en `scripts/*.ts` que importe `prisma`.

**Notas**:
- Para correr scripts one-shot contra Neon, se usa `dotenv-cli`:
  ```bash
  npx dotenv-cli -e .env.neon -- npx tsx scripts/foo.ts
  ```
- Cuando Neon está idle (no recibió queries en ~5 min), la primera query
  puede tardar 5–10s mientras "despierta" el compute. Algunos timeouts
  de Prisma pueden disparar — reintentar.

**Placeholder**: `YOUR_DATABASE_URL`.

---

### AUTH_SECRET

**Categoría**: auth.
**Obligatoria**: sí.

**Descripción**: secret usado por NextAuth v5 para firmar JWTs.

**Formato**: string aleatorio de 32+ bytes en base64.

```bash
openssl rand -base64 32
```

**Dónde se usa**:
- `src/lib/auth.ts` (config NextAuth).
- Internamente NextAuth lo lee del entorno automáticamente.

**Notas**:
- ⚠️ NextAuth v5 cambió el nombre. **Es `AUTH_SECRET`, no `NEXTAUTH_SECRET`**.
  Si copiás `.env.example`, asegurate del nombre correcto.
- Cambiarla invalida todas las sesiones JWT existentes (todos los
  usuarios deberán relogearse).

**Placeholder**: `YOUR_AUTH_SECRET`.

---

### NEXTAUTH_URL

**Categoría**: auth.
**Obligatoria**: sí en producción.

**Descripción**: URL pública del operativo. NextAuth la usa para construir
callbacks de OAuth y redirects.

**Formato**: URL absoluta sin slash final.

**Ejemplos**:
- Producción: `https://YOUR_DOMAIN`
- Local: `http://localhost:3000`

**Dónde se usa**:
- `src/lib/auth.ts` (NextAuth lo lee automático).

**Placeholder**: `YOUR_NEXTAUTH_URL`.

---

### NODE_ENV

**Categoría**: app.
**Obligatoria**: sí.

**Valores**: `development` | `production` | `test`.

**Notas**: Vercel lo setea a `production` automáticamente en deploys.
En local, `npm run dev` lo setea a `development`. Solo lo seteás
explícitamente para tests.

---

### GOOGLE_SERVICE_ACCOUNT_JSON

**Categoría**: Drive integration.
**Obligatoria**: sí (sin esto el sync no funciona).

**Descripción**: JSON entero del Service Account de Google Cloud, en una
sola línea. Usado para autenticar contra Drive API.

**Formato**: JSON serializado.

```json
{"type":"service_account","project_id":"YOUR_PROJECT_ID","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"YOUR_SA_EMAIL","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"...","client_x509_cert_url":"...","universe_domain":"googleapis.com"}
```

**Dónde se usa**:
- `src/lib/integrations/google-drive.ts` (cliente Drive).

**Notas**:
- El SA debe estar compartido con permiso de Editor sobre las dos
  carpetas de Drive (`SALDOS.xlsx` y `TKL-SIAF-CSV/diario/`).
- Para rotar la key: ver
  [TROUBLESHOOTING.md → Necesito rotar el Service Account de Google](./TROUBLESHOOTING.md).
- Cuando se setea esta var manualmente desde PowerShell hay que tener
  cuidado con encoding UTF-16 vs UTF-8 — ver TROUBLESHOOTING.

**Placeholder**: `YOUR_GOOGLE_SERVICE_ACCOUNT_JSON`.

---

### GOOGLE_DRIVE_FOLDER_ID

**Categoría**: Drive integration.
**Obligatoria**: sí para sync de saldos.

**Descripción**: ID de la carpeta de Drive donde Administración sube el
Excel de saldos bancarios (`SALDOS.xlsx`). El sync de saldos lee este
archivo cada mañana.

**Cómo obtenerlo**: en Drive, navegar a la carpeta y copiar el segmento
de URL después de `folders/`:
`https://drive.google.com/drive/folders/<ID_AQUI>`.

**Dónde se usa**:
- `src/lib/sync/sync-balances.ts` (`process.env.GOOGLE_DRIVE_FOLDER_ID`).

**Placeholder**: `YOUR_DRIVE_FOLDER_ID_FOR_BALANCES`.

---

### GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID

**Categoría**: Drive integration.
**Obligatoria**: sí para sync de ventas.

**Descripción**: ID de la carpeta `diario/` de Drive donde el script
Python (`siaf_to_drive.py`) sube los 33 CSVs (11 sucursales × 3 tipos).

**Notas importantes**:
- Para el sync diario en Vercel, **debe apuntar a `diario/`**, no a `historico/`.
- Para la carga histórica inicial (`scripts/load-sales-history.ts`),
  se cambia temporalmente a `historico/` en `.env.neon`.

**Dónde se usa**:
- `src/lib/sync/sync-sales.ts`.
- `scripts/load-sales-history.ts`.

**Placeholder**: `YOUR_DRIVE_FOLDER_ID_FOR_SIAF_CSVS`.

---

### SYNC_WEBHOOK_SECRET

**Categoría**: sync.
**Obligatoria**: sí.

**Descripción**: Bearer token que valida `POST /api/sync/trigger`. GitHub
Actions lo envía en el header `Authorization: Bearer <secret>`.

**Formato**: string aleatorio.

```bash
openssl rand -base64 32
```

**Dónde se usa**:
- `src/app/api/sync/trigger/route.ts` (server-side validation).
- `.github/workflows/daily-sync.yml` (envío en el `curl`).

**Notas**:
- **Debe ser idéntico en Vercel (env var) y en GitHub Actions (secret)**.
- Para rotarlo: ver
  [TROUBLESHOOTING.md → Necesito rotar SYNC_WEBHOOK_SECRET](./TROUBLESHOOTING.md).

**Placeholder**: `YOUR_WEBHOOK_SECRET`.

---

### EXECUTIVE_DASHBOARD_URL

**Categoría**: app.
**Obligatoria**: recomendada.

**Descripción**: URL del dashboard ejecutivo (server-side). Usada para
construir links cross-app en server components.

**Ejemplos**:
- Producción: `https://dashboard.YOUR_DOMAIN`
- Local: `http://localhost:3000/executive`

**Notas**: solo lectura desde server components. Si no se setea, los
componentes pueden usar `pathname` relativo.

---

### NEXT_PUBLIC_EXECUTIVE_DASHBOARD_URL

**Categoría**: app.
**Obligatoria**: recomendada.

**Descripción**: misma que `EXECUTIVE_DASHBOARD_URL` pero accesible desde
cliente. El prefijo `NEXT_PUBLIC_` es requisito de Next.js para variables
expuestas al browser.

**Dónde se usa**:
- `src/components/layout/TopBar.tsx` (botón "Dashboard Ejecutivo" del header operativo).

**⚠️ Cualquier var con prefijo `NEXT_PUBLIC_` es VISIBLE PARA EL CLIENTE.**
Nunca poner secrets ahí.

---

## GitHub Actions secrets

No son env vars del runtime de Next, pero las necesita el workflow.
Configurar en `repo → Settings → Secrets and variables → Actions`.

| Secret | Descripción | Placeholder |
|---|---|---|
| `DASHBOARD_URL` | URL base del operativo (donde está `/api/sync/trigger`) | `YOUR_DASHBOARD_URL` |
| `SYNC_WEBHOOK_SECRET` | Bearer token, idéntico al de Vercel | `YOUR_WEBHOOK_SECRET` |

---

## Convenciones de archivos `.env*`

| Archivo | Cuándo se usa | Tracked en git |
|---|---|---|
| `.env` | Defaults locales (no usar en prod) | No |
| `.env.local` | Overrides locales del developer | No |
| `.env.example` | Plantilla con todas las vars (sin valores) | **Sí** |
| `.env.neon` | Connection string a Neon para correr scripts puntuales | No |
| `.env.production` | No usar — producción se configura en Vercel | No |

**Regla de oro**: si un archivo contiene secretos reales, **debe estar
en `.gitignore`**. El `.gitignore` actual cubre todos los `.env*` excepto
`.env.example`.

---

## Encoding de archivos `.env`

⚠️ **Riesgo histórico**: PowerShell en Windows escribe archivos en UTF-16
LE por default. Eso rompe `dotenv-cli` (que espera UTF-8). Si tenés
problemas raros con vars que "no se cargan", verificá el encoding:

```bash
python -c "print(open('.env.neon','rb').read()[:8])"
```

Tiene que empezar con bytes ASCII (`b'DATABASE'`), no con BOM UTF-16
(`b'\xff\xfeD'`). Si está mal, regeneralo con Python:

```python
from pathlib import Path
content = 'DATABASE_URL="..."\n'
Path('.env.neon').write_bytes(content.encode('utf-8'))
```

Ver más en [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).
