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
 * Mappers PUROS Emozion(Chatwoot) → TKL (Sprint 4B, commit 2/4). Sin DB, sin red.
 * FRONTERA PURA: CERO import de Prisma/@prisma/client (los enums son uniones locales).
 * Producen payload MÍNIMO NORMALIZADO: NUNCA custom_attributes/additional_attributes,
 * DNI, domicilio, obra_social, data_url/thumb_url ni URLs completas. No inventan datos.
 */

/** id del agente bot en Emozion (Asistente Virtual), confirmado por el probe de agentes. */
export const BOT_SENDER_ID = 1;

/** Whitelist de eventos que procesa 4B. */
export const SUPPORTED_EVENTS = ["conversation_created", "message_created", "conversation_status_changed"] as const;

// ── helpers ─────────────────────────────────────────────────────────────────────
/** epoch (segundos) → Date; null si no es un número válido. */
export function epochToDate(v: unknown): Date | null {
  return typeof v === "number" && v > 0 ? new Date(v * 1000) : null;
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

/** author de un mensaje. fallback=true marca un outgoing con sender raro/ausente. */
export function mapAuthor(m: EmozionMessage): { author: NormalizedAuthor; fallback: boolean } {
  const mt = Number(m?.message_type);
  const s = m?.sender ?? null;
  if (mt === 0 || s?.type === "contact") return { author: "CUSTOMER", fallback: false };
  if (s?.type === "agent_bot") return { author: "BOT", fallback: false };
  if (Number(s?.id) === BOT_SENDER_ID) return { author: "BOT", fallback: false };
  if (s?.type === "user") return { author: "OPERATOR", fallback: false };
  // outgoing con sender raro/ausente: OPERATOR solo como fallback técnico, marcado.
  return { author: "OPERATOR", fallback: true };
}

/** labels crudas → string[] limpio (sin unificar). Staging hacia futuro ConversationTag. */
export function normalizeLabels(raw: EmozionConversation | EmozionWebhookEnvelope | null | undefined): string[] {
  const labels = (raw as EmozionConversation | null)?.labels;
  if (!Array.isArray(labels)) return [];
  return labels.filter((l): l is string => typeof l === "string" && l.length > 0);
}

function normalizeContact(c: EmozionContact | null | undefined): { phone: string; displayName: string | null } | null {
  const phone = typeof c?.phone_number === "string" && c.phone_number.trim() ? c.phone_number.trim() : null;
  if (!phone) return null; // sin teléfono no hay Customer; no se inventa
  return { phone, displayName: typeof c?.name === "string" && c.name.trim() ? c.name : null };
}

// ── mappers principales ───────────────────────────────────────────────────────────
/** Conversación Emozion → NormalizedConversation. insufficientData si falta uuid o phone. */
export function normalizeConversation(raw: EmozionConversation | null | undefined): NormalizeResult<NormalizedConversation> {
  const warnings: string[] = [];
  const uuid = typeof raw?.uuid === "string" && raw.uuid ? raw.uuid : null;
  const contactRaw = raw?.meta?.sender ?? raw?.contact ?? null;
  const contact = normalizeContact(contactRaw);
  if (!uuid || !contact) {
    return {
      outcome: "insufficientData",
      data: null,
      warnings: [`conversación incompleta (uuid:${!!uuid} phone:${!!contact}) → no se mapea`],
      authorFallbackCount: 0,
    };
  }
  const hasAssignee = Boolean(raw?.meta?.assignee && raw.meta.assignee.id != null);
  const st = mapStatus(raw?.status, hasAssignee);
  warnings.push(...st.warnings);
  return {
    outcome: "processed",
    data: {
      externalConversationId: uuid,
      status: st.status,
      source: "EMOZION",
      customerPhoneSnapshot: contact.phone,
      firstResponseAt: epochToDate(raw?.first_reply_created_at),
      closedAt: epochToDate(raw?.resolved_at),
      externalCreatedAt: epochToDate(raw?.created_at),
      externalLabels: normalizeLabels(raw),
      contact,
    },
    warnings,
    authorFallbackCount: 0,
  };
}

/**
 * Mensaje Emozion → NormalizedMessage.
 *  - activity (message_type 2) → outcome "ignored" (no se persiste).
 *  - sin source_id ni id → insufficientData.
 *  - externalMessageId = source_id ?? "emozion-message:<id>".
 */
export function normalizeMessage(raw: EmozionMessage | null | undefined): NormalizeResult<NormalizedMessage> {
  const warnings: string[] = [];
  const mt = Number(raw?.message_type);

  if (mt === 2) {
    return { outcome: "ignored", data: null, warnings: ["activity (message_type 2) ignorada"], authorFallbackCount: 0 };
  }

  const sourceId = typeof raw?.source_id === "string" && raw.source_id ? raw.source_id : null;
  const idStr = raw?.id != null ? String(raw.id) : null;
  const externalMessageId = sourceId ?? (idStr ? `emozion-message:${idStr}` : null);
  if (!externalMessageId) {
    return { outcome: "insufficientData", data: null, warnings: ["mensaje sin source_id ni id → no se mapea"], authorFallbackCount: 0 };
  }

  const { author, fallback } = mapAuthor(raw ?? {});
  if (fallback) warnings.push(`author fallback (outgoing con sender raro/ausente) → OPERATOR; extId=${externalMessageId}`);

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
      sentAt: epochToDate(raw?.created_at) ?? new Date(0), // sin timestamp real → centinela; el caller puede warninguear
      isActivity: false,
    },
    warnings,
    authorFallbackCount: fallback ? 1 : 0,
  };
}

/** Evento de cambio de estado → NormalizedStatusEvent. insufficientData si falta uuid. */
export function normalizeStatusEvent(raw: EmozionConversation | null | undefined): NormalizeResult<NormalizedStatusEvent> {
  const uuid = typeof raw?.uuid === "string" && raw.uuid ? raw.uuid : null;
  if (!uuid) {
    return { outcome: "insufficientData", data: null, warnings: ["status change sin uuid → no se mapea"], authorFallbackCount: 0 };
  }
  const hasAssignee = Boolean(raw?.meta?.assignee && raw.meta.assignee.id != null);
  const st = mapStatus(raw?.status, hasAssignee);
  return {
    outcome: "processed",
    data: { externalConversationId: uuid, status: st.status, closedAt: epochToDate(raw?.resolved_at) },
    warnings: st.warnings,
    authorFallbackCount: 0,
  };
}

/**
 * Localiza, en el envelope del webhook, el tipo de evento + accountId + las entidades.
 * Defensivo: para message_created el mensaje está en el top-level; para conversation_*
 * la conversación está en el top-level.
 */
export function readEnvelope(raw: EmozionWebhookEnvelope | null | undefined): {
  event: string | null;
  accountId: number | null;
  conversation: EmozionConversation | null;
  message: EmozionMessage | null;
} {
  const event = typeof raw?.event === "string" ? raw.event : null;
  const accountId = (raw?.account?.id ?? raw?.account_id) ?? null;
  const conversation = event === "message_created" ? (raw?.conversation ?? null) : ((raw as EmozionConversation | null) ?? null);
  const message = event === "message_created" ? ((raw as EmozionMessage | null) ?? null) : null;
  return { event, accountId: typeof accountId === "number" ? accountId : null, conversation, message };
}
