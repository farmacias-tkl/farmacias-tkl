# Coseguros SIAF en Neon — solo consultas

Los coseguros de cada sucursal se guardan en la tabla `CoseguroDaily` para
hacer consultas puntuales. **El dashboard no cambia**: no lee esta tabla, y
`syncSales()`, `SalesSnapshot` y las APIs del dashboard siguen igual.

> **El importe es cobertura secundaria de ventas que ya están contadas.** Un
> coseguro cubre parte de una venta que ya está en `SalesSnapshot` (con su obra
> social principal y lo que pagó el cliente). No genera otra venta ni otro
> ticket. **No se suma a las ventas** ni se resta de la obra social principal.

---

## De dónde sale

`scripts/server/siaf_to_drive.py` genera cada noche `{Sucursal}_coseguros.csv`
(ver [siaf-sync.md](siaf-sync.md#sucursal_coseguroscsv)) y lo sube a la carpeta
`diario/` de Drive, junto a los tres de ventas:

```csv
fecha,codigo_coseguro,nombre_coseguro,comprobantes,notas_credito,importe_coseguro
```

## Tabla `CoseguroDaily`

| Campo | CSV | Notas |
|---|---|---|
| `branchId` | nombre del archivo | Se mapea igual que en `syncSales` (`resolveBranchId` con nombre y alias de `Branch`) |
| `date` | `fecha` | `@db.Date` |
| `code` | `codigo_coseguro` | El mismo código en otra sucursal es otra fila |
| `name` | `nombre_coseguro` | Sale del `OS.DBF` de cada sucursal: puede variar entre sucursales |
| `receipts` | `comprobantes` | NCR incluidas |
| `creditNotes` | `notas_credito` | De esos, cuántos son NCR |
| `amount` | `importe_coseguro` | `Decimal(15,2)`. Negativo o cero es válido |
| `sourceFile` | — | `drive:{archivo}@{modifiedTime}` (diaria) o `historico:{archivo}` |
| `createdAt`, `updatedAt` | — | `updatedAt` cambia solo si cambió algún valor |

**Clave única:** `branchId + date + code`. Una recarga reemplaza la fila, no la
duplica. Las filas de Neon que no aparecen en una recarga se informan como aviso
y **no se borran**.

## Carga diaria

- **Llamada propia.** `POST /api/sync/trigger` con `{"source": "coseguros"}`.
  `sales` y `all` **no** la corren: la respuesta y el resultado de ventas son los
  de siempre. La dispara `.github/workflows/coseguros-sync.yml` a las 05:00 ART
  (después de los CSV de las 03:00 y de ventas de las 04:00/04:30); también se
  puede correr a mano desde Actions.
- **Apagada salvo** `COSEGUROS_SYNC_ENABLED=true` en Vercel. Apagada responde
  `DISABLED` y no lista, no descarga, no escribe ni deja `SyncLog`.
- **Termina de verdad dentro del límite** `COSEGUROS_DEADLINE_MS` (default 8000 ms,
  por debajo del límite más bajo de Vercel; se puede subir con la variable):
  - cada llamada a Drive lleva timeout y se cancela (`AbortSignal`) al vencer, y
    eso incluye la autenticación con Google: el pedido del token de la cuenta de
    servicio sale con la misma señal y se corta igual;
  - cada archivo de sucursal se escribe en **una transacción** (lee, compara y
    escribe) que tiene como tiempo total lo que queda de la corrida. Ese tiempo se
    reparte entre esperar para empezar (`maxWait`, hasta 1/4, tope 2 s) y ejecutar
    (`timeout`, el resto): juntos nunca lo pasan. Como el `timeout` de Prisma no
    corta una sentencia que ya está corriendo, antes de cada sentencia se fija
    `SET LOCAL statement_timeout` al tiempo que le queda y Postgres la cancela si
    se pasa. Si vence o falla cualquier sentencia, se revierte entera y no queda
    nada de esa sucursal;
  - con poco tiempo no se empiezan archivos nuevos;
  - se reserva 1 s para dejar el `SyncLog`, también cuando se agotó el tiempo.
- **Completa o incompleta.** Las esperadas son las **11** sucursales de la carga de
  ventas (`EXPECTED_SIAF_BRANCHES`, iguales a `FOLDER_MAP` de `siaf_to_drive.py`;
  un test lo verifica).
  - `SUCCESS` solo si las 11 se reconocen en `Branch` y se cargaron. Un archivo
    con solo el encabezado cuenta como cargado (0 filas).
  - Si falta alguna: `PARTIAL` (o `ERROR` si no se cargó ninguna), y el mensaje
    dice cuáles y por qué: `sin archivo`, `no reconocida en DB`,
    `archivo duplicado`, `archivo inválido`, `tiempo agotado` o `error`.
  - Un archivo de una sucursal que no es de las 11: aviso, no se carga.
- **`SyncLog` propio:** `source = SALES_COSEGUROS`. Mensajes:
  - `Completa: 11 de 11 sucursales. N filas nuevas, M actualizadas, K sin cambios.`
  - `Incompleta: 9 de 11 sucursales. Faltan: Galesa (sin archivo), Tekiel (archivo inválido). N filas nuevas, …`
  - `Incompleta: 0 de 11 sucursales. Falló la carga: …` (Drive, base o tiempo)
- **Si no se puede escribir el `SyncLog`** (Neon falla o no responde en 1 s), la
  corrida es `ERROR` aunque la carga haya andado: el mensaje empieza con
  `No quedó registrada en SyncLog (…). Resultado de la carga: …`, y la respuesta
  trae `loadStatus` (cómo terminó la carga) y `logWritten: false`. Además queda
  en la consola de Vercel.
- **Respuesta HTTP** de `source: "coseguros"`: 200 con `SUCCESS`, `PARTIAL` o
  `DISABLED`; 500 si es `ERROR`. El workflow marca el run en rojo si no es
  `SUCCESS` ni `DISABLED`.
- **Archivo inválido** (fecha, código vacío, números que no lo son, fecha + código
  repetidos): esa sucursal no se carga, ni sus filas válidas. **Nada se borra
  automáticamente:** las filas de Neon que ya no están en el archivo solo se avisan.

## Activación (por gate)

1. Aplicar `prisma/gates/2026-10-19-coseguro-daily.sql` en Neon por el gate de
   siempre (host-check, `prisma migrate diff`, scan destructivo, OK explícito).
   Solo agrega el valor de enum `SALES_COSEGUROS`, la tabla, tres índices y la FK
   a `Branch`.
2. Desplegar el código y el workflow. Con la variable ausente el workflow recibe
   `DISABLED` y no pasa nada.
3. Confirmar en Vercel el límite de duración de las funciones (plan, Fluid compute y
   "Max Duration" por defecto). Si es mayor, se puede subir `COSEGUROS_DEADLINE_MS`
   dejando margen (por ejemplo 45000 con un límite de 60 s).
4. Poner `COSEGUROS_SYNC_ENABLED=true` en Vercel.
5. Al día siguiente, revisar el run del workflow y el `SyncLog` de
   `SALES_COSEGUROS` (consulta 7).

Vuelta atrás: quitar `COSEGUROS_SYNC_ENABLED`. La tabla puede quedar.

## Histórico desde el 01/01/2026

1. **En el servidor**, correr el modo `--prueba` de `siaf_to_drive.py` una vez
   por sucursal, del `2026-01-01` a ayer, en una carpeta propia (no toca Drive,
   `control.json`, `historico/` ni `diario/`):

   ```
   python C:\TKL\siaf_sync\siaf_to_drive.py --prueba --sucursal "La Perla" --desde 2026-01-01 --hasta AAAA-MM-DD --salida C:\TKL\siaf-coseguros-historico\salida
   ```

2. **Copiar** los 11 `*_coseguros.csv` a una carpeta de la PC de desarrollo
   **fuera del repo** (el repo es público).
3. **Control sin base:**

   ```bash
   npx tsx scripts/load-coseguros-history.ts --dir <carpeta> --sin-db --control 2026-01-01:2026-10-12
   ```

   Muestra por sucursal filas, período y totales (comprobantes, NCR, importe),
   y los totales del período de control, para compararlos con los de referencia.
4. **Dry-run contra Neon** (solo lecturas; requiere el gate aplicado):

   ```bash
   npx dotenv-cli -e .env.neon -- npx tsx scripts/load-coseguros-history.ts --dir <carpeta> --control 2026-01-01:2026-10-12
   ```

   Por sucursal: cuántas filas se insertarían, cuántas ya existen (cargadas por
   la carga diaria) y cuántas de esas cambian de valor, con ejemplos. Lo
   esperado es que las existentes no cambien.
5. **Escritura**, con OK explícito y confirmando el host:

   ```bash
   npx dotenv-cli -e .env.neon -- npx tsx scripts/load-coseguros-history.ts --dir <carpeta> --apply --host <host de DATABASE_URL>
   ```

   Si algún archivo es inválido o su sucursal no se encuentra, no se escribe
   nada. Se escriben solo las filas nuevas y las que cambian; repetirlo no
   cambia nada.
6. **Verificar** con la consulta 6.

## Consultas de ejemplo (solo lectura)

Reemplazar fechas, textos y códigos. Los importes son **cobertura de coseguro**, no ventas.

> **Nunca agrupar ni filtrar por código solo.** El mismo código significa cosas
> distintas en cada sucursal (sale del `OS.DBF` de cada una), y el mismo coseguro
> puede tener un código distinto en cada sucursal. Se agrupa por **sucursal +
> código**; para un coseguro puntual se busca **por nombre** (consulta 2) y, si
> hace falta precisión, con los pares sucursal + código que devolvió (consulta 4).

**1. Cobertura por sucursal y código en un período**

```sql
SELECT b.name AS sucursal, c.code AS codigo, max(c.name) AS nombre,
       sum(c.receipts) AS comprobantes, sum(c."creditNotes") AS ncr,
       sum(c.amount) AS cobertura_coseguro
FROM "CoseguroDaily" c
JOIN "Branch" b ON b.id = c."branchId"
WHERE c.date BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY b.name, c.code
ORDER BY b.name, cobertura_coseguro DESC;
```

**2. Un coseguro puntual: con qué código figura en cada sucursal**

```sql
SELECT b.name AS sucursal, c.code AS codigo, c.name AS nombre,
       count(*) AS dias, min(c.date) AS primer_dia, max(c.date) AS ultimo_dia
FROM "CoseguroDaily" c
JOIN "Branch" b ON b.id = c."branchId"
WHERE c.name ILIKE '%texto%'
GROUP BY b.name, c.code, c.name
ORDER BY b.name, c.code;
```

El nombre depende de cómo esté escrito en el `OS.DBF` de cada sucursal: revisar
que aparezcan todas las sucursales esperadas y que no se cuele otro coseguro con
un nombre parecido.

**3. Un coseguro puntual: qué sucursales lo atendieron y cuántos comprobantes**

```sql
SELECT b.name AS sucursal, c.code AS codigo, max(c.name) AS nombre,
       sum(c.receipts) AS comprobantes, sum(c."creditNotes") AS ncr,
       sum(c.amount) AS cobertura_coseguro
FROM "CoseguroDaily" c
JOIN "Branch" b ON b.id = c."branchId"
WHERE c.name ILIKE '%texto%'
  AND c.date BETWEEN '2026-01-01' AND '2026-12-31'
GROUP BY b.name, c.code
ORDER BY comprobantes DESC;
```

**4. Lo mismo con pares sucursal + código explícitos** (los que devolvió la consulta 2)

```sql
SELECT b.name AS sucursal, c.code AS codigo, max(c.name) AS nombre,
       sum(c.receipts) AS comprobantes, sum(c."creditNotes") AS ncr,
       sum(c.amount) AS cobertura_coseguro
FROM "CoseguroDaily" c
JOIN "Branch" b ON b.id = c."branchId"
WHERE (b.name, c.code) IN (('Sucursal A', 'AAA'), ('Sucursal B', 'BBB'))
  AND c.date BETWEEN '2026-01-01' AND '2026-12-31'
GROUP BY b.name, c.code
ORDER BY b.name;
```

**5. Evolución mensual de un coseguro puntual (todas sus sucursales)**

```sql
SELECT to_char(c.date, 'YYYY-MM') AS mes,
       string_agg(DISTINCT b.name || ' ' || c.code, ', ') AS sucursal_codigo,
       sum(c.receipts) AS comprobantes, sum(c."creditNotes") AS ncr,
       sum(c.amount) AS cobertura_coseguro
FROM "CoseguroDaily" c
JOIN "Branch" b ON b.id = c."branchId"
WHERE c.name ILIKE '%texto%'
GROUP BY 1
ORDER BY 1;
```

**6. Control por sucursal en un período (para el histórico)**

```sql
SELECT b.name AS sucursal, count(DISTINCT c.date) AS dias,
       sum(c.receipts) AS comprobantes, sum(c."creditNotes") AS ncr,
       sum(c.amount) AS cobertura_coseguro
FROM "CoseguroDaily" c
JOIN "Branch" b ON b.id = c."branchId"
WHERE c.date BETWEEN '2026-01-01' AND '2026-10-12'
GROUP BY b.name
ORDER BY b.name;
```

**7. Últimas corridas de la carga diaria**

```sql
SELECT "createdAt", status, message, "rowsProcessed", warnings
FROM "SyncLog"
WHERE source = 'SALES_COSEGUROS'
ORDER BY "createdAt" DESC
LIMIT 10;
```

---

## Archivos

- `prisma/schema.prisma` — modelo `CoseguroDaily`, `SyncSource.SALES_COSEGUROS`.
- `prisma/gates/2026-10-19-coseguro-daily.sql` — SQL del gate (no aplicado).
- `src/lib/integrations/csv-coseguros-parser.ts` — parser.
- `src/lib/integrations/google-drive.ts` — `listCosegurosFiles` y `downloadDriveFileText` (con timeout y cancelación).
- `src/lib/sync/coseguros-upsert.ts` — plan y upsert por clave (diaria e histórico).
- `src/lib/sync/sync-coseguros.ts` — carga diaria (límite, completitud, `SyncLog`).
- `src/app/api/sync/trigger/route.ts` — `source: "coseguros"` (ventas sin cambios).
- `.github/workflows/coseguros-sync.yml` — la llamada diaria de las 05:00 ART.
- `scripts/load-coseguros-history.ts` — histórico local, dry-run por defecto.
- Tests: `csv-coseguros-parser.test.ts`, `sync-coseguros.test.ts`,
  `trigger-coseguros.test.ts` (ruta real contra la de b3af746) y
  `coseguros.smoke.ts` (Postgres local efímero: SQL del gate, transacciones
  reales, histórico y las consultas de este documento).
