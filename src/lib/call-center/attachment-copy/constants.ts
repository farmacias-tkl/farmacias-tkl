/**
 * B6.3-C3 — Constantes y códigos del job de copia de adjuntos a storage privado (R2).
 * Códigos de error de ENUM FIJO: son lo único que va a storageLastError / SyncLog / logs.
 */

export const MAX_ATTEMPTS = 5;
export const LEASE_SECONDS = 120;
export const RESERVE_CHUNK = 5;
export const MAX_OBJECT_BYTES = 25 * 1024 * 1024; // 25 MB
export const SOURCE_TTL_HOURS = 72;               // TTL del origen transitorio (Emozion)
export const WEBHOOK_TRANSIENT_TTL_HOURS = 72;    // TTL de WebhookEvent.transientSourceUrls (M3)
export const ORIGIN_FETCH_TIMEOUT_MS = 15_000;

export const OBJECT_KEY_PREFIX = "call-center/attachments/v1/";
/** Key de chequeo de acceso (preflight). No se escribe nunca: NOT_FOUND = acceso OK. */
export const PREFLIGHT_KEY = `${OBJECT_KEY_PREFIX}.preflight`;

/** Key determinística e interna del objeto: solo el cuid del adjunto (sin filename ni ids externos). */
export function objectKeyFor(attachmentId: string): string {
  return `${OBJECT_KEY_PREFIX}${attachmentId}`;
}

export type CopyErrorCode =
  // mantenimiento
  | "SOURCE_TTL_EXPIRED"
  | "LEASE_EXPIRED_MAX"
  // origen
  | "SOURCE_URL_REJECTED"
  | "ORIGIN_REDIRECT_REJECTED"
  | "ORIGIN_GONE"
  | "ORIGIN_HTTP_4XX"
  | "ORIGIN_HTTP_5XX"
  | "ORIGIN_TIMEOUT"
  | "ORIGIN_NETWORK"
  | "UNEXPECTED_CONTENT_TYPE"
  | "TOO_LARGE"
  // storage / integridad
  | "CHECKSUM_MISMATCH"
  | "CHECKSUM_CONFLICT"
  | "R2_RETRYABLE"
  | "R2_PERMANENT"
  // otros
  | "NO_FETCHER"
  | "UNKNOWN";
