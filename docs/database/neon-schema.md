# Schema de base de datos

Este documento describe el modelo de datos del sistema. La fuente de
verdad es `prisma/schema.prisma` — si encontrás discrepancia, el archivo
manda.

---

## Información general

- **Motor**: PostgreSQL (Neon en producción, Postgres local en dev).
- **ORM**: Prisma 5.22.
- **Modo de deploy**: `prisma db push` (sin tabla de migrations).
- **Cliente**: `@prisma/client` instanciado en `src/lib/prisma.ts` como
  singleton global.

### Convención `@db.Date`

Varios modelos (SalesSnapshot, BankBalanceSnapshot, SyncLog,
SourceFile) usan `DateTime @db.Date`. **Comportamiento importante**:

- En la DB se guarda solo la fecha (`YYYY-MM-DD`), sin hora.
- Prisma lo devuelve como `Date` JavaScript representando **medianoche
  UTC del día almacenado**.
- Por eso es crítico construir las fechas en UTC al hacer queries:
  ```ts
  const today = new Date(Date.UTC(year, month - 1, day));
  ```
  No usar `new Date()` + `setHours(0,0,0,0)` (que usa la TZ del server,
  típicamente UTC en Vercel pero podría no serlo en local).

Para TZ Argentina hay un helper en
`src/app/(executive)/executive/page.tsx`:

```ts
function getArtToday(): Date {
  const artMs = Date.now() - 3 * 60 * 60 * 1000;  // ART = UTC-3, sin DST
  const art   = new Date(artMs);
  return new Date(Date.UTC(art.getUTCFullYear(), art.getUTCMonth(), art.getUTCDate()));
}
```

---

## Catálogo de enums

### `UserRole`

```prisma
enum UserRole {
  SUPERVISOR
  BRANCH_MANAGER
  HR
  MAINTENANCE
  OWNER
  ADMIN
}
```

Antes existía `CO_SUPERVISOR` — eliminado en commit `f63dccb`.

### `PositionScope`

A qué sucursales aplica el puesto en sí (vs el `PermissionScope` que
aplica al permiso operativo).

```prisma
enum PositionScope {
  ALL        // el puesto existe en todas las sucursales
  SPECIFIC   // solo en algunas (ver PositionBranchScope)
}
```

### `PermissionScope`

Alcance de un permiso operativo asignado a un puesto.

```prisma
enum PermissionScope {
  OWN_BRANCH    // aplica solo a la sucursal donde el empleado está asignado
  ALL_BRANCHES  // aplica a cualquier sucursal
}
```

### `AssignmentType` y `AssignmentStatus`

```prisma
enum AssignmentType {
  PERMANENT           // empleado fijo de la sucursal
  TEMPORARY_COVERAGE  // cobertura puntual (vacaciones, ausencia)
  ROTATION            // rotación programada
}

enum AssignmentStatus {
  ACTIVE     // vigente, suma al plantel real
  CANCELLED  // cancelada antes/durante, no impacta dotación
  COMPLETED  // terminada normalmente
}
```

### Auditoría / dashboard ejecutivo

```prisma
enum SyncStatus    { SUCCESS, ERROR, PARTIAL, NO_FILE, STALE }
enum SyncSource    { GOOGLE_DRIVE, SALES_API }
enum SyncTrigger   { CRON, MANUAL, WEBHOOK }
enum AccessAction  { LOGIN, LOGOUT, VIEW_DASHBOARD, VIEW_BALANCES, VIEW_SALES, VIEW_COMPARATIVE, EXPORT }

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
```

### Otros

```prisma
enum AbsenceType        { SICKNESS, PERSONAL_REASON, NO_SHOW, LATE_NOTICE, MEDICAL_LEAVE, SPECIAL_LEAVE, SUSPENSION, OTHER }
enum AbsenceStatus      { REPORTED, JUSTIFIED, UNJUSTIFIED, UNDER_REVIEW, CLOSED }
enum ActionPlanStatus   { OPEN, IN_PROGRESS, COMPLETED, CLOSED, CANCELLED }
enum ActionPlanTemplateType { MOSTRADOR, CADETE, CAJERA, AUDITORIA }
enum OvertimeStatus     { REPORTED, APPROVED, REJECTED }
enum OvertimeReason     { ABSENCE_COVERAGE, VACATION_COVERAGE, UNDERSTAFFING, HIGH_DEMAND, OTHER }
enum NotificationType   { VACATION_NEEDS_COVERAGE, VACATION_PENDING_APPROVAL, ROTATING_CONFLICT, MAINTENANCE_HIGH_PRIORITY, TASK_OVERDUE, WHATSAPP_NEEDS_REVIEW, ABSENCE_REPORTED, ABSENCE_CRITICAL_POSITION, ABSENCE_NO_CERTIFICATE, GENERAL }
```

