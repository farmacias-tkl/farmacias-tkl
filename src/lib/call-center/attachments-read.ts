import { prisma } from "@/lib/prisma";
import { canViewCallCenter } from "@/lib/permissions";
import type { UserRole } from "@prisma/client";

/**
 * Lectura metadata-only de adjuntos de una conversación (B3-A). NO sirve archivos, NO
 * URLs, NO bytes, NO preview/download (eso es B3-B/B6, bloqueado por storage + retención).
 *
 * Núcleo testeable separado del route handler (mismo patrón que webhook→processor): permite
 * smoke contra DB efímera de 401/403/404/lista sin mockear auth(). El route es un wrapper fino
 * que resuelve la sesión y delega acá.
 *
 * SELECT WHITELIST EXPLÍCITO (no include): por construcción, una columna futura de storage
 * (B6: storageKey/provider/URL) NO se filtra al frontend aunque se agregue al modelo.
 * Campos omitidos a propósito:
 *  - sourceExternalId: id técnico interno ("emozion-attachment:<id>"), no aporta a la UI.
 *  - originalFileName: PII potencial (hoy siempre null).
 *  - mimeType: el fork NO lo manda (siempre null) → se omite por inútil, NO por sensible.
 */
export const ATTACHMENT_LIST_SELECT = {
  id: true,
  conversationId: true,
  messageId: true,
  mediaType: true,
  sizeBytes: true,
  documentType: true,
  status: true,
  source: true,
  createdAt: true,
} as const;

type SessionUser = { role: UserRole; callCenterAccess?: boolean | null } | null | undefined;

export interface AttachmentsResponse {
  status: number;
  body: unknown;
}

/**
 * Resuelve la respuesta metadata-only para GET attachments de una conversación.
 * 401 sin usuario · 403 sin acceso al módulo (canViewCallCenter) · 404 si la conversación
 * no existe (distingue "no existe" de "existe y vacía") · 200 { data: [...] } ordenado asc.
 */
export async function buildAttachmentsResponse(
  user: SessionUser,
  conversationId: string,
): Promise<AttachmentsResponse> {
  if (!user) return { status: 401, body: { error: "No autenticado" } };
  if (!canViewCallCenter(user)) return { status: 403, body: { error: "Sin permisos" } };

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true },
  });
  if (!conv) return { status: 404, body: { error: "Conversación no encontrada" } };

  const data = await prisma.conversationAttachment.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: ATTACHMENT_LIST_SELECT,
  });
  return { status: 200, body: { data } };
}
