# Plataforma Operativa Farmacias TKL — Documento Maestro de Roadmap Funcional

**Versión:** 3.0  
**Fecha:** Mayo 2026  
**Estado:** Documento vivo — actualizar ante cambios funcionales o arquitectónicos relevantes

---

## Visión general

La plataforma TKL ha evolucionado desde un dashboard simple hacia un **sistema operativo interno empresarial** para una cadena de farmacias multi-sucursal. Su objetivo es digitalizar, centralizar y auditar todos los procesos operativos que hoy se gestionan de forma manual, en papel, por WhatsApp o en planillas dispersas.

La plataforma se organiza en dos grandes dominios:

| Dominio | URL | Audiencia principal |
|---|---|---|
| **Operativa** | `farmacias-tkl.vercel.app` | Encargados, Supervisores, RRHH, Mantenimiento, Admin |
| **Dashboard Ejecutivo** | `farmacias-tkl.vercel.app/executive` | Dirección (OWNER) |

Ambos dominios comparten infraestructura, base de datos, autenticación y sistema de permisos.

---

## No objetivos actuales

Para evitar scope creep, se define explícitamente lo que esta plataforma **no** incluye en su alcance actual:

- Liquidación de sueldos
- Gestión de stock completa
- Facturación electrónica
- Reemplazo del sistema SIAF
- Business Intelligence avanzado (cubos, OLAP)
- Arquitectura multiempresa
- App pública para empleados (autogestión)
- Portal de proveedores
- E-commerce o ventas online

Cualquier expansión hacia estas áreas requiere decisión explícita de Dirección y revisión de este documento.

---

## Principios arquitectónicos

Estos principios guían todas las decisiones de diseño, desarrollo e implementación. Son obligatorios para cualquier desarrollador que trabaje en el sistema.

| Principio | Descripción |
|---|---|
| **Mobile-first** | Toda interfaz debe funcionar correctamente en dispositivos móviles. Los encargados operan desde el piso, no desde escritorios. |
| **Todo proceso es auditable** | Toda acción crítica debe dejar trazabilidad: quién, qué, cuándo, desde qué sucursal. |
| **Timestamps en todo** | Toda entidad crítica registra `createdAt`, `updatedAt` y timestamps de cada transición de estado. |
| **Permisos server-side** | Ninguna decisión de autorización vive solo en el frontend. Todo se valida en el servidor. |
| **Sucursales como entidad central** | La sucursal es el eje del dominio. Todo registro operativo pertenece a una sucursal. |
| **Desacoplamiento entre módulos** | Los módulos no deben depender directamente entre sí. Las relaciones se modelan por entidades compartidas (Employee, Branch), no por lógica cruzada. |
| **WhatsApp no es fuente de verdad** | WhatsApp puede usarse como canal de captura operativa y notificación, pero todo evento debe transformarse en un registro formal dentro de la plataforma antes de considerarse válido. |
| **Tolerancia a operación parcial** | Si un módulo falla, los demás deben seguir funcionando. No hay dependencias de runtime entre módulos. |
| **Estado explícito siempre** | Todo registro tiene un estado explícito en todo momento. No hay estados implícitos o inferidos. |
| **Sin borrado lógico ambiguo** | Las entidades no se borran, se desactivan o cancelan. El historial es permanente. |
| **Simplicidad antes que sobreingeniería** | La arquitectura actual prioriza velocidad de desarrollo y simplicidad operativa sobre microservicios o complejidad distribuida. Escalar cuando el problema lo justifique, no antes. |

---

## Principios de UX operativa

El sistema opera en farmacias reales, con personal en el piso, móviles de gama media y situaciones de apuro. La UX debe diseñarse para ese contexto, no para un usuario de escritorio con tiempo ilimitado.

| Principio | Descripción |
|---|---|
| **Velocidad operativa** | Toda tarea recurrente debe poder completarse en menos de 30 segundos. |
| **Mínima cantidad de clicks** | Formularios directos. Sin pantallas intermedias innecesarias. |
| **Pensado para uso apurado** | Los flujos deben funcionar cuando el usuario está parado, con una mano, mirando la pantalla 5 segundos. |
| **Inputs grandes y táctiles** | Botones y campos dimensionados para dedos, no para mouse. |
| **Estados visuales claros** | El usuario debe entender el estado de cualquier registro con un vistazo. Sin ambigüedad. |
| **Evitar texto excesivo** | Íconos y colores comunican más rápido que texto en contexto operativo. |
| **Acciones críticas visibles** | Las acciones más usadas no pueden estar enterradas en menús. |
| **Feedback inmediato** | Toda acción debe confirmar visualmente que ocurrió. Sin pantallas en blanco ni silencios. |
| **Resiliencia ante mala conectividad** | Ver sección "Offline y conectividad". |

---

## Infraestructura actual

| Componente | Tecnología |
|---|---|
| Frontend / Backend | Next.js 14 App Router + TypeScript |
| Base de datos | PostgreSQL en Neon (serverless) |
| ORM | Prisma 5 (`db push`, sin migrations formales) |
| Auth | NextAuth v5 — JWT + Credentials |
| Hosting | Vercel |
| Repositorio | GitHub (cuenta empresa `farmacias-tkl`) |
| Sync de ventas | Python (DBF → CSV → Google Drive → Neon) |
| Sync de saldos | Python (Excel local → Google Drive → Neon) |
| PWA | Manifest + íconos generados |
| Task Scheduler | Windows Server — 4 tareas automatizadas |

---

## Entidades maestras del dominio

### Entidades centrales

