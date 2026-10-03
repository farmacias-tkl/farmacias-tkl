/**
 * B6.3-C3 — Worker de copia de adjuntos a storage privado (R2).
 *
 * Flujo de runAttachmentCopy({ deadline, signal }):
 *  1. Mantenimiento (M1/M2/M3) SIEMPRE, aun con la copia apagada.
 *  2. Copia solo con ATTACHMENT_COPY_JOB_ENABLED==="true" + config R2 válida.
 *  3. Preflight: headObject(".preflight") ANTES de reservar; si falla → aborta sin reservar.
 *  4. Reserva en tramos de RESERVE_CHUNK (FOR UPDATE SKIP LOCKED), hasta el deadline/limit.
 *  5. Por ítem: fetch del origen → putObject(Content-MD5, If-None-Match:"*") → GetObject y
 *     recálculo de SHA-256 + tamaño (criterio de cierre) → STORED. PRECONDITION_FAILED →
 *     relectura: hash igual = éxito idempotente; distinto = FAILED terminal CHECKSUM_CONFLICT +
 *     alerta. NUNCA deleteObject.
 *
 * Todos los cierres con FENCING: WHERE id + storageStatus='COPYING' + storageLeaseId. Si 0 filas
 * → lease perdido: no se toca nada. Aborto/deadline sin culpa del archivo → LIBERAR: vuelve a
 * prev_status/prev_next y deshace SU PROPIO incremento de storageAttemptCount.
 *
 * Drena aunque la captura esté apagada: no mira ATTACHMENT_SOURCE_CAPTURE (lo ya capturado se
 * copia; sin URL no se reserva). Este módulo usa el SDK (r2.ts); el webhook NO lo importa.
 *
 * Sumideros (SyncLog / console / storageLastError): SOLO códigos fijos + safeErrorCode + ids
 * (cuid). NUNCA e.message, URL, nombre de archivo ni texto del cliente.
 */
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient, StorageStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { getR2Client, getObject, headObject, putObject, R2StorageError, type R2SendClient } from "@/lib/integrations/r2";
import { getR2Config } from "@/lib/integrations/r2-config";
import { safeErrorCode } from "../safe-error";
import { backoffMs } from "./backoff";
import {
  LEASE_SECONDS, MAX_ATTEMPTS, MAX_OBJECT_BYTES, ORIGIN_FETCH_TIMEOUT_MS, PREFLIGHT_KEY, RESERVE_CHUNK,
  objectKeyFor, type CopyErrorCode,
} from "./constants";
import { createEmozionFetcher } from "./emozion-fetcher";
import { runMaintenance, type MaintenanceResult } from "./maintenance";
import { buildReserveQuery, type ReservedRow } from "./reserve-sql";
import { FetchAbortedError, getSourceFetcher, SourceFetchError, type FetchedObject, type SourceFetcher } from "./source-fetcher";

export interface CopyDeps {
  prisma: PrismaClient;
  /** Cliente R2 + bucket. Si se inyecta, no se exige config R2 en env (tests). */
  r2?: { client: R2SendClient; bucket: string };
  fetchers: readonly SourceFetcher[];
  now: () => Date;
  random: () => number;
  env: Record<string, string | undefined>;
}

export interface RunOptions {
  /** Epoch ms: no se reservan ni se empiezan ítems después de esto. */
  deadline: number;
  signal?: AbortSignal;
  /** Tope de ítems reservados en la corrida. */
  limit?: number;
}

export interface CopyCounters {
  enabled: boolean;
  preflight: "ok" | "failed" | "skipped";
  reserved: number;
  stored: number;
  retryScheduled: number;
  failedTerminal: number;
  conflicts: number;
  leaseLost: number;
  released: number;
  aborted: boolean;
}

export interface AttachmentCopyRunResult {
  maintenance: MaintenanceResult;
  copy: CopyCounters;
}

const DEFAULT_LIMIT = 25;

function r2ConfigValid(): boolean {
  try { getR2Config(); return true; } catch { return false; }
}

type ItemOutcome = "stored" | "retry" | "terminal" | "conflict" | "released" | "leaseLost" | "abortRun";

