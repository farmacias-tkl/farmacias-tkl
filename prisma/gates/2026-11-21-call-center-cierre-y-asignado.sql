-- Gate · Call Center: tipo de cierre y asignado de Emozion · 2026-11-21
--
-- PENDIENTE DE APLICAR. No correr sin el OK de Daniel. Antes, crear una branch de
-- respaldo en Neon.
--
-- Generado sin conexión a ninguna base con:
--   npx prisma migrate diff \
--     --from-schema-datamodel <schema.prisma de c6ba680> \
--     --to-schema-datamodel prisma/schema.prisma --script
--
-- Solo aditivo. Agrega seis columnas de texto, todas nullable y sin default. No
-- borra, no renombra, no cambia tipos, no crea índices y no reescribe ninguna
-- fila: las conversaciones y los cambios de estado que ya existen quedan con las
-- columnas nuevas en NULL.
--
--   Conversation:             externalAssigneeId, closureTypeId, closureTypeName
--   ConversationStateHistory: externalAssigneeId, closureTypeId, closureTypeName
--
-- Qué guardan (los escribe solo la ingesta del webhook de Emozion):
--   externalAssigneeId  id del agente asignado en Emozion, tal cual llega. No se
--                       cruza con usuarios de la plataforma.
--   closureTypeId/Name  código y nombre del tipo de cierre que el operador elige
--                       al resolver. El comentario de cierre no se guarda nunca.
--
-- No toca usuarios, ventas, coseguros, saldos, mensajes, adjuntos ni WebhookEvent.
--
-- Orden: aplicar ANTES de desplegar el código de la rama
-- feat/call-center-ingesta-cierre-asignado. El cliente de Prisma de ese código
-- lee y escribe estas columnas en cada operación sobre Conversation: desplegado
-- sin el gate, TODA la ingesta del webhook quedaría en ERROR y la bandeja
-- fallaría. El código anterior no las conoce y sigue funcionando con el gate ya
-- aplicado, así que aplicar el gate primero no rompe nada.
--
-- Vuelta atrás (ya sin el código desplegado; borra lo que se haya ingerido en
-- estas columnas, no afecta ninguna otra):
--   BEGIN;
--   ALTER TABLE "ConversationStateHistory"
--     DROP COLUMN "externalAssigneeId",
--     DROP COLUMN "closureTypeId",
--     DROP COLUMN "closureTypeName";
--   ALTER TABLE "Conversation"
--     DROP COLUMN "externalAssigneeId",
--     DROP COLUMN "closureTypeId",
--     DROP COLUMN "closureTypeName";
--   COMMIT;

BEGIN;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "closureTypeId" TEXT,
ADD COLUMN     "closureTypeName" TEXT,
ADD COLUMN     "externalAssigneeId" TEXT;

-- AlterTable
ALTER TABLE "ConversationStateHistory" ADD COLUMN     "closureTypeId" TEXT,
ADD COLUMN     "closureTypeName" TEXT,
ADD COLUMN     "externalAssigneeId" TEXT;

COMMIT;