| Entidad | Descripción | Estado |
|---|---|---|
| `User` | Usuario autenticado en el sistema | ✅ Implementado |
| `Employee` | Empleado real de la cadena | ✅ Implementado |
| `Branch` | Sucursal física | ✅ Implementado |
| `Position` | Puesto operativo (Cajera, Encargado, etc.) | ✅ Implementado |
| `Permission` | Permiso granular del Universo B | ✅ Implementado |
| `PositionPermission` | Asignación de permiso a puesto con scope | ✅ Implementado |
| `EmployeeBranchAssignment` | Asignación de empleado a sucursal (fija o rotativa) | ✅ Implementado |
| `AbsenceRecord` | Registro de ausencia o suspensión | ✅ Implementado |
| `ActionPlan` | Plan de acción disciplinario | ✅ Implementado |
| `OvertimeRecord` | Registro de horas extras | ✅ Implementado |
| `VacationRequest` | Solicitud de vacaciones | 🚧 Pendiente |
| `CashClosing` | Cierre de caja diario | 🚧 Pendiente |
| `ExpiredItem` | Registro de producto vencido retirado | 🚧 Pendiente |
| `MaintenanceTicket` | Ticket de mantenimiento | 🚧 Pendiente |
| `SalesSnapshot` | Snapshot diario de ventas por sucursal | ✅ Implementado |
| `BankBalanceSnapshot` | Snapshot diario de saldos bancarios | ✅ Implementado |
| `SyncLog` | Log de sincronización de datos externos | ✅ Implementado |
| `AuditLog` | Log de acciones críticas del sistema | ✅ Implementado |
| `SecurityEvent` | Eventos de seguridad (permisos, usuarios) | ✅ Implementado |

### Relaciones clave del dominio

```
Branch (Sucursal)
  ├── tiene muchos Employee (via EmployeeBranchAssignment)
  ├── tiene muchos AbsenceRecord
  ├── tiene muchos ActionPlan
  ├── tiene muchos CashClosing (futuro)
  ├── tiene muchos MaintenanceTicket (futuro)
  ├── tiene muchos ExpiredItem (futuro)
  └── tiene muchos SalesSnapshot / BankBalanceSnapshot

Employee (Empleado)
  ├── pertenece a una Branch principal
  ├── puede cubrir otras Branches (rotativas)
  ├── puede estar vinculado a un User (acceso al sistema)
  ├── tiene un Position (puesto operativo)
  └── hereda permisos del Position via PositionPermission

User (Usuario)
  ├── tiene un UserRole (Universo A)
  ├── puede tener flag executiveAccess
  ├── puede estar vinculado a un Employee
  └── tiene permisos operativos via Employee → Position → PositionPermission

Position (Puesto)
  └── tiene muchos PositionPermission (con scope OWN_BRANCH / ALL_BRANCHES)
```

---

## Modelo de ownership funcional

Define quién es el responsable funcional de cada área. Ante dudas de proceso o decisiones de negocio, es el interlocutor.

| Área | Responsable funcional |
|---|---|
| Cierre de caja | Oficina / Administración |
| Saldos bancarios | Administración |
| Gestión de vencidos | Auditoría |
| Ausencias y presentismo | RRHH |
| Vacaciones y licencias | RRHH |
| Mantenimiento | Supervisión |
| Planes de acción | Supervisión / RRHH |
| Horas extras | Supervisión |
| Dashboard Ejecutivo | Dirección (OWNER) |
| Ventas y comparativos | Dirección (OWNER) |
| Usuarios y permisos | Administrador técnico (ADMIN) |

---

## Convenciones globales de estados

Para garantizar consistencia en UX, colores y filtros, todos los módulos deben usar este vocabulario estándar. Cada módulo puede usar un subconjunto y agregar estados específicos, pero nunca redefinir los estándar.

| Estado | Significado universal | Color sugerido |
|---|---|---|
| `DRAFT` | Borrador editable, no enviado | Gris |
| `PENDING` | Esperando revisión o acción | Amarillo |
| `IN_PROGRESS` | En curso activo | Azul |
| `APPROVED` | Validado y aprobado | Verde |
| `REJECTED` | Rechazado con motivo | Rojo |
| `CLOSED` | Cerrado (con o sin resolución) | Gris oscuro |
| `CANCELLED` | Cancelado explícitamente | Gris |
| `STALE` | Desactualizado (dato vencido) | Naranja |

---

## Trazabilidad y auditoría

### Campos obligatorios en toda entidad crítica

| Campo | Tipo | Descripción |
|---|---|---|
| `createdAt` | DateTime | Timestamp de creación |
| `updatedAt` | DateTime | Timestamp de última modificación |
| `createdBy` | Relación User | Quién creó el registro |
| `branchId` | Relación Branch | A qué sucursal pertenece |

Entidades con flujo de aprobación agregan:

| Campo | Tipo | Descripción |
|---|---|---|
| `approvedBy` | Relación User | Quién aprobó |
| `approvedAt` | DateTime | Cuándo se aprobó |
| `rejectedBy` | Relación User | Quién rechazó |
| `rejectionReason` | Text | Motivo del rechazo |

### Acciones críticas auditables

Las siguientes acciones **siempre** deben escribir en `AuditLog` o `SecurityEvent`:

- Aprobación o rechazo de vacaciones
- Creación o cierre de plan de acción
- Modificación de cierre de caja ya aprobado
- Cancelación de un plan de acción activo
- Cambio de permisos de un puesto
- Otorgar o revocar `executiveAccess`
- Cambio de rol de usuario
- Creación o desactivación de usuario
- Validación de retiro de vencidos
- Registro de suspensión disciplinaria

### Historial de estados

Para módulos con workflow multi-estado, considerar tabla de historial de transiciones:

