# Bugs y limitaciones conocidos

Este documento lista issues activos del sistema: bugs no resueltos,
limitaciones inherentes a la arquitectura, y workarounds en uso.

> Para problemas resueltos con instrucciones de fix ver
> [TROUBLESHOOTING.md](../TROUBLESHOOTING.md). Para roadmap futuro ver
> [future-roadmap/planned-modules.md](../future-roadmap/planned-modules.md).

---

## Categorización

- ⚠️ **Limitación**: comportamiento intencional pero subóptimo.
- 🐛 **Bug**: comportamiento incorrecto pendiente de fix.
- 🔒 **Riesgo**: superficie de seguridad / falla potencial.
- 💡 **Mejora pendiente**: idea aprobada pero no priorizada.

---

## Infraestructura

### ⚠️ Neon idle wakeup (5-10s en primer query)

**Descripción**: Neon serverless suspende el compute después de ~5 min
sin queries. La primera query post-idle tarda 5-10s. Puede disparar
timeout en algunos endpoints.

**Impacto**: usuarios que entran al sistema después de hueco prolongado
ven loading inicial lento (típicamente página `/dashboard` o
`/executive`). Subsiguiente navegación ya es rápida.

**Workaround**:
- Vercel Cron / GitHub Actions cada hora puede mantener el compute
  activo (no implementado — costo no justificado).
- Para scripts ad-hoc: si el primer query falla por timeout, reintentar.

**No es un bug**: comportamiento esperado de Neon serverless.

---

### ⚠️ Host de Neon `ep-xxx-pooler.c-N.us-east-1.aws.neon.tech`

**Descripción**: la convención de hostnames de Neon incluye `c-N`
(número de cluster) que algunos resolvers o firewalls tratan
inconsistentemente. Históricamente vimos timeouts de DNS en redes
restrictivas.

**Workaround**:
- En Vercel: no es problema (DNS resolvers públicos).
- En local con DNS corporativo restrictivo: configurar override o usar
  DNS público (8.8.8.8).

**No tiene fix posible** — es la convención de Neon.

---

## Sync de saldos

### ⚠️ Dependencia de admin manual subiendo `SALDOS.xlsx`

**Descripción**: el flujo de saldos depende de que Administración suba
manualmente el Excel a Drive cada mañana. Si no lo hace:
- `SyncLog.status = STALE`.
- Banner "Saldos sin actualizar" en el dashboard.

**Impacto**: alta dependencia humana. Ausencia de Administración =
no hay saldos actualizados.

**Workaround**:
- 3 corridas del cron (08:50, 09:30) dan margen a uploads tardíos.
- Banner discreto "Último cierre: DD/MM/YYYY" cuando es de ayer (no asusta).
- En domingos / feriados se respeta como stale legítimo.

**Mitigación futura posible**: integración directa con el banco vía
API (no priorizado).

---

### 🐛 Excel parsing puede fallar con formato no-estándar

**Descripción**: `parseBalancesExcel` espera estructura específica del
Excel (headers, columnas en orden). Si Administración cambia el formato
(agrega columnas, renombra), el parser puede:
- Tirar exception → status `ERROR`, sin filas guardadas.
- Loggear warnings y guardar parcialmente.

**Impacto**: si pasa silenciosamente, el dashboard puede mostrar saldos
incompletos sin warning visible.

**Detección**: `SyncLog.warnings` tiene los detalles. `BankBalanceSnapshot`
puede tener menos rows que sucursales esperadas.

**Workaround**:
- Comunicar a Administración que NO modifique el formato del Excel.
- Si hace falta cambiar el Excel, sincronizar con dev para actualizar
  el parser primero.

**Mitigación futura posible**: validación schema-aware con esquema
versionado y warning hard-fail si difiere.

---

## Sync de ventas (SIAF)

### ⚠️ DETMOV date_mismatch ocasionales

**Descripción**: el cruce de líneas DETMOV con CPBTEMI a veces tiene
fechas diferentes para el mismo NUMERO (cierres tardíos en SIAF).
Cubierto con dual index `cpbt_meta_by_numero` como fallback, pero el
fallback puede asignar la línea a una fecha distinta.

**Impacto**: bajísimo (mínimos % de líneas afectadas). Podría haber 1-2
unidades atribuidas a un día en lugar de otro.

