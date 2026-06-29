# Refactor de Permisos — Plan cerrado de la segunda mitad (Decision Record)

- **Fecha:** 2026-06-28
- **Rama:** `refactor/permisos-por-usuario`
- **HEAD:** `99d1a61 feat(permissions): loader de permisos por usuario (Fase 1E)`
- **Estado:** núcleo lógico cerrado e INERTE (schema local + helpers + defaults + loader);
  Neon sin tabla `UserPermission`; ningún consumer en runtime; Cajas pausado.

Este documento fija el ORDEN, las DEPENDENCIAS y los GATES de la segunda mitad del
refactor, para que cada fase se ejecute contra criterios escritos, no improvisados.
Es un plan, no una implementación.

---

## 1. Estado de partida (desde Fase 2A, read-only)

- `UserPermission` **NO existe en Neon** (`to_regclass('public."UserPermission"')` = null). Núcleo inerte en prod.
- `PositionPermission` **inerte en data**: 0 asignaciones.
- `PositionPermission` **inerte en runtime**: 0 importers de `position-permissions.ts`;
  `requirePermission`/`canInBranch` con 0 usos en endpoints.
- **Usuarios**: paneles paralelos `/owner/usuarios` y `/admin/usuarios`; guards OWNER/ADMIN
  vigentes (ADMIN no toca OWNER/ADMIN; protección de último OWNER activo). **No existe** UI de
  permisos finos por usuario.
- **Call Center ↔ Ejecutivo**: acople de **superficie + perímetro de permiso**. Columnas
  (`executiveAccess` vs `callCenterAccess`), endpoints (`owner/access` vs `owner/call-center-access`)
  y helpers (`canViewExecutive` ≠ `canViewCallCenter`) están separados; pero `GET /api/owner/access`
  devuelve ambos flags y ambos PATCH están bajo `canAccessOwnerPanel` (OWNER-only).
- **Ejecutivo**: `canViewExecutive = role === "OWNER" || executiveAccess`; `executiveAccess` sigue
  vivo como columna en `User`; hoy solo los 2 OWNER lo tienen → mover a OWNER-only no cambia
  comportamiento actual (verificar data justo antes de 2I).
- **Data `User.branchId`**:
  - 4/4 `BRANCH_MANAGER` con `branchId` poblado (usan defaults `OWN_BRANCH` → resolubles ✅).
  - 3/3 `SUPERVISOR` sin `branchId`, pero usan defaults `ALL_BRANCHES` (ignora sucursal → no rompe).
  - `Employee.userId` = 0 vínculos → el fallback Employee no resuelve para nadie.
  - **No bloquea Cajas** en la configuración default actual.
  - Riesgo residual: grants futuros `OWN_BRANCH` a usuarios sin `branchId`.

---

## 2. Reglas-contrato duras (requisitos, no notas)

### REGLA 1 — `OWN_BRANCH` exige `User.branchId`
Todo grant con scope `OWN_BRANCH` exige que el usuario destino tenga `User.branchId` poblado.
Si no lo tiene, el endpoint **rechaza con `400` y NO escribe la fila `UserPermission`**.
Vive en **backend** (endpoint/servicio de 2C), no solo en la UI. Test mockeado obligatorio en 2C.
Racional: 2A mostró `SUPERVISOR` con `branchId = null` y `Employee.userId = 0`; un grant
`OWN_BRANCH` a un usuario sin `branchId` crearía un permiso muerto que nunca matchea `getOwnBranchId()`.

### REGLA 2 — Los defaults NO migran usuarios existentes
Los defaults de 1C aplican **solo al crear usuarios nuevos**. Los usuarios existentes **no** tendrán
filas `UserPermission` hasta que se les asignen (manual o backfill controlado). Antes de reanudar
Cajas, los usuarios que operan Cajas deben tener filas `UserPermission` efectivas. Gate explícito,
resuelto en **2F**. Sin esto, un `BRANCH_MANAGER` existente —aunque tenga `branchId`— recibiría
`403` por no tener permisos efectivos.