```
{entidad}StateHistory
  ├── entityId
  ├── fromState
  ├── toState
  ├── changedBy
  ├── changedAt
  └── note (opcional)
```

---

## Eventos del sistema

Definición de eventos clave que el sistema puede emitir. Esta arquitectura permite conectar notificaciones, WhatsApp, IA y analytics de forma desacoplada en el futuro.

| Evento | Disparador | Consumidores futuros |
|---|---|---|
| `CASH_CLOSING_SUBMITTED` | Cajera envía cierre | Notificación a encargada |
| `CASH_CLOSING_APPROVED` | Encargada aprueba | Notificación a oficina |
| `CASH_CLOSING_OBSERVED` | Cierre con diferencias | Alerta a supervisor |
| `VACATION_REQUESTED` | Se crea solicitud | Notificación a supervisor |
| `VACATION_APPROVED` | Supervisor aprueba | Notificación al solicitante |
| `VACATION_REJECTED` | Supervisor rechaza | Notificación al solicitante |
| `ABSENCE_REGISTERED` | Encargada registra ausencia | Log RRHH |
| `ABSENCE_THRESHOLD_EXCEEDED` | Empleado supera X ausencias | Sugerencia plan de acción |
| `MAINTENANCE_TICKET_CREATED` | Ticket abierto | Notificación a técnico |
| `MAINTENANCE_TICKET_URGENT` | Ticket urgente abierto | Alerta inmediata |
| `EXPIRED_ITEM_REGISTERED` | Vencido registrado | Log auditoría |
| `EXPIRED_ITEM_VALIDATED` | Encargada valida retiro | Notificación a oficina |
| `ACTION_PLAN_EXPIRING` | Plan próximo a vencer | Alerta al responsable |
| `SYNC_STALE` | Excel/CSV sin actualizar | Alerta en dashboard |
| `SYNC_ERROR` | Error en sync | Alerta técnica |

---

## Política de archivos y adjuntos

Con la incorporación de fotos en vencidos, mantenimiento y certificados médicos, el storage puede crecer rápidamente. Esta política debe aplicarse desde el primer módulo que use adjuntos.

| Aspecto | Definición |
|---|---|
| **Formatos permitidos** | Imágenes: JPG, PNG, WEBP. Documentos: PDF. Sin archivos ejecutables ni ZIP. |
| **Tamaño máximo por archivo** | 5 MB por imagen, 10 MB por PDF |
| **Compresión** | Comprimir imágenes en cliente antes del upload (target: < 1 MB) |
| **Naming** | `{entidad}-{id}-{timestamp}-{index}.{ext}` — nunca nombres de archivo del usuario |
| **Storage provider** | A definir: Vercel Blob, Cloudinary o Google Drive según volumen |
| **Retención** | A definir: ¿cuánto tiempo se conservan los adjuntos de registros cerrados? |
| **Thumbnails** | Generar thumbnail para previews en listas (evitar cargar imagen completa) |
| **PDFs derivados** | Los PDFs generados por el sistema (planes de acción, remitos) se almacenan igual que adjuntos manuales |
| **Borrado** | Los adjuntos no se borran al cancelar un registro — se desvinculan pero se conservan por auditoría |

---

## Offline y conectividad

Los encargados operan desde el piso de la farmacia con conexión móvil variable. El sistema debe ser resiliente a esto.

| Aspecto | Estrategia |
|---|---|
| **Formularios** | Guardar borrador (`DRAFT`) automáticamente. El usuario no pierde datos si pierde conexión. |
| **Uploads de fotos** | Cola de reintentos automáticos. Si falla, notificar y permitir reintentar manualmente. |
| **Acciones críticas** | Mostrar indicador de estado de conexión. Si está offline, bloquear envío con mensaje claro. |
| **Feedback visual** | Spinner / confirmación explícita en toda acción. Nunca dejar al usuario sin saber si la acción se completó. |
| **PWA** | Aprovechar service worker para cachear assets estáticos y mejorar carga en señal débil. |
| **Timeout** | Configurar timeouts razonables (10-15s) con mensaje de error accionable, no pantalla en blanco. |

---

## Política de automatizaciones

### Automatizaciones activas

| Automatización | Responsable técnico | Horario ART | Fallback |
|---|---|---|---|
| Sync ventas (DBF → Drive) | Python / Task Scheduler | 03:00 | Manual desde servidor |
| Sync trigger ventas (Drive → Neon) | Task Scheduler + GitHub Actions | 04:00 / 04:30 | GitHub Actions workflow_dispatch |
| Sync saldos (Excel → Drive) | Python / Task Scheduler | 08:45 | Técnico sube manualmente a Drive |
| Sync trigger saldos (Drive → Neon) | Task Scheduler + GitHub Actions | 08:50 / 09:00 | GitHub Actions workflow_dispatch |

### Principios de automatizaciones

- Toda automatización tiene un **fallback manual documentado**
- Toda automatización escribe en un **log verificable** (`tkl_sync.log`, `upload_saldos.log`, `SyncLog`)
- Las automatizaciones son **idempotentes**: correr dos veces no genera datos duplicados
- GitHub Actions actúa como **red de seguridad**, no como disparador principal
- El Task Scheduler del servidor Windows es el **mecanismo principal**

### Monitoreo

- Verificar `SyncLog` en Neon Console ante anomalías
- GitHub Actions: `repo → Actions → Daily Sync` para ver historial de runs
- Logs del servidor: `C:\TKL\siaf_sync\tkl_sync.log` y `upload_saldos.log`

---

## Observabilidad

### Logs operativos (negocio)

