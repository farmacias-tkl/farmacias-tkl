import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { deriveStorageDisplay, type StorageDisplay } from "./attachment-display";

/**
 * Adjuntos para el DETALLE de conversación (B5 + B6.3-C5). Server-only.
 *
 * UNA sola sentencia (lectura consistente: estado y "tiene origen" salen de la MISMA fila en el
 * mismo instante; no hay ventana entre leer el estado y leer el origen). Columnas WHITELIST +
 * storageStatus + ("sourceFetchUrl" IS NOT NULL) AS "hasSource". La URL NUNCA se selecciona:
 * solo aparece dentro de la expresión IS NOT NULL. storageStatus y hasSource se usan para derivar
 * y NO se devuelven: al render llega solo `storageDisplay`. Nunca: sourceFetchUrl, storageKey,
 * storageBucket, storageLeaseId, storageLastError, storageChecksumSha256, sourceExternalId,
 * originalFileName.
 */
export function buildAttachmentDetailQuery(conversationId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT "id", "messageId", "mediaType", "sizeBytes", "documentType", "status", "createdAt",
           "storageStatus", ("sourceFetchUrl" IS NOT NULL) AS "hasSource"
    FROM "ConversationAttachment"
    WHERE "conversationId" = ${conversationId}
    ORDER BY "createdAt" ASC, "id" ASC`;
}

interface AttachmentDetailRow {
  id: string;
  messageId: string | null;
  mediaType: string | null;
  sizeBytes: number | null;
  documentType: string;
  status: string;
  createdAt: Date;
  storageStatus: string;
  hasSource: boolean;
}

export interface AttachmentDetailItem {
  id: string;
  messageId: string | null;
  mediaType: string | null;
  sizeBytes: number | null;
  documentType: string;
  status: string;
  createdAt: Date;
  storageDisplay: StorageDisplay;
}

export async function loadAttachmentsForDetail(conversationId: string, db: PrismaClient = defaultPrisma): Promise<AttachmentDetailItem[]> {
  const rows = await db.$queryRaw<AttachmentDetailRow[]>(buildAttachmentDetailQuery(conversationId));
  // Proyección EXPLÍCITA: mismas keys que antes; storageStatus/hasSource no salen.
  return rows.map((r) => ({
    id: r.id,
    messageId: r.messageId,
    mediaType: r.mediaType,
    sizeBytes: r.sizeBytes,
    documentType: r.documentType,
    status: r.status,
    createdAt: r.createdAt,
    storageDisplay: deriveStorageDisplay({ storageStatus: r.storageStatus, hasSource: r.hasSource === true }),
  }));
}
