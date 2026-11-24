-- Gate · Call Center: etiquetas vistas durante la conversación · 2026-11-23
--
-- PENDIENTE DE APLICAR. No correr sin el OK de Daniel. Antes, crear una branch de
-- respaldo en Neon.
--
-- Generado sin conexión a ninguna base con:
--   npx prisma migrate diff \
--     --from-schema-datamodel <schema.prisma de cdf4207> \
--     --to-schema-datamodel prisma/schema.prisma --script
--
-- Solo aditivo. Agrega una columna de lista de texto en dos tablas, con default
-- lista vacía. No borra, no renombra, no cambia tipos y no crea índices. El
-- default es constante, así que Postgres no reescribe las filas: las que ya
-- existen leen la lista vacía.
--
--   Conversation:             externalLabelsSeen
--   ConversationStateHistory: externalLabelsSeen
--
-- Qué guardan (las escribe solo la ingesta del webhook de Emozion):
--   Conversation              las etiquetas que tuvo la conversación desde que se
--                             abrió o reabrió por última vez. Solo suma. La lista
--                             actual (externalLabels) no cambia de significado.
--   ConversationStateHistory  solo en las filas RESUELTA: las etiquetas vistas
--                             hasta ese cierre.
--
-- Para qué: una automatización de Emozion quita al resolver las etiquetas de
-- sucursal y de modalidad. Hoy ese dato se pierde en casi todas las
-- conversaciones cerradas.
--
-- Lo anterior no se recupera: las conversaciones ya cerradas quedan con la lista
-- vacía. Las abiertas la completan con su próximo evento.
--
-- No toca usuarios, ventas, coseguros, saldos, mensajes, adjuntos ni WebhookEvent.
--
-- Orden: aplicar ANTES de desplegar el código. El cliente de Prisma de ese código
-- lee y escribe estas columnas en cada operación sobre Conversation: desplegado
-- sin el gate, TODA la ingesta del webhook quedaría en ERROR y la bandeja
-- fallaría. El código anterior no las conoce y sigue funcionando con el gate ya
-- aplicado, así que aplicar el gate primero no rompe nada.
--
-- Vuelta atrás (ya sin el código desplegado; borra lo ingerido en estas columnas,
-- no afecta ninguna otra):
--   BEGIN;
--   ALTER TABLE "ConversationStateHistory" DROP COLUMN "externalLabelsSeen";
--   ALTER TABLE "Conversation" DROP COLUMN "externalLabelsSeen";
--   COMMIT;

BEGIN;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "externalLabelsSeen" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ConversationStateHistory" ADD COLUMN     "externalLabelsSeen" TEXT[] DEFAULT ARRAY[]::TEXT[];

COMMIT;
