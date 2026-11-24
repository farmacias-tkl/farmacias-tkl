-- Gate · Call Center: tipo de asignado de Emozion (bot o usuario) · 2026-11-23
--
-- PENDIENTE DE APLICAR. No correr sin el OK de Daniel. Antes, crear una branch de
-- respaldo en Neon.
--
-- Generado sin conexión a ninguna base con:
--   npx prisma migrate diff \
--     --from-schema-datamodel <schema.prisma de 02e3afa> \
--     --to-schema-datamodel prisma/schema.prisma --script
--
-- Solo aditivo. Agrega una columna de texto, nullable y sin default, en dos
-- tablas. No borra, no renombra, no cambia tipos, no crea índices y no reescribe
-- ninguna fila: lo que ya existe queda con la columna en NULL.
--
--   Conversation:             externalAssigneeType
--   ConversationStateHistory: externalAssigneeType
--
-- Qué guarda (la escribe solo la ingesta del webhook de Emozion): de qué es el id
-- del asignado, "USER" o "AGENT_BOT". En Emozion los bots y los usuarios tienen
-- numeraciones separadas, así que el id solo no alcanza. NULL = el evento no lo
-- dijo, o el dato es anterior a esta columna.
--
-- Lo anterior no se completa: el tipo no se guardó.
--
-- No toca usuarios, ventas, coseguros, saldos, mensajes, adjuntos ni WebhookEvent.
--
-- Orden: aplicar ANTES de desplegar el código. El cliente de Prisma de ese código
-- lee y escribe esta columna en cada operación sobre Conversation: desplegado sin
-- el gate, TODA la ingesta del webhook quedaría en ERROR y la bandeja fallaría.
-- El código anterior no la conoce y sigue funcionando con el gate ya aplicado.
-- Se puede aplicar junto con 2026-11-23-call-center-etiquetas-vistas.sql.
--
-- Vuelta atrás (ya sin el código desplegado):
--   BEGIN;
--   ALTER TABLE "ConversationStateHistory" DROP COLUMN "externalAssigneeType";
--   ALTER TABLE "Conversation" DROP COLUMN "externalAssigneeType";
--   COMMIT;

BEGIN;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "externalAssigneeType" TEXT;

-- AlterTable
ALTER TABLE "ConversationStateHistory" ADD COLUMN     "externalAssigneeType" TEXT;

COMMIT;
