-- Migración de datos · Ausencias cargadas como llegada tarde · 2026-11-13
--
-- PREPARADA, NO APLICADA. Va DESPUÉS de
-- 2026-11-13-asistencia-ausencias-y-compensacion.sql (necesita el tipo ABSENCE
-- y la columna TimeEvent.absenceRecordId), con branch de respaldo y reporte de
-- antes y después.
--
-- Qué registros toca: los TimeEvent cargados desde el mail de RRHH (id que
-- empieza con "temail") que en realidad son ausencias de día completo: se
-- cargaron como LATE_ARRIVAL con los minutos del turno y la nota "Ausencia del
-- día completo". Se reconocen por esa nota. En producción son 2.
--
-- Qué hace con cada uno:
--   1. Registra la ausencia en Ausencias (AbsenceRecord) con su fecha, la misma
--      persona y sucursal, y los mismos nombres congelados. Tipo OTHER y estado
--      REPORTED: el mail no dice si fue con aviso ni si está justificada, eso
--      lo define supervisión desde la pestaña Ausencias.
--   2. Pasa el TimeEvent a tipo ABSENCE y lo vincula a esa ausencia. Conserva
--      la deuda tal cual: mismos minutos, mismo estado, mismas notas.
--   3. Deja constancia en AuditLog, a nombre de quien había cargado el registro.
--
-- No borra nada. Es idempotente: una segunda corrida no encuentra registros
-- (ya no son LATE_ARRIVAL) y no escribe nada.
--
-- El id de la ausencia se deriva del id del registro ("absmail" + lo que sigue
-- a "temail"), así la relación queda trazable sin guardar nada más.

BEGIN;

INSERT INTO "AbsenceRecord" (
  "id", "employeeId", "branchId",
  "employeeNameSnapshot", "branchNameSnapshot", "positionNameSnapshot",
  "reportedByUserId", "startDate", "endDate", "absenceType", "status",
  "notes", "createdAt", "updatedAt"
)
SELECT
  'absmail' || substr(te."id", 7), te."employeeId", te."branchId",
  te."employeeNameSnapshot", te."branchNameSnapshot", te."positionNameSnapshot",
  te."reportedByUserId", te."date"::timestamp, te."date"::timestamp, 'OTHER', 'REPORTED',
  'Ausencia de día completo informada por mail de RRHH. Se había cargado en Asistencia como llegada tarde y sus horas adeudadas siguen ahí. Falta definir tipo y si está justificada.',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TimeEvent" te
WHERE te."id" LIKE 'temail%'
  AND te."type" = 'LATE_ARRIVAL'
  AND te."reporterNote" LIKE '%Ausencia del día completo%';

INSERT INTO "AuditLog" ("id", "userId", "action", "entity", "entityId", "detail", "createdAt")
SELECT
  'audmig' || substr(te."id", 7), te."reportedByUserId", 'TIME_EVENT_MIGRATED_TO_ABSENCE', 'TimeEvent', te."id",
  jsonb_build_object(
    'migration', '2026-11-13-asistencia-migracion-ausencias',
    'fromType', 'LATE_ARRIVAL', 'toType', 'ABSENCE',
    'absenceRecordId', 'absmail' || substr(te."id", 7),
    'date', to_char(te."date", 'YYYY-MM-DD'),
    'minutesOwed', te."minutesOwed", 'status', te."status"
  ),
  CURRENT_TIMESTAMP
FROM "TimeEvent" te
WHERE te."id" LIKE 'temail%'
  AND te."type" = 'LATE_ARRIVAL'
  AND te."reporterNote" LIKE '%Ausencia del día completo%';

UPDATE "TimeEvent"
SET "type" = 'ABSENCE',
    "absenceRecordId" = 'absmail' || substr("id", 7),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" LIKE 'temail%'
  AND "type" = 'LATE_ARRIVAL'
  AND "reporterNote" LIKE '%Ausencia del día completo%';

COMMIT;
