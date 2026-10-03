/**
 * B6.3-C3 — Worker de copia de adjuntos a storage privado (R2).
 *
 * Flujo de runAttachmentCopy({ deadline, signal }):
 *  1. Mantenimiento (M1/M2/M3) SIEMPRE, aun con la copia apagada.
 *  2. Copia solo con ATTACHMENT_COPY_JOB_ENABLED==="true" + config R2 válida.
 *  3. Config de los fetchers (p.ej. allowlist vacía/inválida) → aborto CONFIG sin reservar.
 *  4. Preflight: headObject(".preflight") ANTES de reservar, con la señal de operación; si falla
 *     o no responde a tiempo → no se reserva nada.
 *  5. Reserva en tramos de RESERVE_CHUNK (FOR UPDATE SKIP LOCKED), hasta el deadline/limit.
 *  6. Por ítem: descarga COMPLETA del origen → putObject(Content-MD5, If-None-Match:"*") →
 *     GetObject y recálculo de SHA-256 + tamaño (criterio de cierre) → STORED.
 *     PRECONDITION_FAILED → relectura: hash igual = éxito idempotente (cubre el PUT cortado que
 *     igual llegó); distinto = FAILED terminal CHECKSUM_CONFLICT + alerta. NUNCA deleteObject.
 *
 * Señales: cada operación R2 corre con (señal externa + deadline de la corrida + timeout por
 * operación R2_OP_TIMEOUT_MS) y se cancela de verdad en el SDK. Corte por deadline o por timeout
 * propio → liberar sin penalizar y cortar la corrida (un R2 colgado no consume la corrida).
 * Corte por la señal externa → liberar y marcar aborted.
 *
 * Todos los cierres con FENCING: WHERE id + storageStatus='COPYING' + storageLeaseId. Si 0 filas
 * → lease perdido: no se toca nada. LIBERAR = volver a prev_status/prev_next y deshacer SU PROPIO
 * incremento de storageAttemptCount.
 *
 * Drena aunque la captura esté apagada: no mira ATTACHMENT_SOURCE_CAPTURE (lo ya capturado se
 * copia; sin URL no se reserva). Este módulo usa el SDK (r2.ts); el webhook NO lo importa.
 *
 * Sumideros (SyncLog / console / storageLastError): SOLO códigos fijos + safeErrorCode + ids
 * (cuid) + (solo para redirecciones rechazadas) el hostname del destino. NUNCA e.message, URL,
 * nombre de archivo ni texto del cliente.
 */
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient, StorageStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { getR2Client, getObject, headObject, putObject, R2StorageError, type R2SendClient } from "@/lib/integrations/r2";
import { getR2Config } from "@/lib/integrations/r2-config";
import { safeErrorCode } from "../safe-error";
import { backoffMs } from "./backoff";
import {
  LEASE_SECONDS, MAX_ATTEMPTS, MAX_OBJECT_BYTES, ORIGIN_FETCH_TIMEOUT_MS, PREFLIGHT_KEY, R2_OP_TIMEOUT_MS, RESERVE_CHUNK,
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
  /** Timeout por operación R2 (default R2_OP_TIMEOUT_MS; inyectable en tests). */
  r2OpTimeoutMs: number;
}

export interface RunOptions {
  /** Epoch ms: no se reservan ni se empiezan ítems después de esto; corta operaciones en curso. */
  deadline: number;
  signal?: AbortSignal;
  /** Tope de ítems reservados en la corrida. */
  limit?: number;
}

export type StopReason = "none" | "deadline" | "external" | "r2_timeout" | "r2_auth" | "config" | "preflight";

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
  stopReason: StopReason;
}

export interface AttachmentCopyRunResult {
  maintenance: MaintenanceResult;
  copy: CopyCounters;
}

const DEFAULT_LIMIT = 25;

function r2ConfigValid(): boolean {
  try { getR2Config(); return true; } catch { return false; }
}

type ItemOutcome = "stored" | "retry" | "terminal" | "conflict" | "released" | "leaseLost";
interface ItemResult { outcome: ItemOutcome; stop?: StopReason }

type R2Ctx = { client: R2SendClient; bucket: string };