### REGLA 3 — No merge a `main` antes del gate Neon
La UI/endpoints que dependen de la tabla `UserPermission` pueden escribirse y testearse en la rama,
pero **NO se mergean a `main` ni se exponen en producción antes del gate Neon (2E)**, salvo que
estén completamente escondidos o feature-flagged. Racional: evitar que producción tenga una
pantalla/endpoint que lea o escriba una tabla inexistente.

---

## 3. Orden de fases acordado

| Fase | Título |
|---|---|
| **2C** | Endpoints `UserPermission` (`grant`/`revoke`/`list`) + tests mockeados. Sin Neon. |
| **2D** | UI de asignación de permisos en Usuarios, integrada a esos endpoints. Sin Neon real. |
| **2E** | Gate Neon aditivo de `UserPermission` + primera verificación real `grant/list/revoke` end-to-end. |
| **2F** | Defaults para usuarios nuevos + estrategia/backfill para existentes. **Gate de Cajas.** |
| **2G** | Quitar permisos de Puestos: modal + endpoints `positions/[id]/permissions/*`. |
| **2H** | Desacoplar Call Center de `/owner/accesos`. |
| **2I** | Dashboard Ejecutivo OWNER-only. Último, aislado, con tests/verificaciones antes y después. |

**Racional del orden:**
- **Mock-first**: la lógica (endpoints/UI) se escribe y testea con mocks antes de tocar prod.
- **Neon entra cuando hay escritura real que verificar** (2E), no antes.
- **No crear una tabla vacía en producción antes de tener consumidores testeados** (2C/2D antes de 2E).
- **No mergear UI dependiente de `UserPermission` antes del gate Neon** (Regla 3).
- **Ejecutivo va último** porque es la zona más productiva/delicada (única en uso real hoy).

---

## 4. Detalle por fase (objetivo · precondición · Neon · entrada · salida · riesgo · merge)

### 2C — Endpoints `UserPermission` (grant/revoke/list)
1. **Objetivo:** exponer `grant`/`revoke`/`list` de `UserPermission` gobernados por los helpers de 1B.
2. **Precondición:** núcleo 1A/1B/1C/1E cerrado: schema local `UserPermission`, helpers, defaults y loader disponibles. Neon todavía sin tabla.
3. **Neon:** NO. Tests con Prisma mockeado/cliente inyectado.
4. **Entrada:** helpers `canGrantUserPermission`/`canRevokeUserPermission`/`canManageUserPermissions` verdes.
5. **Salida:** endpoints con guards correctos + Regla 1 (`OWN_BRANCH` ⇒ exige `branchId`, 400 sin escribir) + auditoría (AuditLog) en `$transaction`; tests mockeados verdes incluido el caso Regla 1; `tsc` 0.
6. **Riesgo:** olvidar Regla 1 en backend (dejarla solo en UI) → permisos muertos.
7. **Merge a main:** **espera** (Regla 3) — escriben una tabla que aún no existe en Neon.

### 2D — UI de asignación de permisos en Usuarios
1. **Objetivo:** pantalla en `/owner/usuarios` (y según rol, `/admin/usuarios`) para asignar/quitar permisos por usuario, por módulo, con scope.
2. **Precondición:** 2C.
3. **Neon:** NO real (mock/local).
4. **Entrada:** endpoints 2C verdes.
5. **Salida:** UI integrada a 2C; refleja Regla 1 (bloquea `OWN_BRANCH` si el usuario no tiene `branchId`); respeta guards OWNER/ADMIN; oculta/feature-flag mientras no haya gate Neon.
6. **Riesgo:** exponer en prod una UI que escribe una tabla inexistente (mitiga Regla 3 / flag).
7. **Merge a main:** **espera** o solo detrás de flag/escondida.

