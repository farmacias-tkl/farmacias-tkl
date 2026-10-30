-- Gate · Personal real: empleados, horarios, saldo de vacaciones y cobertura · 2026-10-29
--
-- PREPARADO, NO APLICADO. Se aplica solo por gate (respaldo de Neon, host-check,
-- dry-run con `prisma migrate diff`, scan destructivo, OK explícito de Daniel).
--
-- Generado sin conexión a ninguna base con:
--   npx prisma migrate diff \
--     --from-schema-datamodel <schema.prisma de 5c2ba5b> \
--     --to-schema-datamodel prisma/schema.prisma --script
--
-- PARTE 1 (esquema) es solo aditiva: 2 enums nuevos, 1 valor de enum, columnas
-- nullable o con DEFAULT en tablas existentes, 4 tablas nuevas, índices y FKs.
-- No borra, no renombra, no cambia tipos y no reescribe filas existentes
-- (las columnas NOT NULL nuevas traen DEFAULT false).
--
--   Enums:      ScheduleWeek (ALL/A/B), VacationBalanceMovementType
--               (LOAD/LOAD_ADJUST/CONSUME/REFUND); AbsenceType + MATERNITY_LEAVE.
--   Branch:     zone (CABA / PROVINCIA; rotativos solo en CABA; null = sin zona, no se cubre).
--   Employee:   contractBranchId (sucursal de contrato, FK Branch, SET NULL),
--               secondaryPositionId (FK Position, SET NULL), isTechnicalDirector,
--               weeklyHours DECIMAL(4,1), extraTasks, nameKey; UNIQUE
--               (nameKey, contractBranchId) = clave de la carga (los NULL de los
--               empleados actuales no chocan entre sí en PostgreSQL).
--   EmployeeBranchAssignment: vacationRequestId (cobertura vinculada a una
--               solicitud, FK SET NULL) y coverageSlots JSONB (tramos a cubrir).
--   VacationRequest: approvedWithWarnings, approvalWarnings JSONB, withoutCoverage.
--   WorkSchedule / WorkScheduleSlot: horario con vigencia (UNIQUE empleado +
--               validFrom) y tramos (UNIQUE horario + semana + día + tramo).
--   VacationBalance (UNIQUE empleado + año) / VacationBalanceMovement.
--
-- PARTE 2 (datos) es aparte: carga Branch.code y Branch.zone (CABA / PROVINCIA)
-- de las 11 sucursales operativas por su nombre REAL en la base ("Central San
-- Miguel" = "San Miguel"). Solo toca filas con code/zone NULL; "Call Center",
-- "Patricios" y "Condominio ET" no cambian. Requiere la parte 1 (columna zone).
--
-- Orden: aplicar ANTES de desplegar el código de esta rama (el código lee las
-- columnas nuevas). Después: scripts/load-personal.ts y
-- scripts/clean-operational-demo-data.ts, cada uno con su dry-run primero.

-- =============================================================================
-- PARTE 1 · Esquema (salida de prisma migrate diff, sin cambios)
-- =============================================================================

-- CreateEnum
CREATE TYPE "ScheduleWeek" AS ENUM ('ALL', 'A', 'B');

-- CreateEnum
CREATE TYPE "VacationBalanceMovementType" AS ENUM ('LOAD', 'LOAD_ADJUST', 'CONSUME', 'REFUND');

-- AlterEnum
ALTER TYPE "AbsenceType" ADD VALUE 'MATERNITY_LEAVE';

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "zone" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "contractBranchId" TEXT,
ADD COLUMN     "extraTasks" TEXT,
ADD COLUMN     "isTechnicalDirector" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nameKey" TEXT,
ADD COLUMN     "secondaryPositionId" TEXT,
ADD COLUMN     "weeklyHours" DECIMAL(4,1);

-- AlterTable
ALTER TABLE "EmployeeBranchAssignment" ADD COLUMN     "coverageSlots" JSONB,
ADD COLUMN     "vacationRequestId" TEXT;

-- AlterTable
ALTER TABLE "VacationRequest" ADD COLUMN     "approvalWarnings" JSONB,
ADD COLUMN     "approvedWithWarnings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "withoutCoverage" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "abReferenceDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkScheduleSlot" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "week" "ScheduleWeek" NOT NULL DEFAULT 'ALL',
    "dayOfWeek" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "branchId" TEXT,
    "otherPlace" TEXT,

    CONSTRAINT "WorkScheduleSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacationBalance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VacationBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacationBalanceMovement" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "type" "VacationBalanceMovementType" NOT NULL,
    "vacationRequestId" TEXT,
    "userId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VacationBalanceMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkSchedule_employeeId_validFrom_key" ON "WorkSchedule"("employeeId", "validFrom");

-- CreateIndex
CREATE INDEX "WorkScheduleSlot_branchId_idx" ON "WorkScheduleSlot"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkScheduleSlot_scheduleId_week_dayOfWeek_slot_key" ON "WorkScheduleSlot"("scheduleId", "week", "dayOfWeek", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "VacationBalance_employeeId_year_key" ON "VacationBalance"("employeeId", "year");

-- CreateIndex
CREATE INDEX "VacationBalanceMovement_employeeId_year_idx" ON "VacationBalanceMovement"("employeeId", "year");

-- CreateIndex
CREATE INDEX "VacationBalanceMovement_vacationRequestId_idx" ON "VacationBalanceMovement"("vacationRequestId");

-- CreateIndex
CREATE INDEX "Employee_contractBranchId_idx" ON "Employee"("contractBranchId");

-- CreateIndex
CREATE INDEX "Employee_secondaryPositionId_idx" ON "Employee"("secondaryPositionId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_nameKey_contractBranchId_key" ON "Employee"("nameKey", "contractBranchId");

-- CreateIndex
CREATE INDEX "EmployeeBranchAssignment_vacationRequestId_idx" ON "EmployeeBranchAssignment"("vacationRequestId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_secondaryPositionId_fkey" FOREIGN KEY ("secondaryPositionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_contractBranchId_fkey" FOREIGN KEY ("contractBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleSlot" ADD CONSTRAINT "WorkScheduleSlot_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleSlot" ADD CONSTRAINT "WorkScheduleSlot_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacationBalance" ADD CONSTRAINT "VacationBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacationBalanceMovement" ADD CONSTRAINT "VacationBalanceMovement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacationBalanceMovement" ADD CONSTRAINT "VacationBalanceMovement_vacationRequestId_fkey" FOREIGN KEY ("vacationRequestId") REFERENCES "VacationRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeBranchAssignment" ADD CONSTRAINT "EmployeeBranchAssignment_vacationRequestId_fkey" FOREIGN KEY ("vacationRequestId") REFERENCES "VacationRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================================
-- PARTE 2 · Datos: códigos (Branch.code) y zonas (Branch.zone) de sucursal
-- Antes de correrla, verificar que los 11 nombres existen y tienen code y zone NULL:
--   SELECT name, code, zone FROM "Branch" WHERE name IN ('America','Facultad',
--     'San Miguel','Etcheverry','Galesa','Larcade','La Perla','Naveira',
--     'Quintana','San Agustin','Tekiel') ORDER BY name;
-- Cada UPDATE de código tiene que afectar 1 fila; el de CABA 8 y el de PROVINCIA 3.
-- =============================================================================

UPDATE "Branch" SET "code" = 'AME' WHERE "name" = 'America'     AND "code" IS NULL;
UPDATE "Branch" SET "code" = 'AYA' WHERE "name" = 'Facultad'    AND "code" IS NULL;
UPDATE "Branch" SET "code" = 'CSM' WHERE "name" = 'San Miguel'  AND "code" IS NULL;
UPDATE "Branch" SET "code" = 'ETC' WHERE "name" = 'Etcheverry'  AND "code" IS NULL;
UPDATE "Branch" SET "code" = 'GAL' WHERE "name" = 'Galesa'      AND "code" IS NULL;
UPDATE "Branch" SET "code" = 'LAR' WHERE "name" = 'Larcade'     AND "code" IS NULL;
UPDATE "Branch" SET "code" = 'MUN' WHERE "name" = 'La Perla'    AND "code" IS NULL;
UPDATE "Branch" SET "code" = 'NAV' WHERE "name" = 'Naveira'     AND "code" IS NULL;
UPDATE "Branch" SET "code" = 'QUI' WHERE "name" = 'Quintana'    AND "code" IS NULL;
UPDATE "Branch" SET "code" = 'SAG' WHERE "name" = 'San Agustin' AND "code" IS NULL;
UPDATE "Branch" SET "code" = 'TEK' WHERE "name" = 'Tekiel'      AND "code" IS NULL;

-- Zona de cada sucursal. La cobertura con rotativos aplica solo a CABA: en
-- PROVINCIA (y en sucursales sin zona: Call Center, Patricios, Condominio ET)
-- no se proponen rotativos, no sale la advertencia "sin rotativo libre" y la
-- solicitud no queda "sin cobertura".
UPDATE "Branch" SET "zone" = 'CABA'
 WHERE "name" IN ('America','Facultad','Etcheverry','Galesa','Naveira','Quintana','San Agustin','Tekiel')
   AND "zone" IS NULL;
UPDATE "Branch" SET "zone" = 'PROVINCIA'
 WHERE "name" IN ('La Perla','San Miguel','Larcade')
   AND "zone" IS NULL;

-- Vuelta atrás (no ejecutar salvo decisión explícita, y antes revertir el código):
--   UPDATE "Branch" SET "code" = NULL WHERE "code" IN ('AME','AYA','CSM','ETC','GAL','LAR','MUN','NAV','QUI','SAG','TEK');
--   UPDATE "Branch" SET "zone" = NULL WHERE "zone" IN ('CABA','PROVINCIA');
--   DROP TABLE "VacationBalanceMovement"; DROP TABLE "VacationBalance";
--   DROP TABLE "WorkScheduleSlot"; DROP TABLE "WorkSchedule";
--   ALTER TABLE "VacationRequest" DROP COLUMN "approvalWarnings", DROP COLUMN "approvedWithWarnings", DROP COLUMN "withoutCoverage";
--   ALTER TABLE "EmployeeBranchAssignment" DROP COLUMN "vacationRequestId", DROP COLUMN "coverageSlots";
--   ALTER TABLE "Employee" DROP COLUMN "contractBranchId", DROP COLUMN "secondaryPositionId",
--     DROP COLUMN "isTechnicalDirector", DROP COLUMN "weeklyHours", DROP COLUMN "extraTasks", DROP COLUMN "nameKey";
--   ALTER TABLE "Branch" DROP COLUMN "zone";
--   DROP TYPE "VacationBalanceMovementType"; DROP TYPE "ScheduleWeek";
-- El valor 'MATERNITY_LEAVE' de AbsenceType no se puede quitar con ALTER TYPE;
-- si queda sin uso no afecta a nada.
