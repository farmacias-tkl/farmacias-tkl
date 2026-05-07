# Sistema de permisos por puesto

Este documento describe el modelo de permisos del sistema, que coexiste
en **dos universos** independientes: uno legacy basado en roles (Universo
A) y uno granular basado en puestos (Universo B).

> Para autenticación y manejo de sesiones ver [SECURITY.md](../SECURITY.md).

---

## Resumen ejecutivo

```
┌─────────────────────────────────────────────────┐
│         UNIVERSO A — Sistema (legacy)           │
│  ┌───────────────────────────────────────────┐  │
│  │  User.role (UserRole enum)                 │  │
│  │  + User.executiveAccess (Boolean)          │  │
│  │                                            │  │
│  │  Decide:                                   │  │
│  │  - A qué módulos podés entrar              │  │
│  │  - Acceso al dashboard ejecutivo           │  │
│  │  - Acceso al panel /owner                  │  │
│  │  - Acceso al panel /admin                  │  │
│  │                                            │  │
│  │  Helpers:                                  │  │
│  │  - canViewExecutive(user)                  │  │
│  │  - canAccessOwnerPanel(user)               │  │
│  │  - canAccessRoute(role, pathname)          │  │
│  │  - can.viewAllBranches(role), etc.         │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│      UNIVERSO B — Operativo (Fase 3)            │
│  ┌───────────────────────────────────────────┐  │
│  │  Permission (catálogo)                     │  │
│  │  + PositionPermission (asignación)         │  │
│  │  + PermissionScope (OWN_BRANCH/ALL_BRANCHES)│  │
│  │                                            │  │
│  │  Decide:                                   │  │
│  │  - Qué acciones granulares podés hacer     │  │
│  │    dentro de cada módulo operativo         │  │
│  │  - Restringido por sucursal vía OWN_BRANCH │  │
│  │                                            │  │
│  │  Bypass total: OWNER, ADMIN, SUPERVISOR    │  │
│  │                                            │  │
│  │  Helpers:                                  │  │
│  │  - loadUserWithPermissions(userId)         │  │
│  │  - can(user, key)                          │  │
│  │  - canInBranch(user, key, branchId)        │  │
│  │  - requirePermission(user, key, branchId?) │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**Separación estricta**: ningún chequeo del Universo B controla acceso
a módulos enteros del sistema (eso es Universo A). Y el Universo A no
mira `Permission` / `PositionPermission`.

---

## Universo A — Roles legacy

### Roles disponibles

```ts
enum UserRole {
  SUPERVISOR
  BRANCH_MANAGER  // "Encargada"
  HR              // "RRHH"
  MAINTENANCE
  OWNER           // "Direccion"
  ADMIN
}
```

`CO_SUPERVISOR` existió pero fue eliminado (commit `f63dccb`).

### Flag `executiveAccess`

```prisma
model User {
  executiveAccess Boolean @default(false)
}
```

Independiente del rol. Solo OWNER puede modificarlo (desde
`/owner/accesos`). Se usa para otorgar acceso al Dashboard Ejecutivo a
usuarios no-OWNER (ADMIN, SUPERVISOR, etc.) sin tener que cambiarles el
rol.

### Helpers principales (`src/lib/permissions.ts`)

#### `canViewExecutive(user)`

```ts
export function canViewExecutive(
  u: { role: UserRole; executiveAccess?: boolean | null } | null | undefined,
): boolean {
  if (!u) return false;
  if (u.role === "OWNER") return true;
  return Boolean(u.executiveAccess);
}
```

Reglas:
- OWNER: siempre `true` (no depende del flag).
- Otros roles: `true` solo si `executiveAccess === true`.

Usado en:
- `src/middleware.ts` — gate de `/executive` y `/api/dashboard`.
- `src/components/layout/TopBar.tsx` — mostrar botón "Dashboard Ejecutivo".

#### `canAccessOwnerPanel(user)`

```ts
export function canAccessOwnerPanel(
  u: { role: UserRole } | null | undefined,
): boolean {
  return u?.role === "OWNER";
}
```

Solo OWNER. No hay flag adicional.

#### `canAccessRoute(role, pathname)`

Cruza con `ROUTE_PERMISSIONS` (mapa de path prefix → roles permitidos):

```ts
const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  "/sucursales":      ["SUPERVISOR","OWNER","ADMIN"],
  "/empleados":       ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/ausencias":       ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/planes-accion":   ["SUPERVISOR","BRANCH_MANAGER","ADMIN"],
  "/horas-extras":    ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/vacaciones":      ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/rotativas":       ["SUPERVISOR","HR","ADMIN"],
  "/mantenimiento":   ["SUPERVISOR","BRANCH_MANAGER","MAINTENANCE","OWNER","ADMIN"],
  "/tareas":          ["SUPERVISOR","BRANCH_MANAGER","OWNER","ADMIN"],
  "/whatsapp":        ["SUPERVISOR","ADMIN"],
  "/alertas":         ["SUPERVISOR","OWNER","ADMIN"],
  "/puestos":         ["ADMIN","OWNER"],
  "/admin":           ["ADMIN"],
  "/admin/usuarios":  ["ADMIN"],
  "/owner":           ["OWNER"],
  "/owner/usuarios":  ["OWNER"],
  // ... (API routes equivalentes)
};
```

Las rutas `/executive` y `/api/dashboard` **no** están en este mapa —
las gateaba `canAccessRoute` por error en una versión anterior, lo que
ignoraba el flag `executiveAccess`. Ahora `middleware.ts` las gateamos
con `canViewExecutive` directamente. Esa fue una de las bugs corregidas
en commit `91033d8`.

#### Helpers de feature `can.*`

```ts
export const can = {
  viewAllBranches:   (role) => ["SUPERVISOR","HR","OWNER","ADMIN"].includes(role),
  manageBranches:    (role) => role === "ADMIN",
  viewAllEmployees:  (role) => ["SUPERVISOR","HR","OWNER","ADMIN"].includes(role),
  manageEmployees:   (role) => ["SUPERVISOR","HR","BRANCH_MANAGER","ADMIN"].includes(role),
  reassignEmployee:  (role) => ["SUPERVISOR","HR","ADMIN"].includes(role),

  createVacation:    (role) => [...],
  approveVacation:   (role) => ["SUPERVISOR","ADMIN"].includes(role),
  manageCoverage:    (role) => ["SUPERVISOR","HR","ADMIN"].includes(role),

  createAbsence:     (role) => [...],
  justifyAbsence:    (role) => ["SUPERVISOR","HR","OWNER","ADMIN"].includes(role),

  createActionPlan:  (role) => ["SUPERVISOR","BRANCH_MANAGER","ADMIN"].includes(role),
  createOvertime:    (role) => ["SUPERVISOR","BRANCH_MANAGER","ADMIN"].includes(role),
  approveOvertime:   (role) => ["SUPERVISOR","ADMIN"].includes(role),

  manageUsers:       (role) => role === "ADMIN",
  managePositions:   (role) => role === "ADMIN" || role === "OWNER",
  managePositionPermissions: (role) => role === "ADMIN" || role === "OWNER",
  viewAuditLog:      (role) => role === "ADMIN",
  // ... más
};
```

Usados en handlers de API y componentes UI para mostrar/ocultar acciones.

### Tabla resumen de roles

| Rol | Operativa | Dashboard Ejec. | Panel `/owner` | Panel `/admin` |
|---|---|---|---|---|
| **OWNER** | Total (read-mostly) | Sí (siempre) | Sí | No |
| **ADMIN** | Total + admin usuarios operativos | Si flag | No | Sí |
| **SUPERVISOR** | Amplio (multi-sucursal) | Si flag | No | No |
| **BRANCH_MANAGER** | Su sucursal | Si flag | No | No |
| **HR** | Empleados, ausencias, vacaciones, rotativas | Si flag | No | No |
| **MAINTENANCE** | Solo mantenimiento | No | No | No |

---

## Universo B — Permisos operativos por puesto

### Modelo conceptual

Cada **puesto** (`Position`) puede tener un set de **permisos operativos**
asignados. Cuando un usuario tiene un `Employee` asociado con un puesto,
hereda los permisos del puesto.

```
Position "Cajera"
   └─ PositionPermission {scope: OWN_BRANCH, permission: vencidos.upload_remito}
   └─ PositionPermission {scope: OWN_BRANCH, permission: caja.create_close}
   └─ PositionPermission {scope: ALL_BRANCHES, permission: vencidos.view_global}