### 2E — Gate Neon aditivo + verificación real
1. **Objetivo:** aplicar `UserPermission` a Neon (expand-only) y verificar el primer `grant/list/revoke` real.
2. **Precondición:** 2C y 2D testeados/cerrados en rama.
3. **Neon:** **SÍ** — `migrate diff` dry-run aditivo → `db push --skip-generate` (sin `--accept-data-loss`) → verificación read-only. Host-check `.env.neon` obligatorio.
4. **Entrada:** dry-run muestra solo `CREATE TABLE/INDEX/FK` sobre tabla nueva; 0 `DROP`/`ALTER COLUMN`.
5. **Salida:** tabla creada vacía; diff post-push vacío; un ciclo `grant→list→revoke` real verificado. **La limpieza elimina/revoca la fila `UserPermission` creada para la prueba. Si el endpoint genera `AuditLog`, la traza de auditoría NO se borra** (no se promete "limpieza total" cuando hay auditoría persistente).
6. **Riesgo:** aplicar algo no-aditivo (mitiga el gate de conteos del dry-run).
7. **Merge a main:** habilita el merge de 2C/2D después de esta fase.

### 2F — Defaults a nuevos + backfill a existentes (Gate de Cajas)
1. **Objetivo:** aplicar defaults de 1C al crear usuarios y backfillear/asignar permisos a los operativos existentes.
2. **Precondición:** 2E (tabla real).
3. **Neon:** **SÍ** — escritura controlada (apply-defaults/backfill), con dry-run de conteos y verificación.
4. **Entrada:** 2E cerrada; defaults de 1C revisados; lista de usuarios operativos objetivo.
5. **Salida:** usuarios nuevos nacen con defaults; operativos existentes con filas `UserPermission` efectivas; verificación de que `BRANCH_MANAGER` resuelven OWN_BRANCH y `SUPERVISOR` ALL_BRANCHES; **Cajas desbloqueable**.
6. **Riesgo:** backfill incorrecto (scope equivocado, o `OWN_BRANCH` a usuario sin `branchId`) → re-aplica Regla 1 en el backfill.
7. **Merge a main:** sí, una vez verificado.

### 2G — Quitar permisos de Puestos
1. **Objetivo:** remover/ocultar `permissions-modal.tsx` y endpoints `positions/[id]/permissions/*`; Puestos vuelve a ser solo RRHH/organigrama.
2. **Precondición:** ninguna técnica (inerte), pero se hace **después** de 2C–2F para no mezclar remoción con introducción.
3. **Neon:** NO (data `PositionPermission` = 0; opcional limpiar después, fase aparte).
4. **Entrada:** confirmar 0 consumers runtime (ya confirmado en 2A) y 0 asignaciones.
5. **Salida:** Puestos sin gestión de permisos; sin endpoints de PositionPermission; `position-permissions.ts` marcado deprecado (su borrado y el del modelo es fase separada explícita, no acá).
6. **Riesgo:** romper la pantalla de Puestos al sacar el botón/modal.
7. **Merge a main:** sí (independiente).

### 2H — Desacoplar Call Center de `/owner/accesos`
1. **Objetivo:** desacople de superficie/perímetro: sacar Call Center de `/owner/accesos` sin tocar el Dashboard Ejecutivo y sin cambiar Call Center funcional.
2. **Precondición:** independiente de 2G y de la cadena 2C–2F.
3. **Neon:** NO, salvo que en una fase futura separada se decida migrar Call Center a `UserPermission`.
4. **Entrada:** acople reconfirmado (2A) de superficie + perímetro.
5. **Salida:** `/owner/accesos` deja de mezclar CC; CC gestionado fuera; **el gate del Dashboard Ejecutivo NO se toca**.
6. **Riesgo:** romper la grilla del panel o el gate CC (`canViewCallCenter`).
7. **Merge a main:** sí (independiente), sin tocar Ejecutivo.

> **Nota 2H:** Migrar Call Center a `UserPermission` **NO** queda diseñado ni aprobado en 2H; si se decide, requiere **fase propia**.