| Log | Dónde | Qué registra |
|---|---|---|
| `SyncLog` | Neon | Cada run de sync: status, filas procesadas, warnings, duración |
| `AuditLog` | Neon | Acciones críticas de usuarios |
| `SecurityEvent` | Neon | Cambios de permisos, roles, accesos |
| `AccessLog` | Neon | Accesos al Dashboard Ejecutivo |

### Logs técnicos (infraestructura)

| Log | Dónde | Qué registra |
|---|---|---|
| `tkl_sync.log` | Servidor Windows | Runs de `siaf_to_drive.py` |
| `upload_saldos.log` | Servidor Windows | Runs de `upload_saldos.py` |
| Vercel Function Logs | Vercel Dashboard | Errores de runtime en API routes |
| GitHub Actions | GitHub | Historial de runs de crons |

### Métricas a monitorear

| Métrica | Fuente | Frecuencia |
|---|---|---|
| Storage Neon | Neon Console | Mensual |
| Compute Neon | Neon Console | Mensual |
| Bandwidth Vercel | Vercel Dashboard | Mensual |
| Runs de sync exitosos vs fallidos | `SyncLog` | Diario |
| Tiempo de respuesta del dashboard | Vercel Analytics | Semanal |

---

## Estado funcional vs estado técnico de módulos

### Core Infraestructura

| Módulo | Estado funcional | Estado técnico |
|---|---|---|
| Auth + roles | ✅ En uso productivo | ✅ Backend, UI, API completos |
| Sucursales | ✅ En uso productivo | ✅ Backend, UI, API completos |
| Empleados | ✅ En uso productivo | ✅ Backend, UI, API completos |
| Puestos + permisos | ✅ En uso productivo | ✅ Backend, UI, API completos |

### Core RRHH

| Módulo | Estado funcional | Estado técnico |
|---|---|---|
| Ausencias | ✅ En uso productivo | ✅ Schema, UI y APIs completos. Faltan adjuntos de certificados y aprobación formal |
| Planes de acción | ✅ En uso productivo | ✅ Backend, UI, PDF completos |
| Horas extras | ✅ En uso productivo | ✅ Backend, UI, API completos |
| Rotativas | ✅ En uso productivo | ✅ Backend, UI, API completos |
| Vacaciones | ❌ Sin funcionalidad | 🚧 Página placeholder, sin schema final |

### Core Operativo

| Módulo | Estado funcional | Estado técnico |
|---|---|---|
| Cierre de caja | ❌ Sin funcionalidad | 🚧 No iniciado |
| Gestión de vencidos | ❌ Sin funcionalidad | 🚧 No iniciado |
| Mantenimiento | ❌ Sin funcionalidad | 🚧 Página placeholder, sin schema |

### Core Analítico

| Módulo | Estado funcional | Estado técnico |
|---|---|---|
| Dashboard Ejecutivo | ✅ En uso productivo | ✅ Backend, UI, API completos |
| Sync ventas SIAF | ✅ En uso productivo | ✅ Pipeline Python + Neon completo |
| Sync saldos bancarios | ✅ En uso productivo | ✅ Pipeline Python + Neon completo |
| Comparativos históricos | ✅ En uso productivo | ✅ Backend, UI, API completos |

---

## Sistema de roles y permisos

### Universo A — Roles de sistema

| Rol | Descripción | Acceso ejecutivo |
|---|---|---|
| `OWNER` | Dirección. Acceso total | Siempre |
| `ADMIN` | Administrador técnico. Acceso total + panel admin | Con flag |
| `SUPERVISOR` | Multi-sucursal. Acceso amplio operativo | Con flag |
| `BRANCH_MANAGER` | Encargada. Restringido a su sucursal | Con flag |
| `HR` | RRHH. Empleados, ausencias, vacaciones, rotativas | Con flag |
| `MAINTENANCE` | Solo módulo de mantenimiento | No |

### Universo B — Permisos operativos por puesto

Controla acciones granulares. Bypass automático: OWNER, ADMIN, SUPERVISOR.

| Scope | Descripción |
|---|---|
| `OWN_BRANCH` | Solo puede actuar en su propia sucursal |
| `ALL_BRANCHES` | Puede actuar en todas las sucursales |

---

## Módulos a desarrollar

---

### Módulo 1 — Cierre de caja

#### Objetivo de negocio
Digitalizar el cierre diario de caja por sucursal, reemplazando el papel y permitiendo control centralizado desde oficina. Facilitar la futura exportación a Eiffel.

#### Estado actual
100% manual en papel. Sin registro digital ni trazabilidad.

#### Usuarios involucrados

| Actor | Rol |
|---|---|
| Cajera | Carga el cierre de su caja |
| Encargada | Revisa y valida |
| Supervisora | Revisa cualquier sucursal |
| Oficina / Admin | Concilia y exporta |
| OWNER | Visualiza resumen ejecutivo |

#### Permisos necesarios

| Acción | Quién |
|---|---|
| Crear cierre de caja | Cajera (OWN_BRANCH) |
| Validar cierre | Encargado (OWN_BRANCH), SUPERVISOR (ALL_BRANCHES) |
| Ver todos los cierres | SUPERVISOR, ADMIN, OWNER |
| Exportar a Eiffel | ADMIN, OWNER |

#### Flujo propuesto
1. Cajera carga valores del día en `/cierre-caja`
2. Sistema calcula totales y diferencias
3. Encargada revisa y aprueba
4. Oficina ve consolidado multi-sucursal
5. Export CSV/Excel para Eiffel

#### Datos a capturar

