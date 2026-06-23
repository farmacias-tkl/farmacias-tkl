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

## Technical Audit — seguimiento

Estado de los hallazgos del audit técnico.

### ✅ DM-7 — Corrupción silenciosa de históricos (snapshots) — COMPLETO

Primer hallazgo del Technical Audit, resuelto **end-to-end** (ver CHANGELOG, Junio
2026). `ActionPlan` / `OvertimeRecord` / `AbsenceRecord` capturan empleado, sucursal
y puesto al crear, y display + PDF leen el snapshot con fallback a la relación viva.
Sub-hitos: DM-7A captura (`ffc0034`), DM-7B1 display+PDF (`7920745`), DM-7B2 backfill
de filas previas (`5efc827`).

### ✅ Overtime 404 — acción de aprobación/rechazo sin backend — RESUELTO (OVERTIME-0)

Resuelto como **OVERTIME-0** (commit `7490366`): se ocultó la acción rota en
`/horas-extras` (frontend-only). `PATCH /api/overtime/[id]` no existe — daba 404 real
al click en Aprobar/Rechazar. El "loop" del audit era **engañoso**: era una acción
muerta al click, no un loop automático. Crear y listar quedaron intactos.

### ✅ DC-1 — Doble fuente de verdad en llegadas tarde — RESUELTO (commit `62cbe90`)

`AbsenceRecord.LATE_ARRIVAL` ya **no se puede crear**: `POST /api/absences` con
`absenceType=LATE_ARRIVAL` devuelve **400** claro y accionable. Las llegadas tarde van
por el path canónico `TimeEvent` (`TimeEventFormPanel` → `POST /api/time-events`), que
es lo que la **UI visible ya usaba**. La premisa original del audit estaba
**desactualizada**: no hubo que migrar la UI visible — se eliminó *dead code* de
`AbsenceRecord.LATE_ARRIVAL` en ausencias y se bloqueó el backend residual. Conteo prod
previo: **1** `AbsenceRecord.LATE_ARRIVAL` legacy / **0** `TimeEvent.LATE_ARRIVAL`. El
legacy queda **read-only** (no se migró data). El gap de DC-4 en `/api/absences` no se
tocó (deuda separada).

### Deuda pendiente (en orden de prioridad)

1. **DC-3** — pendiente.
2. ⚠️ **OWNER absoluto** — pendiente.
3. 💡 **OVERTIME-1** — aprobación real de horas extras (feature faltante). Detalle abajo.
4. 🔒 **Sidebar hardening** — `name.charAt(0)` sin guard. Detalle abajo.
5. ⚠️ **DC-4 gap** — audit fuera de `$transaction` en `POST /api/absences`. Detalle abajo.

### 💡 OVERTIME-1 — Aprobación real de horas extras (feature faltante, no bug)

No existe `PATCH /api/overtime/[id]`. El schema de `OvertimeRecord` **ya** tiene
`approvedByUserId` / `approvedAt` / `status` / `rejectionReason`; falta el handler y
reactivar los botones que OVERTIME-0 ocultó. Patrón "la forma TKL": guard de transición
con matriz blanca (`REPORTED → APPROVED` / `REPORTED → REJECTED`) y `auditLog` dentro de
un `$transaction`.

### 🔒 Sidebar — `name.charAt(0)` sin guard (hardening, no bug vivo)

`src/components/layout/Sidebar.tsx:80` hace `name.charAt(0)` sin guard → **500 que
voltea el layout entero** si `user.name` es `undefined`/vacío. No reproducible con
login normal (`name` siempre viene), pero un user sin nombre rompe la app. Fix de una
línea (`name?.charAt(0)` con fallback). Hardening, no urgente.

### ⚠️ DC-4 (parcial) — `POST /api/absences` audita fuera de transacción

DC-4 movió el `auditLog` dentro del `$transaction` en `ActionPlan` y `OvertimeRecord`,
pero **nunca cubrió `AbsenceRecord`**: `POST /api/absences` crea el registro y luego
escribe el `auditLog` con `.catch(() => {})` **fuera** de un `$transaction`. Si el
audit falla, el registro de ausencia queda sin rastro de auditoría. Deuda separada,
identificada, **no resuelta** (DM-7 no la tocó, por diseño — una concern por commit).

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

## Call Center / Emozion

### ✅ Estado post-reconexión (2026-06-18)

Webhook Emozion reconectado 2026-06-18 12:17 UTC. Verificado en tráfico real
sostenido (~1h): 497 message_created PROCESSED, 0 ERROR en mensajes,
0 externalMessageId repetidos sobre ~500 mensajes (idempotencia confirmada
en prod, incluido el fallback outgoing emozion-message:<id> que no era
verificable desde código). Deploy 65c9722, EMOZION_DEBUG_CAPTURE ausente/OFF.
Salud del conector: cerrada y verificada.

