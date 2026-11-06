-- Gate: tipo de SecurityEvent para el cambio de contraseña del propio usuario.
--
-- Aplicar en Neon ANTES de desplegar el código que lo usa. Solo agrega un valor
-- al enum: no toca filas ni otras columnas. Salida de prisma migrate diff.
-- Vuelta atrás: no hace falta; un valor sin uso no afecta a nada.

-- AlterEnum
ALTER TYPE "SecurityEventType" ADD VALUE 'USER_PASSWORD_CHANGED';
