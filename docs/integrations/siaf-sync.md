# Integración SIAF — pipeline de ventas

Este documento describe el pipeline completo que extrae las ventas
diarias del sistema SIAF (legacy Windows + DBF) y las carga en la base
Neon. Es el módulo de integración más crítico del sistema.

---

## Vista general del pipeline

```
SIAF Windows DBF
     │
     │  03:00 ART (Task Scheduler)
     ▼
scripts/server/siaf_to_drive.py
     │
     │ Genera 33 CSVs (11 sucursales × 3 archivos)
     ▼
\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\diario\
     │
     │ Drive Desktop sincroniza a Drive
     ▼
Google Drive — carpeta diario/
     │
     │  04:00 ART — GitHub Actions cron
     │  POST /api/sync/trigger {"source":"all"}
     ▼
src/lib/sync/sync-sales.ts
     │
     │  - downloadSalesCSVs(folderId)
     │  - parseSalesCSV / parseSalesVendedoresCSV / parseSalesOSSocialCSV
     │  - Filtrar por lastSnap por sucursal
     │  - prisma.salesSnapshot.createMany({ skipDuplicates: true })
     ▼
Neon: tabla SalesSnapshot
     │
     ▼
Dashboard ejecutivo (/executive)
```

---

## Componentes

### 1. Servidor TKL Windows + Python

**Ubicación**: el servidor donde corre el SIAF (sistema de ventas).
Sistema legacy con archivos DBF como base de datos.

**Componentes en disk**:

```
C:\TKL\siaf_sync\
├── siaf_to_drive.py            ← script principal
├── credentials.json            ← Service Account de Google (NO commitear)
├── tkl_sync_control.json       ← registro de hasta qué fecha procesó cada sucursal
└── tkl_sync.log                ← log rotativo

C:\_Datos\_administracion\temporal_sucursales\
└── (carpetas con DBF de cada sucursal — leído por el script)

\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\
├── historico\   ← CSVs acumulativos completos (carga inicial)
└── diario\      ← CSVs solo con días procesados en el run actual
```

