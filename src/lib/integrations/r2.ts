/**
 * Adapter de storage R2 (Cloudflare) / S3-compatible (B6.2, ampliado en B6.3-C1).
 *
 * GENÉRICO: NO importa Prisma ni conoce ConversationAttachment. Solo put/head/get/delete de
 * objetos. La convención de `key` (storageKey), el mapeo a columnas de dominio, la captura de
 * origen y el job de copia viven AFUERA (B6.3) — esto es solo la capa de transporte.
 *
 * INTEGRIDAD (B6.3-C1): R2 NO soporta checksum SHA-256 de objeto completo (solo COMPOSITE /
 * multipart; ver matriz de compatibilidad S3 de Cloudflare) y HeadObject no lo devuelve. Por
 * eso el adapter NO maneja ChecksumSHA256: transporta Content-MD5 (validación de transporte
 * del lado de R2) e If-None-Match:"*" (no pisar un objeto existente). El SHA-256 y el criterio
 * de cierre (GetObject + recálculo) son del worker, no del adapter.
 *
 * NO incluye: signed URLs / preview / download (B3-B), hash ni tope de bytes en getObject
 * (worker), streaming sin contentLength.
 *
 * Inyección de cliente: las operaciones reciben un `S3Client` (vía `getR2Client()` en prod,
 * o un stub en tests). Así los tests no necesitan credenciales ni bucket real.
 */
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { getR2Config, R2StorageError } from "./r2-config";

export type R2ObjectBody = Buffer | Uint8Array | Readable;

export interface PutR2ObjectInput {
  key: string;
  body: R2ObjectBody;
  contentType: string;
  /** REQUERIDO si body es Readable (PutObjectCommand necesita longitud; streaming sin
   *  longitud previa queda para B6.3 con lib-storage). */
  contentLength?: number;
  /** MD5 del body en BASE64 (24 chars, 16 bytes) → header Content-MD5. R2 lo valida del lado
   *  del servidor (BadDigest si no coincide → CHECKSUM_MISMATCH). Inválido → R2StorageError
   *  PERMANENT "invalid contentMd5 input" sin enviar nada. */
  contentMd5?: string;
  /** Solo "*": la escritura falla (412 → PRECONDITION_FAILED) si la key ya existe. */
  ifNoneMatch?: "*";
  metadata?: Record<string, string>;
}

export interface PutR2ObjectResult {
  provider: "R2";
  bucket: string;
  key: string;
  contentType: string;
  sizeBytes?: number;
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
  etag?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
}

export interface GetR2ObjectResult {
  provider: "R2";
  bucket: string;
  key: string;
  /** Body crudo como stream de bytes. SIN hash ni tope: el consumidor (worker) los aplica. */
  body: AsyncIterable<Uint8Array>;
  contentType?: string;
  sizeBytes?: number;
  etag?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
}

// ── Error de dominio + config: viven en r2-config.ts (sin @aws-sdk, B6.3-C2c) ──────────
// Re-exportados acá para no romper la API pública del adapter.
export { getR2Config, R2StorageError, type R2ErrorCode, type R2Config } from "./r2-config";

// ── Cliente (lazy) ──────────────────────────────────────────────────────────────────
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
    // no pedidos; la integridad de transporte va por Content-MD5 explícito.
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

// ── Content-MD5: base64 canónico de exactamente 16 bytes ────────────────────────────
const BASE64_MD5_RE = /^[A-Za-z0-9+/]{22}==$/;

/** ¿Es un MD5 en base64 válido? Forma (24 chars, padding "==") + round-trip canónico a 16 bytes. */
function isValidBase64Md5(v: unknown): v is string {
  if (typeof v !== "string" || !BASE64_MD5_RE.test(v)) return false;
  const bytes = Buffer.from(v, "base64");
  return bytes.length === 16 && bytes.toString("base64") === v;
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
  // Integridad de transporte: R2 rechazó el Content-MD5 (antes de la regla 4xx genérica).
  if (name === "BadDigest" || code === "BadDigest" || name === "InvalidDigest" || code === "InvalidDigest") {
    return new R2StorageError("CHECKSUM_MISMATCH", "R2 rechazó el Content-MD5", e);
  }
  // If-None-Match:"*" sobre key existente (antes de la regla 4xx genérica).
  if (name === "PreconditionFailed" || code === "PreconditionFailed" || status === 412) {
    return new R2StorageError("PRECONDITION_FAILED", "El objeto ya existe (precondición fallida)", e);
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
 * Sube un objeto a R2. Si `body` es Readable, `contentLength` es OBLIGATORIO (no se maneja
 * streaming sin longitud). Transporta `contentMd5` como Content-MD5 e `ifNoneMatch` como
 * If-None-Match. NO envía ningún campo Checksum* (R2 no soporta SHA-256 full-object).
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

  // Content-MD5 = base64 canónico de 16 bytes. Inválido → error claro, sin enviar nada.
  if (input.contentMd5 != null && !isValidBase64Md5(input.contentMd5)) {
    throw new R2StorageError("PERMANENT", "invalid contentMd5 input (se espera MD5 en base64 de 16 bytes)");
  }
  // If-None-Match: solo "*" (defensa runtime además del tipo).
  if (input.ifNoneMatch != null && input.ifNoneMatch !== "*") {
    throw new R2StorageError("PERMANENT", "invalid ifNoneMatch input (solo se admite \"*\")");
  }

  // NOTA (límite del stub): los tests interceptan .send(command) y ven command.input, pero el
  // checksum automático del SDK se inyecta en el MIDDLEWARE (después de construir el comando).
  // Estos tests verifican la capa de COMANDO (lo que ponemos nosotros); que R2 acepte el upload
  // sin CRC32 espurio y valide Content-MD5 se confirma en B6.4 con bucket real, no con stubs.
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: input.key,
    Body: input.body as any,
    ContentType: input.contentType,
    ...(input.contentLength != null ? { ContentLength: input.contentLength } : {}),
    ...(input.contentMd5 != null ? { ContentMD5: input.contentMd5 } : {}),
    ...(input.ifNoneMatch != null ? { IfNoneMatch: input.ifNoneMatch } : {}),
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
    etag: typeof res?.ETag === "string" ? res.ETag : undefined,
    lastModified: res?.LastModified instanceof Date ? res.LastModified : undefined,
    metadata: res?.Metadata && typeof res.Metadata === "object" ? res.Metadata : undefined,
  };
}

/**
 * GET de un objeto. Devuelve el body como stream de bytes + metadata técnica. GENÉRICO: no
 * hashea ni aplica tope de bytes (eso es del worker). Si no existe → R2StorageError(NOT_FOUND).
 * Body ausente o no iterable → R2StorageError(UNKNOWN).
 */
export async function getObject(
  client: R2SendClient,
  bucket: string,
  key: string,
): Promise<GetR2ObjectResult> {
  let res: any;
  try {
    res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e) {
    throw normalizeError(e);
  }
  const body = res?.Body;
  if (!body || typeof body[Symbol.asyncIterator] !== "function") {
    throw new R2StorageError("UNKNOWN", "GetObject sin body legible");
  }
  return {
    provider: "R2",
    bucket,
    key,
    body: body as AsyncIterable<Uint8Array>,
    contentType: typeof res?.ContentType === "string" ? res.ContentType : undefined,
    sizeBytes: typeof res?.ContentLength === "number" ? res.ContentLength : undefined,
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
