import type {
  EmozionConversation,
  EmozionMessage,
  EmozionContact,
  EmozionWebhookEnvelope,
  NormalizedConversation,
  NormalizedMessage,
  NormalizedAttachment,
  NormalizedStatusEvent,
  NormalizedUpdateEvent,
  NormalizeResult,
  NormalizedStatus,
  NormalizedAuthor,
  NormalizedAssigneeType,
} from "./emozion-types";
import { isUsableAttachmentId, emozionAttachmentSourceExternalId } from "./attachment-identity";

/**
 * Mappers PUROS Emozion(Chatwoot fork) → TKL. Sin DB, sin red.
 * FRONTERA PURA: CERO import de Prisma/@prisma/client (los enums son uniones locales).
 * Producen payload MÍNIMO NORMALIZADO: NUNCA custom_attributes/additional_attributes,
 * DNI, domicilio, obra_social, data_url/thumb_url ni URLs completas. No inventan datos.
 *
 * FORMA REAL del fork (capturada en prod, distinta del Chatwoot estándar):
 *  - message_created: la RAÍZ es el MENSAJE; la conversación va embebida en `conversation`;
 *    account_id en `account.id`. El id de conversación es NUMÉRICO (`conversation.id`), NO uuid.
 *  - conversation_created / conversation_status_changed: la RAÍZ es la CONVERSACIÓN; su id
 *    es `id` (numérico); account_id viene en `messages[0].account_id`.
 *  - message_type es STRING ("incoming" | "outgoing" | "activity"); created_at es ISO string.
 *  - externalConversationId = String(<id numérico>) (el webhook no trae uuid).
 */

/** id del agente bot en Emozion (Asistente Virtual), confirmado por el probe de agentes. */
export const BOT_SENDER_ID = 1;

/** Whitelist de eventos que procesa 4B. */
export const SUPPORTED_EVENTS = ["conversation_created", "message_created", "conversation_status_changed", "conversation_updated"] as const;

