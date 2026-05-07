# Roadmap — módulos planificados

Este documento describe el estado de implementación de cada módulo del
sistema y los planes futuros. Es una foto del proyecto, no un compromiso.

> Para bugs y limitaciones del estado actual ver
> [known-issues/current-known-issues.md](../known-issues/current-known-issues.md).

---

## Estado de módulos al momento de redacción

### ✅ Funcionales

Estos módulos están en uso productivo:

| Módulo | Notas |
|---|---|
| **Auth + roles** | NextAuth v5 + 6 roles + flag `executiveAccess` |
| **Dashboard** (operativa) | Home con métricas y links |
| **Sucursales** | Lista + detalle con plantel real (`getPlantillaReal`) |
| **Empleados** | CRUD completo, asignación de sucursal, perfil |
| **Ausencias** | Para fijos, rotativos y suspensiones; certificados médicos |
| **Planes de acción** | CRUD + 4 templates (MOSTRADOR, CADETE, CAJERA, AUDITORIA) + PDF generación |
| **Horas extras** | Reporte y aprobación |
| **Rotativas / coberturas** | Asignaciones con `status` y puesto cubierto |
| **Puestos** | Catálogo + asignación de permisos |
| **Admin / Usuarios** | OWNER y ADMIN pueden crear/editar/resetear-password |
| **Perfil propio** | Cambio de password, datos básicos |
| **Dashboard Ejecutivo** | KPIs + saldos + ventas + comparativos |
| **Sync SIAF** | Pipeline diario operativo |
| **Sync saldos** | Excel manual de Administración |
| **Permisos por puesto** | Universo B con helpers Fase 3 |
| **Panel `/owner`** | Gestión de `executiveAccess`, gestión de usuarios sensibles |
| **PWA** | Manifest + íconos generados desde logo real |

### 🚧 Placeholders (UI existe, lógica pendiente)

| Módulo | Estado actual | Plan |
|---|---|---|
| **Vacaciones** | Página existe, sin lógica completa | Fase 2 — modelado de balance, aprobaciones, conflictos |
| **Mantenimiento** | Página existe, sin lógica | Fase 2 — tickets por sucursal, asignación, status |
| **Tareas de supervisión** | Página existe, sin lógica | Fase 2 — checklist por sucursal con frecuencia |
| **Alertas** | Página existe, sin lógica | Fase 2 — centro de notificaciones operativas |
| **WhatsApp** | Página existe, sin lógica | Fase 2 — vista de mensajes operativos |

> ⚠️ Estos placeholders aparecen en el menú lateral y son navegables,
> pero internamente no hacen lectura/escritura significativa de la DB.
> Si un usuario los abre, ve estructura UI sin datos reales.

---

## Roadmap por fase

### Fase 4 (próxima) — Vacaciones

**Objetivos**:
- Modelado: `VacationRequest` con startDate, endDate, days, reason.
- Workflow: solicitud → aprobación → cobertura asignada → confirmación.
- Detección de conflictos: si la sucursal queda sub-staffed.
- Calendario visual.

**Schema preliminar**:

```prisma
model VacationRequest {
  id              String   @id @default(cuid())
  employeeId      String
  startDate       DateTime
  endDate         DateTime
  days            Int
  reason          String?
  status          VacationStatus @default(REQUESTED)
  approvedByUserId String?
  approvedAt      DateTime?
  // ...
}

enum VacationStatus {
  REQUESTED
  APPROVED
  CONFIRMED   // cobertura ya asignada
  CANCELLED
  COMPLETED
}
```

**Permisos**: ya están definidos en helpers `can.*` (createVacation,
approveVacation, confirmVacation, manageCoverage). Falta el módulo.

**Dependencias**: `EmployeeBranchAssignment` con `type: TEMPORARY_COVERAGE`
ya existe.

---

### Fase 5 — Mantenimiento

**Objetivos**:
- Tickets de mantenimiento por sucursal.
- Asignación a personal de MAINTENANCE.
- Estado: REPORTED → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED.
- Prioridad y fecha objetivo.

**Schema preliminar**:

```prisma
model MaintenanceTicket {
  id              String   @id @default(cuid())
  branchId        String
  reportedByUserId String
  assignedToUserId String?
  title           String
  description     String
  priority        TicketPriority   @default(NORMAL)
  status          TicketStatus     @default(REPORTED)
  expectedAt      DateTime?
  resolvedAt      DateTime?
  // ...
}

enum TicketPriority { LOW, NORMAL, HIGH, URGENT }
enum TicketStatus   { REPORTED, ASSIGNED, IN_PROGRESS, RESOLVED, CLOSED }
```

**Notificaciones**: integrar con `Notification` para HIGH/URGENT.

---

### Fase 6 — Tareas de supervisión

**Objetivos**:
- Checklist de tareas por sucursal con frecuencia (diaria, semanal, mensual).
- Asignación a roles (Encargada, Supervisor).
- Cumplimiento tracking.

**Schema preliminar**:

```prisma
model TaskTemplate {
  id          String   @id @default(cuid())
  title       String
  description String?
  frequency   TaskFrequency
  applicableRoles UserRole[]
  active      Boolean  @default(true)
}

model TaskInstance {
  id              String   @id @default(cuid())
  templateId      String
  branchId        String
  assignedToUserId String
  dueDate         DateTime
  completedAt     DateTime?
  status          TaskStatus  @default(PENDING)
  // ...
}

enum TaskFrequency { DAILY, WEEKLY, MONTHLY, AD_HOC }
enum TaskStatus    { PENDING, COMPLETED, OVERDUE }
```