---

## Modelos principales

### `Branch` — sucursales

```prisma
model Branch {
  id              String   @id @default(cuid())
  name            String   @unique
  aliases         String[] @default([])  // nombres alternativos para el matching SIAF
  code            String?  @unique
  address         String?
  phone           String?
  active          Boolean  @default(true)
  showInExecutive Boolean  @default(true)
  showInOperative Boolean  @default(true)
  notes           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  // ... relaciones
  @@index([active])
  @@index([showInExecutive])
  @@index([showInOperative])
}
```

**Campos clave**:
- `aliases`: el SIAF usa nombres distintos a los de la DB ("AM" → "America"). El parser de CSVs hace `resolveBranchId` que matcha por name o aliases.
- `showInExecutive` / `showInOperative`: filtros para hide soft. Una sucursal cerrada se marca `active=false`. Una sucursal en transición puede estar `showInExecutive=false` mientras aún se ven en operativa.

### `Position` — puestos (cargos)

```prisma
model Position {
  id               String        @id @default(cuid())
  name             String        @unique
  requiresCoverage Boolean       @default(false)  // si requiere cobertura ante ausencia
  isRotatingRole   Boolean       @default(false)  // ej: cadete que rota entre sucursales
  scope            PositionScope @default(ALL)
  active           Boolean       @default(true)
  notes            String?
  // ... relaciones (incl. PositionPermission)
}
```

Vinculado a permisos vía `PositionPermission` (Universo B).

### `Employee` — empleados

```prisma
model Employee {
  id                       String    @id @default(cuid())
  firstName                String
  lastName                 String
  positionId               String
  position                 Position  @relation(...)
  currentBranchId          String?           // sucursal "fija" (null para rotativos)
  currentBranch            Branch?   @relation(...)
  active                   Boolean   @default(true)
  hireDate                 DateTime?
  isRotating               Boolean   @default(false)
  zone                     String?
  maxConcurrentAssignments Int       @default(1)
  workScheduleNotes        String?
  notes                    String?
  userId                   String?   @unique  // si tiene login al sistema
  // ...
}
```

Un Employee puede tener (o no) un User asociado (`userId`). Eso define
si tiene acceso al sistema o solo está en el plantel para tracking.

### `EmployeeBranchAssignment` — asignaciones de sucursal

Modela coberturas, rotaciones y la asignación permanente.

```prisma
model EmployeeBranchAssignment {
  id          String   @id @default(cuid())
  employeeId  String
  employee    Employee @relation(...)
  branchId    String
  branch      Branch   @relation(...)
  startDate   DateTime
  endDate     DateTime?  // null solo para PERMANENT
  type        AssignmentType   @default(PERMANENT)
  status      AssignmentStatus @default(ACTIVE)
  positionId  String?            // puesto que cubre la rotativa (opcional para PERMANENT)
  position    Position? @relation(...)
  reason      String?
  assignedByUserId String?
  notes       String?
  // ...
}
```

`getPlantillaReal()` (en `src/lib/plantilla.ts`) filtra `status=ACTIVE`
y fechas activas para reportar el plantel "real" de una sucursal.

### `User` — usuarios del sistema

```prisma
model User {
  id                 String    @id @default(cuid())
  name               String
  email              String    @unique
  passwordHash       String                    // bcrypt
  role               UserRole
  active             Boolean   @default(true)
  branchId           String?                   // si es BRANCH_MANAGER, su sucursal
  branch             Branch?   @relation(...)
  employeeId         String?                   // referencia al Employee operativo (opcional)
  mustChangePassword Boolean   @default(true)
  resetToken         String?   @unique
  resetTokenExpiry   DateTime?
  executiveAccess    Boolean   @default(false) // Universo A: acceso al dashboard ejecutivo
  // ... relaciones (Account, Session, AuditLog, AccessLog, SecurityEvent)
}
```