### 2I — Dashboard Ejecutivo OWNER-only
1. **Objetivo:** `canViewExecutive` ≡ `role === "OWNER"`; deprecar/ignorar `executiveAccess` (y luego quitar la columna en microfase aparte).
2. **Precondición:** todo lo demás cerrado; es la zona más delicada.
3. **Neon:** eventual (al quitar la columna, fase aparte).
4. **Entrada:** **verificación de data justo antes** — confirmar que ningún no-OWNER tenga `executiveAccess = true`.
5. **Salida:** gate OWNER-only con tests antes/después; comportamiento idéntico al actual.
6. **Riesgo:** dejar afuera a un no-OWNER con `executiveAccess` si se otorgó entre medio (mitiga la verificación de entrada).
7. **Merge a main:** sí, aislado, último.

---

## 5. Grafo de dependencias

```
2C → 2D → 2E → 2F   (cadena UserPermission; 2F = gate de Cajas)
2G        (independiente; se ubica DESPUÉS de 2C–2F por orden, no por dependencia)
2H        (independiente; NO toca Ejecutivo)
2I        (último, aislado, verificación de data antes)
```
- 2C crea endpoints mock-first.
- 2D crea UI integrada, sin uso real en prod.
- 2E aplica schema a Neon y verifica el primer flujo real `grant/list/revoke`.
- 2F depende de 2E (necesita tabla real para asignar/backfillear a existentes).
- 2F es **prerequisito para reanudar Cajas**.
- 2G y 2H son independientes entre sí y de la cadena; 2H no debe tocar el Dashboard Ejecutivo.
- 2I va último, con verificación de data justo antes.

---

## 6. Gates de Cajas
Cajas **NO** se reanuda hasta que se cumpla, en orden:
1. **2E** — tabla `UserPermission` real en Neon + flujo `grant/list/revoke` verificado.
2. **2F** — operativos existentes con filas `UserPermission` efectivas (Regla 2) y defaults activos para nuevos.
3. **Regla 1** vigente en backend (grants `OWN_BRANCH` validan `branchId`).
Recién entonces los endpoints de Cajas pueden autorizar con `loadUserWithUserPermissions` + `requireUserPermission`.

---

## 7. Fuera de alcance de este plan
- Reanudar Cajas / implementar endpoints de Cajas.
- Migrar módulos legacy (vacaciones, ausencias, mantenimiento, planes, rotativas, etc.) a `user-permissions`.
- Migrar Call Center a `UserPermission` (si se decide, es fase propia; no es parte de 2H).
- Modificar Call Center funcional (atención/conversaciones).
- Tocar Dashboard Ejecutivo fuera de la microfase 2I.
- Eliminar modelos Prisma viejos (`PositionPermission`, etc.) si no es una fase explícita.
- `prisma format` global.
- Merge a `main` (cada fase define su propia elegibilidad; varias esperan al gate Neon).

---

## 8. Notas de seguridad
- Neon solo se toca en 2E/2F (y eventual 2I), siempre con host-check `.env.neon` (`*.neon.tech`),
  dry-run aditivo previo, sin `--accept-data-loss`, `DATABASE_URL` limpiada en `finally`, sin imprimir
  credenciales ni PII (solo agregados).
- Toda escritura de permisos audita en `AuditLog` dentro de `$transaction`. La auditoría es
  persistente: una limpieza de prueba revoca la fila `UserPermission`, pero **no** borra su traza en `AuditLog`.
- Guards server-side siempre; la UI nunca es la única barrera.
- **Nota técnica (codegen):** las fases que implementen endpoints reales contra `prisma.userPermission`
  pueden requerir `npx prisma generate` local/CI para que Prisma Client conozca el modelo `UserPermission`.
  Esto **no** toca Neon ni aplica schema; es codegen local. **No se ejecuta en 2B.** Si se usa en una
  fase futura, debe quedar explícito en su gate.

---

## 9. Confirmaciones (al redactar este plan)
- Documento de planificación; sin código, sin schema, sin Neon, sin tests, sin commit/push.

