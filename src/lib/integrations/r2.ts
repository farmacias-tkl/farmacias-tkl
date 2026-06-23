/**
 * Adapter de storage R2 (Cloudflare) / S3-compatible (B6.2).
 *
 * GENÉRICO: NO importa Prisma ni conoce ConversationAttachment. Solo put/head/delete de
 * objetos. La convención de `key` (storageKey), el mapeo a columnas de dominio, la captura de
 * origen y el job de copia viven AFUERA (B6.3) — esto es solo la capa de transporte.
 *
 * B6.2 NO incluye: signed URLs / preview / download (B3-B), validación de integridad
 * end-to-end (B6.3), streaming sin contentLength (eval @aws-sdk/lib-storage en B6.3).
 *
 * Inyección de cliente: las operaciones reciben un `S3Client` (vía `getR2Client()` en prod,
 * o un stub en tests). Así los tests no necesitan credenciales ni bucket real.
 */
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

export type R2ObjectBody = Buffer | Uint8Array | Readable;

export interface PutR2ObjectInput {
  key: string;
  body: R2ObjectBody;
  contentType: string;
  /** REQUERIDO si body es Readable (PutObjectCommand necesita longitud; streaming sin
   *  longitud previa queda para B6.3 con lib-storage). */
  contentLength?: number;
  /** Checksum SHA-256 en HEX lowercase de 64 chars (formato interno / lo que va a la DB).
   *  Se transporta a R2 convertido a base64 (borde S3). NO se valida integridad en B6.2
   *  (eso es B6.3). Hex inválido → R2StorageError PERMANENT "invalid checksum input". */
  checksumSha256?: string;
  metadata?: Record<string, string>;
}

export interface PutR2ObjectResult {
  provider: "R2";
  bucket: string;
  key: string;
  contentType: string;
  sizeBytes?: number;
  checksumSha256?: string; // HEX lowercase (convertido del base64 que devuelve R2, o el del input)
  etag?: string;           // metadata técnica — NUNCA checksum fuente de verdad
  uploadedAt: Date;
}

export interface HeadR2ObjectResult {
  provider: "R2";
  bucket: string;
  key: string;
  exists: true;
  contentType?: string;
  sizeBytes?: number;
  checksumSha256?: string; // HEX lowercase (convertido del base64 de R2)
  etag?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
}

// ── Error de dominio (NO HTTP) ──────────────────────────────────────────────────────
export type R2ErrorCode =
  | "CONFIG_MISSING"
  | "AUTH_ERROR"
  | "NOT_FOUND"
  | "RETRYABLE"
  // RESERVADO para B6.3: B6.2 NO lo emite porque no valida integridad end-to-end (no compara
  // el checksum esperado contra el del objeto). Queda en el enum para que B6.3 no toque el contrato.
  | "CHECKSUM_MISMATCH"
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

