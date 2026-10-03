/**
 * B6.3-C4 — Núcleo testeable de POST /api/sync/attachment-copy (el route es un wrapper fino).
 *
 * Orden:
 *  1. ATTACHMENT_COPY_JOB_SECRET ausente o < 32 chars → 503, sin tocar la base.
 *  2. Authorization: Bearer <secret> (timingSafeEqual sobre hashes) → si falla, 401 sin cuerpo.
 *  3. Body JSON opcional { "limit": n } (entero 1–50; ausente/vacío → 25). Inválido → 400
 *     { status: "bad_request" } sin tocar la base. Se valida DESPUÉS de la auth.
 *  4. ATTACHMENT_COPY_JOB_ENABLED !== "true" → SOLO mantenimiento (M1–M3): sin preflight, sin R2,
 *     sin reservar ni copiar → 200 { status: "maintenance_only", maintenance, healthy, durationMs }.
 *  5. Flag "true" → mantenimiento + copia (runAttachmentCopy) con deadline interno de 35 s y la
 *     señal del request → 200 { status: "ok", maintenance, copy, healthy, durationMs }.
 *  6. Error inesperado → 500 { status: "error", code: safeErrorCode } + SyncLog ATTACHMENT_STORAGE.
 *
 * Respuestas: SOLO contadores agregados (whitelist explícita) + stopReason + healthy + duración.
 * Nunca ids, keys, URLs, hostnames ni mensajes de error.
 */
import type { PrismaClient } from "@prisma/client";
import { isUsableSecret, verifyBearer } from "@/lib/sync/bearer-auth";
import { safeErrorCode } from "../safe-error";
import type { MaintenanceResult } from "./maintenance";
import type { MaintenanceOnlyResult } from "./maintenance-runner";
import type { AttachmentCopyRunResult, CopyDeps, RunOptions, StopReason } from "./worker";

export const ENDPOINT_DEADLINE_MS = 35_000;
export const DEFAULT_RUN_LIMIT = 25;
export const MAX_RUN_LIMIT = 50;
const MAX_BODY_CHARS = 1024;

/** stopReason que indican un problema de la corrida (no del archivo) → healthy=false. */
const UNHEALTHY_STOPS: ReadonlySet<StopReason> = new Set<StopReason>(["r2_auth", "config", "preflight", "r2_timeout"]);

export interface EndpointRequest {
  authorization: string | null;
  signal: AbortSignal;
  /** Cuerpo crudo (texto). Solo se lee si la auth pasó. */
  readBody: () => Promise<string>;
}

export interface EndpointResponse {
  status: number;
  /** null = sin cuerpo. */
  body: Record<string, unknown> | null;
}

export interface EndpointDeps {
  env: Record<string, string | undefined>;
  /** Se resuelven LAZY: los caminos 503/401/400 no cargan nada; maintenance_only no carga el SDK. */
  runCopy: (opts: RunOptions, deps: Partial<CopyDeps>) => Promise<AttachmentCopyRunResult>;
  runMaintenanceOnly: () => Promise<MaintenanceOnlyResult>;
  getPrisma: () => Promise<PrismaClient>;
  /** Deps extra para el worker (tests: R2/fetchers falsos). */
  copyDeps?: Partial<CopyDeps>;
  deadlineMs?: number;
  nowMs?: () => number;
}

/** limit del body: ausente/vacío/{} → 25; entero 1–50; cualquier otra cosa → null (400). */
export function parseRunLimit(raw: string): number | null {
  if (raw.length > MAX_BODY_CHARS) return null;
  if (raw.trim() === "") return DEFAULT_RUN_LIMIT;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (keys.some((k) => k !== "limit")) return null;
  if (!("limit" in v)) return DEFAULT_RUN_LIMIT;
  const n = (v as { limit: unknown }).limit;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_RUN_LIMIT ? n : null;
}

function publicMaintenance(m: MaintenanceResult | null) {
  return m ? { leasesRecovered: m.leasesRecovered, attachmentsTtlNoOrigin: m.attachmentsTtlNoOrigin, webhookUrlsCleared: m.webhookUrlsCleared } : null;
}

/** Proyección EXPLÍCITA (whitelist) del resultado: solo números, booleanos y enums fijos. */
function publicCopy(r: AttachmentCopyRunResult) {
  const c = r.copy;
  return {
    enabled: c.enabled,
    preflight: c.preflight,
    reserved: c.reserved,
    stored: c.stored,
    retryScheduled: c.retryScheduled,
    failedTerminal: c.failedTerminal,
    conflicts: c.conflicts,
    leaseLost: c.leaseLost,
    released: c.released,
    aborted: c.aborted,
    stopReason: c.stopReason,
  };
}

export async function handleAttachmentCopy(req: EndpointRequest, deps: EndpointDeps): Promise<EndpointResponse> {
  const now = deps.nowMs ?? Date.now;
  const startedAt = now();

  // 1. Secreto
  const secret = deps.env.ATTACHMENT_COPY_JOB_SECRET;
  if (!isUsableSecret(secret)) return { status: 503, body: { status: "unavailable" } };

  // 2. Auth (nunca se loguea el header)
  if (!verifyBearer(req.authorization, secret)) return { status: 401, body: null };

  // 3. Límite por corrida (después de la auth)
  let raw: string;
  try { raw = await req.readBody(); } catch { return { status: 400, body: { status: "bad_request" } }; }
  const limit = parseRunLimit(raw);
  if (limit === null) return { status: 400, body: { status: "bad_request" } };

  try {
    // 4. Copia apagada → solo mantenimiento
    if (deps.env.ATTACHMENT_COPY_JOB_ENABLED !== "true") {
      const r = await deps.runMaintenanceOnly();
      return { status: 200, body: { status: "maintenance_only", maintenance: publicMaintenance(r.maintenance), healthy: r.ok, durationMs: now() - startedAt } };
    }

    // 5. Mantenimiento + copia
    const result = await deps.runCopy(
      { deadline: startedAt + (deps.deadlineMs ?? ENDPOINT_DEADLINE_MS), signal: req.signal, limit },
      { ...deps.copyDeps, env: deps.env },
    );
    const healthy = result.maintenanceOk && !UNHEALTHY_STOPS.has(result.copy.stopReason);
    return {
      status: 200,
      body: {
        status: "ok",
        maintenance: publicMaintenance(result.maintenanceOk ? result.maintenance : null),
        copy: publicCopy(result),
        healthy,
        durationMs: now() - startedAt,
      },
    };
  } catch (e) {
    // 6. Error inesperado
    const code = safeErrorCode(e, "copy.endpoint");
    console.error("[attachment-copy] endpoint error", JSON.stringify({ code }));
    try {
      await (await deps.getPrisma()).syncLog.create({
        data: {
          source: "ATTACHMENT_STORAGE",
          status: "ERROR",
          message: "attachment-copy: endpoint error",
          rowsProcessed: 0,
          warnings: [`ENDPOINT_ERROR:${code}`],
          syncDate: new Date(),
          triggeredBy: "CRON",
        },
      });
    } catch (le) {
      console.error("[attachment-copy] synclog failed", JSON.stringify({ code: safeErrorCode(le, "copy.endpoint.synclog") }));
    }
    return { status: 500, body: { status: "error", code } };
  }
}