**Detección**: log del script reporta `date_mismatch=N`. Si N es alto
(>1% del total), investigar.

**No requiere fix**: aceptable por costo/beneficio.

---

### 🐛 Script Python no maneja DBF corruptos cleanly

**Descripción**: si un DBF está corrupto o bloqueado por SIAF, dbfread
puede tirar excepción que el `read_dbf_safely` captura. Pero la
sucursal queda sin procesar ese día y nadie lo nota hasta que alguien
revise el log.

**Detección**: `tkl_sync.log` tiene la traza. Pero no hay alerting.

**Mitigación**: no implementada. Idea: enviar email/Slack notification
cuando el script termina con N sucursales fallidas > 0.

---

### ⚠️ `control.json` borrado = reproceso completo

**Descripción**: si se borra accidentalmente
`C:\TKL\siaf_sync\tkl_sync_control.json`, el próximo run del script
reprocesa todo el historial.

**Impacto**:
- Tiempo: minutos a horas según volumen.
- DB: los rows se duplican en `historico/` pero NO en Neon (porque
  Vercel solo lee `diario/`).

**Workaround**: tener backup del archivo. El script no rota backups
automáticamente — copiar manualmente cada cierto tiempo.

---

## Drive integration

### ⚠️ Google Drive API quota

**Descripción**: cuota gratuita de Drive API: ~1.000 requests/100s/usuario.

**Impacto actual**: muy bajo. Cada sync hace ~5-10 calls. Lejos del
límite.

**Riesgo**: si en el futuro se agregan más sync sources o más calls por
sync, podríamos chocar con la quota.

**Mitigación**: cachear `modifiedTime` de los files (ya hecho via
`SourceFile`) reduce calls innecesarios.

---

### 🔒 Service Account con permiso de Editor sobre carpetas

**Descripción**: el SA tiene permiso de Editor sobre `TKL-SIAF-CSV/` y
sobre la carpeta de saldos. Si el SA se compromete, un atacante podría:
- Modificar/borrar los CSVs / Excel.
- Subir CSVs maliciosos para inyectar data falsa en el dashboard.

**Mitigación implementada**:
- Validación tipos en parsers (numérico vs string).
- Sucursales no en DB se ignoran con warning.
- Los CSVs se sobreescriben cada noche.

**Mitigación adicional posible**: cambiar a Reader sobre la carpeta
de saldos (Vercel solo lee). Para SIAF necesita Writer (servidor TKL
sube). Idea: SA separado para read vs write.

---

## Auth y permisos

### ⚠️ JWT no se refresca al cambiar `executiveAccess`

**Descripción**: si OWNER otorga `executiveAccess` a un usuario, el
JWT actual del usuario sigue marcando el flag viejo. Necesita
relogearse.

**Impacto**: usuario espera entrar al dashboard inmediatamente, pero
recibe redirect a `/sin-acceso`.

**Workaround**: instruir al usuario "cerrá sesión y volvé a entrar".

**Mitigación futura posible**:
- Refresh token endpoint que re-fetchee el flag desde DB.
- O middleware que haga lookup ocasional (vs solo del JWT).

---

### ⚠️ Sin rate limiting en endpoints de auth

**Descripción**: un atacante puede intentar credenciales sin throttle.

**Mitigación implementada**: ninguna a nivel app. Vercel tiene rate
limiting plataforma-wide pero no por usuario.

**Mitigación futura posible**: agregar rate limiting (ej: `next-rate-limit`)
en el endpoint de NextAuth credentials.

**Modelo de amenaza actual**: bajo riesgo. Sistema interno, usuarios
conocidos, red corporativa.

---

### ⚠️ OWNER sin timeout de sesión

**Descripción**: el JWT de OWNER no expira (excepto por el TTL nativo
de NextAuth, que típicamente es 30 días).

**Razón**: comodidad operativa para Dirección.

**Riesgo**: si una laptop OWNER es robada y la cookie es accesible, el
atacante tiene acceso indefinido hasta cambiar `AUTH_SECRET`.

**Mitigación**: cookies HTTP-only + Secure. Browser cierra sesión al
limpiar cookies o en private mode.

---

## Frontend / UX

### ⚠️ `revalidate = 300` en server components

**Descripción**: el dashboard ejecutivo cachea por 5 min. Después de
sync exitoso, puede tardar hasta 5 min en reflejar.