// ── helpers ─────────────────────────────────────────────────────────────────────
/** Parsea timestamp del fork: ISO string (new Date) o epoch number (seg→*1000, o ms). null si inválido. */
export function parseTimestamp(v: unknown): Date | null {
  if (typeof v === "number" && v > 0) {
    const d = new Date(v < 1e12 ? v * 1000 : v); // <1e12 ⇒ epoch en segundos
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * body del mensaje: null si no es string o si es whitespace-puro (sin contenido real). Si hay
 * contenido, se preserva el texto ORIGINAL sin recortar (el trim solo decide si hay contenido;
 * la limpieza cosmética, si se quisiera, es de UI, no de persistencia).
 */
function normalizeMessageBody(content: unknown): string | null {
  if (typeof content !== "string") return null;
  return content.trim().length > 0 ? content : null;
}

/**
 * Metadata de attachments → NormalizedAttachment[] (B2.1). PURO: sin bytes, sin URL cruda.
 * Mapea TODOS los adjuntos (no solo [0]). SIN documentType (lo pone el ingest = UNKNOWN).
 *
 * Identidad rota (NO objeto, o sin id usable) → brokenIdentity=true y attachments=[]: el caller
 * devuelve insufficientData para que el receptor/ingest falle RUIDOSO (todo-o-nada, sin dominio
 * parcial). NO se inventa fallback por índice: el fork manda id estable (contrato real B2.0).
 */
export function normalizeAttachments(
  rawAttachments: unknown,
  externalMessageId: string,
): { attachments: NormalizedAttachment[]; brokenIdentity: boolean; warnings: string[] } {
  if (!Array.isArray(rawAttachments)) return { attachments: [], brokenIdentity: false, warnings: [] };
  const attachments: NormalizedAttachment[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < rawAttachments.length; i++) {
    const a = rawAttachments[i];
    if (!a || typeof a !== "object" || Array.isArray(a)) {
      return { attachments: [], brokenIdentity: true, warnings: [`adjunto[${i}] no es objeto → identidad rota; extId=${externalMessageId}`] };
    }
    const att = a as Record<string, unknown>;
    if (!isUsableAttachmentId(att.id)) {
      return { attachments: [], brokenIdentity: true, warnings: [`adjunto[${i}] sin id usable → identidad rota; extId=${externalMessageId}`] };
    }
    attachments.push({
      // id estable (no índice), trimmeado; helper compartido con la captura de origen (B6.3).
      sourceExternalId: emozionAttachmentSourceExternalId(att.id),
      mediaType: typeof att.file_type === "string" ? att.file_type : null,
      sizeBytes: typeof att.file_size === "number" && Number.isFinite(att.file_size) ? att.file_size : null,
      mimeType: null,         // el fork no lo manda
      originalFileName: null, // el fork no lo manda
    });
  }
  return { attachments, brokenIdentity: false, warnings };
}

/**
 * Resuelve el id (numérico → string) de la conversación a partir de candidatos posibles:
 * el `id` del objeto conversación y `messages[0].conversation_id`. Si ambos existen y NO
 * coinciden → discrepancy=true (no elegir silenciosamente; el caller marca warning/ERROR).
 */
export function resolveConversationId(conv: EmozionConversation | null | undefined): { id: string | null; discrepancy: boolean } {
  const cands: string[] = [];
  if (conv?.id != null) cands.push(String(conv.id));
  const m0 = conv?.messages?.[0]?.conversation_id;
  if (m0 != null) cands.push(String(m0));
  const uniq = [...new Set(cands)];
  if (uniq.length > 1) return { id: null, discrepancy: true };
  return { id: uniq[0] ?? null, discrepancy: false };
}

/**
 * ¿La conversación tiene asignada a una PERSONA? Un bot asignado (el del menú queda como
 * asignado al salir de "pendiente") no cuenta: nadie la tomó. Sin dato de tipo se asume
 * persona, como antes de leer el tipo.
 */
export function hasPersonAssignee(conv: EmozionConversation | null | undefined): boolean {
  return normalizeExternalAssigneeId(conv) !== null && normalizeExternalAssigneeType(conv) !== "AGENT_BOT";
}

/** status Emozion + presencia de assignee → ConversationStatus (conservador + warning). */
export function mapStatus(status: unknown, hasAssignee: boolean): { status: NormalizedStatus; warnings: string[] } {
  switch (status) {
    case "pending":
      return { status: "PENDIENTE", warnings: [] };
    case "open":
      return { status: hasAssignee ? "ASIGNADA" : "SIN_ASIGNAR", warnings: [] };
    case "resolved":
      return { status: "RESUELTA", warnings: [] };
    default:
      return {
        status: "SIN_ASIGNAR",
        warnings: [`status Emozion no mapeado: "${String(status)}" → SIN_ASIGNAR (conservador)`],
      };
  }
}

/**
 * author de un mensaje (fork: message_type STRING). fallback=true marca un outgoing con
 * sender raro/ausente. incoming / sender contacto → CUSTOMER; outgoing sender.id==1 → BOT;
 * outgoing sender.type=="user" (id!=1) → OPERATOR; resto → OPERATOR (fallback técnico).
 */
export function mapAuthor(m: EmozionMessage): { author: NormalizedAuthor; fallback: boolean } {
  const mt = m?.message_type;
  const s = m?.sender ?? null;
  if (mt === "incoming" || mt === 0 || s?.type === "contact") return { author: "CUSTOMER", fallback: false };
  if (s?.type === "agent_bot") return { author: "BOT", fallback: false };
  if (Number(s?.id) === BOT_SENDER_ID) return { author: "BOT", fallback: false };
  if (s?.type === "user") return { author: "OPERATOR", fallback: false };
  return { author: "OPERATOR", fallback: true };
}

/** Largo máximo del nombre del tipo de cierre: es un valor de catálogo, no texto libre. */
export const CLOSURE_TYPE_NAME_MAX = 120;

/** Id técnico → string: número finito, o string de 1 a 64 caracteres sin espacios. Si no, null. */
function technicalId(v: unknown): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 && t.length <= 64 && !/\s/.test(t) ? t : null;
  }
  return null;
}

/**
 * id crudo del agente asignado (meta.assignee.id) → string. Solo número finito o string
 * corto sin espacios; cualquier otra cosa → null (no se inventa ni se guarda texto libre).
 */
export function normalizeExternalAssigneeId(conv: EmozionConversation | null | undefined): string | null {
  return technicalId(conv?.meta?.assignee?.id);
}

/**
 * De qué es el id del asignado: meta.assignee_type ("AgentBot" | "User") o, si no viene,
 * meta.assignee.type ("agent_bot" | "user"). Sin asignado, o con un valor que no es ninguno
 * de esos, null: no se adivina.
 */