export async function runAttachmentCopy(opts: RunOptions, partial: Partial<CopyDeps> = {}): Promise<AttachmentCopyRunResult> {
  const d: CopyDeps = {
    prisma: partial.prisma ?? defaultPrisma,
    r2: partial.r2,
    fetchers: partial.fetchers ?? [createEmozionFetcher()],
    now: partial.now ?? (() => new Date()),
    random: partial.random ?? Math.random,
    env: partial.env ?? process.env,
  };
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_LIMIT, 50));
  const copy: CopyCounters = { enabled: false, preflight: "skipped", reserved: 0, stored: 0, retryScheduled: 0, failedTerminal: 0, conflicts: 0, leaseLost: 0, released: 0, aborted: false };
  const warnings: string[] = [];

  // 1. Mantenimiento (siempre)
  const maintenance = await runMaintenance(d.prisma, d.now(), d.fetchers);

  // 2. ¿Copia habilitada?
  copy.enabled = d.env.ATTACHMENT_COPY_JOB_ENABLED === "true" && (!!d.r2 || r2ConfigValid());
  if (!copy.enabled) {
    await writeRunSyncLog(d, maintenance, copy, warnings);
    return { maintenance, copy };
  }

  // 3. Preflight ANTES de reservar
  let r2: { client: R2SendClient; bucket: string };
  try {
    r2 = d.r2 ?? getR2Client();
    try {
      await headObject(r2.client, r2.bucket, PREFLIGHT_KEY);
    } catch (e) {
      if (!(e instanceof R2StorageError && e.code === "NOT_FOUND")) throw e; // NOT_FOUND = acceso OK
    }
    copy.preflight = "ok";
  } catch (e) {
    copy.preflight = "failed";
    copy.aborted = true;
    warnings.push(`PREFLIGHT_FAILED:${safeErrorCode(e, "copy.preflight")}`);
    console.error("[attachment-copy] preflight failed", JSON.stringify({ code: safeErrorCode(e, "copy.preflight") }));
    await writeRunSyncLog(d, maintenance, copy, warnings);
    return { maintenance, copy };
  }

  // 4. Señal de la corrida: deadline o aborto externo.
  const run = new AbortController();
  const onExternal = () => run.abort();
  if (opts.signal) {
    if (opts.signal.aborted) run.abort();
    else opts.signal.addEventListener("abort", onExternal, { once: true });
  }
  const timer = setTimeout(() => run.abort(), Math.max(0, opts.deadline - Date.now()));
  const outOfTime = () => run.signal.aborted || d.now().getTime() >= opts.deadline;

  try {
    outer: for (const fetcher of d.fetchers) {
      while (!outOfTime() && copy.reserved < limit) {
        const leaseId = randomUUID();
        const now = d.now();
        const rows = await d.prisma.$queryRaw<ReservedRow[]>(buildReserveQuery({
          source: fetcher.source,
          maxAttempts: MAX_ATTEMPTS,
          limit: Math.min(RESERVE_CHUNK, limit - copy.reserved),
          leaseId,
          now,
          leaseUntil: new Date(now.getTime() + LEASE_SECONDS * 1000),
        }));
        if (rows.length === 0) break;
        copy.reserved += rows.length;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (outOfTime()) { await count(copy, await release(d, row, leaseId)); continue; }
          const outcome = await processItem(d, r2, row, leaseId, run.signal, warnings);
          await count(copy, outcome);
          if (outcome === "abortRun") {
            copy.aborted = true;
            for (const rest of rows.slice(i + 1)) await count(copy, await release(d, rest, leaseId));
            break outer;
          }
        }
      }
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternal);
  }
  if (opts.signal?.aborted && !copy.aborted) copy.aborted = true;

  await writeRunSyncLog(d, maintenance, copy, warnings);
  return { maintenance, copy };
}

async function count(c: CopyCounters, o: ItemOutcome): Promise<void> {
  switch (o) {
    case "stored": c.stored++; break;
    case "retry": c.retryScheduled++; break;
    case "terminal": c.failedTerminal++; break;
    case "conflict": c.failedTerminal++; c.conflicts++; break;
    case "released": c.released++; break;
    case "leaseLost": c.leaseLost++; break;
    case "abortRun": c.released++; break; // processItem ya liberó el ítem
  }
}