Cementerio histórico pre-fix (NO recuperar, NO borrar, filtrar por fecha en reportes):
- 153 NORMALIZED_OR_RAW (17/06 20:31–20:41 UTC): mensajes reales ya atendidos
  por operadores en Emozion; pérdida solo del espejo TKL. Decisión: no recuperar.
- 23 DEBUG_SANITIZED (17/06 22:09–22:17 UTC): capturas de diagnóstico, no reprocesables.

### Pendientes no bloqueantes (diagnóstico read-only antes de construir)

#### 🔒 1. Multimedia en UI

DIAGNÓSTICO COMPLETADO. La UI muestra `[contenido multimedia]` porque en mensajes
solo-media `body` viene null y el render cae a ese fallback.

- Schema ya tiene `mediaUrl` y `mediaType` (`ConversationMessage`).
- La ingesta guarda `mediaType` (etiqueta del adjunto), pero **`mediaUrl` queda siempre
  `null`**.
- **`mediaUrl = null` es DELIBERADO/CONSERVADOR, no un olvido del mapper**: la URL del
  adjunto (`data_url` de Emozion) se descarta por diseño hasta resolver privacidad, acceso,
  retención y almacenamiento de datos sensibles (recetas/fotos clínicas/PDFs = datos de salud).

Conteo real en prod (query PII-safe, Neon Console):
- `mediaUrl` poblados: **0**
- `mediaType` poblados: **293**
- `body` null: **190**
- tipos: image **218**, file **69**, audio **7**

Clasificación final: **B + D + E**.
- **B** — mapper/ingesta descarta la URL por diseño.
- **D** — la naturaleza real de la URL Emozion/Chatwoot (pública / temporal / autenticada /
  expirable) NO es determinable desde el repo.
- **E** — privacidad/PII de salud aplica obligatoriamente.

Orden de dependencia para resolver (NO empezar por la UI: sin decisión E no hay nada seguro
que ingerir ni mostrar):
1. **E primero** — decisión de privacidad/producto/storage.
2. **Luego B** — ingesta de la URL, si se decide conservar/traer adjuntos.
3. **Luego D** — proxy/storage si la URL es temporal, protegida o no debe exponerse directo.
4. **UI al final.**

No es un fix UI chico: sin `mediaUrl` no hay archivo que renderizar. Mostrar adjuntos
requiere decisión previa de producto/privacidad/storage: permisos; quién puede ver qué
conversación; retención; si se guarda la URL de Emozion; si se usa proxy; si se copia a
storage propio; cómo tratar recetas, PDFs, imágenes y audios. No elegir todavía la solución
técnica. Resolverlo dentro del Sprint 2 / Inbox operativo, no como parche suelto.

#### ⚠️ 2. Live refresh de UI

DIAGNÓSTICO COMPLETADO: capacidad ausente, no bug. Los mensajes nuevos no aparecen
en `/call-center` sin refresh/navegación manual.

Encuadre (verificado contra código):
- Sprint 1 es vista read-only server-rendered: listado y detalle cargan por Prisma
  durante el render server (no client fetch).
- No hay TanStack Query / SWR / polling / SSE / websocket en el área Call Center.
- `router.refresh()` existe SOLO post-mutación en `ConversationActions` (tomar/reasignar/
  cerrar); no se dispara por mensajes entrantes del webhook.
- Por eso, mientras la página queda abierta, no se actualiza sola: requiere refresh/
  navegación manual para ver mensajes nuevos.
- NO es problema de caché: las vistas son dinámicas por request; al navegar/refrescar
  traen datos frescos. El problema no es stale cache sino la ausencia de un mecanismo de
  actualización mientras la página permanece abierta.

Pendiente (no bloqueante): resolverlo como parte del Sprint 2 / Inbox operativo, NO como
fix suelto. No elegir todavía la técnica (polling vs SSE vs websocket) — queda para una
Fase A propia del Sprint 2. El mecanismo de refresco debe considerar privacidad/PII de
salud: frecuencia y superficie de transmisión de bodies de mensajes, recetas, imágenes o
datos sensibles hacia operadores que quizá no estén atendiendo esa conversación.

#### ✅ 3. Timezone UI — RESUELTO

Las fechas/horas de Call Center se mostraban en UTC en vez de hora Argentina.

- **Causa**: las vistas son server-side (Vercel = UTC) y formateaban con
  `Intl.DateTimeFormat` sin `timeZone` → el string salía en UTC y llegaba congelado
  al browser (no dependía del navegador del operador).
- **Fix** (commit `26ffad6`): helper `src/lib/dates/format.ts` con `formatDateTimeAR`
  (instantes/timestamps, zona `America/Argentina/Buenos_Aires`) y `formatDateAR`
  (date-only, sin correr el día). Aplicado SOLO en las dos vistas de Call Center
  (`/call-center` listado y `/call-center/[id]` detalle).
