-- Gate · Call Center: hora del cambio de estado que fijó el estado · 2026-11-24
--
-- PENDIENTE DE APLICAR. No correr sin el OK de Daniel. Antes, crear una branch de
-- respaldo en Neon.
--
-- Generado sin conexión a ninguna base con:
--   npx prisma migrate diff \
--     --from-schema-datamodel <schema.prisma de 07633c6> \
--     --to-schema-datamodel prisma/schema.prisma --script
--
-- Solo aditivo. Agrega una columna de fecha y hora, nullable y sin default, en una
-- tabla. No borra, no renombra, no cambia tipos, no crea índices y no reescribe
-- ninguna fila: las conversaciones que ya existen quedan con la columna en NULL.
--
--   Conversation: externalStatusAt
--
-- Qué guarda (la escribe solo la ingesta del webhook de Emozion): la hora, según
-- Emozion, del cambio de estado que fijó el estado y el tipo de cierre guardados.
-- Los eventos llegan desordenados; con esta hora, un cambio de estado anterior no
-- vuelve a pegar un estado viejo (por ejemplo, no vuelve a cerrar una conversación
-- que ya se reabrió). NULL = el evento no traía hora, o el dato es anterior a
-- esta columna (en ese caso el estado se aplica como hasta ahora).
--
-- Va aparte de externalAssigneeAt (asignado y etiquetas) porque solo los cambios
-- de estado traen estado.
--
-- No toca usuarios, ventas, coseguros, saldos, mensajes, adjuntos ni WebhookEvent.
--
-- Orden: aplicar ANTES de desplegar el código de este commit. El cliente de Prisma
-- de ese código lee y escribe esta columna en cada operación sobre Conversation:
-- desplegado sin el gate, TODA la ingesta del webhook quedaría en ERROR. El código
-- anterior no la conoce y sigue funcionando con el gate aplicado.
--
-- Vuelta atrás (ya sin el código desplegado):
--   BEGIN;
--   ALTER TABLE "Conversation" DROP COLUMN "externalStatusAt";
--   COMMIT;

BEGIN;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "externalStatusAt" TIMESTAMP(3);

COMMIT;