| Campo | Tipo | Notas |
|---|---|---|
| Sucursal | Relación Branch | |
| Fecha de cierre | Date | |
| Efectivo declarado | Decimal | |
| Mercado Pago | Decimal | |
| Transferencias | Decimal | |
| Otros medios | Decimal | A validar con oficina |
| Total declarado | Decimal | Calculado |
| Diferencia | Decimal | vs SIAF — futura integración |
| Observaciones | Text | |
| Adjuntos | Archivos | Ticket de cierre, fotos |
| Estado | Enum | |
| createdBy / approvedBy | Relación User | |

#### Estados

| Estado | Base | Descripción |
|---|---|---|
| `DRAFT` | ✅ | En carga |
| `PENDING` | ✅ | Enviado, esperando validación |
| `APPROVED` | ✅ | Validado por encargada |
| `REJECTED` | ✅ | Observado, requiere corrección |
| `CLOSED` | ✅ | Aprobado por oficina |
| `EXPORTED` | Específico | Exportado a Eiffel |

#### Riesgos / edge cases
- Cierre con error ya aprobado → flujo de corrección con auditoría
- Sucursal sin cajera asignada → A validar
- Diferencias recurrentes en la misma cajera → reporte de auditoría
- Múltiples cajas por sucursal → A validar con dueños

#### MVP mínimo
- Carga + validación por encargada + vista consolidada para oficina
- Sin integración Eiffel en MVP

#### Fase futura
- Diferencia automática vs totales SIAF
- Export directo a Eiffel
- Alertas por diferencias sobre umbral configurable

---

### Módulo 2 — Gestión de vencidos

#### Objetivo de negocio
Trazabilidad completa desde el retiro de producto vencido hasta la nota de crédito del proveedor. Eliminar faltantes no documentados.

#### Estado actual
Manual sin registro. Sin trazabilidad, sin conciliación.

#### Permisos necesarios

| Acción | Quién |
|---|---|
| Registrar retiro | Encargado sector (OWN_BRANCH) |
| Validar retiro | Encargado sucursal (OWN_BRANCH) |
| Ver todos los retiros | Auditoría (ALL_BRANCHES), SUPERVISOR, ADMIN, OWNER |
| Gestionar notas de crédito | ADMIN |

#### Datos a capturar

| Campo | Tipo | Notas |
|---|---|---|
| Sucursal | Relación Branch | |
| Fecha de retiro | Date | |
| Producto | Text | A validar integración SIAF |
| Cantidad | Integer | |
| Proveedor | Text | A validar |
| Motivo | Enum | Vencido / Deteriorado / Retirado por proveedor |
| Adjuntos | Archivos | Foto obligatoria |
| Estado NC | Enum | |
| createdBy / approvedBy | Relación User | |

#### Estados

| Estado | Base | Descripción |
|---|---|---|
| `PENDING` | ✅ | Registrado, pendiente validación |
| `APPROVED` | ✅ | Validado por encargada |
| `CLOSED` | ✅ | NC conciliada |
| `CANCELLED` | ✅ | Error de carga |
| `REMITO_EMITIDO` | Específico | Remito enviado a proveedor |
| `NC_RECIBIDA` | Específico | NC recibida del proveedor |
| `FALTANTE` | Específico | Sin NC — requiere seguimiento |

#### Riesgos / edge cases
- NC parcial del proveedor → A validar con oficina
- Producto sin código conocido en SIAF
- Mismo producto registrado dos veces

#### MVP mínimo
- Registro con foto + validación + estado NC + vista auditoría

#### Fase futura
- Integración SIAF para autocompletar producto
- Generación automática de remito PDF
- Alertas de productos próximos a vencer

---

### Módulo 3 — Vacaciones y licencias

#### Objetivo de negocio
Digitalizar vacaciones garantizando cobertura de sucursal y respetando reglas operativas.

#### Reglas operativas confirmadas
- Múltiplos de 7 días
- Inician normalmente el lunes
- Excepciones por feriados
- Restricciones por puesto (A validar)
- No puede haber dos encargadas de vacaciones simultáneas en la misma sucursal
- Cobertura rotatoria (A validar cómo se asigna)
- **RRHH administra pero no aprueba — solo el Supervisor aprueba**

#### Estados

| Estado | Base | Descripción |
|---|---|---|
| `PENDING` | ✅ | Cargado, pendiente aprobación |
| `IN_PROGRESS` | ✅ | Empleado de vacaciones |
| `APPROVED` | ✅ | Aprobado por supervisor |
| `REJECTED` | ✅ | Rechazado con motivo |
| `CANCELLED` | ✅ | Cancelado |
| `CLOSED` | ✅ | Finalizado |

#### MVP mínimo
- Carga + validación de reglas + aprobación supervisor + balance de días

---

### Módulo 4 — Ausencias y presentismo

#### Objetivo de negocio
Registro digital de ausencias, licencias y suspensiones. Trazabilidad para RRHH ante conflictos laborales.

#### Estado actual
MVP en producción. Schema completo, dos flujos de carga (fijo y rotativo), filtros y cambio de estado funcionando. Detección automática de sucursal impactada para rotativas vía `EmployeeBranchAssignment`.

#### Tipos de ausencia (enum `AbsenceType`)

| Tipo | Label UI | Estado |
|---|---|---|
| `SICKNESS` | Enfermedad | ✅ Implementado |
| `PERSONAL_REASON` | Razón personal | ✅ Implementado |
| `NO_SHOW` | No se presentó | ✅ Implementado |
| `LATE_NOTICE` | Aviso tarde (avisó tarde) | ✅ Implementado |
| `MEDICAL_LEAVE` | Licencia médica | ✅ Implementado |
| `SPECIAL_LEAVE` | Licencia especial | ✅ Implementado |
| `SUSPENSION` | Suspensión disciplinaria | ✅ Implementado |
| `OTHER` | Otro | ✅ Implementado |