**Cron** (Task Scheduler):
- Trigger: diariamente a las 03:00 AM, todos los días incluyendo domingos.
- Acción: `python.exe C:\TKL\siaf_sync\siaf_to_drive.py`.
- Working directory: `C:\TKL\siaf_sync\`.
- Run as: usuario con permisos de lectura sobre los DBF y la carpeta de red.

### 2. Drive como buzón

Carpeta `TKL-SIAF-CSV/` con dos subcarpetas:

| Carpeta | Propósito | Quién escribe | Quién lee |
|---|---|---|---|
| `historico/` | CSVs acumulativos (carga inicial vía `--full-reset`) | Script Python una sola vez al setup | `scripts/load-sales-history.ts` (ejecutado manualmente) |
| `diario/` | Solo los días procesados en cada run (sobreescribe) | Script Python diariamente | `src/lib/sync/sync-sales.ts` (3× por día) |

**Por qué dos carpetas**: la carpeta `historico/` puede tener cientos
de filas por sucursal (años de datos). Si Vercel tuviera que leerla en
cada sync, podría timeoutear (limit 60s en Hobby, 300s en Pro). La
carpeta `diario/` típicamente tiene 1 fila por sucursal (la de ayer),
así el sync es rápido.

### 3. Webhook en Vercel

**Endpoint**: `POST /api/sync/trigger`.

**Auth**: Bearer token (`SYNC_WEBHOOK_SECRET`).

**Body**: `{ "source": "all" | "balances" | "sales" }`.

**Output**: JSON con resultados por source.

```json
{
  "ok": true,
  "results": {
    "balances": {
      "status": "SUCCESS",
      "message": "5 filas procesadas, 0 ignoradas. Archivo: SALDOS.xlsx",
      "rowsProcessed": 5
    },
    "sales": {
      "status": "SUCCESS",
      "message": "11 filas procesadas, 0 ignoradas. 11 sucursales.",
      "rowsProcessed": 11
    }
  }
}
```

---

## Modos del script Python

### Modo DIARIO (default)

```bash
python siaf_to_drive.py
```

Procesa días pendientes desde la última fecha registrada en
`control.json` hasta **ayer**. Sobreescribe los CSVs en `diario/` con
solo esos días (típicamente 1 fila por archivo).

Caso típico: el cron diario.

### Modo BACKFILL un día

```bash
python siaf_to_drive.py --date 2026-04-20
```

Procesa solo esa fecha. Sobreescribe los CSVs en `diario/` con esa
fila. **No** actualiza `control.json` (no avanza la marca de progreso).

Caso típico: una sucursal no procesó bien y quiero re-correr ese día.

### Modo HISTÓRICO completo

```bash
python siaf_to_drive.py --full-reset
```

Borra `control.json` y reprocesa **todo el historial** disponible.
Escribe los CSVs acumulativos en `historico/`. Pide confirmación
interactiva antes de borrar.

Caso típico: setup inicial del sistema, o si se descubre un bug que
requiere recargar todo.

⚠️ **No correr en producción salvo causa muy fundada** — implica varios
minutos de proceso y mucha I/O sobre los DBF.

---

## CSVs generados

Por cada sucursal, el script genera **3 archivos**:

### `{Sucursal}_ventas.csv`

Una fila por día.

```csv
sucursal,fecha,total_ventas,total_tickets,ticket_promedio,total_unidades,ventas_efectivo,ventas_tarjeta,ventas_obra_social
America,2026-04-21,1234567.89,89,13871.10,245,450000.00,650000.00,134567.89
```

### `{Sucursal}_vendedores.csv`

Una fila por vendedor por día.

```csv
sucursal,fecha,codigo_vendedor,nombre_vendedor,ventas,tickets,descuentos,unidades
America,2026-04-21,01,JUAN PEREZ,250000.00,35,4500.00,89
America,2026-04-21,02,MARIA LOPEZ,180000.00,28,3200.00,65
```

`unidades` es opcional (CSVs viejos no la traen, parser usa 0).

### `{Sucursal}_ossocial.csv`

Una fila por obra social por día.

```csv
sucursal,fecha,codigo_os,nombre_os,ventas_bruto,descuentos,ventas_neto,tickets,unidades
America,2026-04-21,OSDE,OSDE,80000.00,8000.00,72000.00,12,25
America,2026-04-21,PAR,PARTICULAR,950000.00,12000.00,938000.00,75,210
```

`tickets` y `unidades` son opcionales.

`PAR` = ventas particulares (sin obra social). El script las agrupa
internamente bajo esa clave para que el merge de unidades funcione
(antes era `""` y se renderizaba como `"PAR"` solo en la escritura).

---

## Detección de códigos de venta

El SIAF guarda comprobantes con códigos cortos. El script usa dos
funciones para decidir si un comprobante cuenta:

### `es_codigo_venta(codigo)`

Retorna `True` para códigos válidos de venta:

- **Códigos fijos**: `DET`, `TKT`, `FAC`, `MOV`, `NOV`, `WHA` (WhatsApp).
- **Numéricos 3 dígitos**: `001`–`999` (puntos de venta).
- **Numéricos 2 dígitos**: `01`–`99`.
- **Facturas A/B/C**: `A01`–`C99`.

### `incluir_registro(codigo)`

Aplica la lógica completa:

1. Si el código está en `CODIGOS_EXCLUIR` → False.
2. Si es `NCR` (nota de crédito) → True (cuenta con TOTBRUTO negativo).
3. Si pasa `es_codigo_venta()` → True.

### `CODIGOS_EXCLUIR`

```python
CODIGOS_EXCLUIR: set[str] = {
    "NDB", "REM", "MCC", "MOS", "REC",
    "BAJ", "ALT", "PRE", "PED", "COM", "REA",
    "OP",  "OI",  "OTR", "IMD", "IME",
}
```

Códigos que NUNCA son ventas (notas de débito, remitos, comprobantes
internos, etc.).

**Cambio reciente** (commit `f953c67`): `WHA` salió de `CODIGOS_EXCLUIR`
y entró a códigos fijos válidos. Las ventas por WhatsApp ahora se
contabilizan.

### NCR — notas de crédito

NCR **no** se excluye. Sus rows tienen `TOTBRUTO < 0`. Al sumar a
`total_bruto` lo descuentan automáticamente del total de ventas.
Comportamiento esperado: si una sucursal hace una nota de crédito,
sus ventas del día bajan en consecuencia.

---

## Cruce DETMOV con CPBTEMI — dual index

El SIAF guarda dos archivos:
- **CPBTEMI** (CABECERA): un row por comprobante con totales.
- **DETMOV** (DETALLE): un row por línea de cada comprobante con
  unidades, vendedor, etc.

Para asignar unidades al vendedor o a la obra social correctos, el
script cruza por número de comprobante. Pero a veces la fecha en
DETMOV difiere de CPBTEMI (cierres tardíos, líneas registradas al día
siguiente).

Solución: **dos índices** sobre cpbt_meta:

```python
cpbt_meta:           dict[tuple[str, str], dict] = {}  # (numero, fecha) → meta
cpbt_meta_by_numero: dict[str, dict] = {}              # numero → meta (fallback)
```

Y un resolver:

```python
def _resolve_meta(nrocpbt, fecha_str, cpbt_meta, cpbt_meta_by_numero):
    """Lookup doble. Devuelve (meta | None, fue_fallback_con_fecha_distinta)."""
    meta = cpbt_meta.get((nrocpbt, fecha_str))
    if meta is not None:
        return meta, False
    meta = cpbt_meta_by_numero.get(nrocpbt)
    if meta is None:
        return None, False
    return meta, True   # mismatch — log para visibilidad
