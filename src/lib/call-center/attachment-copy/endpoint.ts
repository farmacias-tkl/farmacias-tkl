/**
 * B6.3-C4 — Núcleo testeable de POST /api/sync/attachment-copy (el route es un wrapper fino).
 *
 * Orden:
 *  1. ATTACHMENT_COPY_JOB_SECRET ausente o < 32 chars → 503, sin tocar la base.
 *  2. Authorization: Bearer <secret> (timingSafeEqual sobre hashes) → si falla, 401 sin cuerpo.
 *  3. ATTACHMENT_COPY_JOB_ENABLED !== "true" → 200 { status: "disabled" }, sin tocar la base.
 *  4. runAttachmentCopy (mantenimiento M1–M3 + copia) con deadline interno de 40 s desde el
 *     inicio del request y la señal del request como señal externa.
 *  5. Respuesta: SOLO contadores agregados + stopReason + duración. Nunca ids, keys, URLs,
 *     hostnames ni mensajes de error.
 *  6. Error inesperado → 500 { status: "error", code: safeErrorCode } + SyncLog ATTACHMENT_STORAGE.
 */
import type { PrismaClient } from "@prisma/client";
import { isUsableSecret, verifyBearer } from "@/lib/sync/bearer-auth";
import { safeErrorCode } from "../safe-error";
import type { AttachmentCopyRunResult, CopyDeps, RunOptions } from "./worker";

export const ENDPOINT_DEADLINE_MS = 40_000;

export interface EndpointRequest {
  authorization: string | null;
  signal: AbortSignal;
}

export interface EndpointResponse {
  status: number;
  /** null = sin cuerpo. */
  body: Record<string, unknown> | null;
}

export interface EndpointDeps {
  env: Record<string, string | undefined>;
  /** Se resuelven LAZY: los caminos 503/401/disabled no cargan Prisma ni el worker. */
  runCopy: (opts: RunOptions, deps: Partial<CopyDeps>) => Promise<AttachmentCopyRunResult>;
  getPrisma: () => Promise<PrismaClient>;
  /** Deps extra para el worker (tests: R2/fetchers falsos). */
  copyDeps?: Partial<CopyDeps>;
  deadlineMs?: number;
  nowMs?: () => number;
}

/** Proyección EXPLÍCITA (whitelist) del resultado: solo números, booleanos y enums fijos. */
function publicCounters(r: AttachmentCopyRunResult) {
  const m = r.maintenance;
  const c = r.copy;
  return {
    maintenance: {
      leasesRecovered: m.leasesRecovered,
      attachmentsTtlNoOrigin: m.attachmentsTtlNoOrigin,
      webhookUrlsCleared: m.webhookUrlsCleared,
    },
    copy: {
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
    },
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

  // 3. Flag
  if (deps.env.ATTACHMENT_COPY_JOB_ENABLED !== "true") return { status: 200, body: { status: "disabled" } };

  // 4. Corrida
  try {
    const result = await deps.runCopy(
      { deadline: startedAt + (deps.deadlineMs ?? ENDPOINT_DEADLINE_MS), signal: req.signal },
      { ...deps.copyDeps, env: deps.env },
    );
    return { status: 200, body: { status: "ok", ...publicCounters(result), durationMs: now() - startedAt } };
  } catch (e) {
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
