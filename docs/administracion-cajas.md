# Administración / Cajas

Documento de estado del módulo **Control de Cajas** (área Administración) y su
export futuro a Eiffel. La fuente de verdad del modelo de datos es
`prisma/schema.prisma`; este documento registra el **estado de aplicación** y las
decisiones de negocio asociadas.

Ver también: [database/neon-schema.md](database/neon-schema.md) (catálogo del
modelo) y [product/operational-platform-roadmap.md](product/operational-platform-roadmap.md).

---

## Estado del schema en producción

**Fecha:** 2026-06-27

El schema de **captura y consolidación** del módulo Cajas fue aplicado en Neon
producción.

### Rama local

- `feature/administracion-cajas-eiffel`

### Commits locales

- `2b73ec4 feat(cajas): schema captura + consolidación (Fase 1B)`
- `05e11dd feat(cajas): estado REQUIERE_REEXPORTACION (Fase 1C)`

### Estado de Git (asimetría temporal)

- La rama **todavía no fue pusheada a `origin`**.
- Los commits que describen el schema aplicado existen **solo localmente**.
- Esto genera una asimetría temporal: **Neon producción ya contiene las tablas**,
  pero el remoto todavía no respalda esta rama. Hasta pushear, el schema vivo en
  prod no tiene respaldo versionado en `origin`.

### Aplicación en Neon

- Host verificado: `ep-mute-hill-amr63bly.c-5.us-east-1.aws.neon.tech`
- Aplicación mediante `npx prisma db push --skip-generate`.
- **No** se usó `--accept-data-loss`.
- **No** se generó carpeta de migraciones Prisma para este gate; la aplicación se
  hizo mediante `db push`.
- **No** hubo `DROP`.
- **No** hubo `ALTER COLUMN`.
- El dry-run previo (`prisma migrate diff`, read-only) fue **expand-only**:
  `CREATE TYPE=4`, `CREATE TABLE=9`, `CREATE INDEX=17`, `ALTER TABLE=18` (todos
  `ADD CONSTRAINT` sobre tablas nuevas), `ALTER COLUMN=0`, `DROP=0`. `Branch` y
  `User` aparecen únicamente como `REFERENCES`.
- El diff post-push devolvió `-- This is an empty migration.` (Neon en sync).
- Verificación read-only final: `VERIFY_OK`.

### Objetos creados

- **4 enums**
- **9 tablas**

#### Tablas creadas

- `CashBoxSheet`
- `CashBoxExpense`
- `CashBoxCashDelivery`
- `CashBoxCardLot`
- `BranchDailyCashClose`
- `CashWithdrawal`
- `OfficeCashAdjustment`
- `CashBoxSheetStateHistory`
- `BranchDailyCashCloseStateHistory`

### Estado de datos

- Todas las tablas fueron verificadas con `count=0`.
- El schema está **vivo en producción, pero inerte**.
- Todavía **no hay rutas, endpoints, UI ni código productivo** que use estas
  tablas.

### Enums

- `CashBoxSheetStatus`
- `BranchDailyCashCloseStatus`
- `CardLotType`
- `CardLotSource`

`CashBoxSheetStatus` quedó con estos valores, **en orden**:

- `BORRADOR`
- `CERRADA`
- `EN_REVISION`
- `APROBADA`
- `EXPORTADA`
- `REQUIERE_REEXPORTACION`
- `ANULADA`

`BranchDailyCashCloseStatus` **no** incluye `EXPORTADO`: el cierre diario es
control interno TKL y no alimenta el CSV Eiffel (la exportación bifurca desde
`CashBoxSheet`).

### Semántica de `REQUIERE_REEXPORTACION`

- Se usa cuando una caja **ya exportada/importada en Eiffel** fue corregida en TKL.
- En Eiffel no se corrige editando: la carga previa debe **borrarse/anularse** y
  luego **reimportarse**.
- Esa baja/anulación en Eiffel requiere **doble autorización**.
- Los operadores de cajas/liquidaciones **no** tienen ese permiso.
- El estado representa una **acción humana pendiente fuera de TKL** antes de
  reimportar.
- La reexportación debe pensarse como **CSV completo de sucursal+fecha**, no como
  CSV de una sola caja (Eiffel rechaza duplicados por sucursal+fecha).

### Prisma Client

- El Prisma Client local **NO fue regenerado** después del `db push`.
- Antes de construir endpoints o código que use los modelos nuevos, correr:
  `npx prisma generate`
- La verificación post-push usó SQL crudo vía `$queryRawUnsafe`, **no** modelos
  tipados nuevos.

### Call Center

- **No** se tocó Call Center.
- **No** se tocó B6 / R2 / Emozion / adjuntos.

### Export Eiffel

- El bloque Export Eiffel sigue **diferido**.
- **No** se crearon `EiffelExportBatch` ni `EiffelExportLine`.
- Los catálogos de Gauss ya están disponibles en Excel, pero **todavía no** fueron
  modelados ni integrados.
- El diseño de export debe hacerse en una fase posterior, cruzando catálogos Gauss
  con el modelo de Cajas.

### Pendientes de negocio (no bloqueantes para captura)

- Confirmar si el pendiente diario acumula **solo pesos** o también
  dólares/cheques (hoy el campo es `totalWithdrawalsPesos`, supuesto MVP en pesos).
- Confirmar cómo se computan **transferencias** en la práctica.
- Confirmar cómo se computa el **recargo** contra tarjetas.
- Definir lógica de endpoints: si un `OfficeCashAdjustment` sobre una caja
  `EXPORTADA` cambia **automáticamente** el status a `REQUIERE_REEXPORTACION`, o si
  requiere **acción explícita** de oficina. *(Decisión abierta.)*

### Próximo paso recomendado

1. Decidir si se pushea la rama local a `origin`.
2. Correr `npx prisma generate` localmente antes de escribir código.
3. Iniciar Fase 2 de dominio/endpoints de **captura**, sin mezclar todavía Export
   Eiffel.
