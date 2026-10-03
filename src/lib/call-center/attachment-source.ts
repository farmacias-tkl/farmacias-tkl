/**
 * B6.3-C2 — Captura del ORIGEN TRANSITORIO de adjuntos Emozion (data_url).
 *
 * data_url es un dato TÓXICO (URL world-readable de un adjunto clínico). Reglas:
 *  - NUNCA va en WebhookEvent.payload, ni a logs, ni a AuditLog, ni a ningún lector.
 *  - Viaja route → processor en WebhookEvent.transientSourceUrls (columna aparte), que se
 *    anula (SQL NULL) al quedar PROCESSED; ERROR/RECEIVED los limpia el barrido TTL (C3).
 *  - En el adjunto queda en sourceFetchUrl hasta que el job de copia (C3) lo consume.
 *
 * Modos (ATTACHMENT_SOURCE_CAPTURE):
 *  - "off" (default / valor inválido): no captura.
 *  - "probe": NO guarda URL; solo loguea la FORMA enmascarada (describeSourceUrlShape), con
 *    tope por instancia (PROBE_MAX) y vencimiento (PROBE_UNTIL). No requiere la copia.
 *  - "on": guarda URLs que pasen la allowlist, SOLO si la copia está lista (E3): job habilitado
 *    + config R2 válida + allowlist no vacía. Si falta algo → se comporta como "off" y avisa una
 *    vez por instancia con el NOMBRE de la condición (nunca valores).
 *
 * Semántica única (E5): PENDING = "tiene URL y la copia va a ocurrir". Sin contexto de captura
 * el adjunto nace NO_ORIGIN 'SOURCE_NOT_CAPTURED'.
 *
 * PURO salvo console.log/warn: sin Prisma, sin red. La validez de la config R2 se inyecta.
 */
import { isUsableAttachmentId, emozionAttachmentSourceExternalId } from "./attachment-identity";

export type CaptureMode = "off" | "probe" | "on";
type Env = Record<string, string | undefined>;

export const MAX_SOURCE_URL_LENGTH = 2048;
const DEFAULT_PROBE_MAX = 5;

// ── Modo y condiciones ───────────────────────────────────────────────────────────────
/** Modo CONFIGURADO (sin evaluar condiciones). Ausente o inválido → "off". */
export function getConfiguredCaptureMode(env: Env = process.env): CaptureMode {
  const v = (env.ATTACHMENT_SOURCE_CAPTURE ?? "").trim().toLowerCase();
  return v === "probe" || v === "on" ? v : "off";
}

// ── Hostnames ────────────────────────────────────────────────────────────────────────
/** Hostname DNS con al menos un punto, labels [a-z0-9-] sin guión en los bordes, ≤ 253. */
const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
/** Sufijos de hosts privados/locales: nunca orígenes válidos. */
const PRIVATE_HOST_SUFFIXES = ["localhost", "local", "internal", "lan", "home.arpa"];

function isPrivateHostname(h: string): boolean {
  return PRIVATE_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

/** ¿hostname público válido? (no IP literal, no privado/local, forma DNS). */
export function isPublicHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h.startsWith("[") || h.includes(":")) return false; // IPv6 literal
  if (IPV4_RE.test(h)) return false;                       // IPv4 literal
  if (isPrivateHostname(h)) return false;
  return HOSTNAME_RE.test(h);
}

/**
 * Allowlist de hostnames (lowercase, sin punto inicial, vacíos ignorados). ESTRICTA: si alguna
 * entrada no es un hostname público válido (IP, privado, con esquema/path/puerto...), la
 * allowlist completa se considera inválida → [] (= sin allowlist: la captura "on" no es
 * efectiva y el job de copia aborta como CONFIG).
 */
export function getAllowedHosts(env: Env = process.env): string[] {
  const hosts = (env.ATTACHMENT_SOURCE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/^\.+/, ""))
    .filter((h) => h.length > 0);
  return hosts.every(isPublicHostname) ? hosts : [];
}