**Notas**:
- `passwordHash` siempre con bcrypt. Nunca usar campos custom.
- `mustChangePassword=true` por default → forzar cambio en primer login.
- `executiveAccess` solo lo cambia OWNER desde `/owner/accesos`. OWNER siempre tiene acceso ejecutivo aunque el flag sea `false`.
- `employeeId` es **referencia informal**, no es una relación Prisma formal — decisión de Fase 1 para no romper compatibilidad. Cuando estabilice, considerar hacerla relación con FK.

### `Account`, `Session`, `VerificationToken`

Modelos requeridos por `@auth/prisma-adapter` (NextAuth). En este
proyecto se usa **JWT strategy** así que `Session` no se consulta por
request — solo se escribe nominalmente. Los modelos existen por
compatibilidad con el adapter.

---

## Modelos del dashboard ejecutivo

### `BankBalanceSnapshot` — saldos bancarios diarios

```prisma
model BankBalanceSnapshot {
  id           String   @id @default(cuid())
  branchId     String
  bankName     String
  accountLabel String
  balance      Decimal  @db.Decimal(15, 2)
  checks       Decimal? @db.Decimal(15, 2)  // cheques en cartera
  prevBalance  Decimal? @db.Decimal(15, 2)  // saldo del día anterior
  snapshotDate DateTime @db.Date
  sourceSheet  String                       // pestaña del Excel de origen
  createdAt    DateTime @default(now())
  branch       Branch   @relation(...)

  @@unique([branchId, bankName, accountLabel, snapshotDate])
  @@index([snapshotDate(sort: Desc)])
  @@index([branchId, snapshotDate(sort: Desc)])
}
```

**`@@unique` constraint** garantiza una fila por (sucursal, banco,
cuenta, fecha). El sync hace `upsert` para tolerar reintentos del mismo
día.

### `SalesSnapshot` — ventas diarias por sucursal

```prisma
model SalesSnapshot {
  id           String   @id @default(cuid())
  branchId     String
  snapshotDate DateTime @db.Date
  totalSales   Decimal  @db.Decimal(15, 2)
  units        Int
  receipts     Int                          // tickets / comprobantes
  avgTicket    Decimal  @db.Decimal(10, 2)
  rawData      Json                         // detalles SIAF (por OS, por vendedor, etc.)
  dataSource   String                       // "siaf" | "manual" | etc.
  createdAt    DateTime @default(now())
  branch       Branch   @relation(...)

  @@unique([branchId, snapshotDate])
  @@index([snapshotDate(sort: Desc)])
  @@index([branchId, snapshotDate(sort: Desc)])
}
```

**`rawData` JSON** contiene el desglose detallado:

```json
{
  "source": "siaf",
  "efectivo": 450000,
  "tarjeta": 650000,
  "obra_social": 134567.89,
  "vendedores": [
    { "codigo": "01", "nombre": "Juan",
      "ventas": 250000, "tickets": 35, "descuentos": 4500, "unidades": 89 },
    ...
  ],
  "obras_sociales": [
    { "codigo": "OSDE", "nombre": "OSDE",
      "ventas_bruto": 80000, "descuentos": 8000, "ventas_neto": 72000,
      "tickets": 12, "unidades": 25 },
    { "codigo": "PAR", "nombre": "PARTICULAR",
      "ventas_bruto": ..., ..., "unidades": ... },
    ...
  ]
}
```

`dataSource` permite distinguir filas de SIAF vs filas seed o manuales.
`sync-sales.ts` filtra por `dataSource: "siaf"` al hacer el lookup de
`lastSnap` (para no contar seed data como base de incrementalidad).

### `SyncLog` — log de cada ejecución del sync

