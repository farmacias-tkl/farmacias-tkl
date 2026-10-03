/**
 * B6.3-C3 — SQL de RESERVA atómica (una sola sentencia, sin transacción larga).
 *
 * CTE `cand` con FOR UPDATE SKIP LOCKED → dos workers concurrentes toman conjuntos DISJUNTOS
 * (en READ COMMITTED, una fila ya tomada y commiteada por otro se re-evalúa contra su versión
 * nueva — COPYING con lease vigente — y queda excluida). El UPDATE devuelve prev_status /
 * prev_next para poder LIBERAR sin penalizar.
 *
 * Elegibles: source dado, sourceFetchUrl IS NOT NULL (los históricos sin URL NUNCA se tocan),
 * storageAttemptCount < MAX, y (PENDING|FAILED vencidos) o (COPYING con lease vencido).
 * FAILED con URL = reintentable (los FAILED terminales tienen URL NULL).
 *
 * Reloj: todo con el `now` de la app (inyectable). Los DateTime de Prisma son `timestamp(3)`
 * sin zona y guardan UTC; el ISO con "Z" casteado a `timestamp` conserva ese valor UTC.
 */
import { Prisma, type AttachmentSource, type StorageStatus } from "@prisma/client";

export interface ReserveParams {
  source: AttachmentSource;
  maxAttempts: number;
  limit: number;
  leaseId: string;
  now: Date;
  leaseUntil: Date;
}

export interface ReservedRow {
  id: string;
  sourceFetchUrl: string;
  source: AttachmentSource;
  storageAttemptCount: number;
  prev_status: StorageStatus;
  prev_next: Date | null;
}

export function buildReserveQuery(p: ReserveParams): Prisma.Sql {
  const now = p.now.toISOString();
  const leaseUntil = p.leaseUntil.toISOString();
  return Prisma.sql`
    WITH cand AS (
      SELECT id, "storageStatus" AS prev_status, "storageNextRetryAt" AS prev_next
      FROM "ConversationAttachment"
      WHERE "source" = CAST(${p.source} AS "AttachmentSource")
        AND "sourceFetchUrl" IS NOT NULL
        AND "storageAttemptCount" < ${p.maxAttempts}
        AND (
              ("storageStatus" IN ('PENDING', 'FAILED')
                AND ("storageNextRetryAt" IS NULL OR "storageNextRetryAt" <= CAST(${now} AS timestamp)))
           OR ("storageStatus" = 'COPYING' AND "storageNextRetryAt" <= CAST(${now} AS timestamp))
        )
      ORDER BY "createdAt", id
      LIMIT ${p.limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "ConversationAttachment" a
    SET "storageStatus" = 'COPYING',
        "storageLeaseId" = ${p.leaseId},
        "storageNextRetryAt" = CAST(${leaseUntil} AS timestamp),
        "storageAttemptCount" = a."storageAttemptCount" + 1,
        "updatedAt" = CAST(${now} AS timestamp)
    FROM cand
    WHERE a.id = cand.id
    RETURNING a.id, a."sourceFetchUrl", a."source", a."storageAttemptCount", cand.prev_status, cand.prev_next`;
}