#### Estados (enum `AbsenceStatus`)

| Estado | Descripción | Implementado |
|---|---|---|
| `REPORTED` | Reportada — estado inicial | ✅ |
| `JUSTIFIED` | Justificada por RRHH/Supervisor | ✅ |
| `UNJUSTIFIED` | Injustificada | ✅ |
| `UNDER_REVIEW` | En revisión | ✅ |
| `CLOSED` | Cerrada | ✅ |

#### Gaps reales pendientes

| Gap | Detalle |
|---|---|
| **Adjuntos de certificados** | Hay `hasCertificate` (bool) y `certificateUntil` (fecha), pero no se puede subir el PDF/foto. Depende de definir storage provider. |
| **Llegada tarde como concepto distinto** | `LATE_NOTICE` significa "avisó tarde", no "llegó tarde a su turno". No hay tipo `TARDY` con hora esperada vs hora real. A confirmar si se requiere. |
| **Ingesta WhatsApp** | El campo `whatsappMessageId` existe en el schema pero no hay lógica de ingesta. |
| **Flujo de aprobación formal** | No hay `approvedBy`/`approvedAt`. El cambio de estado es libre para quien tenga `justifyAbsence`. A definir si RRHH/Supervisor requiere doble validación. |
| **Auditoría en `PATCH`** | El `POST` escribe en `AuditLog`, pero los cambios de estado vía `PATCH` no se registran. Inconsistencia con principio de "todo proceso es auditable". |
| **Historial de transiciones** | No existe tabla `AbsenceStateHistory`. Solo se ve el estado actual. |
| **Vinculación con planes de acción** | El evento `ABSENCE_THRESHOLD_EXCEEDED` está en el roadmap pero no implementado. |

#### Próximos pasos sugeridos
- Auditar `PATCH` (cierre rápido del gap de auditoría).
- Definir storage provider y agregar adjuntos de certificados.
- Decidir si se requiere flujo de aprobación con doble validación.
- Implementar detección de umbral de ausencias para sugerir plan de acción.

---

### Módulo 5 — Mantenimiento

#### Objetivo de negocio
Reemplazar WhatsApp con tickets formales que permitan seguimiento, responsabilidad y control de costos.

#### Estado actual
100% por WhatsApp. Sin registro ni historial.

#### Permisos necesarios

| Acción | Quién |
|---|---|
| Abrir ticket | BRANCH_MANAGER (OWN_BRANCH), SUPERVISOR |
| Gestionar y cerrar | MAINTENANCE |
| Ver todos los tickets | MAINTENANCE, SUPERVISOR, ADMIN, OWNER |
| Priorizar / escalar | SUPERVISOR, ADMIN |

#### Estados

| Estado | Base | Descripción |
|---|---|---|
| `PENDING` | ✅ | Abierto, sin asignar |
| `IN_PROGRESS` | ✅ | Trabajo en curso |
| `APPROVED` | ✅ | Resuelto y verificado |
| `CLOSED` | ✅ | Cerrado |
| `CANCELLED` | ✅ | Cancelado |
| `WAITING` | Específico | Esperando materiales |

#### MVP mínimo
- Apertura con foto + gestión por técnico + vista por sucursal
- Sin costos en MVP

---

### Módulo 6 — Planes de acción

**Estado: en producción ✅**

CRUD completo, 4 templates, 5 estados, generación de PDF.

**Pendientes:** vinculación automática con ausencias, notificaciones de vencimiento, métricas de efectividad.

---

## Futuras integraciones

### Eiffel
Export de cierre de caja. Formato A validar con oficina. Requiere módulo de Cierre completo.

### WhatsApp Business API
Canal de notificación y captura operativa. Todo mensaje recibido debe transformarse en un registro formal en la plataforma antes de considerarse válido. No es fuente de verdad.

### Google Drive API
Ya integrada. Extensiones posibles: PDFs de planes de acción, remitos de vencidos, cierres de caja.

### SIAF
Integración de lectura en producción. Extensión posible: cruce con cierre de caja para diferencias automáticas.

### OCR
Digitalizar certificados médicos, remitos y comprobantes físicos. No priorizado — evaluar cuando el volumen justifique el costo.

### IA / Claude API
Chat en lenguaje natural sobre datos ejecutivos, detección de anomalías, resúmenes automáticos semanales.

```
Dashboard → Botón flotante → /api/ai/query → Consulta Neon → Claude API → Respuesta
```

---

## Decisiones arquitectónicas (ADRs)

| Decisión | Motivo | Fecha |
|---|---|---|
| **GitHub Actions solo como respaldo** | Delays impredecibles de hasta 5 horas. Task Scheduler es el disparador principal. | Mayo 2026 |
| **Drive Desktop descartado** | Sync inconsistente, se cerraba solo. Reemplazado por API directa con Service Account. | Abril 2026 |
| **Neon como base de datos** | Serverless, compatible con Vercel, branching de DB para previews. | Abril 2026 |
| **Dos universos de permisos (A/B)** | Separar acceso a módulos (macro) de acciones granulares (operativo). Coexisten durante migración módulo a módulo. | Abril 2026 |
| **`db push` sin migrations formales** | Schema en flujo activo. Migrations añaden overhead que no compensa. Revisar cuando el schema estabilice. | Abril 2026 |
| **JWT sin database sessions** | Cero latencia DB en auth. Limitación: revocar sesiones requiere cambiar `AUTH_SECRET`. | Abril 2026 |
| **Un solo proyecto Vercel, dos hosts** | Operativa y ejecutivo comparten auth, DB y componentes. Dos proyectos duplicarían env vars y deploys. | Abril 2026 |
| **Drive como buffer intermedio** | SIAF no está expuesto a internet. Drive desacopla el servidor interno de Vercel. | Abril 2026 |
| **Idempotencia por `modifiedTime`** | Permite reprocesar si el admin corrige el archivo. Idempotencia por fecha de procesamiento perdería correcciones. | Abril 2026 |
| **Simplicidad sobre microservicios** | Velocidad de desarrollo y operación real. Escalar cuando el problema lo justifique, no antes. | Abril 2026 |

