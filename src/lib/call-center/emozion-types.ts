/**
 * Tipos de la ingesta Emozion (Chatwoot) → TKL (Sprint 4B, commit 2/4).
 *
 * FRONTERA PURA: este archivo y emozion-mappers.ts NO importan Prisma/@prisma/client.
 * Solo conocen la forma de Chatwoot (entrada) y los tipos Normalized* (salida). Los enums
 * de estado/autor se declaran acá como uniones de literales — estructuralmente idénticas a
 * las de Prisma, así ingest.ts (la única frontera impura) las pasa a Prisma sin cast.
 *
 * Dos capas:
 *  - RAW: forma (parcial, defensiva) de los payloads que manda Emozion. Solo tipamos los
 *    campos que LEEMOS. Campos PII que NO se ingieren (custom_attributes,
 *    additional_attributes, data_url, thumb_url, etc.) NO se tipan a propósito.
 *  - NORMALIZED: objetos mínimos y limpios que consumen los upserts de ingest.ts.
 */

/** Espejo de Prisma ConversationStatus (sin importar Prisma — frontera pura). */
export type NormalizedStatus = "PENDIENTE" | "SIN_ASIGNAR" | "ASIGNADA" | "RESUELTA";
/** Espejo de Prisma ConversationMessageAuthor. */
export type NormalizedAuthor = "CUSTOMER" | "BOT" | "OPERATOR";

// ── RAW (Chatwoot) — parcial, defensivo ───────────────────────────────────────────
export interface EmozionSender {
  id?: number | null;
  type?: string | null; // "contact" | "user" | "agent_bot" | ...
}

export interface EmozionAttachment {
  file_type?: string | null; // "image" | "audio" | "file" | ... (solo presencia/tipo)
  // data_url / thumb_url NO se tipan: nunca se ingieren.
}

export interface EmozionMessage {
  id?: number | null;
  content?: string | null;
  message_type?: number | null; // 0 incoming, 1 outgoing, 2 activity, 3 template
  content_type?: string | null;
  source_id?: string | null;
  private?: boolean | null;
  created_at?: number | null; // epoch segundos
  sender?: EmozionSender | null;
  attachments?: EmozionAttachment[] | null;
}

/** Contacto = meta.sender en Chatwoot. Solo phone + name; el resto es PII no ingerida. */
export interface EmozionContact {
  phone_number?: string | null;
  name?: string | null;
}

export interface EmozionConversationMeta {
  sender?: EmozionContact | null;
  assignee?: { id?: number | null } | null;
}

export interface EmozionConversation {
  id?: number | null;
  uuid?: string | null;
  status?: string | null; // pending | open | resolved | snoozed
  account_id?: number | null;
  inbox_id?: number | null;
  first_reply_created_at?: number | null; // epoch segundos
  created_at?: number | null;
  updated_at?: number | null;
  resolved_at?: number | null;
  labels?: string[] | null;
  meta?: EmozionConversationMeta | null;
  contact?: EmozionContact | null; // algunos payloads lo traen top-level
  messages?: EmozionMessage[] | null;
}

/**
 * Envelope del webhook. Chatwoot manda la entidad en el top-level + un campo `event`.
 * Para message_created el top-level ES el mensaje (con `conversation` anidada); para
 * conversation_* el top-level ES la conversación. Defensivo: la forma exacta se
 * confirma contra payloads reales en el commit del endpoint.
 */
export interface EmozionWebhookEnvelope extends EmozionMessage, EmozionConversation {
  event?: string | null;
  account?: { id?: number | null } | null;
  account_id?: number | null;
  conversation?: EmozionConversation | null;
}

// ── NORMALIZED — lo que consumen los upserts ───────────────────────────────────────
export interface NormalizedContact {
  phone: string;
  displayName: string | null;
}

export interface NormalizedConversation {
  externalConversationId: string; // uuid
  status: NormalizedStatus;
  source: "EMOZION";
  customerPhoneSnapshot: string;
  firstResponseAt: Date | null;
  closedAt: Date | null;
  externalCreatedAt: Date | null;
  externalLabels: string[]; // crudas; staging hacia futuro ConversationTag
  contact: NormalizedContact;
}

export interface NormalizedMessage {
  externalMessageId: string;
  externalSenderId: string | null;
  author: NormalizedAuthor;
  body: string | null;
  mediaType: string | null; // file_type; mediaUrl SIEMPRE null en ingesta
  isPrivate: boolean;
  sentAt: Date;
  isActivity: boolean; // message_type 2 → no se persiste como ConversationMessage
}

export interface NormalizedStatusEvent {
  externalConversationId: string;
  status: NormalizedStatus;
  closedAt: Date | null;
  // assignedToUserId NO se deriva de Emozion: el cruce agente Emozion → User TKL es
  // dominio futuro. Una conversación ingerida puede quedar ASIGNADA con assignee null.
}

// ── Resultados ────────────────────────────────────────────────────────────────────
export type IngestOutcome = "processed" | "ignored" | "needsRetry" | "insufficientData";

/** Resultado de un mapper puro: outcome + dato normalizado + warnings + fallback. */
export interface NormalizeResult<T> {
  outcome: IngestOutcome;
  data: T | null;
  warnings: string[];
  authorFallbackCount: number;
}

export interface UpsertConversationResult {
  conversationId: string;
  created: boolean;
  warnings: string[];
}

export interface UpsertMessageResult {
  messageId: string | null;
  created: boolean;
  ignored: boolean; // activity / sin id
  warnings: string[];
}

export interface ApplyStatusResult {
  outcome: IngestOutcome;
  conversationId: string | null;
  warnings: string[];
}
