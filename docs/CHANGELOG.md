# Changelog

Historial de cambios técnicos relevantes, agrupados por mes y por tipo
(`feat` / `fix` / `chore` / `docs` / `ui` / `style` / `refactor` / `perf`).

Generado a partir de `git log --oneline`. Para ver la totalidad del
historial: `git log` en el repo.

---

## Mayo 2026

### chore

- `5acd643` — update sync schedule — 04:00 ventas, 08:50 y 09:30 saldos

### fix

- `f953c67` — include WHA sales + units for PARTICULAR in SIAF parser

### ui

- `d70fc60` — header mobile "Tickets" / "Unid." en lugar de "T" / "U"

### feat

- `8ec40a1` — sales-table: mostrar ventas completas mobile en una sola fila

### fix

- `c4c3664` — sales-table: mobile grid evita truncar nombres de sucursal

---

## Abril 2026

### feat (executive / dashboard)

- `e802fc2` — SalesTable mobile como tabla compacta con ventas abreviadas
- `5b4b4aa` — rediseño SalesTable mobile como card compacta
- `91bf2c1` — comparativo personalizado + sort sucursales por ventas DESC
- `94541d7` — fallback a última fecha disponible en ventas
- `5577168` — KPI cards unificados, tabla ventas colapsada por default
- `dd5f42d` — script SIAF final + columnas comparativo + filtros OS/vendedor
- `60326c9` — grid responsivo en desgloses OS y vendedor
- `196b5b7` — agregar unidades por OS al CSV SIAF
- `6596940` — agregar tickets por OS y unidades por vendedor

### feat (permissions)

- `1b0d1da` — Fase 3: helpers `can` / `canInBranch` / `requirePermission`
- `b5a3b21` — Fase 2: UI y APIs para asignar permisos a puestos
- `1dd26d9` — Fase 1: schema `Permission` + `PositionPermission` + seed

### feat (security / owner)

- `87a9df3` — README y DEPLOYMENT guide
- `89c2cc6` — PWA manifest y app icons
- `d83677b` — user management para OWNER + compartir `/puestos` con OWNER
- `93bc2ef` — bloquear ADMIN de gestionar OWNER y otros ADMIN
- `65442db` — Fase 1: panel OWNER con gestión de acceso ejecutivo

### feat (sync)

- `c72fbe5` — triple cron + idempotencia por modifiedTime + skip stale
- `9d0658e` — propagar unidades por vendedor end-to-end

### fix

- `8a148e9` — SalesTable mobile UX (Sucursal/Ventas/Tickets/Unidades)
- `578b6df` — aplicar fix stale a saldos bancarios (paridad con ventas)
- `7d68b91` — banner ventas con TZ Argentina + 1 día de gracia
- `0e45ac1` — mostrar 'N/A' con tooltip cuando vs ayer no tiene base
- `91033d8` — unificar `/executive` y `/api/dashboard` gate via `canViewExecutive`
- `c6d8273` — usar `cpbt_meta` para DETMOV units lookup, dual index
- `068efe1` — mostrar accesos cruzados OWNER también en mobile
- `308ee74` — periodos mensuales como rolling months desde anchorDate
- `b0eaa44` — NCR en sales totals, DETMOV units filter to DET/NCR
- `3723846` — parsear anchorDate como local y enriquecer copy
- `f8da322` — anclar rangos a la última fecha disponible
- `d1cbf55` — balance table column alignment, mobile stacked layout
- `7d200d9` — balances sync siempre con snapshotDate de hoy
- `7d200d9` — allow `/api/sync` through middleware (era redirect a login)
- `6d33143` — excel parser: read only first sheet + dynamic header detection
- `8b09945` — exclude Call Center from executive sales seed

### chore

- `52def0b` — exclude Claude settings from git tracking
- `81f665b` — run daily sync every day including sundays
- `64127bb` — remove temporary debug logs
- `b9c265a` — temporary debug logs in sync-sales y downloadSalesCSVs

### refactor

- `f63dccb` — remove `CO_SUPERVISOR` role completely

### style

- `9f2bd10` — unificar header de monto a 'Ventas' en desgloses
- `d4a14fe` — pulido visual de tablas y copy ejecutivo

### feat (general)

- `4363cb0` — link a executive dashboard para OWNER en operativa header
- `ab68f91` — desglose OS/vendedor con `[COD]` y fix rango mensual

### perf

- `1e33c5d` — batch sales sync con `createMany` + filter-by-lastSnapshot

---

## Cómo leer este changelog

- **feat**: nueva funcionalidad
- **fix**: corrección de bug
- **ui / style**: cambio visual
- **refactor**: cambio interno sin alterar comportamiento
- **perf**: mejora de performance
- **chore**: tarea de mantenimiento
- **docs**: documentación

Cada bullet incluye el hash corto del commit. `git show <hash>` en el repo para ver el diff completo.

---

## Notas históricas relevantes

### Eliminación del rol CO_SUPERVISOR

`f63dccb` eliminó el rol `CO_SUPERVISOR` end-to-end. Esto requirió:

1. Reasignar todos los users con ese rol a `SUPERVISOR` antes de modificar el enum.
2. Actualizar arrays de permisos legacy (`MENU_BY_ROLE`, `ROUTE_PERMISSIONS`, helpers `can.*`).
3. Correr `prisma db push --accept-data-loss` después de migrar.

### Migración a sistema de permisos por puesto (Fases 1-3)

Tres commits de feature acumulados (`1dd26d9`, `b5a3b21`, `1b0d1da`)
dejaron infraestructura completa para un sistema de permisos granular
por puesto que coexiste con el sistema legacy por rol. Ver
[permissions/permission-system.md](./permissions/permission-system.md).

### Triple cron + idempotencia

`c72fbe5` introdujo el patrón actual: 3 ejecuciones diarias del workflow
con idempotencia por `modifiedTime` del archivo en Drive. Esto cubre el
caso "el admin sube el Excel tarde" o "lo corrige a media mañana".
Posteriormente `5acd643` cambió los horarios a 04:00 (ventas) +
08:50/09:30 (saldos).
