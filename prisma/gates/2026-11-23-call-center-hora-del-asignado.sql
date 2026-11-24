-- Gate · Call Center: hora del evento que fijó el asignado · 2026-11-23
--
-- PENDIENTE DE APLICAR. No correr sin el OK de Daniel. Antes, crear una branch de
-- respaldo en Neon.
--
-- Generado sin conexión a ninguna base con:
--   npx prisma migrate diff \
--     --from-schema-datamodel <schema.prisma de 5133cc3> \
--     --to-schema-datamodel prisma/schema.prisma --script
--
-- Solo aditivo. Agrega una columna de fecha y hora, nullable y sin default, en una
-- tabla. No borra, no renombra, no cambia tipos, no crea índices y no reescribe
-- ninguna fila: las conversaciones que ya existen quedan con la columna en NULL.
--
--   Conversation: externalAssigneeAt
--
-- Qué guarda (la escribe solo la ingesta del webhook de Emozion): la hora, según
-- Emozion, del evento que fijó el asignado guardado. Los eventos llegan
-- desordenados; con esta hora, un evento anterior no pisa el asignado. NULL = el
-- evento no traía hora, o el dato es anterior a esta columna (en ese caso el
-- asignado se aplica como hasta ahora).
--
-- Lo ya guardado no se corrige: las conversaciones abiertas que hoy tienen un
-- asignado que Emozion ya quitó lo actualizan con su próximo evento.
--
-- No toca usuarios, ventas, coseguros, saldos, mensajes, adjuntos ni WebhookEvent.
--
-- Orden: aplicar ANTES de desplegar el código de este commit, y DESPUÉS de los
-- gates de etiquetas vistas y de tipo de asignado (o junto con ellos). El cliente
-- de Prisma de ese código lee y escribe esta columna en cada operación sobre
-- Conversation: desplegado sin el gate, TODA la ingesta del webhook quedaría en
-- ERROR. El código anterior no la conoce y sigue funcionando con el gate aplicado.
--
-- Vuelta atrás (ya sin el código desplegado):
--   BEGIN;
--   ALTER TABLE "Conversation" DROP COLUMN "externalAssigneeAt";
--   COMMIT;

BEGIN;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "externalAssigneeAt" TIMESTAMP(3);

COMMIT;
