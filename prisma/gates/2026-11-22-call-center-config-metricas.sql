-- Gate · Call Center: configuración de las métricas y registro de vistas de ventas
-- 2026-11-22
--
-- PENDIENTE DE APLICAR. No correr sin el OK de Daniel. Antes, crear una branch de
-- respaldo en Neon.
--
-- Generado sin conexión a ninguna base con:
--   npx prisma migrate diff \
--     --from-schema-datamodel <schema.prisma de main, f281dcb> \
--     --to-schema-datamodel prisma/schema.prisma --script
--
-- Solo aditivo. No toca ninguna fila ni ninguna tabla existente, no agrega FK.
--
--   CallCenterMetricsConfig: tabla nueva y vacía, con un índice. Una fila por
--     versión de la configuración de /call-center/metricas (horarios, meta,
--     cuentas de Emozion y vendedores de SIAF del Call Center), vigente desde
--     validFrom. Las filas las crea Dirección desde la plataforma; este gate no
--     carga ninguna.
--
--   AccessAction: valor nuevo VIEW_CALL_CENTER_SALES, al final del enum. Es la
--     acción con la que AccessLog registra cada vista del bloque Ventas SIAF del
--     Call Center, separada de VIEW_SALES (Dashboard Ejecutivo). Agregar el valor
--     no cambia ninguna fila de AccessLog.
--
-- ALTER TYPE ... ADD VALUE dentro de la transacción: PostgreSQL lo permite desde
-- la versión 12 (Neon corre la 17). La única restricción es que el valor nuevo
-- no se puede USAR hasta el COMMIT, y este gate no lo usa. Si la transacción
-- falla, tampoco queda el valor: tabla y valor entran juntos o no entra nada.
-- Mismo patrón que el gate 2026-11-13-asistencia-ausencias-y-compensacion.sql.
-- Probado completo (aplicar y volver atrás) en una base local efímera con
-- PostgreSQL 18, partiendo del esquema de main.
--
-- Orden: se puede aplicar antes o después de desplegar el código de la rama
-- feat/call-center-metricas mientras ese código no tenga todavía la pantalla de
-- configuración ni el bloque de ventas. A partir del commit que lee la tabla o
-- registra la acción nueva, el gate va ANTES del deploy. El código anterior no
-- conoce ni la tabla ni el valor y no se ve afectado.
--
-- Vuelta atrás
--
--   1. Tabla (borra las versiones de configuración cargadas; no afecta ninguna
--      otra tabla):
--        DROP TABLE "CallCenterMetricsConfig";
--
--   2. Valor del enum: PostgreSQL NO tiene DROP VALUE. Lo recomendado es DEJARLO:
--      un valor sin uso no afecta a nada (mismo criterio que el gate
--      2026-11-06-password-changed-event.sql). El código anterior nunca lo
--      escribe, y las filas de AccessLog que ya lo tengan siguen siendo válidas.
--
--      Solo si de verdad hiciera falta quitarlo, hay que recrear el tipo. Toma un
--      bloqueo exclusivo sobre AccessLog mientras reescribe la columna, y falla
--      (sin cambiar nada) si alguna fila usa el valor: antes hay que decidir qué
--      hacer con esas filas. Con el código que lo usa ya fuera de producción:
--        BEGIN;
--        ALTER TYPE "AccessAction" RENAME TO "AccessAction_old";
--        CREATE TYPE "AccessAction" AS ENUM
--          ('LOGIN', 'LOGOUT', 'VIEW_DASHBOARD', 'VIEW_BALANCES', 'VIEW_SALES',
--           'VIEW_COMPARATIVE', 'EXPORT');
--        ALTER TABLE "AccessLog" ALTER COLUMN "action" TYPE "AccessAction"
--          USING ("action"::text::"AccessAction");
--        DROP TYPE "AccessAction_old";
--        COMMIT;

BEGIN;

-- AlterEnum
ALTER TYPE "AccessAction" ADD VALUE 'VIEW_CALL_CENTER_SALES';

-- CreateTable
CREATE TABLE "CallCenterMetricsConfig" (
    "id" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "data" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallCenterMetricsConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallCenterMetricsConfig_validFrom_createdAt_idx" ON "CallCenterMetricsConfig"("validFrom" DESC, "createdAt" DESC);

COMMIT;
