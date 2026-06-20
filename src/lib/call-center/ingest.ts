import { Prisma } from "@prisma/client";
import { canTransition } from "./transitions";
import type {
  NormalizedConversation,
  NormalizedMessage,
  NormalizedStatusEvent,
  UpsertConversationResult,
  UpsertMessageResult,
  ApplyStatusResult,
} from "./emozion-types";

/**
 * Upserts idempotentes de ingesta Emozion → TKL (Sprint 4B, commit 2/4).
 *
 * DECISIÓN DE TRANSACCIÓN (firme): todas reciben `tx: Prisma.TransactionClient` y operan
 * DENTRO de la transacción que abre el caller (el processor del commit 4/4, que querrá
 * atomicidad entre WebhookEvent + upsert + SyncLog). NUNCA abren prisma.$transaction acá.
 *
 * Idempotencia: por las claves externas con @unique de dominio
 * (Conversation.externalConversationId, ConversationMessage.externalMessageId). Llegar dos
 * veces no duplica. MERGE conservador: no se pisan campos ya seteados con null.
 */

/**
 * Upsert de conversación (+ Customer por phone). Si se crea, agrega la fila de nacimiento
 * en StateHistory. Si ya existe, hace MERGE conservador (no toca status — eso es
 * applyStatusChangedFromEmozion; no pisa firstResponseAt/snapshot ya presentes).
 */
export async function upsertConversationFromEmozion(
  tx: Prisma.TransactionClient,
  n: NormalizedConversation,
): Promise<UpsertConversationResult> {
  const warnings: string[] = [];

  // Customer por phone (whitelist estricta: solo phone + displayName).
  const customer = await tx.customer.upsert({
    where: { phone: n.contact.phone },
    update: n.contact.displayName != null ? { displayName: n.contact.displayName } : {},
    create: { phone: n.contact.phone, displayName: n.contact.displayName },
  });

  const existing = await tx.conversation.findUnique({
    where: { externalConversationId: n.externalConversationId },
  });

  if (!existing) {
    const conv = await tx.conversation.create({
      data: {
        customerId: customer.id,
        status: n.status,
        source: "EMOZION",
        externalConversationId: n.externalConversationId,
        customerPhoneSnapshot: n.customerPhoneSnapshot,
        firstResponseAt: n.firstResponseAt,
        closedAt: n.closedAt,
        externalLabels: n.externalLabels,
        ...(n.externalCreatedAt ? { createdAt: n.externalCreatedAt } : {}),
      },
    });
    await tx.conversationStateHistory.create({
      data: {
        conversationId: conv.id,
        fromStatus: null,
        toStatus: n.status,
        changedByUserId: null,
        note: "Importado de Emozion (webhook)",
      },
    });
    return { conversationId: conv.id, created: true, warnings };
  }

  // MERGE conservador: solo completar lo que falta; NO pisar con null ni clobberar status.
  await tx.conversation.update({
    where: { id: existing.id },
    data: {
      ...(n.firstResponseAt && !existing.firstResponseAt ? { firstResponseAt: n.firstResponseAt } : {}),
      ...(n.closedAt && !existing.closedAt ? { closedAt: n.closedAt } : {}),
      ...(n.customerPhoneSnapshot && !existing.customerPhoneSnapshot ? { customerPhoneSnapshot: n.customerPhoneSnapshot } : {}),
      ...(n.externalLabels.length ? { externalLabels: n.externalLabels } : {}),
    },
  });
  return { conversationId: existing.id, created: false, warnings };
}

/**
 * Upsert de mensaje + sus adjuntos (B2.2). find/create por externalMessageId (idempotente).
 * No persiste activities. Conserva isPrivate. mediaUrl SIEMPRE null (no se descargan adjuntos).
 *
 * ATTACHMENTS (Opción B): tras resolver el messageId (sea mensaje nuevo o preexistente por
 * retry), se corre SIEMPRE el loop find-by-sourceExternalId → create-if-absent por adjunto.
 * Correrlo en AMBOS paths (no solo en el create) es deliberado: si Emozion reenvía un
 * message_created con el MISMO externalMessageId pero un adjunto NUEVO, el adjunto se crea
 * igual (no se pierde en silencio). Todo en la MISMA tx → si un create falla, rollback total
 * (mensaje + adjuntos), nunca dominio parcial. NormalizedAttachment NO transporta URL/bytes:
 * mediaUrl/data_url/thumb_url/filename no se persisten acá. documentType = UNKNOWN (lo decide
 * un humano, no la ingesta); status = RECEIVED.
 */
