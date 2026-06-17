import type {
  EmozionConversation,
  EmozionMessage,
  EmozionContact,
  EmozionWebhookEnvelope,
  NormalizedConversation,
  NormalizedMessage,
  NormalizedStatusEvent,
  NormalizeResult,
  NormalizedStatus,
  NormalizedAuthor,
} from "./emozion-types";

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
export const SUPPORTED_EVENTS = ["conversation_created", "message_created", "conversation_status_changed"] as const;

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

/** labels crudas → string[] limpio (sin unificar). Staging hacia futuro ConversationTag. */
export function normalizeLabels(conv: EmozionConversation | null | undefined): string[] {
  const labels = conv?.labels;
  if (!Array.isArray(labels)) return [];
  return labels.filter((l): l is string => typeof l === "string" && l.length > 0);
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
  const hasAssignee = Boolean(conv?.meta?.assignee && conv.meta.assignee.id != null);
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

  const att = Array.isArray(raw?.attachments) && raw!.attachments!.length ? raw!.attachments![0] : null;

  return {
    outcome: "processed",
    data: {
      externalMessageId,
      externalSenderId: raw?.sender?.id != null ? String(raw.sender.id) : null,
      author,
      body: typeof raw?.content === "string" ? raw.content : null,
      mediaType: att?.file_type ?? null, // mediaUrl SIEMPRE null en la ingesta
      isPrivate: raw?.private === true,
      sentAt: sentAt ?? new Date(0), // sin timestamp → centinela (warning arriba)
      isActivity: false,
    },
    warnings,
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
  const hasAssignee = Boolean(conv?.meta?.assignee && conv.meta.assignee.id != null);
  const st = mapStatus(conv?.status, hasAssignee);
  return {
    outcome: "processed",
    data: { externalConversationId: id, status: st.status, closedAt: parseTimestamp(conv?.resolved_at) },
    warnings: st.warnings,
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
