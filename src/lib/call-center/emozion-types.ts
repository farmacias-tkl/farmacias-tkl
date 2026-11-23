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
  id?: number | string | null; // id ESTABLE del adjunto (contrato real B2.0) → llave de idempotencia
  file_type?: string | null;   // "image" | "audio" | "file" | ... (solo presencia/tipo) → mediaType
  file_size?: number | null;   // bytes → sizeBytes
  // data_url / thumb_url NO se tipan: nunca se ingieren (URLs world-readable).
  // mime_type / content_type / file_name: el fork NO los manda. extension vino null → no se usa.
}

export interface EmozionMessage {
  id?: number | null;
  content?: string | null;
  // Fork real: STRING "incoming" | "outgoing" | "activity" (no el 0/1/2 de Chatwoot estándar).
  message_type?: string | number | null;
  content_type?: string | null;
  source_id?: string | null;
  private?: boolean | null;
  created_at?: string | number | null; // fork real: STRING ISO ("2026-...-03:00")
  conversation_id?: number | null;     // para validación de consistencia (si viene)
  account?: { id?: number | null } | null; // message_created: account.id = account_id real
  account_id?: number | null;
  inbox?: { id?: number | null } | null;
  conversation?: EmozionConversation | null; // message_created: conversación embebida
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
  id?: number | null; // fork real: id NUMÉRICO de la conversación (no hay uuid en el webhook)
  uuid?: string | null;
  status?: string | null; // pending | open | resolved | snoozed
  account_id?: number | null;
  inbox_id?: number | null;
  first_reply_created_at?: string | number | null; // ISO o epoch (parseamos ambos)
  created_at?: string | number | null;
  updated_at?: string | number | null;
  resolved_at?: string | number | null;
  labels?: string[] | null;
  // Tipo de cierre que el operador elige al resolver (catálogo). Visto en la raíz de
  // conversation_status_changed. closure_comment NO se tipa a propósito: es texto libre del
  // operador y nunca se ingiere.
  closure_type_id?: number | string | null;
  closure_type_name?: string | null;
  meta?: EmozionConversationMeta | null;
  contact?: EmozionContact | null; // algunos payloads lo traen top-level
  messages?: EmozionMessage[] | null; // conversation_*: mensajes embebidos (+ account_id en [0])
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
  // id crudo del agente asignado en Emozion (meta.assignee.id). Opcional: los WebhookEvent
  // guardados antes de este campo no lo traen → se lee como null.
  externalAssigneeId?: string | null;
}

/**
 * Adjunto normalizado (B2.1): metadata MÍNIMA, SIN bytes ni URL cruda. documentType NO se
 * setea acá — lo pone el ingest (B2.2) como UNKNOWN. mimeType/originalFileName van null
 * porque el fork NO los manda (contrato real confirmado en la captura B2.0).
 */
export interface NormalizedAttachment {
  sourceExternalId: string;        // "emozion-attachment:<id>" — id estable del fork (idempotencia)
  mediaType: string | null;        // file_type
  sizeBytes: number | null;        // file_size
  mimeType: string | null;         // null — el fork no lo manda
  originalFileName: string | null; // null — el fork no lo manda
}

export interface NormalizedMessage {
  externalMessageId: string;
  externalSenderId: string | null;
  author: NormalizedAuthor;
  body: string | null;
  mediaType: string | null; // file_type del primer adjunto (compat); mediaUrl SIEMPRE null en ingesta
  isPrivate: boolean;
  sentAt: Date;
  isActivity: boolean; // message_type 2 → no se persiste como ConversationMessage
  attachments: NormalizedAttachment[]; // B2.1: metadata de adjuntos (todos), sin bytes/URL. [] si no hay.
}

export interface NormalizedStatusEvent {
  externalConversationId: string;
  status: NormalizedStatus;
  closedAt: Date | null;
  // assignedToUserId NO se deriva de Emozion: el cruce agente Emozion → User TKL es
  // dominio futuro. Una conversación ingerida puede quedar ASIGNADA con assignee null.
  // Los tres siguientes son opcionales: los WebhookEvent guardados antes de estos campos
  // (p. ej. los que quedaron en ERROR) no los traen → se leen como null.
  externalAssigneeId?: string | null; // meta.assignee.id crudo; null = sin asignado
  closureTypeId?: string | null;      // closure_type_id → string
  closureTypeName?: string | null;    // closure_type_name (catálogo); NUNCA closure_comment
}

/**
 * conversation_updated: SOLO tipo de cierre y asignado. Este evento no crea mensajes ni
 * cambia el estado; `resolved` (el estado que informa el evento) se usa únicamente para
 * decidir si el tipo de cierre corresponde a una resolución.
 */
export interface NormalizedUpdateEvent {
  externalConversationId: string;
  /** El evento dice que la conversación está resuelta. No se usa para cambiar el estado. */
  resolved: boolean;
  /** El evento trae la clave meta.assignee (con un asignado o con null). Si no la trae, el asignado no se toca. */
  assigneePresent: boolean;
  externalAssigneeId: string | null;
  closureTypeId: string | null;
  closureTypeName: string | null;
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