- **Verificado visualmente en producción**: `/call-center` muestra hora local correcta.
- **Deuda residual (no bloqueante)**: el patrón "sin `timeZone` explícita" sigue latente
  en otros módulos que formateen timestamps server-side a futuro. El helper queda
  disponible como camino correcto, pero NO se migraron los 40+ call sites existentes
  (riesgo de corrimiento de día en date-only si se aplica zona a fechas calendario).
  Hardening separado si se decide.

#### 💡 4. Auto-heal de conversation_status_changed huérfano

Durante la reconexión en
caliente, ~11 status_changed sobre conversaciones nacidas mientras el webhook estaba
apagado (sin conversation_created) cayeron en needsRetry/ERROR. Clusterizados 12:23–12:35
UTC, se agotaron solos (>40 min sin nuevos). Residuo esperado de reconexión, NO bug,
NO corrupción. Pendiente: evaluar si el processor debe crear conversación mínima desde
status_changed (análogo al auto-heal de message_created embebido). Priorizar solo si
reaparece en tráfico normal. CUIDADO de diseño: definir qué pasa si llega el
conversation_created real después del auto-heal (idempotencia, no pisar estado nuevo
con uno viejo).

#### ⚠️ 5. Whitelist de transiciones

Emozion manda transiciones fuera de whitelist
(ej. SIN_ASIGNAR→RESUELTA, 7 casos/1h), ingeridas como PROCESSED con nota
"Emozion es la realidad". NO bug — decisión de diseño deliberada. Pendiente: leer
whitelist actual vs transiciones reales del fork; decidir si formalizar los saltos
comunes o mantener el registro-como-excepción.

#### 💡 6. Endpoint/vista de monitoreo (opcional)

Evaluar vista interna read-only de salud
del webhook (eventos por status, errores recientes, duplicados por externalMessageId,
huérfanos) para no depender de queries manuales en Neon. Patrón seguro: endpoint
server-side + GitHub Actions con secret (como el sync SIAF), credencial en Vercel,
nunca en sandbox. Feature con diseño/gate propio; no implementar si distrae del Inbox.

#### ✅ 7. Adjuntos / multimedia — B1 (schema base) APLICADO en prod (2026-06-19)

Primer ciclo del diseño storage-agnóstico de adjuntos (resuelve la base del ítem 🔒 1).
Modelo `ConversationAttachment` **attachment-first**: la receta NO es entidad ni se infiere
del `mediaType` — es un valor de `documentType` que setea un humano (acción auditada), no la
ingesta. **Solo schema; ningún código lee la tabla todavía** (la ingesta de metadata es B2).

- **Aplicado y verificado en Neon producción** + commiteado (`a2d8a7c`).
- Verificado en prod: tabla + 14 columnas; FK `conversationId` → `Conversation`
  **ON DELETE RESTRICT** (divergente de messages/stateHistory, que usan Cascade: un adjunto
  puede ser receta, no se borra en cascada); FK `messageId` → `ConversationMessage`
  **ON DELETE SET NULL**; `sourceExternalId` **UNIQUE nullable** (idempotencia, patrón de
  `externalMessageId`); defaults `source=EMOZION` / `documentType=UNKNOWN` / `status=RECEIVED`;
  4 índices (`conversationId`, `messageId`, `documentType`, `status`); 3 enums con valores
  exactos: `AttachmentSource{EMOZION,INTERNAL,MIGRATED}`,
  `DocumentType{UNKNOWN,PRESCRIPTION,ARCHIVED_PRESCRIPTION,RECEIPT,OTHER}`,
  `AttachmentStatus{RECEIVED,PENDING,FAILED,REDACTED,DELETED}`.
- **Storage-agnóstico**: NO hay columnas de URL/provider/estados de rama — esas son B6,
  expand-only, recién cuando se resuelva copia-vs-referencia.

**Nota operativa (precedencia de env en el push a prod).** El `db push` de B1 a Neon lo
ejecutó Daniel con una `DATABASE_URL` temporal seteada en la sesión de PowerShell: la variable
de entorno de sesión tuvo **precedencia sobre el `.env` local** (que apunta a `localhost`).
Para futuros pushes a prod, preferir el patrón documentado **`.env.neon` efímero + dotenv-cli**
(`npx dotenv-cli -e .env.neon -- npx prisma db push`), o **verificar explícitamente la
precedencia de env** antes de ejecutar, para no aplicar contra la DB equivocada.

#### ✅ 8. Adjuntos / multimedia — B2 (ingesta de metadata) APLICADO y VERIFICADO en prod (2026-06-20)