/**
 * Hostname de una URL apto para registrar (SyncLog), y NADA más de la URL: sin esquema, path,
 * query ni fragment. Validado contra [a-z0-9.-]{1,253}; si no cumple → "invalid".
 */
export function hostnameForLog(u: string): string {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return /^[a-z0-9.-]{1,253}$/.test(h) ? h : "invalid";
  } catch {
    return "invalid";
  }
}

export interface CaptureResolution {
  mode: CaptureMode;              // modo EFECTIVO
  allowedHosts: string[];
  /** Solo si se configuró "on" y no es efectivo: NOMBRES de las condiciones faltantes. */
  missing: string[];
}

let warnedOnNotEffective = false;

/**
 * Modo EFECTIVO (E3). "on" requiere ATTACHMENT_COPY_JOB_ENABLED==="true" + config R2 válida
 * (inyectada) + allowlist no vacía; si no, "off" + console.warn una vez por instancia.
 */
export function resolveCaptureMode(env: Env, r2ConfigValid: () => boolean): CaptureResolution {
  const configured = getConfiguredCaptureMode(env);
  const allowedHosts = getAllowedHosts(env);
  if (configured !== "on") return { mode: configured, allowedHosts, missing: [] };

  const missing: string[] = [];
  if (env.ATTACHMENT_COPY_JOB_ENABLED !== "true") missing.push("ATTACHMENT_COPY_JOB_ENABLED");
  let r2Ok = false;
  try { r2Ok = r2ConfigValid(); } catch { r2Ok = false; }
  if (!r2Ok) missing.push("R2_CONFIG");
  if (allowedHosts.length === 0) missing.push("ATTACHMENT_SOURCE_ALLOWED_HOSTS");

  if (missing.length === 0) return { mode: "on", allowedHosts, missing };
  if (!warnedOnNotEffective) {
    warnedOnNotEffective = true;
    console.warn("[attachment-source] ATTACHMENT_SOURCE_CAPTURE=on no efectivo; se comporta como off. Falta:", missing.join(","));
  }
  return { mode: "off", allowedHosts, missing };
}

// ── Validación de URL ────────────────────────────────────────────────────────────────
export type SourceUrlRejectCode = "SOURCE_URL_MISSING" | "SOURCE_URL_REJECTED";

/** hostname exacto o subdominio de una entrada de la allowlist. */
export function isHostAllowed(hostname: string, hosts: string[]): boolean {
  const h = hostname.toLowerCase();
  return hosts.some((a) => h === a || h.endsWith(`.${a}`));
}

/** https + sin userinfo + largo ≤ 2048 + host público (no IP/privado) en allowlist. Nunca devuelve ni loguea el valor en error. */
export function validateSourceUrl(
  u: unknown,
  hosts: string[],
): { ok: true; url: string } | { ok: false; code: SourceUrlRejectCode } {
  if (typeof u !== "string" || u.trim().length === 0) return { ok: false, code: "SOURCE_URL_MISSING" };
  if (u.length > MAX_SOURCE_URL_LENGTH) return { ok: false, code: "SOURCE_URL_REJECTED" };
  let url: URL;
  try { url = new URL(u); } catch { return { ok: false, code: "SOURCE_URL_REJECTED" }; }
  if (url.protocol !== "https:") return { ok: false, code: "SOURCE_URL_REJECTED" };
  if (url.username || url.password) return { ok: false, code: "SOURCE_URL_REJECTED" };
  if (!isPublicHostname(url.hostname)) return { ok: false, code: "SOURCE_URL_REJECTED" }; // IP literal / privado
  if (!isHostAllowed(url.hostname, hosts)) return { ok: false, code: "SOURCE_URL_REJECTED" };
  return { ok: true, url: u };
}

// ── transientSourceUrls (route → WebhookEvent → processor) ───────────────────────────
export interface TransientSourceUrlsV1 {
  v: 1;
  urls: Record<string, string>; // sourceExternalId → url válida
  rejected: string[];           // sourceExternalIds con URL presente pero rechazada
}

/**
 * Mapa sourceExternalId → url a partir de los attachments CRUDOS. Las ausentes no se listan
 * (el ingest las marca SOURCE_URL_MISSING). null si no hay attachments con id usable.
 */
