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
        externalStatusAt: n.assigneeEventAt ?? null,
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
 * Estado de una conversación ABIERTA según su asignado: con una persona, ASIGNADA; sin
 * asignado o con un bot, SIN_ASIGNAR (al bot nadie la tomó). Sin dato de tipo se asume
 * persona, igual que al mapear el cambio de estado (hasPersonAssignee).
 */
export function openStatusFor(assigneeId: string | null, assigneeType: string | null): "SIN_ASIGNAR" | "ASIGNADA" {
  return assigneeId !== null && assigneeType !== "AGENT_BOT" ? "ASIGNADA" : "SIN_ASIGNAR";
}
const isOpenStatus = (s: string): s is "SIN_ASIGNAR" | "ASIGNADA" => s === "SIN_ASIGNAR" || s === "ASIGNADA";

/**
 * ¿El evento es anterior al que fijó el dato guardado? Los eventos de Emozion llegan
 * desordenados y cada uno trae la conversación como estaba cuando se armó.
 *  - Hora anterior a la guardada: atrasado, no pisa.
 *  - La MISMA hora: no es atrasado. No se pueden ordenar; se aplica el que llega (con el
 *    bloqueo por conversación, de a uno).
 *  - Sin hora en el evento, o sin hora guardada: no se puede saber. Se aplica, como antes de
 *    tener este dato, y un evento sin hora no mueve la hora guardada.
 */
export function isStaleEvent(eventAt: Date | null | undefined, storedAt: Date | null | undefined): boolean {
  return !!eventAt && !!storedAt && eventAt.getTime() < storedAt.getTime();
}

/**
 * Bloquea la fila de la conversación hasta el fin de la transacción. Dos eventos de la misma
 * conversación se aplican de a uno: el segundo lee lo que dejó el primero, en lugar de leer
 * los dos la misma versión y pisarse. Si la conversación no existe no bloquea nada.
 */