/** Contexto de cancelación de la corrida: deadline + señal externa. */
class RunControl {
  private readonly ctrl = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly onExternal = () => this.ctrl.abort();
  constructor(private readonly deadline: number, private readonly external: AbortSignal | undefined, private readonly now: () => Date) {
    if (external) {
      if (external.aborted) this.ctrl.abort();
      else external.addEventListener("abort", this.onExternal, { once: true });
    }
    this.timer = setTimeout(() => this.ctrl.abort(), Math.max(0, deadline - Date.now()));
  }
  get signal(): AbortSignal { return this.ctrl.signal; }
  externalAborted(): boolean { return !!this.external?.aborted; }
  outOfTime(): boolean { return this.ctrl.signal.aborted || this.now().getTime() >= this.deadline || Date.now() >= this.deadline; }
  /** Señal para UNA operación R2: corrida (deadline/externa) + timeout propio. */
  op(timeoutMs: number) {
    const ctrl = new AbortController();
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const onRun = () => ctrl.abort();
    if (this.ctrl.signal.aborted) ctrl.abort();
    else this.ctrl.signal.addEventListener("abort", onRun, { once: true });
    return {
      signal: ctrl.signal,
      /** Por qué se cortó (null si no se cortó). */
      reason: (): StopReason | null => (this.externalAborted() ? "external" : this.ctrl.signal.aborted ? "deadline" : timedOut ? "r2_timeout" : null),
      dispose: () => { clearTimeout(t); this.ctrl.signal.removeEventListener("abort", onRun); },
    };
  }
  dispose(): void {
    clearTimeout(this.timer);
    this.external?.removeEventListener("abort", this.onExternal);
  }
}

export async function runAttachmentCopy(opts: RunOptions, partial: Partial<CopyDeps> = {}): Promise<AttachmentCopyRunResult> {
  const d: CopyDeps = {
    prisma: partial.prisma ?? defaultPrisma,
    r2: partial.r2,
    fetchers: partial.fetchers ?? [createEmozionFetcher()],
    now: partial.now ?? (() => new Date()),
    random: partial.random ?? Math.random,
    env: partial.env ?? process.env,
    r2OpTimeoutMs: partial.r2OpTimeoutMs ?? R2_OP_TIMEOUT_MS,
  };
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_LIMIT, 50));
  const copy: CopyCounters = { enabled: false, preflight: "skipped", reserved: 0, stored: 0, retryScheduled: 0, failedTerminal: 0, conflicts: 0, leaseLost: 0, released: 0, aborted: false, stopReason: "none" };
  const warnings: string[] = [];

  // 1. Mantenimiento (siempre)
  const maintenance = await runMaintenance(d.prisma, d.now(), d.fetchers);

  // 2. ¿Copia habilitada?
  copy.enabled = d.env.ATTACHMENT_COPY_JOB_ENABLED === "true" && (!!d.r2 || r2ConfigValid());
  if (!copy.enabled) {
    await writeRunSyncLog(d, maintenance, copy, warnings);
    return { maintenance, copy };
  }

  // 3. Config de los fetchers ANTES de reservar (no se queman intentos por error de config)
  for (const f of d.fetchers) {
    const bad = f.configError?.() ?? null;
    if (bad) {
      copy.aborted = true;
      copy.stopReason = "config";
      warnings.push(`CONFIG_INVALID:${bad}`);
      console.error("[attachment-copy] config invalid", JSON.stringify({ condition: bad }));
      await writeRunSyncLog(d, maintenance, copy, warnings);
      return { maintenance, copy };
    }
  }

  const run = new RunControl(opts.deadline, opts.signal, d.now);
  try {
    // 4. Preflight ANTES de reservar, con la señal de operación (deadline + timeout + externa)
    let r2: R2Ctx;
    const op = run.op(d.r2OpTimeoutMs);
    try {
      r2 = d.r2 ?? getR2Client();
      try {
        await headObject(r2.client, r2.bucket, PREFLIGHT_KEY, { abortSignal: op.signal });
      } catch (e) {
        if (!(e instanceof R2StorageError && e.code === "NOT_FOUND")) throw e; // NOT_FOUND = acceso OK
      }
      copy.preflight = "ok";
    } catch (e) {
      copy.preflight = "failed";
      copy.aborted = true;
      copy.stopReason = op.reason() === "external" ? "external" : "preflight";
      const code = op.reason() ? `copy.preflight|${op.reason()}` : safeErrorCode(e, "copy.preflight");
      warnings.push(`PREFLIGHT_FAILED:${code}`);
      console.error("[attachment-copy] preflight failed", JSON.stringify({ code }));
      await writeRunSyncLog(d, maintenance, copy, warnings);
      return { maintenance, copy };
    } finally {
      op.dispose();
    }

    // 5/6. Reserva por tramos + copia
    outer: for (const fetcher of d.fetchers) {
      while (!run.outOfTime() && copy.reserved < limit) {
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
          if (run.outOfTime()) { count(copy, await release(d, row, leaseId)); continue; }
          const r = await processItem(d, r2, row, leaseId, run, warnings);
          count(copy, r.outcome);
          if (r.stop) {
            copy.stopReason = r.stop;
            if (r.stop === "external" || r.stop === "r2_auth") copy.aborted = true;
            if (r.stop === "r2_timeout") warnings.push("R2_TIMEOUT");
            for (const rest of rows.slice(i + 1)) count(copy, await release(d, rest, leaseId));
            break outer;
          }
        }
      }
    }
    if (copy.stopReason === "none" && run.outOfTime()) copy.stopReason = run.externalAborted() ? "external" : "deadline";
    if (run.externalAborted()) copy.aborted = true;
  } finally {
    run.dispose();
  }

  await writeRunSyncLog(d, maintenance, copy, warnings);
  return { maintenance, copy };
}