---

## Riesgos técnicos futuros

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Crecimiento desordenado del catálogo de permisos | Alta | Medio | Documentar permisos por módulo antes de implementar. Revisar trimestralmente. |
| Lógica de permisos hardcodeada en frontend | Media | Alto | Code reviews. Todo chequeo crítico en servidor. |
| Saturación de tablas de auditoría | Media | Bajo | Política de retención. Archivar logs > 12 meses. |
| Exceso de bypass de SUPERVISOR | Media | Medio | Considerar migrar SUPERVISOR a permisos finos en Fase 5. |
| Conflictos de concurrencia en sync | Baja | Alto | Idempotencia por `modifiedTime` mitiga. Monitorear con `SyncLog`. |
| Uploads pesados en mobile | Alta | Medio | Comprimir imágenes en cliente. Límite de tamaño por adjunto. |
| Schema sin migrations formales | Media | Alto | Cuando el schema estabilice, migrar a `prisma migrate`. Documentar cada `db push` en CHANGELOG. |
| Dependencia de un solo técnico para el servidor físico | Alta | Alto | Documentar Task Scheduler. Dejar instrucciones escritas. |
| Neon idle wakeup en primer acceso | Alta | Bajo | Comportamiento esperado. Monitorear si impacta UX en producción. |

---

## Escalabilidad futura

La arquitectura actual prioriza **velocidad de desarrollo y simplicidad operativa** sobre complejidad distribuida. Esto es correcto para la etapa actual.

Las siguientes dimensiones de escala están contempladas en el diseño pero no implementadas:

| Dimensión | Estado actual | Camino futuro |
|---|---|---|
| Más sucursales | 12 sucursales, modelo multi-branch ya implementado | Sin cambios de arquitectura necesarios |
| Más usuarios concurrentes | Vercel serverless + Neon pooler | Upgrade plan Neon si supera límites |
| Más módulos | Arquitectura desacoplada permite agregar sin romper | Mantener principio de desacoplamiento |
| Más adjuntos / storage | Sin storage dedicado aún | Implementar Vercel Blob o Cloudinary antes de módulos con fotos |
| Más logs / audit | Tablas crecen linealmente | Política de retención + archivado |
| Automatizaciones más complejas | Scripts Python síncronos | Evaluar workers / queues si el volumen lo requiere |
| APIs externas (Eiffel, WhatsApp) | No implementadas | Diseñar como adapters desacoplados del core |
| Notificaciones en tiempo real | No implementadas | Evaluar Server-Sent Events o WebSockets cuando haya casos de uso claros |

---

## Roadmap tentativo de implementación

### Fase 4 — Core Operativo I (próxima)
**Objetivo:** digitalizar los dos procesos diarios más críticos.
- Cierre de caja (MVP)
- Ausencias y presentismo (completar módulo existente)

### Fase 5 — Core Operativo II
**Objetivo:** completar la gestión de personal y mantenimiento.
- Vacaciones y licencias
- Mantenimiento (MVP)

### Fase 6 — Integraciones y trazabilidad completa
**Objetivo:** conectar con sistemas externos y cerrar loops de auditoría.
- Gestión de vencidos
- Integración Eiffel (export cierre de caja)
- Notificaciones WhatsApp

### Fase 7 — IA y analítica avanzada
**Objetivo:** inteligencia sobre los datos operativos acumulados.
- Chat IA en Dashboard Ejecutivo
- Detección automática de anomalías
- OCR para adjuntos
- Resúmenes ejecutivos automáticos

---

## Dependencias entre módulos

```
Core Infraestructura (✅ completo)
  ├── Sucursales
  ├── Empleados
  └── Permisos por puesto
      ↓ habilita todo lo demás

Ausencias (completar)
  └── requisito previo para → Vacaciones
  └── vinculación con → Planes de acción ✅

Vacaciones
  └── depende de → Ausencias completo

Cierre de caja
  └── habilita → Integración Eiffel

Gestión de vencidos
  └── habilita → Integración stock SIAF (futuro)

Mantenimiento
  └── independiente del resto
  └── habilita → Notificaciones WhatsApp

IA / Analytics
  └── depende de → todos los módulos con datos históricos
```

---

## Definición de DONE

Un módulo se considera **completo** cuando cumple todos los siguientes criterios. Esto evita el síndrome de "está hecho... pero no realmente".

| Criterio | Descripción |
|---|---|
| ✅ Schema final | Entidades y relaciones implementadas en Prisma, `db push` aplicado en producción |
| ✅ UI responsive | Funciona correctamente en mobile y desktop |
| ✅ Permisos server-side | Todo chequeo de autorización validado en el servidor, nunca solo en el frontend |
| ✅ Auditoría | Acciones críticas escriben en `AuditLog` o `SecurityEvent` |
| ✅ Estados completos | Todos los estados del flujo implementados con transiciones correctas |
| ✅ Manejo de errores | Errores de API con mensajes claros, sin pantallas en blanco |
| ✅ Logs | Acciones relevantes loggueadas y verificables |
| ✅ Documentación actualizada | Este documento y los archivos de `docs/` reflejan el estado real |
| ✅ CHANGELOG actualizado | El cambio está registrado en `CHANGELOG.md` |