```

Si Juan trabaja como Cajera en Sucursal Tekiel:
- `can(juan, "vencidos.upload_remito")` → true.
- `canInBranch(juan, "vencidos.upload_remito", "tekiel-id")` → true.
- `canInBranch(juan, "vencidos.upload_remito", "galesa-id")` → false (OWN_BRANCH).

### Schema

```prisma
model Permission {
  id          String   @id @default(cuid())
  key         String   @unique           // "vencidos.upload_remito"
  module      String                     // "vencidos"
  description String                     // texto humano para UI
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  positions   PositionPermission[]
}

model PositionPermission {
  id              String          @id @default(cuid())
  positionId      String
  position        Position        @relation(...)
  permissionId    String
  permission      Permission      @relation(...)
  scope           PermissionScope @default(OWN_BRANCH)
  grantedByUserId String?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@unique([positionId, permissionId])
}

enum PermissionScope {
  OWN_BRANCH    // aplica solo a la sucursal del empleado
  ALL_BRANCHES  // aplica a cualquier sucursal
}
```

### Catálogo de permisos

Vive en `scripts/seed-permissions.ts`. ~44 permisos en 9 módulos.
Ejemplo de naming: `<modulo>.<accion>` (`vencidos.upload_remito`,
`caja.create_close`, etc.).

Para agregar permisos al catálogo:

1. Editar `scripts/seed-permissions.ts`.
2. Commit + push.
3. Correr seed contra Neon:
   ```bash
   # con .env.neon temporal
   npx dotenv-cli -e .env.neon -- npx tsx scripts/seed-permissions.ts
   ```

El seed es **idempotente** — se puede correr N veces sin duplicar.

### Helpers (`src/lib/permissions/position-permissions.ts`)

#### `loadUserWithPermissions(userId)`

Carga User → Employee → Position → Permissions.

```ts
export interface UserWithPermissions {
  id:   string;
  role: UserRole;
  employee: {
    id:              string;
    currentBranchId: string | null;
    position: {
      permissions: Array<{
        scope:      PermissionScope;
        permission: { key: string; active: boolean };
      }>;
    };
  } | null;
}