```prisma
model SyncLog {
  id            String      @id @default(cuid())
  source        SyncSource    // GOOGLE_DRIVE | SALES_API
  status        SyncStatus    // SUCCESS | ERROR | PARTIAL | NO_FILE | STALE
  message       String?
  rowsProcessed Int?
  warnings      Json?
  durationMs    Int?
  syncDate      DateTime    @db.Date
  triggeredBy   SyncTrigger   // CRON | MANUAL | WEBHOOK
  createdAt     DateTime    @default(now())

  @@index([createdAt(sort: Desc)])
  @@index([source, syncDate])
}
```

Cada llamada a `syncBalances()` y `syncSales()` escribe un row.
Diagnóstico:

```sql
SELECT createdAt, source, status, message, "rowsProcessed"
FROM "SyncLog"
ORDER BY createdAt DESC
LIMIT 20;
```

### `SourceFile` — idempotencia por archivo de Drive

```prisma
model SourceFile {
  id           String    @id @default(cuid())
  driveFileId  String    @unique           // ID del file en Drive
  filename     String
  fileDate     DateTime  @db.Date
  modifiedTime DateTime?                   // modifiedTime del Drive file (para idempotencia)
  processedAt  DateTime
  rowsCount    Int
  status       String                      // "processed" | "error"
  createdAt    DateTime  @default(now())

  @@index([fileDate(sort: Desc)])
}
```

**Por qué `modifiedTime` es importante**: si entre dos runs del mismo
día el admin actualiza el Excel, el `modifiedTime` cambia → el sync
detecta y reprocesa. Sin este campo, el comportamiento viejo era
"ya procesé este file hoy → skip" y se perdían las correcciones.

---

## Modelos operativos (RRHH)

### `AbsenceRecord`

Ausencias de empleados. Soporta certificados médicos, justificación,
detección automática de sucursal vía asignación.

```prisma
model AbsenceRecord {
  id                            String   @id @default(cuid())
  employeeId                    String
  employee                      Employee @relation(...)
  branchId                      String
  branch                        Branch   @relation(...)
  reportedByUserId              String
  startDate                     DateTime
  endDate                       DateTime
  absenceType                   AbsenceType
  status                        AbsenceStatus @default(REPORTED)
  hasCertificate                Boolean       @default(false)
  certificateUntil              DateTime?
  notifiedAt                    DateTime?
  reasonDetail                  String?
  notes                         String?
  branchDetectedFromAssignment  Boolean       @default(false)
  whatsappMessageId             String?
}
```

### `ActionPlan` y `ActionPlanForm`

Planes de acción disciplinarios con templates por tipo de puesto
(MOSTRADOR, CADETE, CAJERA, AUDITORIA). El form guarda los datos
estructurados en JSON y se renderiza un PDF firmable.

```prisma
model ActionPlan {
  id              String   @id @default(cuid())
  employeeId      String
  branchId        String
  createdByUserId String
  date            DateTime
  reason          String
  requiredActions String
  deadline        DateTime
  status          ActionPlanStatus @default(OPEN)
  notes           String?
  // ...
  form            ActionPlanForm?
}

model ActionPlanForm {
  id             String                 @id @default(cuid())
  actionPlanId   String                 @unique
  templateType   ActionPlanTemplateType
  formData       Json                       // datos del formulario tipado por templateType
  generalScore   String
  improvementPlan String?
  nextReview     DateTime?
  signedAt       DateTime?
  signedDocUrl   String?                    // URL al PDF firmado en storage
  // ...
}
```

### `OvertimeRecord`

Horas extras. `@@unique([employeeId, date])` impide duplicados por día
para el mismo empleado.

```prisma
model OvertimeRecord {
  id               String   @id @default(cuid())
  employeeId       String
  branchId         String
  reportedByUserId String
  approvedByUserId String?
  approvedAt       DateTime?
  date             DateTime
  hours            Decimal  @db.Decimal(4, 2)
  reason           OvertimeReason
  status           OvertimeStatus @default(REPORTED)
  notes            String?
  rejectionReason  String?

  @@unique([employeeId, date])
}
```

### `Notification`

```prisma
model Notification {
  id        String           @id @default(cuid())
  userId    String
  type      NotificationType
  title     String
  body      String
  read      Boolean          @default(false)
  link      String?
  createdAt DateTime         @default(now())
}
```

---

## Modelos de auditoría / seguridad

Ver [SECURITY.md](../SECURITY.md) para el contexto.

### `AuditLog`

Log genérico de mutaciones.