// ── Por ítem ─────────────────────────────────────────────────────────────────────────
async function processItem(
  d: CopyDeps,
  r2: { client: R2SendClient; bucket: string },
  row: ReservedRow,
  leaseId: string,
  runSignal: AbortSignal,
  warnings: string[],
): Promise<ItemOutcome> {
  const fetcher = getSourceFetcher(row.source, d.fetchers);
  if (!fetcher) return fail(d, row, leaseId, "NO_FETCHER", false, warnings);

  // a) descarga del origen
  let fetched: FetchedObject;
  try {
    fetched = await fetcher.fetch(row.sourceFetchUrl, { maxBytes: MAX_OBJECT_BYTES, timeoutMs: ORIGIN_FETCH_TIMEOUT_MS, signal: runSignal });
  } catch (e) {
    if (e instanceof FetchAbortedError || runSignal.aborted) return release(d, row, leaseId);
    if (e instanceof SourceFetchError) return fail(d, row, leaseId, e.code, e.retryable, warnings);
    return fail(d, row, leaseId, "UNKNOWN", true, warnings);
  }

  // b) subida (Content-MD5 + If-None-Match:"*")
  const key = objectKeyFor(row.id);
  let preexisting = false;
  try {
    await putObject(r2.client, r2.bucket, {
      key,
      body: fetched.bytes,
      contentType: fetched.contentType,
      contentLength: fetched.sizeBytes,
      contentMd5: fetched.md5Base64,
      ifNoneMatch: "*",
      metadata: { sha256: fetched.sha256Hex, attachmentid: row.id },
    });
  } catch (e) {
    const r = classifyR2(e);
    if (r === "precondition") preexisting = true;
    else if (r === "abort") { await release(d, row, leaseId); return "abortRun"; }
    else return fail(d, row, leaseId, r, true, warnings);
  }

  // c) verificación: GetObject + recálculo (criterio de cierre)
  let actual: { sha256Hex: string; sizeBytes: number } | null;
  try {
    actual = await digestObject(r2, key);
  } catch (e) {
    const r = classifyR2(e);
    if (r === "abort") { await release(d, row, leaseId); return "abortRun"; }
    return fail(d, row, leaseId, r === "precondition" ? "R2_RETRYABLE" : r, true, warnings);
  }
  const same = actual !== null && actual.sha256Hex === fetched.sha256Hex && actual.sizeBytes === fetched.sizeBytes;
  if (!same) {
    if (preexisting) {
      // Hay un objeto distinto en NUESTRA key: no se pisa (If-None-Match) ni se borra. Alerta.
      warnings.push(`ALERT_CHECKSUM_CONFLICT:${row.id}`);
      console.error("[attachment-copy] CHECKSUM_CONFLICT", JSON.stringify({ attachmentId: row.id }));
      const o = await fail(d, row, leaseId, "CHECKSUM_CONFLICT", false, warnings);
      return o === "terminal" ? "conflict" : o;
    }
    return fail(d, row, leaseId, "CHECKSUM_MISMATCH", true, warnings);
  }

  // d) STORED (fenced), anulando el origen transitorio en el MISMO update
  const res = await d.prisma.conversationAttachment.updateMany({
    where: { id: row.id, storageStatus: "COPYING", storageLeaseId: leaseId },
    data: {
      storageStatus: "STORED",
      storageProvider: "R2",
      storageBucket: r2.bucket,
      storageKey: key,
      storageContentType: fetched.contentType,
      storageSizeBytes: fetched.sizeBytes,
      storageChecksumSha256: fetched.sha256Hex,
      storageCopiedAt: d.now(),
      sourceFetchUrl: null,
      storageLeaseId: null,
      storageNextRetryAt: null,
      storageLastError: null,
    },
  });
  return res.count === 1 ? "stored" : "leaseLost";
}

/** R2StorageError → acción. AUTH/CONFIG = problema de la corrida (no del archivo) → abortar. */
function classifyR2(e: unknown): "precondition" | "abort" | "CHECKSUM_MISMATCH" | "R2_RETRYABLE" | "R2_PERMANENT" {
  if (!(e instanceof R2StorageError)) return "R2_RETRYABLE";
  switch (e.code) {
    case "PRECONDITION_FAILED": return "precondition";
    case "AUTH_ERROR":
    case "CONFIG_MISSING": return "abort";
    case "CHECKSUM_MISMATCH": return "CHECKSUM_MISMATCH";
    case "PERMANENT": return "R2_PERMANENT";
    default: return "R2_RETRYABLE"; // RETRYABLE / NOT_FOUND / UNKNOWN
  }
}