export async function loadUserWithPermissions(userId: string): Promise<UserWithPermissions | null>;
```

Implementado con **dos queries encadenadas** (User + Employee con
nested position+permissions). La razón: `User.employeeId` no está
formalizada como relación Prisma — decisión de Fase 1 para no romper
compatibilidad.

#### `can(user, key)`

Chequeo a nivel módulo (sin importar la sucursal):

```ts
export function can(
  user: UserWithPermissions | null | undefined,
  permissionKey: string,
): boolean {
  if (hasBypass(user)) return true;
  if (!user?.employee?.position?.permissions) return false;
  return user.employee.position.permissions.some(
    pp => pp.permission.active && pp.permission.key === permissionKey,
  );
}
```

Útil para decidir "muestro el item de menú" o "muestro la página".

#### `canInBranch(user, key, branchId)`

Chequeo a nivel acción para una sucursal específica:

```ts
export function canInBranch(
  user: UserWithPermissions | null | undefined,
  permissionKey: string,
  branchId: string,
): boolean {
  if (hasBypass(user)) return true;
  if (!user?.employee?.position?.permissions) return false;
  const match = user.employee.position.permissions.find(
    pp => pp.permission.active && pp.permission.key === permissionKey,
  );
  if (!match) return false;
  if (match.scope === "ALL_BRANCHES") return true;
  // OWN_BRANCH
  return user.employee.currentBranchId === branchId;
}
```

Útil para "puedo ejecutar esta acción sobre esta sucursal".

#### `requirePermission(user, key, branchId?)`

Para usar en handlers de API:

```ts
export function requirePermission(
  user: UserWithPermissions | null | undefined,
  permissionKey: string,
  branchId?: string,
): { error: string; status: number } | null {
  if (!user) return { error: "No autenticado", status: 401 };
  const ok = branchId
    ? canInBranch(user, permissionKey, branchId)
    : can(user, permissionKey);
  return ok ? null : { error: "Sin permisos para esta accion", status: 403 };
}
```

Devuelve `null` si OK, o `{error, status}` si no autorizado. Patrón
consistente con `requireCan` / `requireAuth` del Universo A.

### Bypass operativo

```ts
const ROLES_WITH_OPERATIONAL_BYPASS: UserRole[] = [
  "OWNER", "ADMIN", "SUPERVISOR"
];

