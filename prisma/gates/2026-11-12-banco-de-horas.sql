-- Gate · Banco de horas y días compensatorios · 2026-11-12
--
-- APLICADO en producción el 2026-11-12, con el OK de Daniel. Branch de respaldo
-- en Neon creada justo antes: respaldo-pre-banco-horas-12-11. Verificado después:
-- 3 enums, 2 tablas vacías, la columna nullable, 9 índices y 8 FK. No volver a
-- correrlo sobre producción (los CREATE fallarían: ya existe todo).
--
-- Generado sin conexión a ninguna base con:
--   npx prisma migrate diff \
--     --from-schema-datamodel <schema.prisma de acc42ac> \
--     --to-schema-datamodel prisma/schema.prisma --script
--
-- Solo aditivo. No borra, no renombra, no cambia tipos y no reescribe ninguna
-- fila existente:
--
--   Enums nuevos:   OvertimeDestination (PAY / BANK), HourBankRequestStatus
--                   (PENDING / APPROVED / REJECTED / CANCELLED),
--                   HourBankMovementType (INITIAL / OVERTIME / COMPENSATION /
--                   TAKEN / TAKEN_REVERSAL / ADJUST).
--   OvertimeRecord: destination, nullable y sin default. Las horas extra que ya
--                   existen quedan con destino NULL ("sin decidir"): ninguna
--                   suma al banco por aplicar el gate.
--   HourBankRequest:  tabla nueva (día o franja pedida contra el banco).
--   HourBankMovement: tabla nueva (movimientos; el saldo es su suma). UNIQUE
--                   en overtimeRecordId: una hora extra suma una sola vez.
--
-- No toca usuarios, contraseñas, ventas, coseguros, saldos bancarios ni las
-- tablas de Call Center. Las FK nuevas apuntan a Employee, Branch, User y
-- OvertimeRecord, sin modificar esas tablas (salvo la columna de OvertimeRecord).
--
-- Orden: aplicar ANTES de desplegar el código de la rama feat/banco-horas (el
-- código lee OvertimeRecord.destination y las tablas nuevas).
--
-- Vuelta atrás (ya sin el código desplegado; borra lo cargado en el banco):
--   DROP TABLE "HourBankMovement"; DROP TABLE "HourBankRequest";
--   ALTER TABLE "OvertimeRecord" DROP COLUMN "destination";
--   DROP TYPE "HourBankMovementType"; DROP TYPE "HourBankRequestStatus";
--   DROP TYPE "OvertimeDestination";

BEGIN;

-- CreateEnum
CREATE TYPE "OvertimeDestination" AS ENUM ('PAY', 'BANK');

-- CreateEnum
CREATE TYPE "HourBankRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HourBankMovementType" AS ENUM ('INITIAL', 'OVERTIME', 'COMPENSATION', 'TAKEN', 'TAKEN_REVERSAL', 'ADJUST');

-- AlterTable
ALTER TABLE "OvertimeRecord" ADD COLUMN     "destination" "OvertimeDestination";

-- CreateTable
CREATE TABLE "HourBankRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "employeeNameSnapshot" TEXT NOT NULL,
    "branchNameSnapshot" TEXT NOT NULL,
    "positionNameSnapshot" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "hours" DECIMAL(6,2) NOT NULL,
    "scheduleHours" DECIMAL(6,2),
    "status" "HourBankRequestStatus" NOT NULL DEFAULT 'PENDING',
    "coveredByEmployeeId" TEXT,
    "coverageNote" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "requesterNote" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HourBankRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HourBankMovement" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "hours" DECIMAL(7,2) NOT NULL,
    "type" "HourBankMovementType" NOT NULL,
    "overtimeRecordId" TEXT,
    "hourBankRequestId" TEXT,
    "userId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HourBankMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HourBankRequest_employeeId_idx" ON "HourBankRequest"("employeeId");

-- CreateIndex
CREATE INDEX "HourBankRequest_branchId_idx" ON "HourBankRequest"("branchId");

-- CreateIndex
CREATE INDEX "HourBankRequest_status_idx" ON "HourBankRequest"("status");

-- CreateIndex
CREATE INDEX "HourBankRequest_startDate_endDate_idx" ON "HourBankRequest"("startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "HourBankMovement_overtimeRecordId_key" ON "HourBankMovement"("overtimeRecordId");

-- CreateIndex
CREATE INDEX "HourBankMovement_employeeId_createdAt_idx" ON "HourBankMovement"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "HourBankMovement_hourBankRequestId_idx" ON "HourBankMovement"("hourBankRequestId");

-- AddForeignKey
ALTER TABLE "HourBankRequest" ADD CONSTRAINT "HourBankRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourBankRequest" ADD CONSTRAINT "HourBankRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourBankRequest" ADD CONSTRAINT "HourBankRequest_coveredByEmployeeId_fkey" FOREIGN KEY ("coveredByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourBankRequest" ADD CONSTRAINT "HourBankRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourBankRequest" ADD CONSTRAINT "HourBankRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourBankMovement" ADD CONSTRAINT "HourBankMovement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourBankMovement" ADD CONSTRAINT "HourBankMovement_overtimeRecordId_fkey" FOREIGN KEY ("overtimeRecordId") REFERENCES "OvertimeRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourBankMovement" ADD CONSTRAINT "HourBankMovement_hourBankRequestId_fkey" FOREIGN KEY ("hourBankRequestId") REFERENCES "HourBankRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;


COMMIT;