export function normalizeExternalAssigneeType(conv: EmozionConversation | null | undefined): NormalizedAssigneeType | null {
  if (normalizeExternalAssigneeId(conv) === null) return null;
  const raw = conv?.meta?.assignee_type ?? conv?.meta?.assignee?.type;
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  return t === "agentbot" ? "AGENT_BOT" : t === "user" ? "USER" : null;
}

/**
 * Tipo de cierre que el operador elige al resolver en Emozion: SOLO código y nombre de
 * catálogo. closure_comment NO se lee en ningún punto (texto libre, posible dato personal).
 * Lectura defensiva (los valores reales no están confirmados): id = número finito o string
 * corto sin espacios; nombre = string no vacío, recortado a CLOSURE_TYPE_NAME_MAX. Los
 * warnings no incluyen valores.
 */
export function normalizeClosure(conv: EmozionConversation | null | undefined): {
  closureTypeId: string | null;
  closureTypeName: string | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const closureTypeId = technicalId(conv?.closure_type_id);
  if (conv?.closure_type_id != null && closureTypeId === null) {
    warnings.push("closure_type_id con forma inesperada → null");
  }
  let closureTypeName: string | null = null;
  const rawName: unknown = conv?.closure_type_name;
  if (typeof rawName === "string") {
    const trimmed = rawName.trim();
    if (trimmed.length > CLOSURE_TYPE_NAME_MAX) {
      warnings.push(`closure_type_name supera ${CLOSURE_TYPE_NAME_MAX} caracteres → recortado`);
    }
    closureTypeName = trimmed.length > 0 ? trimmed.slice(0, CLOSURE_TYPE_NAME_MAX) : null;
  } else if (rawName != null) {
    warnings.push("closure_type_name con forma inesperada → null");
  }
  return { closureTypeId, closureTypeName, warnings };
}

/** Tope de etiquetas por conversación y de largo de cada una. */
export const LABELS_MAX = 50;
export const LABEL_NAME_MAX = 64;

/**
 * labels crudas → string[] limpio (sin unificar). SOLO nombres de etiqueta: letras, números,
 * guion y guion bajo, hasta LABEL_NAME_MAX caracteres. Cualquier otra cosa (texto con
 * espacios, objetos) se descarta: una etiqueta no es texto libre.
 */
export function normalizeLabels(conv: EmozionConversation | null | undefined): string[] {
  const labels = conv?.labels;
  if (!Array.isArray(labels)) return [];
  const out: string[] = [];
  for (const l of labels) {
    if (typeof l !== "string") continue;
    const name = l.trim();
    if (name.length > 0 && name.length <= LABEL_NAME_MAX && /^[\p{L}\p{N}_-]+$/u.test(name) && !out.includes(name)) out.push(name);
    if (out.length >= LABELS_MAX) break;
  }
  return out;
}

/** Etiquetas del evento si trae la clave `labels` como lista (aunque esté vacía); null si no la trae. */
export function labelsIfPresent(conv: EmozionConversation | null | undefined): string[] | null {
  return Array.isArray(conv?.labels) ? normalizeLabels(conv) : null;
}

function normalizeContact(c: EmozionContact | null | undefined): { phone: string; displayName: string | null } | null {
  const phone = typeof c?.phone_number === "string" && c.phone_number.trim() ? c.phone_number.trim() : null;
  if (!phone) return null; // sin teléfono no hay Customer; no se inventa
  return { phone, displayName: typeof c?.name === "string" && c.name.trim() ? c.name : null };
}

// ── mappers principales ───────────────────────────────────────────────────────────
/**
 * Conversación Emozion → NormalizedConversation. insufficientData si falta el id o el phone,
 * o si hay discrepancia entre candidatos de id de conversación (defensa, no elegir a ciegas).
 */