function count(c: CopyCounters, o: ItemOutcome): void {
  switch (o) {
    case "stored": c.stored++; break;
    case "retry": c.retryScheduled++; break;
    case "terminal": c.failedTerminal++; break;
    case "conflict": c.failedTerminal++; c.conflicts++; break;
    case "released": c.released++; break;
    case "leaseLost": c.leaseLost++; break;
  }
}

// ── Por ítem ─────────────────────────────────────────────────────────────────────────
async function processItem(d: CopyDeps, r2: R2Ctx, row: ReservedRow, leaseId: string, run: RunControl, warnings: string[]): Promise<ItemResult> {
  const fetcher = getSourceFetcher(row.source, d.fetchers);
  if (!fetcher) return { outcome: await fail(d, row, leaseId, "NO_FETCHER", false, warnings) };

  // a) descarga COMPLETA del origen (todo validado antes del PUT)
  let fetched: FetchedObject;
  try {
    fetched = await fetcher.fetch(row.sourceFetchUrl, {
      maxBytes: MAX_OBJECT_BYTES,
      timeoutMs: ORIGIN_FETCH_TIMEOUT_MS,
      signal: run.signal,
      expectedSizeBytes: row.sizeBytes,
    });
  } catch (e) {
    if (e instanceof FetchAbortedError || run.signal.aborted) {
      return { outcome: await release(d, row, leaseId), stop: run.externalAborted() ? "external" : "deadline" };
    }
    if (e instanceof SourceFetchError) {
      if (e.code === "ORIGIN_REDIRECT_REJECTED" && e.rejectedHost) warnings.push(`REDIRECT_REJECTED_HOST:${e.rejectedHost}`);
      return { outcome: await fail(d, row, leaseId, e.code, e.retryable, warnings) };
    }
    return { outcome: await fail(d, row, leaseId, "UNKNOWN", true, warnings) };
  }

  // b) subida (Content-MD5 + If-None-Match:"*"), cancelable
  const key = objectKeyFor(row.id);
  let preexisting = false;
  {
    const op = run.op(d.r2OpTimeoutMs);
    try {
      await putObject(r2.client, r2.bucket, {
        key,
        body: fetched.bytes,
        contentType: fetched.contentType,
        contentLength: fetched.sizeBytes,
        contentMd5: fetched.md5Base64,
        ifNoneMatch: "*",
        metadata: { sha256: fetched.sha256Hex, attachmentid: row.id },
      }, { abortSignal: op.signal });
    } catch (e) {
      const cut = op.reason();
      if (cut) return { outcome: await release(d, row, leaseId), stop: cut };
      const r = classifyR2(e);
      if (r === "precondition") preexisting = true;
      else if (r === "abort") return { outcome: await release(d, row, leaseId), stop: "r2_auth" };
      else return { outcome: await fail(d, row, leaseId, r, true, warnings) };
    } finally {
      op.dispose();
    }
  }

  // c) verificación: GetObject + recálculo (criterio de cierre), cancelable
  let actual: { sha256Hex: string; sizeBytes: number } | null;
  {
    const op = run.op(d.r2OpTimeoutMs);
    try {
      actual = await digestObject(r2, key, op.signal);
    } catch (e) {
      const cut = op.reason();
      if (cut) return { outcome: await release(d, row, leaseId), stop: cut };
      const r = classifyR2(e);
      if (r === "abort") return { outcome: await release(d, row, leaseId), stop: "r2_auth" };
      return { outcome: await fail(d, row, leaseId, r === "precondition" ? "R2_RETRYABLE" : r, true, warnings) };
    } finally {
      op.dispose();
    }
  }
  const same = actual !== null && actual.sha256Hex === fetched.sha256Hex && actual.sizeBytes === fetched.sizeBytes;
  if (!same) {
    if (preexisting) {
      // Hay un objeto distinto en NUESTRA key: no se pisa (If-None-Match) ni se borra. Alerta.
      warnings.push(`ALERT_CHECKSUM_CONFLICT:${row.id}`);
      console.error("[attachment-copy] CHECKSUM_CONFLICT", JSON.stringify({ attachmentId: row.id }));
      const o = await fail(d, row, leaseId, "CHECKSUM_CONFLICT", false, warnings);
      return { outcome: o === "terminal" ? "conflict" : o };
    }
    return { outcome: await fail(d, row, leaseId, "CHECKSUM_MISMATCH", true, warnings) };
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
  return { outcome: res.count === 1 ? "stored" : "leaseLost" };
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
    default: return "R2_RETRYABLE"; // RETRYABLE / NOT_FOUND / ABORTED sin causa propia / UNKNOWN
  }
}

