/**
 * B6.3-C3 — Interfaz de descarga del ORIGEN, independiente del proveedor. El worker elige el
 * fetcher por ConversationAttachment.source. Hoy solo EMOZION; un proveedor futuro (p.ej. Meta
 * Cloud API: media con token y URL que expira en minutos) trae su propio TTL y su lógica.
 *
 * `sourceRef` (no "url") a propósito: un fetcher futuro puede recibir un media id y resolver
 * la URL al momento de descargar.
 */
import type { AttachmentSource } from "@prisma/client";
import type { CopyErrorCode } from "./constants";

export interface FetchedObject {
  bytes: Buffer;
  sizeBytes: number;
  sha256Hex: string;
  md5Base64: string;
  contentType: string;
}

export interface SourceFetchLimits {
  maxBytes: number;
  timeoutMs: number;
  /** Señal de la corrida (deadline/aborto externo). Si se dispara → FetchAbortedError. */
  signal?: AbortSignal;
}

export interface SourceFetcher {
  readonly source: AttachmentSource;
  /** TTL del origen transitorio de este proveedor (lo usa M2). */
  readonly sourceTtlMs: number;
  fetch(sourceRef: string, limits: SourceFetchLimits): Promise<FetchedObject>;
}

/** Error de descarga con código de enum fijo. NUNCA lleva URL ni contenido en el mensaje. */
export class SourceFetchError extends Error {
  constructor(public readonly code: CopyErrorCode, public readonly retryable: boolean) {
    super(code);
    this.name = "SourceFetchError";
  }
}

/** La corrida se abortó (deadline / señal externa): NO es culpa del archivo → liberar sin penalizar. */
export class FetchAbortedError extends Error {
  constructor() {
    super("FETCH_ABORTED");
    this.name = "FetchAbortedError";
  }
}

export function getSourceFetcher(source: AttachmentSource, fetchers: readonly SourceFetcher[]): SourceFetcher | null {
  return fetchers.find((f) => f.source === source) ?? null;
}
