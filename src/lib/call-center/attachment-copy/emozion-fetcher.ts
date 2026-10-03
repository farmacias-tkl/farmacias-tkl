/**
 * B6.3-C3 — SourceFetcher de Emozion (data_url).
 *  - validateSourceUrl completo (https, host público en allowlist, sin IP literal/privados, sin
 *    credenciales) ANTES del fetch y en CADA salto de redirección.
 *  - redirect: "manual"; se siguen hasta MAX_REDIRECTS saltos (301/302/303/307/308), con Location
 *    resuelto contra la URL actual. Destino no permitido → ORIGIN_REDIRECT_REJECTED (reintentable,
 *    con SOLO el hostname rechazado para diagnóstico); excedido → TOO_MANY_REDIRECTS (reintentable).
 *    Entre saltos NO se reenvían headers sensibles: solo `accept`, sin credenciales ni cookies.
 *  - Descarga COMPLETA obligatoria (todo antes del PUT; nunca STORED con cuerpo dudoso):
 *    solo HTTP 200 (otro 2xx → INCOMPLETE_RESPONSE); 0 bytes → EMPTY_BODY; con Content-Length y
 *    sin Content-Encoding (o identity) los bytes deben coincidir (INCOMPLETE_BODY); stream cortado
 *    a mitad → INCOMPLETE_BODY; con tamaño informado por el proveedor (> 0) los bytes deben
 *    coincidir (SIZE_MISMATCH). Todos reintentables.
 *  - Tope por Content-Length y por conteo de bytes en el stream → TOO_LARGE (terminal).
 *  - Timeout propio → ORIGIN_TIMEOUT (reintentable); señal de la corrida → FetchAbortedError.
 *  - SHA-256 y MD5 incrementales. NUNCA loguea ni propaga la URL.
 */
import { createHash } from "node:crypto";
import { getAllowedHosts, hostnameForLog, validateSourceUrl } from "../attachment-source";
import { MAX_REDIRECTS, SOURCE_TTL_HOURS } from "./constants";
import { FetchAbortedError, SourceFetchError, type FetchedObject, type SourceFetcher, type SourceFetchLimits } from "./source-fetcher";

const CONTENT_TYPE_RE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const REJECTED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** ÚNICOS headers que se envían (en cada salto). Nada de Authorization/Cookie/etc. */
export const ORIGIN_REQUEST_HEADERS: Readonly<Record<string, string>> = Object.freeze({ accept: "*/*" });

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

    configError(): string | null {
      return allowedHosts().length === 0 ? "ATTACHMENT_SOURCE_ALLOWED_HOSTS" : null;
    },

    async fetch(sourceRef: string, limits: SourceFetchLimits): Promise<FetchedObject> {
      const hosts = allowedHosts();
      const v = validateSourceUrl(sourceRef, hosts);
      if (!v.ok) throw new SourceFetchError("SOURCE_URL_REJECTED", true);
      if (limits.signal?.aborted) throw new FetchAbortedError();

      const link = linkedSignal(limits.timeoutMs, limits.signal);
      const classifyAbort = () => {
        if (limits.signal?.aborted) return new FetchAbortedError();
        if (link.timedOut()) return new SourceFetchError("ORIGIN_TIMEOUT", true);
        return null;
      };
      try {
        // ── Request + redirecciones limitadas ──────────────────────────────────────────
        let current = v.url;
        let res: Response;
        for (let hops = 0; ; hops++) {
          try {
            res = await fetchImpl(current, { method: "GET", redirect: "manual", signal: link.signal, credentials: "omit", headers: { ...ORIGIN_REQUEST_HEADERS } });
          } catch {
            throw classifyAbort() ?? new SourceFetchError("ORIGIN_NETWORK", true);
          }
          if (!(res.status >= 300 && res.status < 400)) break;

          res.body?.cancel().catch(() => {});
          if (!REDIRECT_STATUSES.has(res.status)) throw new SourceFetchError("ORIGIN_REDIRECT_REJECTED", true);
          if (hops >= MAX_REDIRECTS) throw new SourceFetchError("TOO_MANY_REDIRECTS", true);
          const location = res.headers.get("location");
          if (!location) throw new SourceFetchError("ORIGIN_REDIRECT_REJECTED", true);
          let next: string;
          try { next = new URL(location, current).toString(); } catch { throw new SourceFetchError("ORIGIN_REDIRECT_REJECTED", true); }
          const nv = validateSourceUrl(next, hosts); // https, allowlist, sin IP/privado/credenciales
          if (!nv.ok) throw new SourceFetchError("ORIGIN_REDIRECT_REJECTED", true, hostnameForLog(next));
          current = nv.url;
        }

        // ── Status: SOLO 200 ───────────────────────────────────────────────────────────
        const drop = () => { res.body?.cancel().catch(() => {}); };
        if (res.status === 404 || res.status === 410) { drop(); throw new SourceFetchError("ORIGIN_GONE", false); }
        if (res.status >= 500) { drop(); throw new SourceFetchError("ORIGIN_HTTP_5XX", true); }
        if (res.status >= 400) { drop(); throw new SourceFetchError("ORIGIN_HTTP_4XX", true); }
        if (res.status !== 200) { drop(); throw new SourceFetchError("INCOMPLETE_RESPONSE", true); }

        const declaredHeader = res.headers.get("content-length");
        const declared = declaredHeader != null && /^\d+$/.test(declaredHeader.trim()) ? Number(declaredHeader.trim()) : null;
        if (declared != null && declared > limits.maxBytes) { drop(); throw new SourceFetchError("TOO_LARGE", false); }

        const contentType = normalizeContentType(res.headers.get("content-type"));
        if (REJECTED_CONTENT_TYPES.has(contentType)) { drop(); throw new SourceFetchError("UNEXPECTED_CONTENT_TYPE", true); }

        // ── Cuerpo (con tope) ──────────────────────────────────────────────────────────
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
            // Corte a mitad de cuerpo: NUNCA seguir con lo leído.
            throw classifyAbort() ?? new SourceFetchError("INCOMPLETE_BODY", true);
          }
        }

        // ── Descarga completa obligatoria ──────────────────────────────────────────────
        if (size === 0) throw new SourceFetchError("EMPTY_BODY", true);
        const encoding = (res.headers.get("content-encoding") ?? "").trim().toLowerCase();
        if (declared != null && (encoding === "" || encoding === "identity") && size !== declared) {
          throw new SourceFetchError("INCOMPLETE_BODY", true);
        }
        const expected = limits.expectedSizeBytes;
        if (typeof expected === "number" && expected > 0 && size !== expected) {
          throw new SourceFetchError("SIZE_MISMATCH", true);
        }

        return { bytes: Buffer.concat(chunks, size), sizeBytes: size, sha256Hex: sha256.digest("hex"), md5Base64: md5.digest("base64"), contentType };
      } finally {
        link.dispose();
      }
    },
  };
}