Ingesta de **metadata** de adjuntos desde el webhook Emozion → rows reales en
`ConversationAttachment`. Sin descargar archivos, sin URLs, sin bytes. Tres micro-ciclos,
los tres cerrados:
- **B2.0 — captura estructural PII-safe** (deployada y usada en ventana controlada): registró
  la FORMA real del adjunto del fork sin exponer contenido. Confirmó el contrato:
  `id:number` estable, `file_type`, `file_size`; el fork NO manda `mime_type`/`content_type`/
  `file_name`; `data_url`/`thumb_url` presentes (world-readable) pero nunca se ingieren.
- **B2.1 — mapper puro de metadata** (commit `8a65013`): `normalizeMessage` emite
  `attachments: NormalizedAttachment[]` (todos, no solo `[0]`); `sourceExternalId =
  "emozion-attachment:<id>"` (id estable, sin fallback por índice); `mimeType`/
  `originalFileName` = null; identidad rota → `insufficientData` (todo-o-nada).
- **B2.2 — persistencia** (commit `af4b69e`): crea los rows dentro de la MISMA `$transaction`
  del processor.

Verificado en producción con dato real (primer `ConversationAttachment` creado):
- `sourceExternalId="emozion-attachment:1214256"`, `mediaType="image"`,
  `documentType="UNKNOWN"`, `status="RECEIVED"`, `source="EMOZION"`, `mimeType=null`,
  `originalFileName=null`, `sizeBytes=115669`, **sin ninguna URL persistida**.
- **Cadena verificada de punta a punta**: webhook → mapper → ingest → row real.
- **Idempotencia por `sourceExternalId`** (find-create-if-absent + `sourceExternalId` en
  `DOMAIN_IDEMPOTENCY_TARGETS` como red para la carrera concurrente).
- **Opción B implementada**: si el mensaje ya existe y llega un adjunto NUEVO en un reenvío,
  el adjunto se crea — no se pierde en silencio.
- Salud post-deploy: `message_created` con adjunto procesado OK; el único ERROR reciente es el
  huérfano conocido (`conversation_status_changed` sobre conversación inexistente / needsRetry,
  ítem 💡 4), **no relacionado con B2.2**.

Continuación del carril en el ítem ✅ 9 (metadata) y el estado del carril CONTENIDO abajo.

#### ✅ 9. Adjuntos / multimedia — carril METADATA COMPLETO y verificado en prod (2026-06-21)

El carril **metadata** (mostrar QUE existe un adjunto y sus datos, sin servir el archivo) está
**cerrado de punta a punta**: ingesta (B2) → persistencia → endpoint metadata-only (B3-A) →
UI metadata (B5).

- **B3-A — endpoint metadata-only** (commit `5af34d3`, deploy verde):
  `GET /api/call-center/conversations/[id]/attachments`. Gate `canViewCallCenter` (lectura);
  401/403/404/200 `{ data }` ordenado asc. **`select` whitelist** (sin `sourceExternalId`/URLs/
  `originalFileName`/`mimeType`/storage) → una columna futura de B6 no se filtra por
  construcción. SIN audit (listar metadata no es acceso a contenido; audit granular = B4).
  Nota: B5 NO lo consume (la UI usa SSR directo); queda como **API pública del módulo** para
  consumidores futuros.
- **B5 — UI metadata** (commit `dfa4474`, deploy verde, verificado visualmente en prod):
  el detalle SSR `/call-center/[id]` reemplaza el placeholder mudo `[contenido multimedia]` por
  metadata textual anclada al mensaje — p. ej. **`Adjunto: Imagen · 113 KB · Sin clasificar`**.
  Body y adjunto conviven (texto arriba, `Adjunto:` debajo). Carga vía Prisma (SSR directo, no
  consume B3-A), `select` whitelist. Adjuntos **huérfanos** (`messageId` null por SetNull o sin
  match) NO desaparecen → bloque **"Adjuntos de la conversación"** como red (Ajuste 3).
  **Sin preview/thumbnail/link/botón/descarga** — metadata-only, scope respetado.
- Verificado en prod (captura): placeholder reemplazado por la metadata real; caso adjunto-solo
  y caso texto+adjunto correctos; bloque de huérfanos **no aparece** (sano, sin huérfanos).

**Carril CONTENIDO (ver/descargar el archivo) — NO hecho, pendiente de ingeniería.**
Desbloqueado **legalmente** (decisión de storage/retención validada por asesor de datos), pero
sin implementar:
- **B6 — storage privado propio — PRÓXIMO.** Rama **A (copia a storage propio privado)**: los
  adjuntos Emozion son world-readable sin auth (`exp:null`) → proxy/referencia a una URL pública
  permanente no es modelo de privacidad válido.
- **B3-B — preview/download seguro** (sirve bytes/stream o signed-URL propia) — posterior, depende de B6.
- **B4 — auditoría granular** (PREVIEW_OPENED/DOWNLOADED/CLASSIFY/REDACT) — posterior, cuando haya acceso a contenido.