export async function upsertMessageFromEmozion(
  tx: Prisma.TransactionClient,
  conversationId: string,
  n: NormalizedMessage,
): Promise<UpsertMessageResult> {
  if (n.isActivity) {
    return { messageId: null, created: false, ignored: true, warnings: [] };
  }

  // (1) Resolver el messageId: find-by-externalMessageId → create-if-absent.
  const existing = await tx.conversationMessage.findUnique({
    where: { externalMessageId: n.externalMessageId },
  });

  let messageId: string;
  let created: boolean;
  if (existing) {
    messageId = existing.id;
    created = false;
  } else {
    const msg = await tx.conversationMessage.create({
      data: {
        conversationId,
        author: n.author,
        senderUserId: null, // cruce a User TKL = dominio futuro
        externalSenderId: n.externalSenderId,
        body: n.body,
        mediaType: n.mediaType,
        mediaUrl: null,
        isPrivate: n.isPrivate,
        externalMessageId: n.externalMessageId,
        sentAt: n.sentAt,
      },
    });
    messageId = msg.id;
    created = true;
  }

  // (2) Adjuntos: SIEMPRE (ambos paths), con el messageId ya resuelto. find-create-if-absent.
  let attachmentsCreated = 0;
  for (const a of n.attachments) {
    const existingAtt = await tx.conversationAttachment.findUnique({
      where: { sourceExternalId: a.sourceExternalId },
    });
    if (existingAtt) continue; // idempotente: ya persistido (retry / reenvío)
    await tx.conversationAttachment.create({
      data: {
        conversationId,
        messageId,
        source: "EMOZION",
        sourceExternalId: a.sourceExternalId,
        mediaType: a.mediaType,
        mimeType: null,         // el fork no lo manda
        originalFileName: null, // el fork no lo manda
        sizeBytes: a.sizeBytes,
        documentType: "UNKNOWN", // lo setea un humano, NUNCA la ingesta
        status: "RECEIVED",
        // retentionUntil omitido → default null (sin política de retención aún)
        // NUNCA: mediaUrl/data_url/thumb_url/source_url/filename/bytes/storageProvider/storageKey
      },
    });
    attachmentsCreated++;
  }

  return {
    messageId,
    created,
    ignored: false,
    warnings: attachmentsCreated ? [`attachments creados: ${attachmentsCreated}`] : [],
  };
}

/**
 * Aplica un cambio de estado ingerido. Registra la REALIDAD de Emozion: NO bloquea por
 * canTransition() (esa whitelist gobierna las acciones de operador, Sprint 2). Si la
 * transición no está en la whitelist, deja un warning, no bloquea. NO setea
 * assignedToUserId (cruce agente Emozion → User TKL = dominio futuro).
 *
 * Si la conversación no existe (evento fuera de orden) → outcome "needsRetry": el caller
 * decide (crear mínima desde otro payload / reconsultar API / dejar el evento en ERROR).
 */
export async function applyStatusChangedFromEmozion(
  tx: Prisma.TransactionClient,
  n: NormalizedStatusEvent,
): Promise<ApplyStatusResult> {
  const warnings: string[] = [];
  const conv = await tx.conversation.findUnique({
    where: { externalConversationId: n.externalConversationId },
    select: { id: true, status: true, closedAt: true },
  });
  if (!conv) {
    return {
      outcome: "needsRetry",
      conversationId: null,
      warnings: [`status change sobre conversación inexistente (${n.externalConversationId}) → needsRetry`],
    };
  }

  const from = conv.status;
  if (from !== n.status && !canTransition(from, n.status)) {
    warnings.push(`transición ingerida fuera de whitelist: ${from}→${n.status} (se registra igual; Emozion es la realidad)`);
  }

  await tx.conversation.update({
    where: { id: conv.id },
    data: {
      status: n.status,
      ...(n.closedAt && !conv.closedAt ? { closedAt: n.closedAt } : {}),
    },
  });
  await tx.conversationStateHistory.create({
    data: {
      conversationId: conv.id,
      fromStatus: from,
      toStatus: n.status,
      changedByUserId: null,
      note: "Cambio de estado de Emozion (webhook)",
    },
  });
  return { outcome: "processed", conversationId: conv.id, warnings };
}