async function lockConversation(tx: Prisma.TransactionClient, externalConversationId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Conversation" WHERE "externalConversationId" = ${externalConversationId} FOR UPDATE`;
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
  await lockConversation(tx, n.externalConversationId);
  const conv = await tx.conversation.findUnique({
    where: { externalConversationId: n.externalConversationId },
    select: { id: true, status: true, closedAt: true, closureTypeId: true, closureTypeName: true, externalLabels: true, externalLabelsSeen: true, externalAssigneeId: true, externalAssigneeType: true, externalAssigneeAt: true, externalStatusAt: true },
  });
  if (!conv) {
    return {
      outcome: "needsRetry",
      conversationId: null,
      warnings: [`status change sobre conversación inexistente (${n.externalConversationId}) → needsRetry`],
    };
  }

  // Cambio de estado ATRASADO: ya se aplicó uno más nuevo. No toca el estado, el cierre, el
  // asignado ni las etiquetas de la conversación. El hecho igual ocurrió: queda en el
  // historial, con la hora del evento y no la de llegada, para no perder ese cierre.
  if (isStaleEvent(n.assigneeEventAt, conv.externalStatusAt)) {
    const at = n.assigneeEventAt!;
    const prev = await tx.conversationStateHistory.findFirst({
      where: { conversationId: conv.id, changedAt: { lte: at } },
      orderBy: [{ changedAt: "desc" }, { id: "desc" }],
      select: { toStatus: true },
    });
    if (!prev || prev.toStatus !== n.status) {
      const isResolved = n.status === "RESUELTA";
      // Sin las etiquetas guardadas de aquel momento, la de cierre vale solo si es la única.
      const lateLabel = isResolved ? closureLabelOf(n.labels, closureLabels, n.labels ?? []) : null;
      await tx.conversationStateHistory.create({
        data: {
          conversationId: conv.id,
          fromStatus: prev?.toStatus ?? null,
          toStatus: n.status,
          changedByUserId: null,
          changedAt: at,
          note: "Cambio de estado de Emozion (webhook, llegó atrasado)",
          externalAssigneeId: n.externalAssigneeId ?? null,
          externalAssigneeType: n.externalAssigneeId ? n.externalAssigneeType ?? null : null,
          closureTypeId: isResolved && !lateLabel ? n.closureTypeId ?? null : null,
          closureTypeName: isResolved ? lateLabel ?? n.closureTypeName ?? null : null,
          ...(isResolved ? { externalLabelsSeen: mergeLabelsSeen(n.labels) } : {}),
        },
      });
    }
    warnings.push("cambio de estado anterior al último aplicado → no cambia el estado actual; queda en el historial con su hora");
    return { outcome: "processed", conversationId: conv.id, warnings };
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
  // El asignado y la lista actual de etiquetas de la CONVERSACIÓN respetan el orden de los
  // eventos según Emozion: si este evento es anterior al que los fijó, no los pisa (pasa
  // cuando el cambio de estado llega después del conversation_updated que ya desasignó). La
  // fila del historial lleva siempre el asignado de su propio evento.
  const staleAssignee = isStaleEvent(n.assigneeEventAt, conv.externalAssigneeAt);
  if (staleAssignee) warnings.push("cambio de estado anterior al evento que fijó el asignado y las etiquetas → no se pisan");
  // Si el asignado guardado es más nuevo que este evento y el evento deja la conversación
  // abierta, el estado sale del asignado GUARDADO: el evento dice "abierta", pero quién la
  // tiene lo dice el dato más nuevo. Sin esto, "la tomó una persona" seguido del cambio de
  // estado atrasado "sale de pendiente con el bot" la dejaba SIN_ASIGNAR con una persona.
  const status = staleAssignee && isOpenStatus(n.status) ? openStatusFor(conv.externalAssigneeId, conv.externalAssigneeType) : n.status;
  const byStored = status !== n.status;
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
      status,
      ...(staleAssignee ? {} : { externalAssigneeId, externalAssigneeType, ...(n.assigneeEventAt ? { externalAssigneeAt: n.assigneeEventAt } : {}) }),
      closureTypeId,
      closureTypeName,
      ...(n.assigneeEventAt ? { externalStatusAt: n.assigneeEventAt } : {}),
      // Las etiquetas del evento reemplazan a las guardadas, solo si el evento trae la clave
      // y no es anterior al que fijó las guardadas.
      ...(n.labels && !staleAssignee ? { externalLabels: n.labels } : {}),
      externalLabelsSeen: labelsSeen,
      ...(n.closedAt && !conv.closedAt ? { closedAt: n.closedAt } : {}),
    },
  });
  await tx.conversationStateHistory.create({
    data: {
      conversationId: conv.id,
      fromStatus: from,
      toStatus: status,
      changedByUserId: null,
      note: "Cambio de estado de Emozion (webhook)",
      // La fila lleva el asignado de su propio evento, salvo cuando el estado salió del
      // asignado guardado: ahí lleva ese, que es el que explica el estado.
      externalAssigneeId: byStored ? conv.externalAssigneeId : externalAssigneeId,
      externalAssigneeType: byStored ? conv.externalAssigneeType : externalAssigneeType,
      closureTypeId,
      closureTypeName,
      ...(resolved ? { externalLabelsSeen: labelsSeen } : {}),
    },
  });
  return { outcome: "processed", conversationId: conv.id, warnings };
}

/**
 * Aplica un conversation_updated: SOLO tipo de cierre, asignado y etiquetas. No crea mensajes.
 * El estado cambia en un único caso, el de abajo ("Estado"); fuera de ese caso no agrega filas
 * al historial, así que varios eventos seguidos son idempotentes.
 *
 *  - Estado: con la conversación ABIERTA (SIN_ASIGNAR o ASIGNADA), el cambio de asignado la
 *    mueve entre esos dos estados (openStatusFor): pasa a una persona, ASIGNADA; queda sin
 *    asignado o con un bot, SIN_ASIGNAR. Es lo que pasa cuando un operador toma una
 *    conversación que salió del menú con el bot asignado: Emozion lo avisa por acá y no con
 *    un cambio de estado. Si el estado cambia se agrega UNA fila al historial, con la hora
 *    del evento y el asignado; si no cambia (reasignación entre personas, evento repetido)
 *    no se agrega nada. Un evento atrasado no cambia el estado. Una conversación PENDIENTE o
 *    RESUELTA no cambia de estado por este evento.
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
 * Conversación inexistente → "needsRetry": el evento llegó antes que el alta. No trae con qué
 * crearla, pero sí datos que hay que aplicar cuando exista (el asignado, las etiquetas): queda
 * pendiente y se reintenta, no se da por procesado.
 */