(NO documentar B6/B3-B/B4 como hechos: solo el carril metadata está cerrado.)

#### ⚠️ 10. Riesgo histórico — adjuntos ya ingeridos sin origen propio recuperable

Los `ConversationAttachment` **ya ingeridos** (p. ej. `emozion-attachment:1214256`) **no tienen
`data_url` recuperable desde TKL**. Confirmado en B6 Fase A, desde el código:
- nunca se guardó en `ConversationAttachment` (B1 es storage-agnóstico, sin columna de URL);
- el payload normalizado del `WebhookEvent` no contiene URL (`NormalizedAttachment` no la lleva);
- el debug capture solo guardaba estructura (nombres+tipos), nunca el valor de `data_url`;
- el processor **anula `payload` (`JsonNull`)** al quedar `PROCESSED`.

**Conclusión:** TKL tiene la **metadata** pero NO una **copia privada propia** del archivo. Esos
archivos existen **solo en Emozion**. Si Emozion se corta, borra adjuntos, o se migra **sin
rescate**, se pierden.

- La salida de Emozion **no es inminente** (depende de que la plataforma TKL esté lista y
  probada), pero el acceso a históricos es **incierto** y conviene asegurarlo con tiempo.
- **Acción externa pendiente (Daniel / infra):** verificar una vía de rescate **antes de migrar**.

**Nota técnica que favorece el rescate:** los `data_url` de Emozion son **world-readable y
`exp:null`** (no expiran mientras Emozion siga vivo) — la misma exposición detectada en la
decisión de storage. Mientras Emozion siga vivo, los archivos históricos son **descargables por
su URL sin token**. El cuello de botella del rescate **NO es el acceso al archivo, sino obtener
el LISTADO de URLs**. Por eso la **vía 1** es probablemente la más simple si infra puede listar
las URLs.

Vías a chequear (ninguna verificada — no asumir que existen/funcionan hasta confirmarlo):
1. **Export/listado** de `data_url` / ActiveStorage desde Emozion.
2. **API Emozion/Chatwoot** para listar conversaciones, mensajes y adjuntos históricos por ids.
3. **Acceso directo al storage/base de Emozion** para copiar archivos físicos / blobs.

Encuadre:
- NO bloquea **B6.0** going-forward (la captura de origen para adjuntos NUEVOS es independiente).
- SÍ debe quedar **resuelto antes de apagar/migrar** fuera de Emozion.
- El rescate **NO está hecho**; es un esfuerzo proactivo, separado del diseño going-forward.

#### 📌 11. Decisión B6.0 — la captura de `data_url` y el job de copia se activan JUNTOS

B6.0 Fase A concluyó que `data_url` es un **dato tóxico**: URL world-readable de un adjunto
clínico, `exp:null`. Capturarla sin un job que la consuma maximiza su vida útil y **reintroduce
a escala la exposición que B2 evitó**. (B6 NO está implementado — esto es decisión de diseño.)

**Modelo de captura:**
- **P0 (no persistir `data_url`)** — DESCARTADO: no es viable sin acoplar el job al webhook
  (Modelo A, I/O de red en la ingesta) o sin guardar el `raw` completo (peor, más PII). Ambos rechazados.
- **P1 (persistencia transitoria mínima)** — ELEGIDO, pero **solo con consumo en ventana corta**:
  una columna nullable `sourceFetchUrl` que el job consume y nullea.

**Regla dura de secuenciación:**
- **NO capturar ni una sola URL hasta que exista el job B6.3 que la consuma y la nullee.**
  Captura sin consumo = acumulación de URLs clínicas world-readable en la DB.
- El **schema** puede ir antes (es inerte: nadie escribe/lee la columna).
- La **lógica de captura** se activa **junto con B6.3**, nunca antes.
- **Guarda compuesta obligatoria** para que la captura escriba algo:
  `ATTACHMENT_SOURCE_CAPTURE_ENABLED` && `ATTACHMENT_COPY_JOB_ENABLED` && storage config presente.

**Cifrado en reposo:** recomendación actual = **NO cifrar en B6.0**. Preferir columna **en claro
+ vida mínima + no exposición + null post-copia**. La URL ya es world-readable de origen; cifrar
solo esa columna (mientras el resto de la PII de dominio va en claro) da poca ganancia y agrega
superficie. Reabrir solo si cambia el modelo de amenaza o si se decide cifrar PII de dominio en general.

**Ciclo de vida de la URL transitoria (precisiones obligatorias):**
- **Éxito**: `sourceFetchUrl` se nullea en el **MISMO update** que marca `STORED` (atómico —
  nunca `STORED` con URL).
- **Fallo definitivo**: al agotar reintentos → `FAILED` **+ URL nulleada**. Implica que un
  `FAILED` **NO se auto-recupera**: pasa a **rescate manual / re-captura del origen desde
  Emozion**, igual que los históricos (ítem ⚠️ 10). Explícito para que nadie espere retry
  automático sobre un `FAILED` sin URL.