/** Siguiente chunk del stream, o rechazo si la señal se aborta (un body colgado no bloquea). */
function nextOrAbort<T>(it: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
  if (signal.aborted) return Promise.reject(new R2StorageError("ABORTED", "Operación R2 cancelada"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new R2StorageError("ABORTED", "Operación R2 cancelada"));
    signal.addEventListener("abort", onAbort, { once: true });
    it.next().then(
      (r) => { signal.removeEventListener("abort", onAbort); resolve(r); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

/** Relee el objeto y recalcula SHA-256 + tamaño, con tope (más allá del tope → null = no coincide). */
async function digestObject(r2: R2Ctx, key: string, signal: AbortSignal): Promise<{ sha256Hex: string; sizeBytes: number } | null> {
  const obj = await getObject(r2.client, r2.bucket, key, { abortSignal: signal });
  const it = obj.body[Symbol.asyncIterator]();
  const h = createHash("sha256");
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await nextOrAbort(it, signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_OBJECT_BYTES) return null;
      h.update(value);
    }
  } finally {
    it.return?.().catch(() => {});
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
  const severe = c.preflight === "failed" || c.aborted || c.stopReason === "r2_timeout" || c.failedTerminal > 0 || c.conflicts > 0 || m.leasesRecovered > 0 || m.attachmentsTtlNoOrigin > 0;
  const mild = c.retryScheduled > 0 || m.webhookUrlsCleared > 0;
  if (!severe && !mild) return;
  const all = [
    ...(m.leasesRecovered ? [`M1_LEASE_EXPIRED_MAX:${m.leasesRecovered}`] : []),
    ...(m.attachmentsTtlNoOrigin ? [`M2_SOURCE_TTL_EXPIRED:${m.attachmentsTtlNoOrigin}`] : []),
    ...(m.webhookUrlsCleared ? [`M3_WEBHOOK_URLS_CLEARED:${m.webhookUrlsCleared}`] : []),
    ...(c.aborted ? ["RUN_ABORTED"] : []),
    ...(c.stopReason !== "none" ? [`STOP:${c.stopReason}`] : []),
    ...warnings,
  ].slice(0, 100);
  try {
    await d.prisma.syncLog.create({
      data: {
        source: "ATTACHMENT_STORAGE",
        status: severe ? "ERROR" : "PARTIAL",
        message: `attachment-copy: stored=${c.stored} retry=${c.retryScheduled} terminal=${c.failedTerminal} conflicts=${c.conflicts} released=${c.released} leaseLost=${c.leaseLost} preflight=${c.preflight} stop=${c.stopReason}`,
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
