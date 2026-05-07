# Operaciones diarias

Este documento describe las tareas operativas comunes: monitoreo del
sync, retries manuales, recargas, cambios de cron, y otros workflows
recurrentes.

---

## Cron schedule actual

`.github/workflows/daily-sync.yml`:

| Cron (UTC) | Hora ART (UTC-3) | Acción esperada |
|---|---|---|
| `0 7 * * *` | **04:00 ART** | Sync de **ventas** del día anterior (CSV SIAF ya subidos durante la madrugada) |
| `50 11 * * *` | **08:50 ART** | Primera lectura de **saldos** bancarios |
| `30 12 * * *` | **09:30 ART** | Segunda lectura de saldos (margen para Administración tardía) |

Los 3 runs llaman al mismo endpoint `POST /api/sync/trigger` con
`{"source": "all"}`. Internamente:
- `syncBalances()` chequea idempotencia por `modifiedTime` y skippea si no cambió.
- `syncSales()` hace insert incremental por sucursal (filtra por `lastSnap`).

---

## Monitoreo del sync

### Verificación rápida (1 minuto)

1. **GitHub Actions**: `repo → Actions → Daily Sync — Saldos Bancarios`.
   - Los 3 runs del día deberían estar verdes.
2. **`SyncLog` en Neon**:
   ```sql
   SELECT createdAt, source, status, message, "rowsProcessed"
   FROM "SyncLog"
   ORDER BY createdAt DESC
   LIMIT 10;
   ```
3. **Dashboard ejecutivo**: abrir `https://dashboard.YOUR_DOMAIN/executive`.
   No debe mostrar banner de stale (excepto domingos para saldos).

### Diagnóstico cuando algo no aparece

Ver [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) sección "Sync".

---

## Retry manual del sync

### Vía GitHub Actions UI

`repo → Actions → Daily Sync → Run workflow`.

Inputs:
- `source`: `balances` | `all` (default `balances` cuando se dispara manual).

Útil cuando:
- El cron del día falló y querés re-correr sin esperar al próximo.
- Administración subió/corrigió el Excel después de los crons normales.

### Vía curl (manual desde una máquina con credenciales)

```bash
curl -X POST "https://YOUR_DASHBOARD_URL/api/sync/trigger" \
  -H "Authorization: Bearer YOUR_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"source":"all"}' \
  --max-time 300
```

Response esperada:

```json
{
  "ok": true,
  "results": {
    "balances": { "status": "SUCCESS", "rowsProcessed": 5, ... },
    "sales":    { "status": "SUCCESS", "rowsProcessed": 11, ... }
  }
}
```

### Vía script local

`scripts/manual-sync.ts` (verificar que existe — si no, crear ad-hoc).

---

## Borrar y recargar datos

### Borrar un día específico de ventas

Caso típico: queremos reprocesar el día tras subir una versión nueva
del script Python que cambia el CSV.

```typescript
// scripts/delete-sales-by-date.ts (temporal)
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const TARGET = new Date("2026-05-05T00:00:00.000Z");

async function main() {
  const before = await prisma.salesSnapshot.count({ where: { snapshotDate: TARGET } });
  console.log(`ANTES → ${before}`);
  const del = await prisma.salesSnapshot.deleteMany({ where: { snapshotDate: TARGET } });
  console.log(`DELETE → ${del.count} filas`);
}
main().finally(async () => prisma.$disconnect());
```

```bash
# .env.neon temporal con DATABASE_URL
npx dotenv-cli -e .env.neon -- npx tsx scripts/delete-sales-by-date.ts
rm .env.neon scripts/delete-sales-by-date.ts
```

### Borrar TODO SalesSnapshot y BankBalanceSnapshot

⚠️ Operación destructiva. Solo justificable en setup nuevo o data
corruption.

```typescript
const salesBefore    = await prisma.salesSnapshot.count();
const balancesBefore = await prisma.bankBalanceSnapshot.count();
console.log(`ANTES → sales=${salesBefore}, balances=${balancesBefore}`);

await prisma.salesSnapshot.deleteMany({});
await prisma.bankBalanceSnapshot.deleteMany({});
```

Después recargar:
- Saldos: el próximo cron los carga (o retry manual).
- Ventas: para histórico completo, ver
  [integrations/siaf-sync.md](../integrations/siaf-sync.md) sección
  "Recargar histórico completo".

### Recargar ventas históricas desde Drive