- **TTL de seguridad**: el barrido **NO debe dejar un adjunto en `PENDING` sin URL** (estado
  zombie: parece procesable pero no tiene origen). Si el TTL mata una URL vieja, **además** marca
  el adjunto como sin origen (`FAILED` o futuro `NO_ORIGIN`) **y alerta**. Es un evento **visible**
  ("el job se demoró demasiado y se perdió el origen transitorio"), nunca limpieza silenciosa.
  Trade-off consciente: borrar el origen vuelve el archivo incopiable → el TTL debe ser ruidoso.
  Valor exacto del TTL **a confirmar en B6.3**, no se fija ahora.

**Schema/activación:**
- B6.0 **schema** (`sourceFetchUrl`, `sourceFetchCapturedAt`) va **junto con B6.1** (storage
  fields + `StorageStatus`).
- B6.0 **captura** va **junto con B6.3** (job copy/retry).

**Plan B6 actualizado:**
1. **B6.1** — schema expand-only: storage fields + `StorageStatus` + `sourceFetchUrl` +
   `sourceFetchCapturedAt`. Inerte, sin capturar todavía.
2. **B6.2** — adapter R2 / S3-compatible.
3. **B6.3** — captura + job copy/retry **activados juntos** (guarda compuesta).
4. **B6.4** — verificación controlada (staging/manual).
5. **B6.5** — gate de prod.
6. **Históricos Emozion** — track externo separado (ítem ⚠️ 10).

(NO documentar B6 como implementado.)

#### ⚠️ 12. Track C — continuidad de recordatorios de medicación (crónicos/anticonceptivos) atada a Emozion

Hoy se envían **recordatorios de reposición de medicación** (crónicos/anticonceptivos) a
pacientes por WhatsApp **desde Emozion**. Emozion registra un campo/flujo rotulado como
opt-in `(⚠️ ver revisión de licitud más abajo)`, pero queda pendiente verificar si ese
registro corresponde a un acto explícito del paciente o a una inferencia desde
`tipo_de_cierre`.

Operativamente el flujo actual existe en Emozion; la continuidad/migración de esos envíos
desde TKL queda pendiente de resolver la Fase A de licitud — TKL **no debe asumir la
continuidad propia** hasta entonces.

**El problema:** esos datos viven **SOLO en Emozion** — el contacto, el atributo de medicación
(CRONICO/ANTICONCEPTIVOS) y, **lo más crítico, la EVIDENCIA DE OPT-IN** (cuándo, vía, qué
consintió). Si Emozion se apaga sin migrarlos, TKL pierde la **continuidad** del envío **y la
prueba de licitud** del tratamiento.

- **El opt-in es el dato de primera clase a rescatar**, no un campo más: es lo que permite a TKL
  continuar el envío legítimamente.
- **Dato de salud sensible (Nivel C** del documento de decisión storage/retención): rescate con
  **base / retención / acceso propios**, NO como lista de contactos ni CRM comercial.
- **Track SEPARADO** de adjuntos históricos (ítem ⚠️ 10) y de B6. Requiere su **propia Fase A**:
  descubrir cómo Emozion guarda los atributos (¿tags? ¿custom attributes?) **y** el opt-in
  (¿tag? ¿custom attribute? ¿fecha? ¿evidencia conversacional?).
- **Reloj**: salida de Emozion (no inminente). **Sin reloj de cumplimiento** (hay opt-in).
- Modelar como **dominio separado** (p. ej. `CustomerContact` / `PatientReminder`), **NO** dentro
  de `ConversationAttachment` ni como CRM.
- **NO implementado, NO diseñado.** Solo registrado como track con reloj.

**Alimentación desde Track F (ver ítem 🧭 17):** un cierre clínico
(`clinicalClassification = CRONICO/ANTICONCEPTIVO`) puede crear/actualizar una inscripción de
recordatorio con intervalo (30/60/90 días según producto). F es el **trigger/cierre**; C es el
**dominio con estado, opt-in y scheduling propios** — NO son lo mismo, NO mezclar.

Modelo conceptual (NO final):
`ReminderEnrollment { customerContactId, reminderType: CHRONIC/CONTRACEPTIVE, intervalDays,
sourceConversationId, sourceCloseOutcomeId, status: ACTIVE/PAUSED/CANCELLED/UNKNOWN,
optInEvidence, lastPurchaseAt, nextReminderAt }`.

**⚠️ Revisión de licitud CRÍTICA para Fase A.**
**Esto deja en REVISIÓN el `CONFIRMADO OPT-IN` registrado antes en este ítem.** Ese "confirmado"
describía que el flujo de recordatorios tiene opt-in documentado en Emozion, pero NO se verificó
si ese opt-in es un acto explícito del paciente o una inferencia del `tipo_de_cierre` asignado por
operador/bot. Hasta resolver la pregunta de Fase A de abajo, tratar el opt-in como **NO confirmado**
a efectos de continuar envíos desde TKL.

