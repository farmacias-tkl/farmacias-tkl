# Modelo de seguridad

Este documento describe la postura de seguridad del sistema: cómo se
autentica, autoriza, audita y cómo se gestionan secretos. Para el detalle
del sistema de permisos por puesto ver
[permissions/permission-system.md](./permissions/permission-system.md).

---

## Resumen ejecutivo

| Aspecto | Implementación |
|---|---|
| **Autenticación** | NextAuth v5 (JWT, sin sesiones en DB) + Credentials con `bcrypt` |
| **Cookie** | HTTP-only, secure (production), SameSite Lax |
| **JWT lifetime** | OWNER: ilimitado / no-OWNER: 8 horas (custom check vs `iat`) |
| **Authorization** | Middleware + helpers `canViewExecutive` / `canAccessRoute` / `can.*` |
| **Permisos granulares** | `Permission` + `PositionPermission` con `OWN_BRANCH` / `ALL_BRANCHES` |
| **Audit** | `AuditLog`, `AccessLog`, `SecurityEvent` |
| **Secrets en repo** | Cero (todo via env vars) |
| **Rate limiting** | No implementado |
| **CSRF** | NextAuth maneja CSRF tokens automáticamente |

---

## 1. Autenticación

### Stack

- **NextAuth v5 beta** (`next-auth@^5.0.0-beta.22`).
- **Strategy**: JWT (sin tabla `Session` consultada por request — los rows existen pero no se leen).
- **Provider**: `Credentials` (email + password). Sin OAuth.
- **Hash**: `bcryptjs` con factor de costo default (10).

### Flujo de login

1. Usuario envía email + password al endpoint `/api/auth/callback/credentials`.
2. NextAuth invoca `authorize()` configurado en `src/lib/auth.ts`:
   - Lookup por email en tabla `User`.
   - Compara hash con `bcrypt.compare(password, user.passwordHash)`.
   - Si OK, devuelve un objeto que se serializa al JWT.
3. NextAuth genera el JWT firmado con `AUTH_SECRET` y lo emite como cookie HTTP-only.
4. Cookie se incluye automáticamente en cada request subsiguiente.

### Contenido del JWT

El `callback.jwt` y `callback.session` enriquecen el token con:

```ts
{
  sub: userId,
  email,
  name,
  role: UserRole,         // SUPERVISOR | OWNER | ADMIN | ...
  branchId: string|null,
  executiveAccess: boolean, // flag para acceso al dashboard ejecutivo
  iat: number,            // timestamp de emisión (Unix epoch s)
  exp: number,            // expiración nativa de NextAuth
}
```

El `iat` se usa para imponer un timeout custom de 8 horas a no-OWNER (ver
abajo).

### Flujo de cambio de password obligatorio

`User.mustChangePassword: Boolean @default(true)`. Cuando es `true`:

- Login exitoso → middleware o layout redirige a `/cambiar-password`.
- Endpoint POST `/cambiar-password` valida la nueva, actualiza el hash y
  setea `mustChangePassword=false`.

Esto cubre el caso "ADMIN/OWNER creó al usuario con una password
temporal generada".

---

## 2. Sesiones y expiración

### JWT vs Database sessions

El sistema usa **JWT strategy**: el token vive en la cookie del browser
y no se consulta la tabla `Session` en cada request. Ventaja: cero
latencia DB para auth. Desventaja: revocar una sesión requiere o
expirarla naturalmente o cambiar `AUTH_SECRET` (lo que invalida TODAS
las sesiones).

### Expiración diferenciada por rol

`src/middleware.ts` impone un timeout custom de **8 horas** sobre `iat`
para todos los roles **excepto OWNER**:

```ts
const NON_OWNER_MAX_AGE_SEC = 8 * 60 * 60;
const iat = (session as any).iat as number | undefined;
if (role !== "OWNER" && typeof iat === "number") {
  const ageSec = Math.floor(Date.now() / 1000) - iat;
  if (ageSec > NON_OWNER_MAX_AGE_SEC) {
    // → redirect /login?expired=1
  }
}
```

**Por qué OWNER no tiene este timeout**: comodidad operativa —
Dirección monitorea el dashboard varias veces al día y no quiere
relogear constantemente. El riesgo es aceptable porque el OWNER
típicamente está en su propio dispositivo.

### Cómo revocar una sesión activa

No hay un endpoint "logout-all". Las opciones:

1. Esperar a que expire naturalmente.
2. Para no-OWNER: cambiar la password del usuario → su JWT sigue válido,
   pero al hacer cualquier acción que requiera comparar password
   (raramente), fallará. **El JWT NO se invalida automáticamente** al
   cambiar la password.
3. Cambiar `AUTH_SECRET` → invalida **todas** las sesiones del sistema.
   Solo último recurso.

> ⚠️ **Limitación conocida**: si revocás `executiveAccess` a un usuario,
> su JWT actual sigue marcando `executiveAccess: true` hasta que el
> usuario se relogee. La sesión no se refresca. Workaround: pedirle al
> usuario que cierre sesión y vuelva a entrar.

