import { Prisma } from "@prisma/client";
import { isExpectedIngestedTransition } from "./transitions";
import { initialStorageFields, type AttachmentSourceCtx } from "./attachment-source";
import { tagErrorStage } from "./safe-error";
import { mergeLabelsSeen } from "./labels-seen";
import type {
  NormalizedAssigneeType,
  NormalizedConversation,
  NormalizedMessage,
  NormalizedStatusEvent,
  NormalizedUpdateEvent,
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
        externalLabelsSeen: mergeLabelsSeen(n.externalLabels),
        externalAssigneeId: n.externalAssigneeId ?? null,
        externalAssigneeType: n.externalAssigneeType ?? null,
        externalAssigneeAt: n.assigneeEventAt ?? null,
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
        externalAssigneeId: n.externalAssigneeId ?? null,
        externalAssigneeType: n.externalAssigneeType ?? null,
        ...(n.status === "RESUELTA" ? { externalLabelsSeen: mergeLabelsSeen(n.externalLabels) } : {}),
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
      ...(n.externalLabels.length
        ? { externalLabels: n.externalLabels, externalLabelsSeen: mergeLabelsSeen(seenSoFar(existing), n.externalLabels) }
        : {}),
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
  // B6.3-C2: contexto de captura de origen (de WebhookEvent.transientSourceUrls). null = no
  // capturado (captura off/probe/"on" no efectivo, o reproceso sin transientSourceUrls).
  sourceCtx: AttachmentSourceCtx | null = null,
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
    // B6.3-C2b: el stage se etiqueta en el error (sin cambiar su tipo) para el código seguro.
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
    }).catch((e: unknown) => { throw tagErrorStage(e, "ingest.message"); });
    messageId = msg.id;
    created = true;
  }

  // (2) Adjuntos: SIEMPRE (ambos paths), con el messageId ya resuelto. find-create-if-absent.
  let attachmentsCreated = 0;
  for (const a of n.attachments) {
    const existingAtt = await tx.conversationAttachment.findUnique({
      where: { sourceExternalId: a.sourceExternalId },
      select: { id: true },
    });
    if (existingAtt) continue; // idempotente: ya persistido (retry / reenvío). Sin backfill de origen.
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
        // B6.3-C2 (E5): PENDING solo con URL capturada (la copia va a ocurrir); si no, NO_ORIGIN
        // con el motivo. sourceFetchUrl es origen transitorio: lo consume y anula el job (C3).
        ...initialStorageFields(a.sourceExternalId, sourceCtx),
        // retentionUntil omitido → default null (sin política de retención aún)
        // NUNCA: mediaUrl/thumb_url/source_url/filename/bytes/storageProvider/storageKey
      },
      select: { id: true },
    }).catch((e: unknown) => { throw tagErrorStage(e, "ingest.attachment"); });
    attachmentsCreated++;
  }

  return {
    messageId,
    created,
    ignored: false,
    warnings: attachmentsCreated ? [`attachments creados: ${attachmentsCreated}`] : [],
  };
}

const NO_CLOSURE_LABELS: ReadonlySet<string> = new Set();
/** Un conversation_updated tan anterior a la última reapertura no suma etiquetas vistas. */
const LABELS_STALE_MARGIN_MS = 60_000;
/**
 * Tipo del asignado que queda guardado: el del evento. Si el evento no lo dice y el asignado
 * es el mismo que ya estaba, se conserva el guardado; si cambió, queda sin dato. Sin asignado,
 * null.
 */
function assigneeTypeOf(
  assigneeId: string | null,
  eventType: NormalizedAssigneeType | null | undefined,
  stored: { externalAssigneeId: string | null; externalAssigneeType: string | null },
): string | null {
  if (!assigneeId) return null;
  if (eventType) return eventType;
  return assigneeId === stored.externalAssigneeId ? stored.externalAssigneeType : null;
}

/**
 * ¿El evento es anterior al que fijó el asignado guardado? Los eventos de Emozion llegan
 * desordenados y cada uno trae el asignado del momento en que se armó. Sin alguna de las dos
 * horas no se puede saber: no es atrasado y se aplica, como antes de tener este dato.
 */
export function isStaleAssigneeEvent(eventAt: Date | null | undefined, storedAt: Date | null | undefined): boolean {
  return !!eventAt && !!storedAt && eventAt.getTime() < storedAt.getTime();
}

/**
 * Etiquetas vistas hasta ahora. Las conversaciones anteriores a este dato no las tienen: para
 * esas, el punto de partida es la lista actual. Con vistas ya guardadas la lista actual no se
 * suma, porque la pudo dejar un evento atrasado de un ciclo anterior.
 */