export function buildTransientSourceUrls(rawAttachments: unknown, hosts: string[]): TransientSourceUrlsV1 | null {
  if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) return null;
  const urls: Record<string, string> = {};
  const rejected: string[] = [];
  let any = false;
  for (const a of rawAttachments) {
    if (!a || typeof a !== "object" || Array.isArray(a)) continue;
    const att = a as Record<string, unknown>;
    if (!isUsableAttachmentId(att.id)) continue;
    any = true;
    const key = emozionAttachmentSourceExternalId(att.id);
    const r = validateSourceUrl(att.data_url, hosts);
    if (r.ok) urls[key] = r.url;
    else if (r.code === "SOURCE_URL_REJECTED") rejected.push(key);
  }
  return any ? { v: 1, urls, rejected } : null;
}

/**
 * Gate ÚNICO del route para escribir transientSourceUrls en el MISMO webhookEvent.create:
 * "on" efectivo + status RECEIVED + message_created + debug apagado + con adjuntos.
 */
export function transientSourceUrlsForWebhook(args: {
  mode: CaptureMode;
  allowedHosts: string[];
  status: string;
  eventType: string;
  debugCaptureOn: boolean;
  rawAttachments: unknown;
}): TransientSourceUrlsV1 | null {
  if (args.mode !== "on" || args.status !== "RECEIVED" || args.eventType !== "message_created" || args.debugCaptureOn) return null;
  return buildTransientSourceUrls(args.rawAttachments, args.allowedHosts);
}

// ── processor / ingest ───────────────────────────────────────────────────────────────
export interface AttachmentSourceCtx {
  urls: Record<string, string>;
  rejected: string[];
  capturedAt: Date; // receivedAt del WebhookEvent (edad real de la URL para el TTL)
}

/** Lee defensivamente WebhookEvent.transientSourceUrls. Forma inesperada → null (= no capturado). */
export function parseTransientSourceUrls(json: unknown, capturedAt: Date): AttachmentSourceCtx | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (o.v !== 1 || !o.urls || typeof o.urls !== "object" || Array.isArray(o.urls) || !Array.isArray(o.rejected)) return null;
  const urls: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.urls as Record<string, unknown>)) if (typeof v === "string") urls[k] = v;
  const rejected = (o.rejected as unknown[]).filter((x): x is string => typeof x === "string");
  return { urls, rejected, capturedAt };
}

export type InitialStorageFields =
  | { storageStatus: "PENDING"; sourceFetchUrl: string; sourceFetchCapturedAt: Date }
  | { storageStatus: "NO_ORIGIN"; storageLastError: "SOURCE_NOT_CAPTURED" | "SOURCE_URL_REJECTED" | "SOURCE_URL_MISSING" };

/** Campos de storage al CREAR un adjunto (E5). */
export function initialStorageFields(sourceExternalId: string, ctx: AttachmentSourceCtx | null): InitialStorageFields {
  if (!ctx) return { storageStatus: "NO_ORIGIN", storageLastError: "SOURCE_NOT_CAPTURED" };
  const url = ctx.urls[sourceExternalId];
  if (typeof url === "string") return { storageStatus: "PENDING", sourceFetchUrl: url, sourceFetchCapturedAt: ctx.capturedAt };
  if (ctx.rejected.includes(sourceExternalId)) return { storageStatus: "NO_ORIGIN", storageLastError: "SOURCE_URL_REJECTED" };
  return { storageStatus: "NO_ORIGIN", storageLastError: "SOURCE_URL_MISSING" };
}

// ── Probe: forma 100% enmascarada (E4) ───────────────────────────────────────────────
/** Únicos segmentos de path que se conservan literales. Todo otro → token. */
const LITERAL_PATH_SEGMENTS = new Set([
  "rails", "active_storage", "blobs", "representations", "redirect", "proxy",
  "disk", "variants", "uploads", "v1", "v2", "v3",
]);
/** Únicos nombres de query que se conservan (comparación case-insensitive → nombre canónico). */
const LITERAL_QUERY_NAMES = [
  "disposition", "expires", "signature", "response-content-disposition", "response-content-type",
  "X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-SignedHeaders",
  "X-Amz-Signature", "X-Amz-Security-Token", "X-Amz-Content-Sha256",
];
const QUERY_NAME_BY_LOWER = new Map(LITERAL_QUERY_NAMES.map((n) => [n.toLowerCase(), n]));

