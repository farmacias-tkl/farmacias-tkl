-- Gate · Asistencia: ausencias con deuda y compensación por persona · 2026-11-13
--
-- APLICADO en producción el 2026-11-13, con branch de respaldo en Neon
-- (respaldo-pre-asistencia-13-11) y verificación previa y posterior, antes de
-- subir el código.
--
-- Generado sin conexión a ninguna base con:
--   npx prisma migrate diff \
--     --from-schema-datamodel <schema.prisma de e1cbcde> \
--     --to-schema-datamodel prisma/schema.prisma --script
--
-- Solo aditivo. No borra, no renombra, no cambia tipos y no reescribe ninguna
-- fila existente:
--
--   TimeEventType:  valor nuevo ABSENCE (deuda de horas de una ausencia).
--   TimeEvent:      absenceRecordId, nullable, UNIQUE, FK a AbsenceRecord
--                   (ON DELETE SET NULL). Los registros que ya existen quedan
--                   con NULL.
--   TimeEventCompensation: batchId, nullable, con índice. Agrupa las filas de
--                   una compensación cargada "por persona" y repartida entre
--                   varias deudas. Las compensaciones que ya existen quedan
--                   con NULL.
--
-- No toca usuarios, contraseñas, ventas, coseguros, saldos bancarios ni las
-- tablas de Call Center.
--
-- Orden: aplicar ANTES de desplegar el código (el código lee las dos columnas
-- nuevas).
--
-- La migración de datos (pasar a ausencia los 2 registros cargados como
-- llegada tarde con la nota "Ausencia del día completo") NO está en este
-- archivo: se corre aparte, después del gate, con su reporte de antes y después.
--
-- Vuelta atrás (ya sin el código desplegado, y sin registros de tipo ABSENCE):
--   ALTER TABLE "TimeEvent" DROP COLUMN "absenceRecordId";
--   ALTER TABLE "TimeEventCompensation" DROP COLUMN "batchId";
--   (un valor de enum no se puede quitar en Postgres; ABSENCE queda sin uso)

BEGIN;

-- AlterEnum
ALTER TYPE "TimeEventType" ADD VALUE 'ABSENCE';

-- AlterTable
ALTER TABLE "TimeEvent" ADD COLUMN     "absenceRecordId" TEXT;

-- AlterTable
ALTER TABLE "TimeEventCompensation" ADD COLUMN     "batchId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TimeEvent_absenceRecordId_key" ON "TimeEvent"("absenceRecordId");

-- CreateIndex
CREATE INDEX "TimeEventCompensation_batchId_idx" ON "TimeEventCompensation"("batchId");

-- AddForeignKey
ALTER TABLE "TimeEvent" ADD CONSTRAINT "TimeEvent_absenceRecordId_fkey" FOREIGN KEY ("absenceRecordId") REFERENCES "AbsenceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