---

## 10. Cierre Fase 2E — Neon UserPermission (aplicado y verificado)

**Fecha de cierre:** 2026-06-28. **Rama:** `refactor/permisos-por-usuario`, HEAD `60ddb34`.

### Estado 2E
- `UserPermission` **ya existe en Neon prod**.
- La tabla se creó con **SQL acotado vía `psql`** (BEGIN/COMMIT, ON_ERROR_STOP=1), **NO** con `prisma db push`.
- **Por qué no `db push`:** Neon prod contiene las tablas de **Cajas**; esta rama **no** contiene los modelos de Cajas; `migrate diff --from-url` desde esta rama mostró **DROP destructivos de Cajas** (9 tablas + 4 enums + 18 constraints). Por eso `db push` desde esta rama es **inseguro** → se aplicó solo el delta aditivo de `UserPermission`.

### Estructura verificada (read-only post-apply)
- `UserPermission_pkey` (PK); 3 índices normales (`userId`, `permissionId`, `grantedByUserId`); unique `(userId, permissionId)`.
- FK `UserPermission_userId_fkey → User(id)` y `UserPermission_permissionId_fkey → Permission(id)`, ambas **ON DELETE CASCADE / ON UPDATE CASCADE**.
- `scope` default `'OWN_BRANCH'::"PermissionScope"`. `COUNT(*) = 0` al cierre.

### Prueba funcional 2E (servicio real 2C-A, no SQL manual)
list inicial vacío → `grant caja.view / OWN_BRANCH` = **GRANTED** → list 1 fila → repetir mismo scope = **NOOP** → `grant ALL_BRANCHES` = **SCOPE_CHANGED** → list 1 fila ALL_BRANCHES → `revoke` = **ok=true** → list final vacío → **`UserPermission count final = 0`**.

### Auditoría
- `AuditLog` global **56 → 59**; `entity='UserPermission'` **0 → 3**.
- Acciones: `USER_PERMISSION_GRANTED`, `USER_PERMISSION_SCOPE_CHANGED`, `USER_PERMISSION_REVOKED`. **NOOP no auditó.**
- Las entradas de `AuditLog` quedan **persistentes por diseño** (la limpieza revoca la fila, no borra la traza).

### Resultado operativo
- Schema de `UserPermission` listo en prod; servicio 2C-A validado funcionalmente contra tabla real.
- **UI sigue oculta** (feature flag `NEXT_PUBLIC_USER_PERMISSIONS_PANEL_ENABLED` apagado).
- Endpoints `/api/users/[id]/permissions` **ya operativos** contra tabla real para OWNER/ADMIN.
- No se activó Cajas, no se activó UI, no se tocó Vercel.

### Estado de mergeabilidad tras 2E
```
Estado de mergeabilidad tras 2E:
La tabla UserPermission existe en prod, pero la rama refactor/permisos-por-usuario
NO es mergeable a main todavía. El gate Neon 2E se completó por SQL acotado,
NO por db push, justamente porque el schema de esta rama no refleja prod: le falta
Cajas. Mergear esta rama a main dejaría main con un schema parcial que, ante
cualquier db push manual o de pipeline, propondría dropear Cajas. El merge queda
bloqueado hasta resolver el drift de ramas/schema, no hasta cerrar 2E.
```
*(Ver deudas registradas en `docs/known-issues/current-known-issues.md`: "drift de ramas/schema" y "2C-C".)*

### Próximo orden recomendado (no presentar 2F como inmediato)
1. **2E documentado y cerrado** (esta sección).
2. **Resolver el drift de ramas/schema** o definir una rama de integración que refleje prod (Cajas + permisos).
3. **Resolver 2C-C** (política de `UserPermission` sobre usuarios inactivos).
4. **Recién después: 2F** (defaults a usuarios nuevos + backfill a operativos existentes = gate de Cajas).
5. Feature flag / UI controlada.
6. Retiro gradual de `PositionPermission`, si aplica.