```

El log al final reporta cuántas líneas matchearon, cuántas fueron
ignoradas (sin match alguno) y cuántas tuvieron `date_mismatch`. Si
date_mismatch es muy alto, puede haber un problema de sincronización
de timestamps en SIAF.

---

## Sync en Vercel — `src/lib/sync/sync-sales.ts`

### Flujo

1. **Lee la carpeta `diario/`** vía Drive API (`downloadSalesCSVs`).
2. **Agrupa por sucursal** (esperan 11 sets, cada uno con 3 archivos:
   ventas, vendedores, ossocial).
3. **Resuelve `branchId`** vía `resolveBranchId(name, branches)` que
   matchea contra `branch.name` y `branch.aliases`.
4. **Parsea los 3 CSVs** con tolerancia a errores: si un CSV falla, se
   loguea warning y se continúa con la sucursal sin esa parte.
5. **Indexa vendedores y OS por fecha** para lookup rápido.
6. **Filtra incrementalmente**: query `salesSnapshot.findFirst({ where: { branchId, dataSource: "siaf" }, orderBy: { snapshotDate: "desc" } })` → solo se procesan filas más nuevas que esa fecha.
7. **Construye el batch** mergeando ventas + vendedores + OS en `rawData`.
8. **Inserta** con `prisma.salesSnapshot.createMany({ data: batch, skipDuplicates: true })` — `skipDuplicates` defiende contra carreras o re-runs.
9. **Escribe `SyncLog`** con resultado.

### Ejemplo del payload `rawData`

```json
{
  "source": "siaf",
  "efectivo": 450000,
  "tarjeta": 650000,
  "obra_social": 134567.89,
  "vendedores": [
    {"codigo": "01", "nombre": "JUAN PEREZ",
     "ventas": 250000, "tickets": 35, "descuentos": 4500, "unidades": 89}
  ],
  "obras_sociales": [
    {"codigo": "OSDE", "nombre": "OSDE",
     "ventas_bruto": 80000, "descuentos": 8000, "ventas_neto": 72000,
     "tickets": 12, "unidades": 25},
    {"codigo": "PAR", "nombre": "PARTICULAR",
     "ventas_bruto": 950000, "descuentos": 12000, "ventas_neto": 938000,
     "tickets": 75, "unidades": 210}
  ]
}
```

Se serializa como `Json` en Postgres. `SalesTable.tsx` lo deserializa
para los filtros de OS/Vendedor.

### Por qué `dataSource: "siaf"` filtro en `lastSnap`

Si en algún momento se cargó data manual o seed con `dataSource != "siaf"`,
no debe contar como base de incrementalidad. El filtro garantiza que
"último snapshot SIAF" sea estable independiente de seed/manual.

### Manejo de errores por sucursal

```ts
try {
  // procesar sucursal X
} catch (e) {
  warnings.push(`[${set.sucursalName}] ERROR procesando: ${String(e)}`);
  rowsSkipped++;
  // sigue con la próxima sucursal — no aborta el sync entero
}
```

Una sucursal con DBF corrupto no rompe el sync de las otras 10.

---

## Sync de saldos — `src/lib/sync/sync-balances.ts`

Análogo pero para el Excel de saldos bancarios.

### Flujo

1. `getBalancesFileBuffer(folderId)` — busca el Excel en Drive.
2. **Si no hay archivo** → status `NO_FILE`, log y return.
3. **Si `isStale`** (modifiedTime no es de hoy) → status `STALE`, skip
   sin escribir snapshots.
4. **Idempotencia**: query `sourceFile.findUnique({ driveFileId })`. Si
   `modifiedTime` matchea el del file actual → skip ("idempotente").
5. **Parsea el Excel** (`parseBalancesExcel`).
6. **Para cada row**: `bankBalanceSnapshot.upsert()` (crea o actualiza
   por la unique constraint).
7. **Escribe `SourceFile`** con el nuevo `modifiedTime`.
8. **Escribe `SyncLog`**.

### `isStale` semántica

- **Frontend stale**: el dato es viejo y debería preocupar (banner rojo).
- **Sync stale**: el archivo de Drive no fue modificado hoy → no
  procesar pero no es error (admin no subió Excel todavía).

---

## Operaciones comunes

### Forzar re-sync de un día

```bash
# Servidor TKL
python C:\TKL\siaf_sync\siaf_to_drive.py --date 2026-04-20
```

Esperar a que Drive Desktop sincronice (1-2 min). Después dispatch
manual del workflow GitHub:

`repo → Actions → Daily Sync → Run workflow → source: all`.

### Borrar día específico de la DB y recargar

```typescript
// .env.neon con DATABASE_URL
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
await prisma.salesSnapshot.deleteMany({
  where: { snapshotDate: new Date('2026-05-05T00:00:00.000Z') }
});
```

```bash
npx dotenv-cli -e .env.neon -- npx tsx scripts/delete-sales-by-date.ts
```

Después:
- Si querés recarga incremental: dispatch del workflow GitHub.
- Si fue un día intermedio (no el último): no se recargará automáticamente
  porque el filtro `lastSnap` solo trae filas más nuevas que el último
  snapshot — habría que borrar también todos los días posteriores.

### Recargar histórico completo

Una sola vez al setup:

```bash
# Servidor TKL
python siaf_to_drive.py --full-reset

# Local con .env.neon apuntando a historico/
npx dotenv-cli -e .env.neon -- npx tsx scripts/load-sales-history.ts
```

Después volver a configurar `GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID` en
Vercel apuntando a `diario/`.

### Distribuir versión nueva del script Python

1. Editar `scripts/server/siaf_to_drive.py`.
2. `python -m py_compile scripts/server/siaf_to_drive.py` — verificar sintaxis.
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

4. Mandar al admin del servidor TKL para instalar.
5. Reemplazar `siaf_to_drive.py` en `C:\TKL\siaf_sync\`.

---

## Troubleshooting específico

Ver [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) sección "Sync" y "Script
Python SIAF" para casos comunes.

---

## Referencias cruzadas

- [database/neon-schema.md](../database/neon-schema.md) — `SalesSnapshot`, `SourceFile`, `SyncLog`.
- [operations/daily-operations.md](../operations/daily-operations.md) — cron schedule, retry manual.
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) — encoding, DBF errors, etc.
- `scripts/server/INSTALACION.md` — guía de instalación del servidor TKL.
