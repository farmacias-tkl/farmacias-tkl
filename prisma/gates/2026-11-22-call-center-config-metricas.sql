-- Gate · Call Center: configuración de las métricas · 2026-11-22
--
-- PENDIENTE DE APLICAR. No correr sin el OK de Daniel. Antes, crear una branch de
-- respaldo en Neon.
--
-- Generado sin conexión a ninguna base con:
--   npx prisma migrate diff \
--     --from-schema-datamodel <schema.prisma de b7cf2b7> \
--     --to-schema-datamodel prisma/schema.prisma --script
--
-- Solo aditivo. Crea una tabla nueva y vacía, con un índice. No toca ninguna
-- tabla existente, no agrega FK y no escribe ninguna fila.
--
--   CallCenterMetricsConfig: una fila por versión de la configuración de
--     /call-center/metricas (horarios, meta, cuentas de Emozion y vendedores de
--     SIAF del Call Center), vigente desde validFrom. Las filas las crea
--     Dirección desde la plataforma; este gate no carga ninguna.
--
-- Orden: se puede aplicar antes o después de desplegar el código de la rama
-- feat/call-center-metricas mientras ese código no tenga todavía la pantalla de
-- configuración ni las métricas. A partir del commit que lee esta tabla, el gate
-- va ANTES del deploy. El código anterior no la conoce y no se ve afectado.
--
-- Vuelta atrás (borra las versiones de configuración cargadas; no afecta
-- ninguna otra tabla):
--   DROP TABLE "CallCenterMetricsConfig";

BEGIN;

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