function hasBypass(user) {
  return user != null && ROLES_WITH_OPERATIONAL_BYPASS.includes(user.role);
}
```

Estos tres roles **siempre** pasan `can()` y `canInBranch()`, sin
consultar `PositionPermission`. Razón:
- **OWNER**: por definición tiene acceso total.
- **ADMIN**: rol técnico. Si Dirección quiere restringirlo en el futuro,
  se puede sacar del bypass — pero hoy preferimos que pueda hacer todo.
- **SUPERVISOR**: rol amplio, multi-sucursal. Si lo modeláramos via
  Permissions tendríamos que crear un Position "Supervisor" con todos
  los permisos × ALL_BRANCHES — overhead innecesario.

### Patrón de uso en handlers de API

```ts
import { auth } from "@/lib/auth";
import {
  loadUserWithPermissions,
  requirePermission
} from "@/lib/permissions/position-permissions";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "..." }, { status: 401 });
  }

  const user = await loadUserWithPermissions(session.user.id);
  const err  = requirePermission(user, "vencidos.upload_remito", branchId);
  if (err) {
    return NextResponse.json({ error: err.error }, { status: err.status });
  }

  // ... lógica autorizada
}
```

---

## Migración módulo a módulo

El sistema **no requiere migrar todos los módulos al mismo tiempo**.
Estrategia incremental:

1. **Hoy**: la mayoría de módulos chequea con helpers legacy `can.*` por rol.
2. **Cuando se decide migrar un módulo**: cambiar los chequeos a
   `requirePermission` y empezar a usar permisos granulares.
3. **Las migraciones no se mezclan**: un módulo está 100% en Universo A
   o 100% en Universo B, no mitad y mitad.

El bypass de OWNER/ADMIN/SUPERVISOR garantiza que módulos migrados
sigan funcionando para esos roles sin tener que asignarles puestos.

---

## UI de gestión

### `/puestos` (catálogo de puestos)

OWNER + ADMIN. Lista de puestos con conteo de empleados, indicador de
si requiere cobertura, y un modal "Permisos" con checkboxes:

- Por cada permiso del catálogo, checkbox "asignado a este puesto".
- Si asignado, dropdown para elegir scope (`OWN_BRANCH` | `ALL_BRANCHES`).
- Save → POST/DELETE a `/api/permissions/positions/{positionId}` que
  actualiza `PositionPermission` rows.

### `/owner/accesos` (flag `executiveAccess`)

Solo OWNER. Lista de usuarios con toggle "Otorgar / Revocar acceso
ejecutivo". POST a `/api/owner/accesos`.

### Audit

Cada asignación/revocación de `PositionPermission` o cambio de
`executiveAccess` escribe un row en `SecurityEvent` con:
- `userId` (sujeto)
- `actorId` (quién hizo el cambio)
- `type` (`POSITION_PERMISSION_GRANTED`, `EXECUTIVE_ACCESS_REVOKED`, etc.)
- `detail` (JSON con info adicional: permission key, branch, scope, etc.)

---

## Consideraciones de futuro

### Migrar SUPERVISOR a permisos finos

Actualmente SUPERVISOR tiene bypass operativo. Para una eventual Fase 5:

1. Crear un `Position "Supervisor"` con todos los permisos × `ALL_BRANCHES`.
2. Modelar cada SUPERVISOR como Employee con ese puesto.
3. Remover `"SUPERVISOR"` de `ROLES_WITH_OPERATIONAL_BYPASS`.

Esto haría el sistema más uniforme pero requiere más data setup.

### Restringir ADMIN

Si Dirección quiere restringir ADMIN (que hoy puede todo), bastaría con
remover `"ADMIN"` del bypass y modelarlo via Position. Decisión a futuro.

### Permisos de sistema (no operativos)

`Permission` modela solo permisos operativos (vencidos, caja, etc.). NO
modelar acá:
- Acceso al dashboard ejecutivo (eso es `executiveAccess`).
- Acceso a `/owner` (eso es `canAccessOwnerPanel`).
- Gestión de usuarios sensibles (eso es `can.manageUsers`).

Esos quedan en Universo A para mantener separación de concerns.

---

## Referencias cruzadas

- [SECURITY.md](../SECURITY.md) — auth, JWT, audit logs.
- [database/neon-schema.md](../database/neon-schema.md) — modelos `User`, `Permission`, `PositionPermission`, `SecurityEvent`.
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) — usuario sin acceso al ejecutivo, errores de permiso.
- `scripts/seed-permissions.ts` — catálogo de permisos seedable.
- `scripts/test-position-permissions.ts` — tests de los helpers.