Pregunta de Fase A: ¿el opt-in al recordatorio es un acto **SEPARADO y explícito** del paciente, o
se **INFIERE** de que el operador/bot tildó `Crónico 60 días` al cerrar (`tipo_de_cierre`)?
**Clasificar a alguien como crónico NO es su consentimiento a recibir recordatorios.** Si el envío
automático se dispara solo por `tipo_de_cierre` sin un "sí" explícito del paciente, la base de
licitud es **débil** y hay que resolverla **antes de que TKL continúe los envíos**. Fase A debe
verificar dónde vive (si existe) la **evidencia de opt-in real** en Emozion, **separada de
`tipo_de_cierre`**.

#### 📌 13. Storage R2 — ubicación validada + infra preparada (Track B)

**Ubicación del bucket R2** (Automático → Norteamérica oriental / EE.UU.): **validada por el
asesor de datos** (vía dueño). Transferencia internacional de datos de salud **avalada**. No
bloqueante. Anotado para trazabilidad.

**Infra R2 preparada (aún NO cableada al repo):**
- Bucket **`farmacias-tkl-adjuntos`** creado, **privado** (acceso público deshabilitado), clase Estándar.
- Token Account "Lectura y escritura de objetos", **scopeado al bucket**, TTL siempre.
- Credenciales + endpoint guardados **fuera del repo** (gestor de secretos). **NO en el repo, NO
  en Vercel/GitHub todavía** — eso va en **B6.2**.
- Provider previsto: **R2 / S3-compatible**.

(B6 sigue sin implementar: esto es solo preparación de infra + trazabilidad de la decisión.)

#### ✅ 14. B6.1 — schema de storage APLICADO en prod e INERTE (2026-06-22)

Schema expand-only para la copia a storage privado, **aplicado en Neon producción** con
verificación read-only. **Inerte**: ningún código lee/escribe las columnas nuevas todavía
(adapter = B6.2, job/captura = B6.3). Commit `22884db`, en `origin/main`.

Verificado en prod (read-only):
- **13 columnas nuevas** en `ConversationAttachment`: `storageStatus`, `storageProvider`,
  `storageBucket`, `storageKey`, `storageContentType`, `storageSizeBytes`,
  `storageChecksumSha256`, `storageCopiedAt`, `storageAttemptCount`, `storageLastError`,
  `storageNextRetryAt`, `sourceFetchUrl`, `sourceFetchCapturedAt`.
- Enum **`StorageStatus`**: `PENDING, COPYING, STORED, FAILED, NO_ORIGIN, DELETED` (eje
  distinto de `AttachmentStatus`).
- Defaults: `storageStatus = PENDING` (NOT NULL), `storageAttemptCount = 0` (NOT NULL).
- Índice `ConversationAttachment_storageStatus_storageNextRetryAt_idx` presente.
- **17 adjuntos históricos intactos**, todos `storageStatus = PENDING`;
  `sourceFetchUrl`/`sourceFetchCapturedAt` non-null = **0**. `ADD COLUMN` no-destructivo confirmado.

**NO se activó captura de `sourceFetchUrl`** (sigue inerte/null). La captura va recién con B6.3
(job + guarda compuesta), según el ítem 📌 11. Redes duras puestas en B6.1: `FORBIDDEN` del smoke
B3-A ampliada con las storage/sourceFetch cols (menos `storageStatus`) + `sourceFetchUrl` en `PII_KEYS`.

**Próximo: B6.2** — adapter R2 / S3-compatible, **con mocks** (sin credenciales reales en tests;
las credenciales R2 se cablean a Vercel/GitHub recién en B6.2, hoy fuera del repo).

> **Contexto Emozion (inspección de UI, capturas 2026-06-22), base de los tracks D/E/F:**
> atributos de CONTACTO observados (`dni`, `obra_social`, `numero_afiliado`, `domicilio`, `zona`,
> `id_sesion_typebot` como posible vínculo a Typebot — a verificar); atributo de CONVERSACIÓN
> `tipo_de_cierre` (tipo Lista) que **mezcla valores comerciales y clínicos** y hoy dispara
> recordatorios automáticos. Todo lo de abajo es **intención + Fase A pendiente**, sin diseño
> final ni implementación.

#### 🧭 15. Track D — identidad operativa Emozion ↔ TKL (riesgo BAJO)

Mapear **operadores** Emozion ↔ usuarios TKL; preservar atribución histórica (quién atendió,
cerró o reasignó). Habilita Inbox Manual / Sprint 2.
- **Sin datos de paciente.** Universo **finito** (empleados). Puede avanzar **antes** que E/F.
- Modelo conceptual (NO final): `OperatorExternalIdentity { source=EMOZION, externalOperatorId,
  externalName, externalEmail?, userId? (nullable), active }`.