function tokenizeSegment(s: string): string {
  const kind = /^\d+$/.test(s) ? "num"
    : /^[0-9a-f]+$/i.test(s) ? "hex"
    : /^[A-Za-z0-9_\-=+]+$/.test(s) ? "b64"
    : "other";
  return `{${kind}:${s.length}}`;
}

export type SourceUrlShape =
  | { valid: true; scheme: string; hostname: string; pathPattern: string; queryKeys: string[]; hasUserinfo: boolean; hasFragment: boolean; length: number }
  | { valid: false; length: number };

/**
 * Forma enmascarada de una URL: literal SOLO para la lista fija de segmentos/nombres técnicos;
 * todo otro segmento → "{num|hex|b64|other:len}", el último siempre "{file}"; query names fuera
 * de la lista → "{param}"; NUNCA valores de query, filename ni ids firmados.
 */
export function describeSourceUrlShape(u: string): SourceUrlShape {
  const length = typeof u === "string" ? u.length : 0;
  let url: URL;
  try { url = new URL(u); } catch { return { valid: false, length }; }
  const segs = url.pathname.split("/").filter((s) => s.length > 0);
  const masked = segs.map((s, i) => (i === segs.length - 1 ? "{file}" : LITERAL_PATH_SEGMENTS.has(s.toLowerCase()) ? s.toLowerCase() : tokenizeSegment(s)));
  const queryKeys = [...new Set([...url.searchParams.keys()].map((k) => QUERY_NAME_BY_LOWER.get(k.toLowerCase()) ?? "{param}"))];
  return {
    valid: true,
    scheme: url.protocol.replace(/:$/, ""),
    hostname: url.hostname,
    pathPattern: "/" + masked.join("/"),
    queryKeys,
    hasUserinfo: Boolean(url.username || url.password),
    hasFragment: url.hash.length > 0,
    length,
  };
}

let probeCount = 0;

/** ¿Probe activo? modo "probe" + PROBE_UNTIL ISO válido y futuro + tope por instancia no alcanzado. */
export function isProbeActive(env: Env, now: Date): boolean {
  if (getConfiguredCaptureMode(env) !== "probe") return false;
  const until = Date.parse(env.ATTACHMENT_SOURCE_PROBE_UNTIL ?? "");
  if (!Number.isFinite(until) || until <= now.getTime()) return false;
  const parsedMax = Number.parseInt(env.ATTACHMENT_SOURCE_PROBE_MAX ?? "", 10);
  const max = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_PROBE_MAX;
  return probeCount < max;
}

/**
 * Loguea la forma enmascarada de los data_url del evento (si el probe está activo). NO persiste
 * nada. NUNCA lanza. Devuelve true si logueó (consume una unidad del tope por instancia).
 */
export function maybeProbeSourceUrls(eventId: string, rawAttachments: unknown, env: Env = process.env, now: Date = new Date()): boolean {
  try {
    if (!isProbeActive(env, now) || !Array.isArray(rawAttachments)) return false;
    const shapes = rawAttachments
      .map((a) => (a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>).data_url : undefined))
      .filter((d): d is string => typeof d === "string" && d.length > 0)
      .map((d) => describeSourceUrlShape(d));
    if (shapes.length === 0) return false;
    probeCount++;
    console.log("[attachment-source-probe]", JSON.stringify({ eventId, attachmentCount: rawAttachments.length, shapes }));
    return true;
  } catch {
    return false;
  }
}

/** SOLO tests: resetea el estado por instancia (aviso único y contador del probe). */
export function __resetAttachmentSourceStateForTests(): void {
  warnedOnNotEffective = false;
  probeCount = 0;
}