```bash
# 1. Generar histórico SIAF en el servidor
# (en servidor TKL Windows)
python C:\TKL\siaf_sync\siaf_to_drive.py --full-reset

# 2. Configurar .env.neon apuntando a la carpeta historico/
cat > .env.neon <<'EOF'
DATABASE_URL="YOUR_DATABASE_URL"
GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID="ID_DE_HISTORICO"
GOOGLE_SERVICE_ACCOUNT_JSON='YOUR_GOOGLE_SERVICE_ACCOUNT_JSON'
EOF

# 3. Correr el script de carga histórica
npx dotenv-cli -e .env.neon -- npx tsx scripts/load-sales-history.ts

# 4. Borrar .env.neon (sensible)
rm .env.neon

# 5. En Vercel: confirmar que GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID apunta a diario/
#    (NO a historico/) para los crons normales.
```

Tarda ~2-5 minutos según volumen.

---

## Forzar re-sync de un día específico

### En el servidor TKL (sube a Drive)

```bash
python C:\TKL\siaf_sync\siaf_to_drive.py --date 2026-04-20
```

Esto regenera los CSVs en `diario/` con esa fecha.

### En Vercel (carga a Neon)

Si la fecha es **posterior** al `lastSnap` de cada sucursal, el sync
incremental la levantará automáticamente en el próximo cron o retry
manual.

Si la fecha es **anterior**, no se cargará — `sync-sales.ts` filtra
estrictamente `> lastSnap`. Workaround: borrar de la DB todos los días
desde la fecha objetivo en adelante, y recargar incremental.

```typescript
await prisma.salesSnapshot.deleteMany({
  where: { snapshotDate: { gte: new Date("2026-04-20T00:00:00.000Z") } }
});
```

Después dispatch manual del workflow.

---

## Cambiar el cron schedule

Editar `.github/workflows/daily-sync.yml`:

```yaml
schedule:
  - cron: "0 7 * * *"    # ← formato cron UTC
```

⚠️ **GitHub Actions siempre usa UTC**. ART = UTC-3 (sin DST). Conversiones útiles:

| Hora ART | Cron UTC |
|---|---|
| 04:00 | `0 7 * * *` |
| 06:00 | `0 9 * * *` |
| 08:00 | `0 11 * * *` |
| 08:50 | `50 11 * * *` |
| 09:30 | `30 12 * * *` |
| 12:00 | `0 15 * * *` |

Después de mergear el cambio, GitHub Actions recoge el nuevo schedule
automáticamente. **No** requiere redeploy de Vercel.

---

## Rotación de secrets

### `SYNC_WEBHOOK_SECRET`

1. Generar nuevo: `openssl rand -base64 32`.
2. Actualizar en **Vercel** (Settings → Environment Variables) → **Redeploy**.
3. Actualizar en **GitHub Actions** (Settings → Secrets) — debe ser **idéntico**.
4. Workflow_dispatch manual para validar.

### `AUTH_SECRET`

⚠️ Cambiar invalida **todas las sesiones JWT**. Todos los usuarios deberán
relogearse.

1. Generar nuevo: `openssl rand -base64 32`.
2. Actualizar en Vercel → Redeploy.

### `GOOGLE_SERVICE_ACCOUNT_JSON`