---

## 3. Autorización

### Modelo de dos universos

Ver [permissions/permission-system.md](./permissions/permission-system.md)
para detalle. Resumen:

- **Universo A — sistema**: `User.role` (UserRole enum) + `User.executiveAccess` (bool). Decide acceso a **rutas y módulos**.
- **Universo B — operativo**: `Permission` + `PositionPermission` (con scope `OWN_BRANCH` o `ALL_BRANCHES`). Decide **acciones granulares** dentro de los módulos. OWNER/ADMIN/SUPERVISOR tienen bypass operativo.

### Middleware

`src/middleware.ts` se ejecuta en cada request (excluyendo `_next/static`,
`favicon`, etc.) y aplica:

1. **Bypass de rutas públicas**: `/api/auth/*`, `/_next/*`, `/api/sync/*`
   (auth con Bearer), `/login`, `/cambiar-password`, `/sin-acceso`.
2. **Redirect a login** si no hay sesión.
3. **Expiración 8h para no-OWNER** (descrita arriba).
4. **Host routing**: si `host` empieza con `dashboard.` → solo permite
   `/executive`, `/api/dashboard`, `/api/sync`. Si no es OWNER y no
   tiene `executiveAccess` → redirect a `/sin-acceso`.
5. **Operativo (host normal)**:
   - `/executive` y `/api/dashboard`: gate único `canViewExecutive`.
     Si falla en API → JSON 403; si falla en página → redirect a
     `/sin-acceso`.
   - Resto: `canAccessRoute(role, pathname)` que cruza con
     `ROUTE_PERMISSIONS`.

### Helpers principales (en `src/lib/permissions.ts`)

```ts
canViewExecutive(user)   // OWNER siempre, otros si executiveAccess===true
canAccessOwnerPanel(user) // solo OWNER
canAccessRoute(role, pathname) // usa ROUTE_PERMISSIONS (legacy por rol)
can.viewAllBranches(role)
can.manageUsers(role)
// ... y muchos otros checks por feature
```

### Helpers de permisos por puesto (en `src/lib/permissions/position-permissions.ts`)

```ts
loadUserWithPermissions(userId)  // carga User + Employee + Position + Permissions
can(user, "vencidos.upload_remito")
canInBranch(user, "caja.create_close", branchId)
requirePermission(user, key, branchId?) // null si OK, {error,status} si no
```

OWNER, ADMIN y SUPERVISOR tienen **bypass operativo**: `can()` y
`canInBranch()` siempre devuelven `true` para ellos sin consultar la
tabla `PositionPermission`.

---

## 4. APIs y endpoints sensibles

### Patrón de autenticación

Todos los handlers de API siguen este patrón:

```ts
import { auth } from "@/lib/auth";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!can.someCheck(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  // ... lógica
}
```

Endpoints sensibles agrupados:

| Prefijo | Quién puede |
|---|---|
| `/api/owner/*` | Solo OWNER |
| `/api/admin/*` | Solo ADMIN |
| `/api/permissions` | OWNER + ADMIN |
| `/api/dashboard/*` | `canViewExecutive` (rol OWNER o flag executiveAccess) |
| `/api/sync/trigger` | **Bearer auth** (no usa sesión) |

### Sync endpoint (Bearer auth)

`POST /api/sync/trigger` no usa NextAuth. En su lugar:

```ts
const auth = req.headers.get("authorization");
if (auth !== `Bearer ${process.env.SYNC_WEBHOOK_SECRET}`) {
  return new Response("Unauthorized", { status: 401 });
}
```

Esto permite que GitHub Actions (sin contexto de usuario) dispare el sync.

---

## 5. Audit y trazabilidad

El schema tiene tres modelos de audit:

### `AuditLog`

Registra acciones de mutación: quién hizo qué, sobre qué entidad, con
qué payload. Genérico — cualquier handler de API puede escribir.

```prisma
model AuditLog {
  id        String
  userId    String
  action    String   // ej: "USER_CREATED", "VACATION_APPROVED"
  entity    String   // ej: "User", "Vacation"
  entityId  String?
  detail    Json?
  ip        String?
  userAgent String?
  createdAt DateTime
}
```

### `AccessLog`

Registra accesos al **Dashboard Ejecutivo**. Útil para reportar a
Dirección quién consultó qué.

```prisma
enum AccessAction {
  LOGIN, LOGOUT, VIEW_DASHBOARD, VIEW_BALANCES,
  VIEW_SALES, VIEW_COMPARATIVE, EXPORT
}
```

### `SecurityEvent`

Eventos sensibles relacionados a auth/permisos. Subset del audit log
con tipos enumerados:

```prisma
enum SecurityEventType {
  EXECUTIVE_ACCESS_GRANTED
  EXECUTIVE_ACCESS_REVOKED
  USER_CREATED
  USER_ROLE_CHANGED
  USER_DEACTIVATED
  USER_REACTIVATED
  USER_PASSWORD_RESET
  POSITION_PERMISSION_GRANTED
  POSITION_PERMISSION_REVOKED
  POSITION_PERMISSION_SCOPE_CHANGED
}

model SecurityEvent {
  userId    String     // sujeto del evento
  actorId   String?    // quien lo hizo
  type      SecurityEventType
  detail    Json?
  ip        String?
  userAgent String?
  createdAt DateTime
}
```

Visible (futuro) desde el panel `/owner` con filtros y export. **Estado
actual**: la tabla existe y se escribe en algunos endpoints; la UI de
visualización es un placeholder.

---

## 6. Gestión de secretos

### Repo

- **Nada de secretos en código**. Solo via `process.env`.
- `.gitignore` cubre `.env`, `.env.local`, `.env.neon`, `.env.production`,
  `scripts/server/credentials.json`.
- `.env.example` es la plantilla pública con placeholders.

### Producción (Vercel)

- Variables de entorno setteadas en `Project → Settings → Environment Variables`.
- Scope: `Production` y `Preview` (con cuidado para previews).
- Para rotar: actualizar var → `Redeploy`.

### Producción (GitHub Actions)

- Secrets en `repo → Settings → Secrets and variables → Actions`.
- `DASHBOARD_URL` y `SYNC_WEBHOOK_SECRET` son los únicos.

### Local development

- Los developers crean `.env.local` con sus propios valores.
- Para correr scripts contra Neon temporalmente: `.env.neon` con la
  connection string, **borrar al terminar**.

### Service Account de Google

- Vive en Vercel como `GOOGLE_SERVICE_ACCOUNT_JSON` (JSON serializado en una sola línea).
- En el servidor TKL Windows, vive como `C:\TKL\siaf_sync\credentials.json`.
- Para rotar: ver [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

### Riesgo histórico: archivos `.env` con UTF-16 BOM

PowerShell en Windows escribe archivos en UTF-16 LE por default. Eso
rompe `dotenv-cli`. Si te encontrás con vars que "no cargan", verificá
encoding (`python -c "print(open('.env','rb').read()[:8])"`) y
regeneralo en UTF-8 si hace falta.

---

## 7. Restricciones de negocio en seguridad

### ADMIN no puede gestionar OWNER ni a otros ADMIN

Implementado en los endpoints `/api/admin/users/*`:

```ts
if (target.role === "OWNER" || target.role === "ADMIN") {
  return NextResponse.json(
    { error: "Solo el OWNER puede gestionar usuarios con rol Direccion o Administrador" },
    { status: 403 }
  );
}
```

**Por qué**: ADMIN es un rol técnico amplio. Si pudiera modificar OWNER,
podría escalar privilegios o desactivar a la dueña. La gestión de roles
sensibles queda solo en OWNER.

### No puede haber 0 OWNER activos

Antes de desactivar un OWNER, se chequea que existan al menos 2 OWNER
activos. **El OWNER no puede desactivarse a sí mismo**.

### CO_SUPERVISOR fue eliminado

El rol `CO_SUPERVISOR` existió en versiones tempranas pero fue removido
end-to-end (commit `f63dccb`). El proceso requirió:

1. Migrar todos los usuarios `CO_SUPERVISOR` → `SUPERVISOR`.
2. Eliminar el valor del enum.
3. Limpiar los arrays `MENU_BY_ROLE`, `ROUTE_PERMISSIONS`, helpers `can.*`.
4. `prisma db push --accept-data-loss` (Prisma exige confirmación
   explícita para borrar valores de enum).

---

## 8. Lo que NO está implementado

Para no dar falsa sensación de cobertura, esto **NO existe** hoy:

- ❌ **Rate limiting** en endpoints de auth o sync. Un atacante puede
  intentar credenciales sin throttle.
- ❌ **2FA** (TOTP, WebAuthn).
- ❌ **Password complexity policies** (longitud mínima, caracteres especiales). Solo se valida que no esté vacía.
- ❌ **Lockout por intentos fallidos**.
- ❌ **Refresh tokens**. Si un JWT se compromete, vive hasta `exp` (8h no-OWNER, ilimitado OWNER salvo cambio de `AUTH_SECRET`).
- ❌ **CSP headers customizados**. Solo los defaults de Next.js.
- ❌ **Logging centralizado de eventos sospechosos**. Los logs viven en Vercel + DB locales.

Estas son **decisiones explícitas** de scope dado el modelo de amenaza:
sistema interno, usuarios conocidos, red corporativa. No es público en
internet salvo para los empleados con credenciales.

---

## 9. Referencias cruzadas

- [permissions/permission-system.md](./permissions/permission-system.md) — universos A y B en detalle.
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — rotación de secrets, errores comunes.
- [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) — todas las vars sensibles.
- [database/neon-schema.md](./database/neon-schema.md) — modelos `User`, `AuditLog`, `SecurityEvent`.
