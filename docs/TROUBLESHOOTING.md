# Troubleshooting

Catálogo de problemas reales observados en el proyecto y cómo resolverlos.
Si te encontrás con algo no listado acá, agregalo cuando lo resuelvas.

---

## Índice por categoría

- [Encoding y archivos `.env`](#encoding-y-archivos-env)
- [Base de datos (Neon)](#base-de-datos-neon)
- [Sync (saldos y ventas)](#sync-saldos-y-ventas)
- [Frontend / dashboard ejecutivo](#frontend--dashboard-ejecutivo)
- [Auth y permisos](#auth-y-permisos)
- [Build y deploy](#build-y-deploy)
- [Script Python SIAF](#script-python-siaf)
- [Prisma y schema](#prisma-y-schema)

---

## Encoding y archivos `.env`

### Síntoma: vars no se cargan, dotenv-cli no las ve

PowerShell en Windows escribe archivos en **UTF-16 LE con BOM** por
default. `dotenv-cli` espera UTF-8 y no parsea correctamente UTF-16.

**Diagnóstico**:

```bash
python -c "print(open('.env.neon','rb').read()[:8])"
```

- ✅ OK: `b'DATABASE'` (texto ASCII).
- ❌ Mal: `b'\xff\xfeD\x00A\x00T\x00A'` (BOM UTF-16 LE).

**Fix**:

```python
from pathlib import Path
content = 'DATABASE_URL="postgresql://..."\n'
Path('.env.neon').write_bytes(content.encode('utf-8'))
```

O desde PowerShell:

```powershell
$content = 'DATABASE_URL="postgresql://..."'
[System.IO.File]::WriteAllText('.env.neon', $content + "`n", [System.Text.UTF8Encoding]::new($false))
```

> El argumento `$false` al constructor evita el BOM UTF-8 (que también
> puede causar problemas en algunos parsers).

### Síntoma: GOOGLE_SERVICE_ACCOUNT_JSON tiene newlines reales en private_key

El private key del Service Account contiene `\n` como **escape** dentro
del string JSON, no como newline literal. Si al copiar/pegar se
convirtieron en newlines reales, el JSON deja de ser válido.

**Diagnóstico**: el archivo `.env.neon` tiene >3 líneas (`wc -l`).

**Fix**: usar Python r-string (raw) para preservar los `\n` literales:

```python
SA_JSON = r'{"type":"service_account",...,"private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",...}'
```

El prefijo `r` evita que Python interprete los `\n` como newlines.

---

## Base de datos (Neon)

### Síntoma: timeout o "Can't reach database server" al primer query

Neon serverless **idle-suspends** el compute después de unos minutos sin
queries. Despertarlo toma 5-10s. La primera query después de idle puede
disparar `PrismaClientInitializationError`.

**Fix**: reintentar la operación. La segunda query funciona.

Si pasa repetidamente:
- Verificar el connection pooler. La URL debe usar el endpoint con
  `-pooler` en el hostname (ej: `ep-xxx-pooler.us-east-1.aws.neon.tech`).
- Considerar bumpear el `connect_timeout` en la connection string:
  `?connect_timeout=30`.

### Síntoma: "Hostname `c-5.us-east-1.aws.neon.tech` doesn't resolve"

Algunos hosts de Neon usan un formato `ep-xxx-pooler.c-N.region.aws.neon.tech`
donde `c-N` es el cluster. Si tenés problemas de DNS:

- Verificar que el host completo del connection string esté correcto,
  copiado **exactamente** del Neon dashboard.
- En redes corporativas con DNS restrictivo, verificar que `*.neon.tech`
  resuelva.

### Síntoma: snapshot duplicado / Prisma `Unique constraint failed`

`SalesSnapshot` y `BankBalanceSnapshot` tienen `@@unique` constraints.
Si querés "reprocesar" un día, primero borralo:

```typescript
await prisma.salesSnapshot.deleteMany({
  where: { snapshotDate: new Date('2026-05-05T00:00:00.000Z') }
});
```

Después correr el sync. `sync-sales.ts` filtra por `lastSnap` por
sucursal — si borraste un día específico (no el último), no se
recargará automáticamente. Workaround: borrar **desde** ese día hasta
hoy y recargar incremental.

---

## Sync (saldos y ventas)

### Síntoma: workflow GitHub Actions falla con HTTP 401

`SYNC_WEBHOOK_SECRET` desincronizado entre Vercel y GitHub Actions.

**Fix**:
1. `openssl rand -base64 32` — generar nuevo secret.
2. Actualizar en Vercel (Production env vars) → Redeploy.
3. Actualizar en GitHub (Settings → Secrets → Actions) — exactamente igual.
4. Workflow_dispatch manual para validar.

### Síntoma: Sync devuelve `STALE` en saldos

El Excel de saldos en Drive no fue modificado hoy. `sync-balances.ts`
chequea `modifiedTime` del file y skippea si no es de hoy.

**Causa esperada**: Administración no subió/actualizó el Excel.
**Acción**: confirmar con Administración que actualice. El próximo run
del cron lo levantará.

**Cuando es legítimo**: domingos. El admin no sube Excel los domingos,
así que el banner "saldos sin actualizar" aparece. Por eso la lógica del
frontend tiene una **gracia de 1 día** sobre `yesterdayArt` — solo
muestra el banner si los datos son **anteriores a ayer**. Ver
`src/app/(executive)/executive/page.tsx`:

```ts
if (isStaleBalances && balances.length > 0) {
  const lastBalanceDate = balances[0].snapshotDate;
  if (lastBalanceDate.getTime() >= yesterdayArt.getTime()) {
    isStaleBalances = false;  // datos de ayer son OK
  }
}
```

### Síntoma: Sync devuelve `NO_FILE`

Posibles causas:
- La carpeta de Drive está vacía.
- El Service Account perdió permisos sobre la carpeta.
- El `GOOGLE_DRIVE_FOLDER_ID` (o `GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID`) está mal seteado.

**Fix**:
1. En Drive UI: confirmar que el SA email aparece como "compartido con" la carpeta con permiso de Editor.
2. Verificar el folder ID copiándolo de la URL: `drive.google.com/drive/folders/<ID>`.

### Síntoma: ventas de una sucursal no aparecen

El script Python falló parcialmente para esa sucursal. Posibles motivos:
- DBF corrupto o bloqueado por SIAF.
- Carpeta de red `\\192.168.0.250\...\nombre-sucursal` no accesible.
- Permisos del usuario que corre la tarea programada.

**Diagnóstico**:
1. Revisar `C:\TKL\siaf_sync\tkl_sync.log` en el servidor TKL.
2. Correr manualmente `python siaf_to_drive.py` y observar.

### Síntoma: banner "Ventas sin actualizar" en domingo

Comportamiento normal. Los sábados las ventas se generan, los domingos
el script Python no produce nada nuevo. La lógica de stale del frontend
considera "ayer" como aceptable. Si igual aparece, verificar:

- `getArtToday()` en `src/app/(executive)/executive/page.tsx`. Convierte
  a TZ Argentina (UTC-3 sin DST):

  ```ts
  function getArtToday(): Date {
    const artMs = Date.now() - 3 * 60 * 60 * 1000;
    const art   = new Date(artMs);
    return new Date(Date.UTC(art.getUTCFullYear(), art.getUTCMonth(), art.getUTCDate()));
  }
  ```

  El server de Vercel corre en UTC. Sin esta conversión, a las 23:00
  ART (= 02:00 UTC del día siguiente) el server creería que ya es
  "mañana" y marcaría stale los datos de hoy.

---

## Frontend / dashboard ejecutivo

### Síntoma: dashboard muestra datos viejos

`/executive` server component tiene `revalidate = 300` (5 minutos) por
default. Después de un sync exitoso, puede tardar hasta 5 min en
reflejarse para visitantes que ya tenían la página cacheada.

**Fix instant**: hard-refresh (Ctrl+Shift+R / Cmd+Shift+R).

### Síntoma: tabla mobile trunca nombres de sucursal

Verificado en commit `c4c3664` y siguientes. La grid de SalesTable.tsx
usa `grid-template-columns` específicas para mobile. Si el cambio es
reciente, verificar que no se haya regresado.

### Síntoma: filtros OS/Vendedor en SalesTable no muestran nada

Los filtros se construyen desde `rawData.obras_sociales` y
`rawData.vendedores` en `BranchSales`. Si los datos no son SIAF (ej:
data seed antigua), los arrays están vacíos y no hay filtros.

**Diagnóstico**:

```sql
SELECT branchId, dataSource, jsonb_typeof(rawData->'vendedores')
FROM "SalesSnapshot"
WHERE snapshotDate = CURRENT_DATE
LIMIT 5;
```

Si `dataSource != 'siaf'` o `rawData->'vendedores'` no es array, los
filtros estarán deshabilitados (mensaje "Disponible con datos reales").

---

## Auth y permisos

### Síntoma: usuario no puede acceder al Dashboard Ejecutivo aunque OWNER lo habilitó

El JWT no se refresca automáticamente al cambiar `executiveAccess`.
**El usuario debe relogearse** para que el flag se actualice en el token.

**Acción**:
1. OWNER habilita el flag en `/owner/accesos`.
2. Pedir al usuario que cierre sesión y vuelva a loguearse.
3. Verificar en la cookie/JWT que `executiveAccess: true`.

### Síntoma: ADMIN ve error "Solo el OWNER puede gestionar usuarios..."

Comportamiento esperado. ADMIN no puede editar/desactivar/resetear
password de usuarios OWNER ni a otros ADMIN. Hacer la operación desde
un usuario OWNER.

### Síntoma: usuario relogueado pero sigue redirect loop a `/cambiar-password`

`User.mustChangePassword` está en `true` y el usuario no completó el
formulario. Verificar el flag:

```sql
UPDATE "User" SET "mustChangePassword" = false WHERE email = 'YOUR_USER_EMAIL';
```

(Solo si confirmaste manualmente con el usuario que ya cambió la password.)

### Síntoma: middleware permite ruta a rol que no debería

Doble-check:
- `ROUTE_PERMISSIONS` en `src/lib/permissions.ts` tiene la ruta listada.
- El middleware está activo (matcher en `src/middleware.ts` debe incluir el path).
- Para `/executive` y `/api/dashboard`, el gate es `canViewExecutive`,
  no `canAccessRoute`. No agregues esas rutas a `ROUTE_PERMISSIONS`.

---

## Build y deploy

### Síntoma: `npm run build` consume mucho output

Usar el patrón estándar para ver solo el final:

```bash
npm run build 2>&1 | tail -20
```

Esto es lo recomendado para CI mental — los warnings de Next + Prisma
generan mucha verbosidad inicial.

### Síntoma: build falla por TypeScript en Vercel pero pasa local

Vercel usa el TS strict del repo. Si pasa local pero falla en Vercel,
es probable que tu IDE esté usando un `tsconfig.json` distinto. Correr
localmente:

```bash
npx tsc --noEmit
```

### Síntoma: Vercel marca el deploy como "Failed" pero las páginas funcionan

Posiblemente el `prisma generate` en `postinstall` falló por una conexión
fallida. Verificar logs de build en Vercel UI.

---

## Script Python SIAF

### Síntoma: script Python no encuentra carpeta `\\192.168.0.250\...`

El usuario que corre la tarea programada no tiene acceso a la red
corporativa.

**Fix**: configurar la Task como "Run with highest privileges" y bajo
un usuario de dominio con acceso a la carpeta compartida.

### Síntoma: error `dbfread.dbf.MissingMemoFile`

Algunos DBF tienen archivo `.fpt` o `.dbt` asociado para campos memo.
Si está faltando o corrupto, dbfread tira esto.

**Fix**: el script ya tiene `read_dbf_safely()` que captura excepciones
y continúa con el siguiente archivo. Verificar en el log qué sucursal
falló y revisar manualmente.

### Síntoma: `control.json` se borró accidentalmente

No es catastrófico, pero el próximo run reprocesará todo el historial
(puede tardar mucho).

**Fix**: si existe backup, restaurarlo. Si no, dejar correr (`--full-reset`)
o crear un control.json manual con la última fecha conocida por
sucursal. Formato:

```json
{
  "America":     "2026-05-05",
  "Etcheverry":  "2026-05-05",
  ...
}
```

### Síntoma: WHA no aparece como venta

Hasta el commit `f953c67`, los códigos `WHA` (WhatsApp) estaban en
`CODIGOS_EXCLUIR`. Después del fix, son ventas válidas. Si seguís sin
ver WHA, regenerá el ZIP del script y reinstalalo en el servidor:

```bash
python -c "
import zipfile
from pathlib import Path
src = Path('scripts/server')
out = Path.home() / 'Desktop' / 'TKL-SIAF-Setup.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zf:
    for n in ['siaf_to_drive.py', 'INSTALACION.md', 'requirements.txt']:
        zf.write(src / n, arcname=f'TKL-SIAF/{n}')
"
```

### Síntoma: unidades de PARTICULAR aparecen en cero

Hasta `f953c67`, las unidades de OS particular se descartaban en
`read_detmov_os_units`. Después del fix se agrupan bajo `"PAR"` y se
suman al `os_agg` correctamente. Mismo workaround: regenerar el ZIP
del script.

---

## Prisma y schema

### Síntoma: `prisma db push` pide `--accept-data-loss`

Significa que el cambio implica borrar columna o valor de enum.

**Antes de aceptar**:
1. Verificar que ningún row use el valor a eliminar:
   ```sql
   SELECT COUNT(*) FROM "User" WHERE role = 'CO_SUPERVISOR';
   ```
2. Si hay rows, migrar primero (UPDATE a otro valor) y después correr
   el push.

### Síntoma: cliente Prisma desactualizado después de cambio en schema

Correr `npm run db:generate` (alias de `prisma generate`). Esto regenera
los tipos TypeScript en `node_modules/@prisma/client`.

`postinstall` lo corre automáticamente al hacer `npm install`. Si
cambiaste el schema pero no reinstalaste, hacelo manual.

### Síntoma: `prisma migrate dev` me pide crear migración

Este proyecto **no usa migrations**, usa `prisma db push` directo (sin
historial de migrations). El folder `prisma/migrations/` no existe.

Si querés introducir migrations, hablalo con el equipo — implica un
cambio de proceso (no se hace simplemente corriendo `migrate dev`).

---

## Cosas a verificar primero ante cualquier problema

1. ¿El usuario está logueado? Cookie `next-auth.session-token` presente.
2. ¿Hay un sync reciente? Query a `SyncLog` ordenado por `createdAt DESC`.
3. ¿Las env vars están cargadas? En Vercel: Settings → Environment Variables. Local: `console.log(process.env.SOMEVAR)`.
4. ¿Los logs de Vercel muestran algo? Functions → último deploy → logs.
5. ¿El branch desplegado es el esperado? `git log --oneline -1` vs commit hash visible en Vercel.