export function normalizeConversation(conv: EmozionConversation | null | undefined): NormalizeResult<NormalizedConversation> {
  const warnings: string[] = [];
  const { id, discrepancy } = resolveConversationId(conv);
  if (discrepancy) {
    return {
      outcome: "insufficientData",
      data: null,
      warnings: [`ids de conversación discrepantes (id vs messages[0].conversation_id) → no se mapea`],
      authorFallbackCount: 0,
    };
  }
  const contact = normalizeContact(conv?.meta?.sender ?? conv?.contact ?? null);
  if (!id || !contact) {
    return {
      outcome: "insufficientData",
      data: null,
      warnings: [`conversación incompleta (id:${!!id} phone:${!!contact}) → no se mapea`],
      authorFallbackCount: 0,
    };
  }
  const hasAssignee = hasPersonAssignee(conv);
  const st = mapStatus(conv?.status, hasAssignee);
  warnings.push(...st.warnings);
  return {
    outcome: "processed",
    data: {
      externalConversationId: id,
      status: st.status,
      source: "EMOZION",
      customerPhoneSnapshot: contact.phone,
      firstResponseAt: parseTimestamp(conv?.first_reply_created_at),
      closedAt: parseTimestamp(conv?.resolved_at),
      externalCreatedAt: parseTimestamp(conv?.created_at),
      externalLabels: normalizeLabels(conv),
      contact,
      externalAssigneeId: normalizeExternalAssigneeId(conv),
      externalAssigneeType: normalizeExternalAssigneeType(conv),
    },
    warnings,
    authorFallbackCount: 0,
  };
}

/**
 * Mensaje Emozion → NormalizedMessage.
 *  - activity (message_type "activity"/2) → outcome "ignored" (no se persiste).
 *  - sin source_id ni id → insufficientData.
 *  - externalMessageId = source_id ?? "emozion-message:<id>".
 */
export function normalizeMessage(raw: EmozionMessage | null | undefined): NormalizeResult<NormalizedMessage> {
  const warnings: string[] = [];
  const mt = raw?.message_type;

  if (mt === "activity" || mt === 2) {
    return { outcome: "ignored", data: null, warnings: ["activity ignorada (no se persiste)"], authorFallbackCount: 0 };
  }

  const sourceId = typeof raw?.source_id === "string" && raw.source_id ? raw.source_id : null;
  const idStr = raw?.id != null ? String(raw.id) : null;
  const externalMessageId = sourceId ?? (idStr ? `emozion-message:${idStr}` : null);
  if (!externalMessageId) {
    return { outcome: "insufficientData", data: null, warnings: ["mensaje sin source_id ni id → no se mapea"], authorFallbackCount: 0 };
  }

  const { author, fallback } = mapAuthor(raw ?? {});
  if (fallback) warnings.push(`author fallback (outgoing con sender raro/ausente) → OPERATOR; extId=${externalMessageId}`);

  const sentAt = parseTimestamp(raw?.created_at);
  if (!sentAt) warnings.push(`mensaje sin created_at parseable → sentAt centinela; extId=${externalMessageId}`);

  // B2.1 — metadata de adjuntos (todos, no solo [0]); SIN bytes ni URL cruda.
  const att = normalizeAttachments(raw?.attachments, externalMessageId);
  if (att.brokenIdentity) {
    // Adjunto con identidad rota tira insufficientData → el mensaje NO se crea (todo-o-nada).
    // Decisión deliberada: preferimos perder temporalmente el espejo del mensaje y dejar
    // WebhookEvent ERROR reprocesable, antes que crear un mensaje con adjuntos parciales o
    // no idempotentes.
    return {
      outcome: "insufficientData",
      data: null,
      warnings: [...warnings, ...att.warnings],
      authorFallbackCount: fallback ? 1 : 0,
    };
  }

  return {
    outcome: "processed",
    data: {
      externalMessageId,
      externalSenderId: raw?.sender?.id != null ? String(raw.sender.id) : null,
      author,
      body: normalizeMessageBody(raw?.content),
      mediaType: att.attachments[0]?.mediaType ?? null, // compat: file_type del primer adjunto; mediaUrl SIEMPRE null en ingesta
      isPrivate: raw?.private === true,
      sentAt: sentAt ?? new Date(0), // sin timestamp → centinela (warning arriba)
      isActivity: false,
      attachments: att.attachments,
    },
    warnings: [...warnings, ...att.warnings],
    authorFallbackCount: fallback ? 1 : 0,
  };
}

