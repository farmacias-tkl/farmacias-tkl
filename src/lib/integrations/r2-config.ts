/**
 * Configuración de R2 y error de dominio del adapter, SIN dependencia de @aws-sdk (B6.3-C2c).
 *
 * Separado de r2.ts para que quien solo necesita saber si la config está completa (p.ej. el
 * gate de captura "on" del webhook Emozion) NO cargue @aws-sdk/client-s3 en su bundle.
 * r2.ts re-exporta todo esto: su API pública no cambia.
 */

// ── Error de dominio (NO HTTP) ──────────────────────────────────────────────────────
export type R2ErrorCode =
  | "CONFIG_MISSING"
  | "AUTH_ERROR"
  | "NOT_FOUND"
  | "RETRYABLE"
  // R2 rechazó el Content-MD5 (BadDigest/InvalidDigest). La comparación SHA-256 post-GetObject
  // del worker también usa este código.
  | "CHECKSUM_MISMATCH"
  // If-None-Match:"*" sobre una key existente (412 / PreconditionFailed).
  | "PRECONDITION_FAILED"
  | "PERMANENT"
  | "UNKNOWN";

/**
 * Error normalizado del adapter. B6.3 (job) decide retry/fail según `code`, sin parsear el
 * error crudo del SDK. NUNCA incluye URL/PII/bytes en el mensaje.
 */
export class R2StorageError extends Error {
  constructor(
    public readonly code: R2ErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "R2StorageError";
  }
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  region: string;
}

// ── Config (lazy, guard manual estilo google-drive.ts) ──────────────────────────────
/** Lee y valida la config R2 desde env. Lanza R2StorageError(CONFIG_MISSING) si falta algo. */
export function getR2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const missing = [
    !accountId && "R2_ACCOUNT_ID",
    !accessKeyId && "R2_ACCESS_KEY_ID",
    !secretAccessKey && "R2_SECRET_ACCESS_KEY",
    !bucket && "R2_BUCKET",
  ].filter(Boolean);
  if (missing.length) {
    throw new R2StorageError("CONFIG_MISSING", `Falta config R2: ${missing.join(", ")}`);
  }
  const endpoint = process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
  const region = process.env.R2_REGION || "auto";
  return { accountId: accountId!, accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!, bucket: bucket!, endpoint, region };
}