**Workaround**: hard refresh (Ctrl+Shift+R).

**Mitigación futura posible**:
- `revalidateTag` desde el endpoint de sync.
- Reducir `revalidate` a 60s (más DB queries, mayor latencia).

---

### ⚠️ Mobile responsive ya optimizado pero limitado en ancho

**Descripción**: `SalesTable` mobile soporta hasta ~360px. En
viewports más chicos (raros pero existen) puede haber overflow horizontal.

**Mitigación**: ninguna especial — los devices reales actuales tienen
mínimo 360-390px.

---

## Documentación / DX

### 💡 Falta API reference auto-generada

**Descripción**: no hay generación automática de docs de los endpoints
de `/api/*`. Hay que leer el código.

**Mitigación futura posible**: OpenAPI spec o doc manual por endpoint.

---

### 💡 Falta testing strategy documentada

**Descripción**: hay tests puntuales (`scripts/test-position-permissions.ts`)
pero no hay test suite formal. No hay coverage tracking.

**Mitigación futura posible**: adoptar Vitest o Jest con setup
estándar, scripts en `package.json`.

---

## Datos / consistencia

### ⚠️ Sin migrations de Prisma

**Descripción**: el schema se aplica con `prisma db push` directo. No
hay tabla de migrations versionadas.

**Impacto**:
- Si dos developers cambian el schema en branches paralelas y el
  segundo en pushear "gana".
- No hay audit trail de cambios de schema.
- Rollback de cambios de schema requiere reverso manual.

**Por qué se eligió así**: schema en flujo activo, simplicidad inicial.

**Mitigación futura**: migrar a `prisma migrate` cuando el schema
estabilice. Requiere proceso ordenado:
1. Generar baseline migration desde schema actual.
2. Aplicar `prisma migrate resolve --applied` en producción.
3. Adoptar `prisma migrate deploy` en CI.

---

### ⚠️ `User.employeeId` no es relación Prisma formal

**Descripción**: `User.employeeId` es un `String?` con `@unique`, pero
no está modelado como `relation` en Prisma. Por eso `loadUserWithPermissions`
hace dos queries en lugar de un nested select.

**Razón**: decisión de Fase 1 — formalizar la relación implicaba
cambios en otros lugares del código.

**Mitigación futura**: formalizar la relación cuando se tenga ciclo
para validar todas las queries dependientes.

---

### ⚠️ `BankBalanceSnapshot.bankName == accountLabel` (duplicación)

**Descripción**: en el upsert de `sync-balances.ts` se hace:

```ts
await prisma.bankBalanceSnapshot.upsert({
  where: { branchId_bankName_accountLabel_snapshotDate: {
    branchId, bankName: row.banco, accountLabel: row.banco, ...
  }}
})
```

Ambos campos reciben el mismo valor (`row.banco`). El schema modela los
dos por separado (`bankName` vs `accountLabel`) pero el parser actual
no distingue.

**Impacto**: las cuentas se identifican solo por banco, no se distinguen
"cuenta corriente" vs "caja de ahorro" del mismo banco.

**Mitigación futura**: si Administración quiere distinguir cuentas,
actualizar el formato del Excel y el parser.

---

## Resumen prioritario

Si tuviera que priorizar fixes para los próximos sprints:

1. **🔝 Alerting cuando sync falla** — hoy nadie se entera hasta que
   Dirección abre el dashboard.
2. **Refresh de JWT al cambiar `executiveAccess`** — UX cuestión.
3. **Rate limiting en login** — defensa básica.
4. **Migrations de Prisma** — preparar para escalamiento.
5. **Testing strategy** — base para regresiones.

---

## Cómo reportar un bug nuevo

1. Verificar si ya está acá listado.
2. Buscar en `SyncLog`, `AuditLog`, Vercel logs antes de afirmar que es bug.
3. Si confirmado, agregar entry acá con:
   - Descripción.
   - Cómo reproducir (si aplica).
   - Workaround temporal.
   - Cuándo se detectó.

---

## Referencias cruzadas

- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) — fixes paso a paso para issues comunes.
- [future-roadmap/planned-modules.md](../future-roadmap/planned-modules.md) — roadmap.
- [SECURITY.md](../SECURITY.md) — superficie de seguridad detallada.