const seenSoFar = (c: { externalLabelsSeen: string[]; externalLabels: string[] }) => (c.externalLabelsSeen.length > 0 ? c.externalLabelsSeen : c.externalLabels);
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Etiqueta de cierre entre las etiquetas de una conversación: la que el operador elige al
 * resolver, que una automatización de Emozion agrega como etiqueta. Cuáles son de cierre lo
 * dice la configuración de métricas, no el código.
 *
 * Se decide POR DIFERENCIA contra las etiquetas que ya estaban guardadas (`stored`): la de
 * cierre es la que el evento AGREGA. Una etiqueta de cierre que ya estaba es de una
 * resolución anterior (Emozion no la quita al reabrir) y el orden de la lista no dice cuál
 * es la más nueva.
 *  - Agrega una o más de cierre: la última de las agregadas.
 *  - No agrega ninguna y la lista tiene UNA sola de cierre: esa (no hay ambigüedad; es el
 *    caso del evento repetido y el de resolver otra vez con el mismo resultado).
 *  - No agrega ninguna y la lista tiene varias de cierre: null, no se puede saber cuál vale.
 * Sin `stored` todas cuentan como agregadas. PURO.
 */
export function closureLabelOf(
  labels: readonly string[] | null | undefined,
  closureLabels: ReadonlySet<string>,
  stored: readonly string[] = [],
): string | null {
  if (!labels) return null;
  const candidates = labels.filter((l) => closureLabels.has(l));
  if (candidates.length === 0) return null;
  const added = candidates.filter((l) => !stored.includes(l));
  if (added.length > 0) return added[added.length - 1];
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Aplica un cambio de estado ingerido. Registra la REALIDAD de Emozion: NO bloquea por
 * canTransition() (esa whitelist gobierna las acciones de operador, Sprint 2). Si la
 * transición no es de las que la ingesta espera (isExpectedIngestedTransition: las de
 * operador más las habituales de Emozion), deja un warning, no bloquea. NO setea
 * assignedToUserId (cruce agente Emozion → User TKL = dominio futuro).
 *
 * Si la conversación no existe (evento fuera de orden) → outcome "needsRetry": el caller
 * decide (crear mínima desde otro payload / reconsultar API / dejar el evento en ERROR).
 */
export async function applyStatusChangedFromEmozion(
  tx: Prisma.TransactionClient,
  n: NormalizedStatusEvent,
  // Etiquetas que la configuración vigente define como de cierre. Vacío = ninguna.
  closureLabels: ReadonlySet<string> = NO_CLOSURE_LABELS,
): Promise<ApplyStatusResult> {
  const warnings: string[] = [];
  const conv = await tx.conversation.findUnique({
    where: { externalConversationId: n.externalConversationId },
    select: { id: true, status: true, closedAt: true, closureTypeId: true, closureTypeName: true, externalLabels: true, externalLabelsSeen: true, externalAssigneeId: true, externalAssigneeType: true, externalAssigneeAt: true },
  });
  if (!conv) {
    return {
      outcome: "needsRetry",
      conversationId: null,
      warnings: [`status change sobre conversación inexistente (${n.externalConversationId}) → needsRetry`],
    };
  }

  const from = conv.status;
  if (from !== n.status && !isExpectedIngestedTransition(from, n.status)) {
    warnings.push(`transición ingerida no esperada: ${from}→${n.status} (se registra igual; Emozion es la realidad)`);
  }

  // Asignado y tipo de cierre: a diferencia del resto (merge conservador), acá el evento
  // MANDA, porque describen el estado actual y no un dato que se completa una vez:
  //  - externalAssigneeId: el del evento, también null (quedó sin asignado).
  //  - tipo de cierre: solo vale mientras está RESUELTA. Al resolver se guarda el del evento.
  //    Si el evento no lo trae, se conserva el que ya tenga la conversación: lo dejó un
  //    conversation_updated de ESTA resolución (antes o después de este evento), y un cambio
  //    de estado sin tipo de cierre no lo pisa con null. No arrastra el de un cierre anterior,
  //    porque en cualquier otro estado (una reapertura) vuelve a null. Cada cierre queda en
  //    su fila de StateHistory.
  // `?? null`: los eventos guardados antes de estos campos no los traen.
  const externalAssigneeId = n.externalAssigneeId ?? null;
  const externalAssigneeType = assigneeTypeOf(externalAssigneeId, n.externalAssigneeType, conv);
  // El asignado de la CONVERSACIÓN respeta el orden de los eventos según Emozion: si este
  // evento es anterior al que fijó el asignado guardado, no lo pisa (pasa cuando el cambio de
  // estado llega después del conversation_updated que ya desasignó). La fila del historial
  // lleva siempre el asignado de su propio evento.
  const staleAssignee = isStaleAssigneeEvent(n.assigneeEventAt, conv.externalAssigneeAt);
  if (staleAssignee) warnings.push("cambio de estado anterior al evento que fijó el asignado → el asignado guardado no se pisa");
  const resolved = n.status === "RESUELTA";
  //  - etiqueta de cierre: si el evento trae las etiquetas y agrega una de cierre a las
  //    guardadas (closureLabelOf), ese es el resultado de la resolución y se guarda como
  //    nombre del tipo de cierre (sin código).
  const eventHasClosure = n.closureTypeId != null || n.closureTypeName != null;
  const label = resolved ? closureLabelOf(n.labels, closureLabels, conv.externalLabels) : null;
  const closureTypeId = !resolved || label ? null : eventHasClosure ? n.closureTypeId ?? null : conv.closureTypeId;
  const closureTypeName = !resolved ? null : label ?? (eventHasClosure ? n.closureTypeName ?? null : conv.closureTypeName);
  //  - etiquetas vistas: suman las guardadas y las del evento. En una REAPERTURA empiezan de
  //    nuevo con las etiquetas de ese momento (las del cierre anterior quedaron en su fila).
  const reopening = from === "RESUELTA" && !resolved;
  const labelsSeen = reopening
    ? mergeLabelsSeen(n.labels ?? conv.externalLabels)
    : mergeLabelsSeen(seenSoFar(conv), n.labels);

  await tx.conversation.update({
    where: { id: conv.id },
    data: {
      status: n.status,
      ...(staleAssignee ? {} : { externalAssigneeId, externalAssigneeType, ...(n.assigneeEventAt ? { externalAssigneeAt: n.assigneeEventAt } : {}) }),
      closureTypeId,
      closureTypeName,
      // Las etiquetas del evento reemplazan a las guardadas, solo si el evento trae la clave.
      ...(n.labels ? { externalLabels: n.labels } : {}),
      externalLabelsSeen: labelsSeen,
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
      externalAssigneeId,
      externalAssigneeType,
      closureTypeId,
      closureTypeName,
      ...(resolved ? { externalLabelsSeen: labelsSeen } : {}),
    },
  });
  return { outcome: "processed", conversationId: conv.id, warnings };
}

/**
 * Aplica un conversation_updated: SOLO tipo de cierre, asignado y etiquetas. No crea mensajes, no cambia
 * el estado y no agrega filas al historial, así que varios eventos seguidos son idempotentes.
 *
 *  - Tipo de cierre: se guarda si la conversación está RESUELTA, o si el propio evento dice
 *    que está resuelta (llegó antes que el cambio de estado; ese cambio lo conserva). Si ya
 *    está RESUELTA se completa también la última fila RESUELTA del historial. Un evento sin
 *    tipo de cierre nunca borra el que hay.
 *  - Evento atrasado: si la conversación se reabrió y la hora del evento (updated_at o
 *    resolved_at) es anterior a esa reapertura, el tipo de cierre es de una resolución vieja
 *    y se ignora. Se compara contra la REAPERTURA y no contra cualquier cambio de estado: la
 *    hora del historial es la de procesamiento, y el evento que acompaña a una resolución
 *    puede traer una hora unos segundos anterior a la fila de esa misma resolución.
 *  - Asignado: solo si el evento trae la clave meta.assignee; con null queda sin asignado.
 *    Su tipo (bot o usuario) lo acompaña; un evento que no lo dice no borra el que ya hay
 *    para ese mismo asignado. Un evento anterior al que fijó el asignado guardado no lo pisa.
 *  - Etiquetas: si el evento trae la clave `labels`, reemplazan a las guardadas. Si agrega
 *    una de cierre a las guardadas (closureLabelOf), es el resultado de la resolución y se
 *    guarda como nombre del tipo de cierre, con las mismas reglas.
 *  - Etiquetas vistas: las del evento se suman (nunca se quitan). Si la conversación está
 *    RESUELTA se completa también la fila de esa resolución. Las de un evento anterior a la
 *    última reapertura no se suman: son del ciclo que ya cerró.
 *
 * Conversación inexistente → "ignored" (sin reintento: el evento no trae con qué crearla).
 */
export async function applyConversationUpdatedFromEmozion(
  tx: Prisma.TransactionClient,
  n: NormalizedUpdateEvent,
  closureLabels: ReadonlySet<string> = NO_CLOSURE_LABELS,
): Promise<ApplyStatusResult> {
  const warnings: string[] = [];
  const conv = await tx.conversation.findUnique({
    where: { externalConversationId: n.externalConversationId },
    select: { id: true, status: true, externalAssigneeId: true, externalAssigneeType: true, externalAssigneeAt: true, closureTypeId: true, closureTypeName: true, externalLabels: true, externalLabelsSeen: true },
  });
  if (!conv) {
    return { outcome: "ignored", conversationId: null, warnings: ["conversation_updated sobre conversación inexistente → ignorado"] };
  }

  const data: Prisma.ConversationUpdateInput = {};
  if (n.assigneePresent && isStaleAssigneeEvent(n.assigneeEventAt, conv.externalAssigneeAt)) {
    warnings.push("conversation_updated anterior al evento que fijó el asignado → el asignado guardado no se pisa");
  } else if (n.assigneePresent) {
    if (n.externalAssigneeId !== conv.externalAssigneeId) data.externalAssigneeId = n.externalAssigneeId;
    const type = assigneeTypeOf(n.externalAssigneeId, n.externalAssigneeType, conv);
    if (type !== conv.externalAssigneeType) data.externalAssigneeType = type;
    if (n.assigneeEventAt && n.assigneeEventAt.getTime() !== conv.externalAssigneeAt?.getTime()) data.externalAssigneeAt = n.assigneeEventAt;
  }
  if (n.labels && !sameList(n.labels, conv.externalLabels)) data.externalLabels = n.labels;

  // El resultado del cierre: la etiqueta de cierre si la hay; si no, el tipo de cierre del evento.
  const label = closureLabelOf(n.labels, closureLabels, conv.externalLabels);
  const closureId = label ? null : n.closureTypeId;
  const closureName = label ?? n.closureTypeName;
  let eventHasClosure = closureId != null || closureName != null;
  const isResolved = conv.status === "RESUELTA";
  // Etiquetas vistas: lo que el evento agrega a las ya vistas.
  let labelsSeen: string[] | null = null;
  if (n.labels) {
    const merged = mergeLabelsSeen(seenSoFar(conv), n.labels);
    if (!sameList(merged, conv.externalLabelsSeen)) labelsSeen = merged;
  }
  if ((eventHasClosure || labelsSeen) && n.eventAt) {
    const reopened = await tx.conversationStateHistory.findFirst({
      where: { conversationId: conv.id, fromStatus: "RESUELTA", toStatus: { not: "RESUELTA" } },
      orderBy: [{ changedAt: "desc" }, { id: "desc" }],
      select: { changedAt: true },
    });
    if (reopened && n.eventAt.getTime() < reopened.changedAt.getTime()) {
      if (eventHasClosure) warnings.push("conversation_updated atrasado: su tipo de cierre es anterior a la última reapertura → no se guarda");
      eventHasClosure = false;
    }
    // Para las etiquetas vistas hay un margen: la hora de la reapertura es la de NUESTRO
    // procesamiento, y el bot puede etiquetar en el mismo segundo en que se reabre.
    if (reopened && n.eventAt.getTime() < reopened.changedAt.getTime() - LABELS_STALE_MARGIN_MS) labelsSeen = null;
  }
  if (labelsSeen) data.externalLabelsSeen = labelsSeen;
  if (eventHasClosure) {
    if (isResolved || n.resolved) {
      if (closureId !== conv.closureTypeId || closureName !== conv.closureTypeName) {
        data.closureTypeId = closureId;
        data.closureTypeName = closureName;
      }
    } else {
      warnings.push("conversation_updated con tipo de cierre sobre una conversación no resuelta → no se guarda");
    }
  }
  if (Object.keys(data).length > 0) await tx.conversation.update({ where: { id: conv.id }, data });

  if ((eventHasClosure || labelsSeen) && isResolved) {
    // Completa la fila de ESTA resolución; no agrega una fila nueva.
    const last = await tx.conversationStateHistory.findFirst({
      where: { conversationId: conv.id, toStatus: "RESUELTA" },
      orderBy: [{ changedAt: "desc" }, { id: "desc" }],
      select: { id: true, closureTypeId: true, closureTypeName: true },
    });
    const rowData: Prisma.ConversationStateHistoryUpdateInput = {};
    if (last && eventHasClosure && (last.closureTypeId !== closureId || last.closureTypeName !== closureName)) {
      rowData.closureTypeId = closureId;
      rowData.closureTypeName = closureName;
    }
    if (last && labelsSeen) rowData.externalLabelsSeen = labelsSeen;
    if (last && Object.keys(rowData).length > 0) {
      await tx.conversationStateHistory.update({ where: { id: last.id }, data: rowData });
    }
  }
  return { outcome: "processed", conversationId: conv.id, warnings };
}