/** Evento de cambio de estado → NormalizedStatusEvent. insufficientData si falta id o hay discrepancia. */
export function normalizeStatusEvent(conv: EmozionConversation | null | undefined): NormalizeResult<NormalizedStatusEvent> {
  const { id, discrepancy } = resolveConversationId(conv);
  if (discrepancy) {
    return { outcome: "insufficientData", data: null, warnings: ["ids de conversación discrepantes → no se mapea"], authorFallbackCount: 0 };
  }
  if (!id) {
    return { outcome: "insufficientData", data: null, warnings: ["status change sin id de conversación → no se mapea"], authorFallbackCount: 0 };
  }
  const hasAssignee = hasPersonAssignee(conv);
  const st = mapStatus(conv?.status, hasAssignee);
  const closure = normalizeClosure(conv);
  return {
    outcome: "processed",
    data: {
      externalConversationId: id,
      status: st.status,
      closedAt: parseTimestamp(conv?.resolved_at),
      externalAssigneeId: normalizeExternalAssigneeId(conv),
      externalAssigneeType: normalizeExternalAssigneeType(conv),
      closureTypeId: closure.closureTypeId,
      closureTypeName: closure.closureTypeName,
      labels: labelsIfPresent(conv),
    },
    warnings: [...st.warnings, ...closure.warnings],
    authorFallbackCount: 0,
  };
}

/**
 * conversation_updated → NormalizedUpdateEvent. Lee SOLO closure_type_id, closure_type_name,
 * meta.assignee.id y los nombres de las etiquetas, con los mismos normalizadores que el
 * cambio de estado. Nunca closure_comment ni otro texto. insufficientData si falta el id o hay discrepancia.
 */
export function normalizeUpdateEvent(conv: EmozionConversation | null | undefined): NormalizeResult<NormalizedUpdateEvent> {
  const { id, discrepancy } = resolveConversationId(conv);
  if (discrepancy) {
    return { outcome: "insufficientData", data: null, warnings: ["ids de conversación discrepantes → no se mapea"], authorFallbackCount: 0 };
  }
  if (!id) {
    return { outcome: "insufficientData", data: null, warnings: ["conversation_updated sin id de conversación → no se mapea"], authorFallbackCount: 0 };
  }
  const closure = normalizeClosure(conv);
  const meta = conv?.meta;
  return {
    outcome: "processed",
    data: {
      externalConversationId: id,
      resolved: conv?.status === "resolved",
      assigneePresent: !!meta && typeof meta === "object" && "assignee" in meta,
      externalAssigneeId: normalizeExternalAssigneeId(conv),
      externalAssigneeType: normalizeExternalAssigneeType(conv),
      closureTypeId: closure.closureTypeId,
      closureTypeName: closure.closureTypeName,
      eventAt: parseTimestamp(conv?.updated_at) ?? parseTimestamp(conv?.resolved_at),
      labels: labelsIfPresent(conv),
    },
    warnings: closure.warnings,
    authorFallbackCount: 0,
  };
}

/** Id externo (string) de una conversación para denormalizar columnas (mismo criterio que los mappers). */
export function conversationExternalId(conv: EmozionConversation | null | undefined): string | null {
  return resolveConversationId(conv).id;
}

/**
 * Localiza, según el eventType, el objeto conversación + el mensaje + el account_id, sin
 * importar la forma del fork (message_created: raíz=mensaje; conversation_*: raíz=conversación).
 * Devuelve siempre el objeto conversación, para que los mappers downstream no sepan de la diferencia.
 */
export function readEnvelope(raw: EmozionWebhookEnvelope | null | undefined): {
  event: string | null;
  accountId: number | null;
  conversation: EmozionConversation | null;
  message: EmozionMessage | null;
} {
  const event = typeof raw?.event === "string" ? raw.event : null;

  if (event === "message_created") {
    const message = (raw as EmozionMessage | null) ?? null; // raíz = mensaje
    const conversation = raw?.conversation ?? null;
    const accountId =
      numOrNull(raw?.account?.id) ?? numOrNull(raw?.account_id) ?? numOrNull(raw?.conversation?.account_id);
    return { event, accountId, conversation, message };
  }

  // conversation_created / conversation_status_changed / otros: raíz = conversación.
  const conversation = (raw as EmozionConversation | null) ?? null;
  const msgs = Array.isArray(raw?.messages) ? raw!.messages! : [];
  const accountId =
    numOrNull(raw?.account_id) ?? numOrNull(raw?.account?.id) ?? numOrNull(msgs[0]?.account_id);
  return { event, accountId, conversation, message: null };
}