export async function applyConversationUpdatedFromEmozion(
  tx: Prisma.TransactionClient,
  n: NormalizedUpdateEvent,
  closureLabels: ReadonlySet<string> = NO_CLOSURE_LABELS,
): Promise<ApplyStatusResult> {
  const warnings: string[] = [];
  await lockConversation(tx, n.externalConversationId);
  const conv = await tx.conversation.findUnique({
    where: { externalConversationId: n.externalConversationId },
    select: { id: true, status: true, externalAssigneeId: true, externalAssigneeType: true, externalAssigneeAt: true, closureTypeId: true, closureTypeName: true, externalLabels: true, externalLabelsSeen: true },
  });
  if (!conv) {
    return { outcome: "needsRetry", conversationId: null, warnings: ["conversation_updated sobre conversación inexistente → needsRetry"] };
  }

  const data: Prisma.ConversationUpdateInput = {};
  // Cambio de estado por cambio de asignado (ver "Estado" arriba). null = no cambia.
  let openStatus: { to: "SIN_ASIGNAR" | "ASIGNADA"; assigneeId: string | null; assigneeType: string | null } | null = null;
  // Atrasado: anterior al evento que fijó el asignado y la lista actual de etiquetas. No los
  // pisa. Las etiquetas VISTAS se suman igual más abajo: no dependen del orden.
  const stale = isStaleEvent(n.assigneeEventAt, conv.externalAssigneeAt);
  if (stale) {
    warnings.push("conversation_updated anterior al evento que fijó el asignado y las etiquetas → no se pisan");
  } else {
    if (n.assigneePresent) {
      if (n.externalAssigneeId !== conv.externalAssigneeId) data.externalAssigneeId = n.externalAssigneeId;
      const type = assigneeTypeOf(n.externalAssigneeId, n.externalAssigneeType, conv);
      if (type !== conv.externalAssigneeType) data.externalAssigneeType = type;
      if (isOpenStatus(conv.status)) {
        const to = openStatusFor(n.externalAssigneeId, type);
        if (to !== conv.status) {
          data.status = to;
          openStatus = { to, assigneeId: n.externalAssigneeId, assigneeType: type };
        }
      }
    }
    if (n.labels && !sameList(n.labels, conv.externalLabels)) data.externalLabels = n.labels;
    if ((n.assigneePresent || n.labels) && n.assigneeEventAt && n.assigneeEventAt.getTime() !== conv.externalAssigneeAt?.getTime()) data.externalAssigneeAt = n.assigneeEventAt;
  }

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

  if (openStatus) {
    // La hora de la fila es la del evento. Las demás filas llevan la hora en que se procesó
    // su evento, que es unos instantes posterior: si la de este evento quedara antes de la
    // última fila, el historial se leería al revés, así que va justo después de esa fila.
    const prev = await tx.conversationStateHistory.findFirst({
      where: { conversationId: conv.id },
      orderBy: [{ changedAt: "desc" }, { id: "desc" }],
      select: { changedAt: true },
    });
    const changedAt = n.assigneeEventAt && prev && n.assigneeEventAt.getTime() <= prev.changedAt.getTime()
      ? new Date(prev.changedAt.getTime() + 1)
      : n.assigneeEventAt ?? undefined;
    await tx.conversationStateHistory.create({
      data: {
        conversationId: conv.id,
        fromStatus: conv.status,
        toStatus: openStatus.to,
        changedByUserId: null,
        ...(changedAt ? { changedAt } : {}),
        note: "Cambio de asignado de Emozion (webhook)",
        externalAssigneeId: openStatus.assigneeId,
        externalAssigneeType: openStatus.assigneeType,
      },
    });
  }

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