1. Google Cloud Console → IAM → Service Accounts → seleccionar SA → **Keys** → "Add Key" (JSON).
2. **No borrar la key vieja todavía**.
3. Actualizar `GOOGLE_SERVICE_ACCOUNT_JSON` en Vercel (todo el JSON en una sola línea).
4. Subir el nuevo `credentials.json` al servidor TKL en `C:\TKL\siaf_sync\`.
5. Verificar sync (workflow_dispatch).
6. **Recién después**, borrar la key vieja desde Google Cloud Console.

### `DATABASE_URL` (rotar password Neon)

1. Neon dashboard → Roles → seleccionar role → **Reset password**.
2. Copiar nuevo `DATABASE_URL`.
3. Actualizar en Vercel → Redeploy.
4. Actualizar local `.env.local` / `.env.neon` activos.

---

## Agregar un permiso operativo nuevo

Ver [permissions/permission-system.md](../permissions/permission-system.md)
sección "Catálogo de permisos".

Pasos resumidos:

1. Editar `scripts/seed-permissions.ts`.
2. Commit + push.
3. `.env.neon` con `DATABASE_URL` y correr seed:
   ```bash
   npx dotenv-cli -e .env.neon -- npx tsx scripts/seed-permissions.ts
   rm .env.neon
   ```
4. OWNER/ADMIN puede asignar el permiso desde `/puestos`.

---

## Distribución de versión nueva del script Python SIAF

Cuando se hace un cambio en `scripts/server/siaf_to_drive.py`:

1. Editar y commitear.
2. Verificar sintaxis: `python -m py_compile scripts/server/siaf_to_drive.py`.
3. Generar ZIP:
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
4. Mandar el ZIP al admin del servidor TKL.
5. El admin reemplaza `siaf_to_drive.py` en `C:\TKL\siaf_sync\`.

---

## Dar acceso ejecutivo a un usuario nuevo

1. OWNER entra a `/owner/accesos`.
2. Busca el usuario, toggle "Otorgar".
3. **Pedirle al usuario que cierre sesión y vuelva a entrar** — el JWT
   no se refresca automáticamente.

---

## Crear un nuevo usuario

### Si es ADMIN o usuario operativo no-OWNER

1. Entrar como ADMIN a `/admin/usuarios/nuevo`.
2. Llenar form: name, email, role, branch (si aplica).
3. **Salvar** → muestra una password temporal (visible una sola vez).
4. Anotarla y comunicarla al usuario.
5. El usuario en su primer login debe cambiarla (`mustChangePassword: true`).

### Si es OWNER u otro ADMIN

Solo OWNER puede crear OWNER o ADMIN. Mismo flujo desde `/owner/usuarios/nuevo`.

---

## Resetear password de un usuario

1. ADMIN (para no-OWNER) o OWNER (para todos): `/admin/usuarios/[id]` o `/owner/usuarios/[id]`.
2. Botón "Resetear password" → genera nueva password temporal y la muestra.
3. Comunicarla al usuario.

---

## Operaciones de DB ad-hoc

### Conectarse a Neon desde local

```bash
psql "postgresql://USER:PASS@HOST.neon.tech/DBNAME?sslmode=require"
```

### Prisma Studio contra producción

⚠️ Cuidado — Prisma Studio permite editar rows directamente. Usar solo
para inspección o mutaciones muy puntuales.

```bash
# .env.neon temporal con DATABASE_URL de producción
npx dotenv-cli -e .env.neon -- npm run db:studio
# Después: rm .env.neon
```

### Counts rápidos

```sql
-- Snapshots por día (últimos 14 días)
SELECT "snapshotDate", COUNT(*)
FROM "SalesSnapshot"
WHERE "snapshotDate" > now() - interval '14 days'
GROUP BY "snapshotDate"
ORDER BY "snapshotDate" DESC;

-- Sucursales sin snapshot hoy
SELECT b.name
FROM "Branch" b
LEFT JOIN "SalesSnapshot" s ON s."branchId" = b.id
  AND s."snapshotDate" = CURRENT_DATE
WHERE b.active AND b."showInExecutive" AND s.id IS NULL;

-- Última actualización del Excel de saldos
SELECT MAX("modifiedTime") FROM "SourceFile" WHERE filename LIKE '%SALDOS%';
```

---

## Calendario de operaciones recurrentes

### Diario

- ✅ Verificar GitHub Actions (3 runs verdes).
- ✅ Verificar dashboard ejecutivo carga.
- ✅ Verificar `SyncLog` no tiene `ERROR` recurrentes.

### Semanal

- ✅ Revisar `AuditLog` por accesos sospechosos.
- ✅ Confirmar con Administración que sigue subiendo `SALDOS.xlsx` en horario.
- ✅ Backup de `tkl_sync_control.json` del servidor TKL (el script no rota backups, así que copiarlo manualmente protege contra borrado accidental).

### Mensual

- ✅ Revisar Neon storage usage (free tier es 0.5GB).
- ✅ Revisar Vercel bandwidth.
- ✅ Rotar `SYNC_WEBHOOK_SECRET` si pasaron 90+ días sin rotar.

### Trimestral / anual

- ✅ Rotar `AUTH_SECRET` (con aviso a usuarios).
- ✅ Rotar Service Account de Google.
- ✅ Auditoría de usuarios activos vs `executiveAccess`.

---

## Referencias cruzadas

- [integrations/siaf-sync.md](../integrations/siaf-sync.md) — pipeline completo.
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) — diagnóstico.
- [deploy/vercel-deploy.md](../deploy/vercel-deploy.md) — config de Vercel.
- [SECURITY.md](../SECURITY.md) — rotación de secrets.
