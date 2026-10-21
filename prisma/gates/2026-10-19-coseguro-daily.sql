-- Gate · Coseguros en Neon (CoseguroDaily + SyncSource.SALES_COSEGUROS) · 2026-10-19
--
-- PREPARADO, NO APLICADO. Se aplica solo por gate (host-check, dry-run con
-- `prisma migrate diff`, scan destructivo, OK explícito de Daniel).
--
-- Generado sin conexión a ninguna base con:
--   npx prisma migrate diff \
--     --from-schema-datamodel <schema.prisma de b3af746> \
--     --to-schema-datamodel prisma/schema.prisma --script
--
-- Solo agrega: un valor de enum, una tabla, tres índices y una FK hacia
-- "Branch". No modifica ni lee ninguna tabla existente (SalesSnapshot,
-- SyncLog, Branch quedan iguales; la FK solo agrega una restricción sobre
-- la tabla nueva).
--
-- Orden: aplicar este SQL ANTES de desplegar el código y de activar
-- COSEGUROS_SYNC_ENABLED=true.

-- AlterEnum
ALTER TYPE "SyncSource" ADD VALUE 'SALES_COSEGUROS';

-- CreateTable
CREATE TABLE "CoseguroDaily" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "receipts" INTEGER NOT NULL,
    "creditNotes" INTEGER NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoseguroDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoseguroDaily_date_idx" ON "CoseguroDaily"("date");

-- CreateIndex
CREATE INDEX "CoseguroDaily_code_date_idx" ON "CoseguroDaily"("code", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CoseguroDaily_branchId_date_code_key" ON "CoseguroDaily"("branchId", "date", "code");

-- AddForeignKey
ALTER TABLE "CoseguroDaily" ADD CONSTRAINT "CoseguroDaily_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Vuelta atrás (no ejecutar salvo decisión explícita):
--   DROP TABLE "CoseguroDaily";
-- El valor 'SALES_COSEGUROS' del enum no se puede quitar con ALTER TYPE en
-- PostgreSQL; si queda sin uso no afecta a nada. Antes de borrar la tabla,
-- desactivar COSEGUROS_SYNC_ENABLED.