- **Fase A**: cómo Emozion identifica operadores humanos vs bot; estabilidad de los IDs; qué hacer
  con mensajes sin match en TKL.
- NO mezclar con E, F, C ni B6.

#### 🧭 16. Track E — contactos Emozion / Customer Mirror (riesgo MEDIO-ALTO por alcance/finalidad, NO por ilicitud de origen)

Base operativa **legítima**: el contacto escribió a TKL para un pedido/consulta. NO está prohibido;
tampoco se trata con la ligereza de un CRM común.
- **Principio de finalidad**: separar **atención operativa** / **continuidad asistencial** (Track C)
  / **CRM-comercial** (base propia). Que alguien haya consultado por un medicamento **NO habilita
  automáticamente** campañas futuras.
- **Mirror MÍNIMO primero**: identidad externa estable (`source=EMOZION`, `externalContactId`),
  teléfono, nombre, última actividad, y **solo** tags operativos/logísticos.
- **Filtro de tags OBLIGATORIO**: los tags NO son homogéneos. `ayuda`, `caba`, `casa_central`
  parecen logísticos; tags clínicos o de frontera con Track C son **Nivel C**. Clasificar
  **tag-por-tag en Fase A ANTES** de decidir cuáles cruzan.
- **Tier sensible** (`dni`, `obra_social`, `numero_afiliado`, `domicilio`, `zona`, historial):
  Fase A propia — clasificación, minimización, base legal, retención, auditoría.
  `obra_social + numero_afiliado + nombre + teléfono` debe tratarse como **dato de salud por
  inferencia**.
- **Dedupe**: Emozion tiene "Combinar" → guardar identidad externa estable para no perder
  trazabilidad ante merges.
- **Selección por CANAL DE ORIGEN** vía campo de canal explícito — NO inferir por teléfono ausente.
  Telegram parece canal de prueba → **fuera del mirror por defecto** hasta verificar; antes
  confirmar que ninguna conversación clínica/B6/C relevante entró por Telegram.
- **Typebot** (`id_sesion_typebot`): parte de los atributos los carga un flujo, no humanos. Fase A
  debe mirar Typebot como **segunda fuente**.
- NO mezclar con B6, C, D ni F.

#### 🧭 17. Track F — outcomes de conversación / `tipo_de_cierre` (NUEVO)

Emozion usa el atributo de CONVERSACIÓN `tipo_de_cierre` (Lista) para el resultado del cierre. Es
**metadata de cierre**, NO contacto/CRM. Lo asigna el operador o el bot al cerrar.
- Valores observados **mezclan dos finalidades** en un solo dropdown:
  - comerciales: `VENTA CONCRETADA`, `SOLO CONSULTA`, `NO REALIZO UN PEDIDO`,
    `FALTA DE STOCK/DISCONTINUADO`, `NO TENEMOS LO QUE PIDIO`, `SOLO NAVEGACION POR EL BOT`;
  - clínicos/asistenciales: `Crónico Mensual`, `Crónico 60 días`, `Anticonceptivos 3 Meses`.

**Corrección de modelado clave — NO copiar el enum único de Emozion como modelo interno final.**
`rawValueSnapshot` conserva el valor original para trazabilidad, pero el mapeo interno parte en
**DOS EJES ORTOGONALES**:
- `commercialOutcome` (nullable/UNKNOWN hasta validar semántica): venta, consulta, sin pedido,
  sin stock, bot, etc.
- `clinicalClassification?` (nullable): `CRONICO`, `ANTICONCEPTIVO` o ninguno.

Razón: con un solo campo, cualquier reporte/export **comercial** de conversiones tocaría
inevitablemente filas **clínicas**. Dos ejes permiten que el reporte comercial filtre por
`commercialOutcome` **sin leer lo clínico**, y que Track C lea `clinicalClassification` **sin pasar
por reporting comercial**. **No** inferir que un valor clínico implica `VENTA_CONCRETADA` hasta Fase A.

Modelo conceptual (NO final): `ConversationCloseOutcome { conversationId,
closedByUserId?/externalOperatorId?, source=EMOZION/TKL/BOT, rawValueSnapshot, commercialOutcome?,
clinicalClassification?, closedAt }`.

Reglas:
- Copiar primero el **catálogo de valores + semántica**; mapear a enums internos **recién tras Fase A**.
- **NO disparar recordatorios** hasta que Track C esté diseñado.
- Auditar quién asignó/cambió el cierre cuando TKL sea fuente de verdad.
- Track F **alimenta** Track C (ítem ⚠️ 12), pero **no son lo mismo**.
- NO mezclar con E ni D.

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