// ── Config / cliente (lazy, guard manual estilo google-drive.ts) ────────────────────
/** Lee y valida la config R2 desde env. Lanza R2StorageError(CONFIG_MISSING) si falta algo. */
export function getR2Config(): { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; endpoint: string; region: string } {
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

/** Crea el S3Client apuntando a R2 (lazy). Los tests inyectan un stub y NO llaman esto. */
export function getR2Client(): { client: S3Client; bucket: string } {
  const cfg = getR2Config();
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // SDK v3 (≥3.729) puede inyectar CRC32 por defecto en uploads. Contra R2/S3-compatible
    // eso puede romper uploads. Configuramos WHEN_REQUIRED para evitar checksums automáticos
    // no pedidos y respetar un checksum provisto explícitamente (ej. nuestro ChecksumSHA256).
    // Nombres verificados por typecheck en el SDK instalado (3.1075). El efecto real contra R2
    // se confirma recién en un gate posterior con bucket real (B6.4/staging), no con stubs.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return { client, bucket: cfg.bucket };
}

// Cliente mínimo que necesitan las operaciones — permite inyectar un stub en tests sin
// depender de la forma completa de S3Client.
export interface R2SendClient {
  send(command: unknown): Promise<any>;
}

// ── Checksum: borde hex (interno/DB) ↔ base64 (S3/R2) ───────────────────────────────
const HEX_SHA256_RE = /^[0-9a-f]{64}$/;

/** hex lowercase de 64 → base64 (formato que espera el header ChecksumSHA256 de S3/R2). */
function hexSha256ToBase64(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}
/** base64 (lo que devuelve R2) → hex lowercase (formato interno / DB). */
function base64Sha256ToHex(b64: string): string {
  return Buffer.from(b64, "base64").toString("hex");
}

// ── Normalización de errores del SDK/stub ───────────────────────────────────────────
function normalizeError(e: unknown): R2StorageError {
  if (e instanceof R2StorageError) return e;
  const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | undefined;
  const name = err?.name ?? "";
  const code = err?.Code ?? "";
  const status = err?.$metadata?.httpStatusCode;

  // No encontrado
  if (name === "NotFound" || name === "NoSuchKey" || code === "NoSuchKey" || status === 404) {
    return new R2StorageError("NOT_FOUND", "Objeto no encontrado", e);
  }
  // Auth / permisos
  if (name === "AccessDenied" || code === "AccessDenied" || name === "InvalidAccessKeyId" ||
      name === "SignatureDoesNotMatch" || status === 401 || status === 403) {
    return new R2StorageError("AUTH_ERROR", "Acceso denegado a R2", e);
  }
  // Transitorio / retryable: red, timeout, throttling, 5xx
  if (name === "TimeoutError" || name === "RequestTimeout" || name === "ThrottlingException" ||
      name === "SlowDown" || (err as { code?: string })?.code === "ECONNRESET" ||
      (err as { code?: string })?.code === "ETIMEDOUT" || (typeof status === "number" && status >= 500)) {
    return new R2StorageError("RETRYABLE", "Error transitorio de R2", e);
  }
  // Cliente 4xx (≠ auth/404): permanente
  if (typeof status === "number" && status >= 400 && status < 500) {
    return new R2StorageError("PERMANENT", "Error permanente de R2", e);
  }
  return new R2StorageError("UNKNOWN", "Error desconocido de R2", e);
}

// ── Operaciones ─────────────────────────────────────────────────────────────────────
/**
 * Sube un objeto a R2. Si `body` es Readable, `contentLength` es OBLIGATORIO (B6.2 no maneja
 * streaming sin longitud). Transporta `checksumSha256` como ChecksumSHA256 (no lo valida).
 */
export async function putObject(
  client: R2SendClient,
  bucket: string,
  input: PutR2ObjectInput,
): Promise<PutR2ObjectResult> {
  // Stream sin longitud → error claro, no fallo opaco del SDK.
  const isStream = typeof (input.body as Readable)?.pipe === "function";
  if (isStream && (input.contentLength == null || !Number.isFinite(input.contentLength))) {
    throw new R2StorageError("PERMANENT", "contentLength es obligatorio cuando body es un stream (B6.2 no soporta streaming sin longitud)");
  }

  // Checksum interno = hex lowercase de 64; al borde S3 va en base64. Hex inválido → error claro.
  let checksumBase64: string | undefined;
  if (input.checksumSha256 != null) {
    if (!HEX_SHA256_RE.test(input.checksumSha256)) {
      throw new R2StorageError("PERMANENT", "invalid checksum input (se espera SHA-256 hex lowercase de 64 chars)");
    }
    checksumBase64 = hexSha256ToBase64(input.checksumSha256);
  }

  // NOTA (límite del stub): los tests interceptan .send(command) y ven command.input, pero el
  // checksum automático del SDK se inyecta en el MIDDLEWARE (después de construir el comando).
  // Estos tests verifican la capa de COMANDO (lo que ponemos nosotros); que R2 acepte el upload
  // sin CRC32 espurio se confirma en B6.4/staging con bucket real, no con stubs.
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: input.key,
    Body: input.body as any,
    ContentType: input.contentType,
    ...(input.contentLength != null ? { ContentLength: input.contentLength } : {}),
    ...(checksumBase64 ? { ChecksumSHA256: checksumBase64 } : {}),
    ...(input.metadata ? { Metadata: input.metadata } : {}),
  });

  let res: any;
  try {
    res = await client.send(command);
  } catch (e) {
    throw normalizeError(e);
  }

  return {
    provider: "R2",
    bucket,
    key: input.key,
    contentType: input.contentType,
    sizeBytes: input.contentLength,
    // R2 devuelve el checksum en base64 → lo normalizamos a hex; si no vino, usamos el del input (ya hex).
    checksumSha256: typeof res?.ChecksumSHA256 === "string" ? base64Sha256ToHex(res.ChecksumSHA256) : input.checksumSha256,
    etag: typeof res?.ETag === "string" ? res.ETag : undefined,
    uploadedAt: new Date(),
  };
}

/**
 * HEAD de un objeto. Si no existe → lanza R2StorageError(NOT_FOUND) (NO devuelve exists:false;
 * el caller distingue por el código de error). Devuelve metadata técnica.
 */
export async function headObject(
  client: R2SendClient,
  bucket: string,
  key: string,
): Promise<HeadR2ObjectResult> {
  let res: any;
  try {
    res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e) {
    throw normalizeError(e);
  }
  return {
    provider: "R2",
    bucket,
    key,
    exists: true,
    contentType: typeof res?.ContentType === "string" ? res.ContentType : undefined,
    sizeBytes: typeof res?.ContentLength === "number" ? res.ContentLength : undefined,
    checksumSha256: typeof res?.ChecksumSHA256 === "string" ? base64Sha256ToHex(res.ChecksumSHA256) : undefined,
    etag: typeof res?.ETag === "string" ? res.ETag : undefined,
    lastModified: res?.LastModified instanceof Date ? res.LastModified : undefined,
    metadata: res?.Metadata && typeof res.Metadata === "object" ? res.Metadata : undefined,
  };
}

/**
 * DELETE de un objeto. Idempotente: borrar un objeto inexistente NO es error (S3/R2 devuelve
 * éxito). Solo normaliza auth/network/permanente.
 */
export async function deleteObject(
  client: R2SendClient,
  bucket: string,
  key: string,
): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e) {
    const norm = normalizeError(e);
    // DeleteObject es idempotente: un NOT_FOUND no debe propagarse como error.
    if (norm.code === "NOT_FOUND") return;
    throw norm;
  }
}
