import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { deriveStorageDisplay, type StorageDisplay } from "./attachment-display";

/**
 * Adjuntos para el DETALLE de conversación (B5 + B6.3-C5). Server-only.
 *
 * SELECT WHITELIST: solo metadata + storageStatus (que NO se devuelve: se usa para derivar).
 * El "tiene origen" se resuelve con una SEGUNDA consulta que solo trae ids
 * (`sourceFetchUrl IS NOT NULL`): la URL NUNCA se carga en memoria ni sale del server.
 * Al render llega solo `storageDisplay`. Nunca: sourceFetchUrl, storageKey, storageBucket,
 * storageLeaseId, storageLastError, storageChecksumSha256, sourceExternalId, originalFileName.
 */
export const ATTACHMENT_DETAIL_SELECT = {
  id: true,
  messageId: true,
  mediaType: true,
  sizeBytes: true,
  documentType: true,
  status: true,
  createdAt: true,
  storageStatus: true,
} as const;

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
  const [rows, withSource] = await Promise.all([
    db.conversationAttachment.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, select: ATTACHMENT_DETAIL_SELECT }),
    db.conversationAttachment.findMany({ where: { conversationId, sourceFetchUrl: { not: null } }, select: { id: true } }),
  ]);
  const hasSource = new Set(withSource.map((r) => r.id));
  return rows.map(({ storageStatus, ...r }) => ({
    ...r,
    storageDisplay: deriveStorageDisplay({ storageStatus, hasSource: hasSource.has(r.id) }),
  }));
}
