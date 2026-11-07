-- Gate: usuario de pruebas oculto en el Panel de Dirección.
--
-- Aplicar en Neon ANTES de desplegar el código que lee la columna: primero en un
-- branch de respaldo, después en producción. Aditivo: agrega una columna con
-- default false (las filas existentes quedan en false) y marca un solo usuario.
-- Todo en una transacción: si la marca no cambia exactamente 1 fila, se revierte
-- entero (también la columna).
--
-- Vuelta atrás: UPDATE "User" SET "hiddenFromOwnerPanel" = false; o, ya sin el
-- código desplegado, ALTER TABLE "User" DROP COLUMN "hiddenFromOwnerPanel";

BEGIN;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "hiddenFromOwnerPanel" BOOLEAN NOT NULL DEFAULT false;

-- Usuario de pruebas de Dirección (cuenta institucional, no de una persona).
DO $$
DECLARE n integer;
BEGIN
  UPDATE "User" SET "hiddenFromOwnerPanel" = true
   WHERE lower("email") = 'direccion@farmaciastkl.com';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Se esperaba marcar 1 usuario y se marcaron %', n;
  END IF;
  RAISE NOTICE 'Usuarios marcados: %', n;
END $$;

COMMIT;