---

## Entidades sensibles

Las siguientes entidades requieren tratamiento especial: auditoría obligatoria, acceso restringido y no se borran bajo ninguna circunstancia.

| Entidad | Por qué es sensible |
|---|---|
| `User` | Acceso al sistema, credenciales, roles |
| `Permission` / `PositionPermission` | Define qué puede hacer cada actor |
| `CashClosing` | Datos financieros diarios |
| `VacationRequest` | Derechos laborales |
| `ActionPlan` | Historial disciplinario |
| `AuditLog` | Trazabilidad del sistema — nunca borrar |
| `SecurityEvent` | Eventos de seguridad — nunca borrar |
| `BankBalanceSnapshot` | Datos financieros sensibles |

**Regla universal:** ninguna de estas entidades se borra físicamente. Se desactivan, cancelan o archivan. El historial es permanente.

---

## Entidades de alto crecimiento

Útil para planificación de índices, retención y archivado.

| Entidad | Crecimiento esperado | Estrategia |
|---|---|---|
| `SyncLog` | Alto — 4+ rows/día indefinidamente | Política de retención: archivar > 12 meses |
| `AuditLog` | Alto — crece con cada acción crítica | Política de retención: archivar > 12 meses |
| `SalesSnapshot` | Alto — 11 rows/día indefinidamente | Índices por `snapshotDate` y `branchId` |
| `BankBalanceSnapshot` | Medio — 1 row/sucursal/día | Manejable en Free tier por años |
| Adjuntos (fotos, PDFs) | Muy alto — fotos de vencidos, mantenimiento, certificados | Definir storage provider antes de lanzar módulos con adjuntos |
| `AbsenceRecord` | Medio | Crece con el tiempo, manejable |
| `ActionPlan` | Bajo-medio | Crece lentamente, manejable |

---

## CHANGELOG arquitectónico

Registro de cambios relevantes en infraestructura, arquitectura y decisiones técnicas importantes. Complementa el `CHANGELOG.md` de commits.

| Fecha | Cambio | Impacto |
|---|---|---|
| Mayo 2026 | Task Scheduler reemplaza GitHub Actions como disparador principal de sync | Mejora confiabilidad horaria. GitHub Actions queda como respaldo. |
| Mayo 2026 | `SYNC_WEBHOOK_SECRET` rotado | Seguridad. Actualizar en Vercel y GitHub Actions en simultáneo. |
| Mayo 2026 | Lógica stale de saldos cambiada: sin gracia de "ayer es OK" | Saldos ahora requieren datos de hoy. Banner aparece fines de semana. |
| Mayo 2026 | Eliminadas leyendas redundantes de fechas en Dashboard Ejecutivo | UX más limpia. `lastBalanceDate` / `lastSalesDate` siguen en el contrato de datos. |
| Abril 2026 | Sistema de permisos Universo B implementado (Fase 3) | Permisos granulares por puesto disponibles para nuevos módulos. |
| Abril 2026 | Dashboard Ejecutivo en producción | KPIs, saldos, ventas, comparativos operativos. |
| Abril 2026 | Pipeline SIAF completo (DBF → CSV → Drive → Neon) | Ventas diarias automatizadas de 11 sucursales. |
| Abril 2026 | Drive Desktop descartado, reemplazado por API con Service Account | Elimina dependencia de cliente de escritorio. |

---

## Preguntas pendientes

### Para Daniel (técnico / desarrollador)

- ¿Hay algún esquema previo de `VacationRequest` en Prisma?
- ¿Hay un storage provider definido para adjuntos o está pendiente de decisión? (bloquea certificados médicos, fotos de vencidos y mantenimiento)
- ¿Se quiere instrumentar `AuditLog` en el `PATCH` de ausencias para cerrar el gap de trazabilidad de cambios de estado?
- ¿Se requiere un tipo `TARDY` (llegada tarde al turno con hora real vs esperada) distinto del actual `LATE_NOTICE` (avisó tarde)?

### Para los dueños (OWNER)

- ¿Cuántas cajas tiene cada sucursal? ¿Hay sucursales con múltiples cajas?
- ¿Qué umbral de diferencia en el cierre de caja es aceptable antes de alertar?
- ¿El técnico de mantenimiento es empleado de la cadena o externo?
- ¿Se quiere control de costos de mantenimiento desde el inicio o es fase futura?
- ¿Las notificaciones por WhatsApp son prioridad o deseable a futuro?
- ¿Los empleados tendrán acceso al sistema para ver su propio historial?

### Para oficina / administración

- ¿Qué formato exacto requiere Eiffel para importar datos de cierre de caja?
- ¿Cómo se gestiona actualmente la conciliación de notas de crédito de vencidos?
- ¿Qué información de vencidos necesita oficina para gestionar la NC?

### Para RRHH

- ¿Cuál es el umbral de ausencias injustificadas que dispara una sanción?
- ¿Los empleados tienen acceso a ver su propio historial de ausencias?
- ¿Cómo se maneja actualmente el balance de días de vacaciones?
- ¿Qué tipos de licencia existen además de vacaciones ordinarias?
- ¿Qué puestos tienen restricciones para tomar vacaciones simultáneamente?

### Para encargadas

- ¿Cómo se registra actualmente una llegada tarde? ¿Quién lo reporta?
- ¿El retiro de vencidos lo hace siempre la encargada del sector o cualquier empleado?
- ¿Qué categorías de problemas de mantenimiento son las más frecuentes?