```prisma
model AuditLog {
  id        String   @id @default(cuid())
  userId    String
  action    String   // ej: "USER_CREATED"
  entity    String   // ej: "User"
  entityId  String?
  detail    Json?
  ip        String?
  userAgent String?
  createdAt DateTime @default(now())
}
```

### `AccessLog`

Accesos al dashboard ejecutivo.

```prisma
model AccessLog {
  id           String       @id @default(cuid())
  userId       String
  action       AccessAction  // VIEW_DASHBOARD | VIEW_SALES | etc
  branchFilter String?
  ipAddress    String?
  userAgent    String?
  createdAt    DateTime     @default(now())
}
```

### `SecurityEvent`

Eventos sensibles de seguridad.

```prisma
model SecurityEvent {
  id        String            @id @default(cuid())
  userId    String                                 // sujeto del evento
  user      User              @relation(...)
  actorId   String?                                // quien hizo el cambio
  type      SecurityEventType
  detail    Json?
  ip        String?
  userAgent String?
  createdAt DateTime          @default(now())
}
```

---

## Modelos del sistema de permisos por puesto

Ver [permissions/permission-system.md](../permissions/permission-system.md)
para el contexto completo.

### `Permission` — catálogo de permisos operativos

```prisma
model Permission {
  id          String   @id @default(cuid())
  key         String   @unique           // ej "vencidos.upload_remito"
  module      String                     // ej "vencidos"
  description String                     // texto humano para UI
  active      Boolean  @default(true)    // soft-delete
  createdAt   DateTime @default(now())

  positions   PositionPermission[]
}
```

Seedeable vía `scripts/seed-permissions.ts` (idempotente).

### `PositionPermission` — asignación de permiso a puesto

```prisma
model PositionPermission {
  id              String          @id @default(cuid())
  positionId      String
  position        Position        @relation(...)
  permissionId    String
  permission      Permission      @relation(...)
  scope           PermissionScope @default(OWN_BRANCH)
  grantedByUserId String?         // quién asignó
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@unique([positionId, permissionId])
}
```

`scope` puede ser `OWN_BRANCH` (típico, el empleado solo puede usar
el permiso en su sucursal asignada) o `ALL_BRANCHES` (excepcional, ej:
supervisor regional).

---

## Constraints e índices clave

| Constraint | Por qué existe |
|---|---|
| `User.email` UNIQUE | Login |
| `Branch.name` UNIQUE | Resolución de sucursal por nombre desde CSVs |
| `Branch.code` UNIQUE | Código identificador |
| `Position.name` UNIQUE | Catálogo de puestos |
| `BankBalanceSnapshot.@@unique([branchId, bankName, accountLabel, snapshotDate])` | Una fila por cuenta por día — el sync hace upsert |
| `SalesSnapshot.@@unique([branchId, snapshotDate])` | Una fila por sucursal por día — el sync usa `skipDuplicates` |
| `OvertimeRecord.@@unique([employeeId, date])` | No registrar dos overtime el mismo día |
| `Permission.key` UNIQUE | Lookup por key |
| `PositionPermission.@@unique([positionId, permissionId])` | No duplicar asignación |
| `SourceFile.driveFileId` UNIQUE | Idempotencia por file de Drive |

Índices sort DESC en `snapshotDate` y `createdAt` están optimizados
para queries del tipo "último snapshot disponible" y "últimos 20 logs".

---

## Setup local del schema

```bash
# 1. Crear la DB local
createdb tkl_dev

# 2. Aplicar el schema (sin migration history)
npm run db:push

# 3. Cargar datos seed (solo dev)
npm run db:seed

# 4. (Opcional) Abrir Prisma Studio para inspección visual
npm run db:studio
```

Para reset completo:

```bash
npm run db:reset  # DESTRUCTIVO: borra todo + push + seed
```

---

## Referencias cruzadas

- [permissions/permission-system.md](../permissions/permission-system.md) — Permission y PositionPermission en uso.
- [SECURITY.md](../SECURITY.md) — User, AuditLog, SecurityEvent.
- [integrations/siaf-sync.md](../integrations/siaf-sync.md) — SalesSnapshot y rawData.
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) — `prisma db push --accept-data-loss`.
