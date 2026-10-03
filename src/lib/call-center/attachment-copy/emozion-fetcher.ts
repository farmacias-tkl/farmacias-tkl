/**
 * B6.3-C3 — SourceFetcher de Emozion (data_url).
 *  - validateSourceUrl + allowlist ANTES de cada fetch (la allowlist puede haber cambiado).
 *  - redirect: "manual"; cualquier 3xx → ORIGIN_REDIRECT_REJECTED (REINTENTABLE).
 *  - tope por Content-Length y por conteo de bytes en el stream → TOO_LARGE (terminal).
 *  - timeout propio + señal de la corrida: timeout → ORIGIN_TIMEOUT (reintentable);
 *    señal de la corrida → FetchAbortedError (el worker libera sin penalizar).
 *  - SHA-256 y MD5 incrementales mientras se lee.
 *  - Sin credenciales ni cookies. NUNCA loguea ni propaga la URL.
 */
import { createHash } from "node:crypto";
import { getAllowedHosts, validateSourceUrl } from "../attachment-source";
import { SOURCE_TTL_HOURS } from "./constants";
import { FetchAbortedError, SourceFetchError, type FetchedObject, type SourceFetcher, type SourceFetchLimits } from "./source-fetcher";

const CONTENT_TYPE_RE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const REJECTED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);

/** "type/subtype" en minúsculas, sin parámetros; inválido o ausente → application/octet-stream. */
export function normalizeContentType(header: string | null): string {
  const t = (header ?? "").split(";")[0].trim().toLowerCase();
  return t.length <= 100 && CONTENT_TYPE_RE.test(t) ? t : "application/octet-stream";
}

/** Señal que se aborta por timeout propio o por la señal externa; distingue cuál fue. */
function linkedSignal(timeoutMs: number, external?: AbortSignal) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const onExternal = () => ctrl.abort();
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener("abort", onExternal, { once: true });
  }
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    dispose: () => { clearTimeout(timer); external?.removeEventListener("abort", onExternal); },
  };
}

export interface EmozionFetcherOptions {
  /** Implementación de fetch (tests). Default: fetch global. */
  fetchImpl?: typeof fetch;
  /** Allowlist vigente (tests). Default: ATTACHMENT_SOURCE_ALLOWED_HOSTS. */
  allowedHosts?: () => string[];
}

export function createEmozionFetcher(opts: EmozionFetcherOptions = {}): SourceFetcher {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const allowedHosts = opts.allowedHosts ?? (() => getAllowedHosts(process.env));

  return {
    source: "EMOZION",
    sourceTtlMs: SOURCE_TTL_HOURS * 3600_000,

    async fetch(sourceRef: string, limits: SourceFetchLimits): Promise<FetchedObject> {
      const v = validateSourceUrl(sourceRef, allowedHosts());
      if (!v.ok) throw new SourceFetchError("SOURCE_URL_REJECTED", true);
      if (limits.signal?.aborted) throw new FetchAbortedError();

      const link = linkedSignal(limits.timeoutMs, limits.signal);
      const classifyAbort = () => {
        if (limits.signal?.aborted) return new FetchAbortedError();
        if (link.timedOut()) return new SourceFetchError("ORIGIN_TIMEOUT", true);
        return null;
      };
      try {
        let res: Response;
        try {
          res = await fetchImpl(v.url, { method: "GET", redirect: "manual", signal: link.signal, credentials: "omit" });
        } catch {
          throw classifyAbort() ?? new SourceFetchError("ORIGIN_NETWORK", true);
        }

        const drop = () => { res.body?.cancel().catch(() => {}); };
        if (res.status >= 300 && res.status < 400) { drop(); throw new SourceFetchError("ORIGIN_REDIRECT_REJECTED", true); }
        if (res.status === 404 || res.status === 410) { drop(); throw new SourceFetchError("ORIGIN_GONE", false); }
        if (res.status >= 500) { drop(); throw new SourceFetchError("ORIGIN_HTTP_5XX", true); }
        if (res.status < 200 || res.status >= 300) { drop(); throw new SourceFetchError("ORIGIN_HTTP_4XX", true); }

        const declared = Number(res.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > limits.maxBytes) { drop(); throw new SourceFetchError("TOO_LARGE", false); }

        const contentType = normalizeContentType(res.headers.get("content-type"));
        if (REJECTED_CONTENT_TYPES.has(contentType)) { drop(); throw new SourceFetchError("UNEXPECTED_CONTENT_TYPE", true); }

        const sha256 = createHash("sha256");
        const md5 = createHash("md5");
        const chunks: Buffer[] = [];
        let size = 0;
        if (res.body) {
          const reader = res.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > limits.maxBytes) {
                reader.cancel().catch(() => {});
                throw new SourceFetchError("TOO_LARGE", false);
              }
              const buf = Buffer.from(value);
              sha256.update(buf);
              md5.update(buf);
              chunks.push(buf);
            }
          } catch (e) {
            if (e instanceof SourceFetchError) throw e;
            throw classifyAbort() ?? new SourceFetchError("ORIGIN_NETWORK", true);
          }
        }
        return { bytes: Buffer.concat(chunks, size), sizeBytes: size, sha256Hex: sha256.digest("hex"), md5Base64: md5.digest("base64"), contentType };
      } finally {
        link.dispose();
      }
    },
  };
}