**Generación automática**: cron que crea `TaskInstance` rows según
`TaskTemplate.frequency` y branches activas.

---

### Fase 7 — Alertas / Centro de Notificaciones

**Objetivos**:
- UI agregada de notificaciones del sistema.
- Filtros por tipo, leídas/no leídas, fecha.
- Marcar como leídas, archivar.

**Modelo ya existe**: `Notification` con `NotificationType` enum y
`read` flag. Solo falta UI y los triggers que crean notifications
desde otros módulos (ausencias, vacaciones, mantenimiento, etc.).

---

### Fase 8 — WhatsApp integration

**Objetivos**:
- Recibir mensajes operativos vía WhatsApp Business API.
- Vincular mensajes a empleados (por número de teléfono).
- Detectar palabras clave (ausencia, certificado médico, etc.) para
  pre-poblar `AbsenceRecord`.
- Vista web de mensajes para Supervisor/ADMIN.

**Dependencias externas**:
- WhatsApp Business API account.
- Webhook endpoint para recibir mensajes.
- Storage para attachments (certificados, fotos).

**Modelo preliminar**:

```prisma
model WhatsAppMessage {
  id              String   @id @default(cuid())
  fromPhone       String
  matchedEmployeeId String?
  message         String
  attachments     String[] @default([])
  classification  String?  // "absence_report" | "certificate" | "other"
  reviewedByUserId String?
  reviewedAt      DateTime?
  createdAt       DateTime @default(now())
}
```

---

## Mejoras transversales planificadas

### Alerting cuando sync falla

**Estado**: no implementado.
**Plan**: enviar email/Slack notification cuando:
- `SyncLog.status = ERROR`.
- Más de 1 sucursal con warnings.
- Sin rows nuevos por >24h.

**Implementación**: webhook adicional desde `syncBalances` /
`syncSales` que llama a un Slack/Email service.

---

### Migrations de Prisma

**Estado**: usando `db push` directo.
**Plan**: migrar a `prisma migrate` cuando schema estabilice.

Pasos:
1. Generar baseline migration desde schema actual.
2. `prisma migrate resolve --applied <baseline>` en producción.
3. Adoptar `prisma migrate deploy` en CI.

---

### Testing strategy formal

**Estado**: tests puntuales ad-hoc (`scripts/test-*.ts`).
**Plan**:
- Adoptar Vitest o Jest.
- Cobertura mínima 60% en `src/lib/` (sync, permissions, parsers).
- E2E con Playwright para flujos críticos (login, dashboard ejecutivo, cargar ausencia).

---

### API documentation

**Estado**: solo lectura del código.
**Plan**: generar OpenAPI spec o JSDoc-driven docs para endpoints públicos
de `/api/*`.

---

### Refresh de JWT al cambiar permisos

**Estado**: usuario debe relogearse.
**Plan**: endpoint `/api/auth/refresh` que re-fetchee `executiveAccess`
y otros flags desde DB. Llamar desde cliente cuando ADMIN modifica.

---

### Rate limiting

**Estado**: ninguno.
**Plan**: usar middleware con `next-rate-limit` o similar:
- 5 intentos de login por IP por minuto.
- 100 requests por usuario por minuto a APIs.

---

### Auditoría más visible

**Estado**: tablas `AuditLog`, `AccessLog`, `SecurityEvent` existen
pero la UI de visualización es placeholder.

**Plan**: panel `/owner/auditoria` con filtros, exports y búsquedas.

---

### Migrar SUPERVISOR a Universo B

**Estado**: SUPERVISOR tiene bypass en `can()` / `canInBranch()`.
**Plan futuro**: modelar SUPERVISOR como Employee con Position
"Supervisor" + permisos × `ALL_BRANCHES`. Permitiría granularidad de
"este supervisor regional sí, este otro no" en acciones específicas.

**Trade-off**: más data setup vs más uniformidad.

---

## Out of scope (no planificado)

Para gestionar expectativas, esto **no está en roadmap**:

- ❌ App nativa iOS/Android (PWA cubre el caso).
- ❌ Integración con sistemas contables (QuickBooks, etc.).
- ❌ Multi-tenancy (sistema dedicado a Farmacias TKL).
- ❌ Internacionalización (solo español, ARS).
- ❌ Reportes avanzados / BI tool integrada (suele resolverse vía export
  a Excel + Power BI o Looker).

---

## Cómo proponer cambios al roadmap

1. Discutir con OWNER / equipo.
2. Si aprobado, agregar entry acá con:
   - Objetivo.
   - Schema preliminar (si aplica).
   - Dependencias.
   - Estimación rough.
3. Crear issue en GitHub para tracking.

---

## Referencias cruzadas

- [README.md](../README.md) — índice general.
- [database/neon-schema.md](../database/neon-schema.md) — modelos actuales.
- [permissions/permission-system.md](../permissions/permission-system.md) — Universo B.
- [known-issues/current-known-issues.md](../known-issues/current-known-issues.md) — limitaciones actuales.