/** Relee el objeto y recalcula SHA-256 + tamaño, con tope (más allá del tope → null = no coincide). */
async function digestObject(r2: { client: R2SendClient; bucket: string }, key: string): Promise<{ sha256Hex: string; sizeBytes: number } | null> {
  const obj = await getObject(r2.client, r2.bucket, key);
  const h = createHash("sha256");
  let size = 0;
  for await (const chunk of obj.body) {
    size += chunk.byteLength;
    if (size > MAX_OBJECT_BYTES) return null;
    h.update(chunk);
  }
  return { sha256Hex: h.digest("hex"), sizeBytes: size };
}

/** Cierre por fallo (fenced). Reintentable con intentos disponibles → FAILED + backoff (URL se conserva). */
async function fail(d: CopyDeps, row: ReservedRow, leaseId: string, code: CopyErrorCode, retryable: boolean, warnings: string[]): Promise<ItemOutcome> {
  const attempts = Number(row.storageAttemptCount);
  const terminal = !retryable || attempts >= MAX_ATTEMPTS;
  const res = await d.prisma.conversationAttachment.updateMany({
    where: { id: row.id, storageStatus: "COPYING", storageLeaseId: leaseId },
    data: terminal
      ? { storageStatus: "FAILED", sourceFetchUrl: null, storageLeaseId: null, storageNextRetryAt: null, storageLastError: code }
      : { storageStatus: "FAILED", storageLeaseId: null, storageNextRetryAt: new Date(d.now().getTime() + backoffMs(attempts, d.random)), storageLastError: code },
  });
  if (res.count === 0) return "leaseLost";
  if (terminal) warnings.push(`FAILED_TERMINAL:${code}:${row.id}`);
  else warnings.push(`RETRY:${code}`);
  return terminal ? "terminal" : "retry";
}

/** Liberar SIN penalizar: vuelve a prev_status/prev_next y deshace su propio incremento (fenced). */
async function release(d: CopyDeps, row: ReservedRow, leaseId: string): Promise<ItemOutcome> {
  const res = await d.prisma.conversationAttachment.updateMany({
    where: { id: row.id, storageStatus: "COPYING", storageLeaseId: leaseId },
    data: {
      storageStatus: row.prev_status as StorageStatus,
      storageNextRetryAt: row.prev_next,
      storageLeaseId: null,
      storageAttemptCount: { decrement: 1 },
    },
  });
  return res.count === 1 ? "released" : "leaseLost";
}

// ── SyncLog (solo en fallo, TTL, aborto, alerta o reintentos) ─────────────────────────
async function writeRunSyncLog(d: CopyDeps, m: MaintenanceResult, c: CopyCounters, warnings: string[]): Promise<void> {
  const severe = c.preflight === "failed" || c.aborted || c.failedTerminal > 0 || c.conflicts > 0 || m.leasesRecovered > 0 || m.attachmentsTtlNoOrigin > 0;
  const mild = c.retryScheduled > 0 || m.webhookUrlsCleared > 0;
  if (!severe && !mild) return;
  const all = [
    ...(m.leasesRecovered ? [`M1_LEASE_EXPIRED_MAX:${m.leasesRecovered}`] : []),
    ...(m.attachmentsTtlNoOrigin ? [`M2_SOURCE_TTL_EXPIRED:${m.attachmentsTtlNoOrigin}`] : []),
    ...(m.webhookUrlsCleared ? [`M3_WEBHOOK_URLS_CLEARED:${m.webhookUrlsCleared}`] : []),
    ...(c.aborted ? ["RUN_ABORTED"] : []),
    ...warnings,
  ].slice(0, 100);
  try {
    await d.prisma.syncLog.create({
      data: {
        source: "ATTACHMENT_STORAGE",
        status: severe ? "ERROR" : "PARTIAL",
        message: `attachment-copy: stored=${c.stored} retry=${c.retryScheduled} terminal=${c.failedTerminal} conflicts=${c.conflicts} released=${c.released} leaseLost=${c.leaseLost} preflight=${c.preflight}`,
        rowsProcessed: c.stored,
        warnings: all,
        syncDate: d.now(),
        triggeredBy: "CRON",
      },
    });
  } catch (e) {
    console.error("[attachment-copy] synclog failed", JSON.stringify({ code: safeErrorCode(e, "copy.synclog") }));
  }
}
