/**
 * SMOKE del job de copia (B6.3-C3) contra una DB Postgres LOCAL EFÍMERA (reserva con SQL real:
 * FOR UPDATE SKIP LOCKED, fencing, mantenimiento). R2 y el fetcher de origen son FAKES en
 * memoria. NO toca Emozion/R2/Neon. Teardown garantizado (DROP al final).
 *
 *   npx tsx src/lib/call-center/attachment-copy/attachment-copy.smoke.ts
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
import type { R2SendClient } from "../../integrations/r2";
import { FetchAbortedError, SourceFetchError, type FetchedObject, type SourceFetcher, type SourceFetchLimits } from "./source-fetcher";
import { MAX_ATTEMPTS, PREFLIGHT_KEY, objectKeyFor, type CopyErrorCode } from "./constants";
import { createEmozionFetcher } from "./emozion-fetcher";

const TEST_DB = "tkl_b63c3_smoke";

function abort(m: string): never { console.error("ABORT:", m); process.exit(1); }
const m = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+?)"?\s*$/m);
if (!m) abort("No encontré DATABASE_URL en .env");
const baseUrl = m[1].trim();
if (!["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname)) abort(`SAFETY ABORT: ${new URL(baseUrl).hostname} no es local. NUNCA Neon.`);
const adminUrl = new URL(baseUrl); adminUrl.pathname = "/postgres";
const testUrl = new URL(baseUrl); testUrl.pathname = `/${TEST_DB}`;
const ADMIN_URL = adminUrl.toString();
const TEST_URL = testUrl.toString();

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
async function adminExec(sql: string) {
  const a = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  try { await a.$executeRawUnsafe(sql); } finally { await a.$disconnect(); }
}

// ── Fakes ─────────────────────────────────────────────────────────────────────────────
const BUCKET = "test-bucket";
const md5b64 = (b: Buffer) => createHash("md5").update(b).digest("base64");
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** R2 en memoria con semántica de Content-MD5 (BadDigest) e If-None-Match:"*" (412). */
class FakeR2 implements R2SendClient {
  objects = new Map<string, { body: Buffer; metadata?: Record<string, string> }>();
  headAuthError = false;
  putAuthError = false;
  putCalls = 0;
  preconditionFailures = 0;
  getCalls = 0;
  deleteCalls = 0;
  /** Operaciones que se "cuelgan" hasta que se aborte su señal (como el SDK con abortSignal). */
  hang = new Set<"head" | "put" | "get">();
  /** PUT que SÍ llega a guardar pero cuya respuesta se pierde (cuelga hasta el abort). */
  putStoresThenHangs = false;
  private hangUntilAbort(options?: { abortSignal?: AbortSignal }): Promise<never> {
    return new Promise((_, reject) => {
      const sig = options?.abortSignal;
      // Sin señal el test fallaría colgado: rechazar tras 5 s para que quede en evidencia.
      if (!sig) { setTimeout(() => reject(new Error("FakeR2: operación colgada SIN abortSignal")), 5000); return; }
      const fire = () => reject({ name: "AbortError" });
      if (sig.aborted) fire(); else sig.addEventListener("abort", fire, { once: true });
    });
  }
  async send(command: any, options?: { abortSignal?: AbortSignal }): Promise<any> {
    const name = command?.constructor?.name;
    const input = command?.input ?? {};
    if (name === "HeadObjectCommand" && this.hang.has("head")) return this.hangUntilAbort(options);
    if (name === "PutObjectCommand" && this.hang.has("put")) { this.putCalls++; return this.hangUntilAbort(options); }
    if (name === "GetObjectCommand" && this.hang.has("get")) { this.getCalls++; return this.hangUntilAbort(options); }
    if (name === "HeadObjectCommand") {
      if (this.headAuthError) throw { name: "AccessDenied", $metadata: { httpStatusCode: 403 } };
      if (!this.objects.has(input.Key)) throw { name: "NotFound", $metadata: { httpStatusCode: 404 } };
      return { ContentLength: this.objects.get(input.Key)!.body.length };
    }
    if (name === "PutObjectCommand") {
      this.putCalls++;
      if (this.putAuthError) throw { name: "AccessDenied", $metadata: { httpStatusCode: 403 } };
      const body = Buffer.from(input.Body);
      if (input.ContentMD5 && input.ContentMD5 !== md5b64(body)) throw { name: "BadDigest", $metadata: { httpStatusCode: 400 } };
      if (input.IfNoneMatch === "*" && this.objects.has(input.Key)) { this.preconditionFailures++; throw { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } }; }
      this.objects.set(input.Key, { body, metadata: input.Metadata });
      if (this.putStoresThenHangs) return this.hangUntilAbort(options);
      return { ETag: '"e"' };
    }
    if (name === "GetObjectCommand") {
      this.getCalls++;
      const o = this.objects.get(input.Key);
      if (!o) throw { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } };
      return { Body: Readable.from([o.body]), ContentLength: o.body.length, Metadata: o.metadata };
    }
    if (name === "DeleteObjectCommand") { this.deleteCalls++; return {}; }
    throw new Error(`comando inesperado: ${name}`);
  }
}

type Behavior = { kind: "ok"; bytes: Buffer; delayMs?: number } | { kind: "error"; code: CopyErrorCode; retryable: boolean } | { kind: "hang" };

/** Fetcher de origen en memoria: comportamiento por URL; cuenta llamadas por URL. */
class FakeFetcher implements SourceFetcher {
  readonly source = "EMOZION" as const;
  readonly sourceTtlMs = 72 * 3600_000;
  behaviors = new Map<string, Behavior>();
  calls = new Map<string, number>();
  async fetch(url: string, limits: SourceFetchLimits): Promise<FetchedObject> {
    this.calls.set(url, (this.calls.get(url) ?? 0) + 1);
    const b = this.behaviors.get(url);
    if (!b) throw new SourceFetchError("ORIGIN_GONE", false);
    if (b.kind === "error") throw new SourceFetchError(b.code, b.retryable);
    if (b.kind === "hang") {
      await new Promise<void>((resolve) => {
        if (limits.signal?.aborted) return resolve();
        limits.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new FetchAbortedError();
    }
    if (b.delayMs) await new Promise((r) => setTimeout(r, b.delayMs));
    return { bytes: b.bytes, sizeBytes: b.bytes.length, sha256Hex: sha256(b.bytes), md5Base64: md5b64(b.bytes), contentType: "image/jpeg" };
  }
}

async function main() {
  console.log("== setup DB efímera ==");
  await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${TEST_DB}"`);
  execSync("npx prisma db push --skip-generate", { stdio: "inherit", env: { ...process.env, DATABASE_URL: TEST_URL } });

  process.env.DATABASE_URL = TEST_URL;
  const { prisma } = await import("../../prisma");
  const { runAttachmentCopy } = await import("./worker");
  const { runMaintenance } = await import("./maintenance");
  const { buildReserveQuery } = await import("./reserve-sql");

  // Captura TODO stdout/stderr de cada corrida para verificar que nunca sale una URL.
  // Reentrante (corridas concurrentes): se instala una vez y se restaura al salir la última.
  let capturedOutput = "";
  let captureDepth = 0;
  const realOut = process.stdout.write.bind(process.stdout), realErr = process.stderr.write.bind(process.stderr);
  async function captured<T>(fn: () => Promise<T>): Promise<T> {
    if (captureDepth++ === 0) {
      (process.stdout as any).write = (c: any) => { capturedOutput += String(c); return true; };
      (process.stderr as any).write = (c: any) => { capturedOutput += String(c); return true; };
    }
    try { return await fn(); }
    finally {
      if (--captureDepth === 0) { (process.stdout as any).write = realOut; (process.stderr as any).write = realErr; }
    }
  }

  let clock = new Date();
  const now = () => new Date(clock.getTime());
  const ENV_ON = { ATTACHMENT_COPY_JOB_ENABLED: "true" }; // captura ausente = "off"
  const run = (r2: FakeR2, fetcher: SourceFetcher, opts: { signal?: AbortSignal; limit?: number; env?: Record<string, string>; deadlineMs?: number; r2OpTimeoutMs?: number } = {}) =>
    captured(() => runAttachmentCopy(
      { deadline: Date.now() + (opts.deadlineMs ?? 30_000), signal: opts.signal, limit: opts.limit ?? 50 },
      { prisma, r2: { client: r2, bucket: BUCKET }, fetchers: [fetcher], now, random: () => 0.5, env: opts.env ?? ENV_ON, ...(opts.r2OpTimeoutMs ? { r2OpTimeoutMs: opts.r2OpTimeoutMs } : {}) },
    ));
  /** Fetcher REAL de Emozion con fetch falso ruteado por URL (Response nueva por llamada). */
  const realFetcher = (routes: Record<string, () => Response>, hosts: string[] = ["files.example", "cdn.example"]) =>
    createEmozionFetcher({
      allowedHosts: () => hosts,
      fetchImpl: (async (url: string) => { const r = routes[url]; if (!r) throw new TypeError("no route"); return r(); }) as unknown as typeof fetch,
    });

  const cust = await prisma.customer.create({ data: { phone: "+5491100000001", displayName: "Cliente" } });
  const conv = await prisma.conversation.create({ data: { customerId: cust.id, status: "SIN_ASIGNAR", source: "EMOZION", externalConversationId: "80001" } });

  let seq = 0;
  const urlFor = (n: number) => `https://files.example/rails/active_storage/blobs/redirect/SENTINEL_SIGNED_${n}/SENTINEL_receta_${n}.jpg`;
  async function mkAtt(o: { url?: string | null; status?: "PENDING" | "FAILED" | "COPYING" | "NO_ORIGIN"; attempts?: number; next?: Date | null; capturedAt?: Date | null; lease?: string | null; createdAt?: Date; sizeBytes?: number | null } = {}) {
    seq++;
    return prisma.conversationAttachment.create({
      data: {
        conversationId: conv.id, source: "EMOZION", sourceExternalId: `emozion-attachment:${90000 + seq}`, mediaType: "image", sizeBytes: o.sizeBytes === undefined ? null : o.sizeBytes,
        storageStatus: o.status ?? "PENDING",
        sourceFetchUrl: o.url === undefined ? urlFor(seq) : o.url,
        sourceFetchCapturedAt: o.capturedAt === undefined ? now() : o.capturedAt,
        storageAttemptCount: o.attempts ?? 0,
        storageNextRetryAt: o.next ?? null,
        storageLeaseId: o.lease ?? null,
        ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      },
    });
  }
  const row = (id: string) => prisma.conversationAttachment.findUniqueOrThrow({ where: { id } });
  async function reset() {
    await prisma.conversationAttachment.deleteMany({});
    await prisma.webhookEvent.deleteMany({});
    await prisma.syncLog.deleteMany({});
    clock = new Date();
  }
  async function assertNoUrlInSinks() {
    const logs = JSON.stringify(await prisma.syncLog.findMany());
    assert.ok(!/SENTINEL|https?:\/\/|receta/.test(logs), "SyncLog sin URL/filename");
    const errs = (await prisma.conversationAttachment.findMany({ select: { storageLastError: true } })).map((r) => r.storageLastError ?? "");
    assert.ok(!errs.some((e) => /SENTINEL|https?:\/\//.test(e)), "storageLastError sin URL");
  }

  try {
    console.log("\n== B6.3-C3: worker de copia ==");

    await check("1. dos workers concurrentes no reservan el mismo adjunto; todos STORED una vez", async () => {
      await reset();
      const r2 = new FakeR2(); const f = new FakeFetcher();
      const atts = [];
      for (let i = 0; i < 12; i++) {
        const a = await mkAtt();
        f.behaviors.set(a.sourceFetchUrl!, { kind: "ok", bytes: Buffer.from(`bytes-${a.id}`), delayMs: 15 });
        atts.push(a);
      }
      const [ra, rb] = await Promise.all([run(r2, f), run(r2, f)]);
      assert.equal(ra.copy.stored + rb.copy.stored, 12);
      assert.ok(ra.copy.stored > 0 && rb.copy.stored > 0, `ambos trabajaron (a=${ra.copy.stored}, b=${rb.copy.stored})`);
      for (const a of atts) assert.equal(f.calls.get(a.sourceFetchUrl!), 1, "cada origen se descargó UNA vez");
      assert.equal(r2.putCalls, 12); assert.equal(r2.preconditionFailures, 0);
      for (const a of atts) {
        const r = await row(a.id);
        assert.equal(r.storageStatus, "STORED");
        assert.equal(r.sourceFetchUrl, null); assert.equal(r.storageLeaseId, null);
        assert.equal(r.storageProvider, "R2"); assert.equal(r.storageBucket, BUCKET);
        assert.equal(r.storageKey, objectKeyFor(a.id));
        assert.equal(r.storageChecksumSha256, sha256(Buffer.from(`bytes-${a.id}`)));
        assert.equal(r.storageSizeBytes, Buffer.from(`bytes-${a.id}`).length);
        assert.equal(r.storageContentType, "image/jpeg");
        assert.ok(r.storageCopiedAt); assert.equal(r.storageAttemptCount, 1);
      }
      assert.equal(await prisma.syncLog.count(), 0, "éxito puro no escribe SyncLog");
    });

    await check("2. lease vencido se re-reserva; vigente no; cierre con lease viejo no pisa", async () => {
      await reset();
      const a = await mkAtt();
      const t0 = now();
      const r1 = await prisma.$queryRaw<any[]>(buildReserveQuery({ source: "EMOZION", maxAttempts: MAX_ATTEMPTS, limit: 5, leaseId: "lease-A", now: t0, leaseUntil: new Date(t0.getTime() + 120_000) }));
      assert.equal(r1.length, 1); assert.equal(r1[0].prev_status, "PENDING"); assert.equal(r1[0].storageAttemptCount, 1);
      const t1 = new Date(t0.getTime() + 60_000); // lease vigente
      const r2 = await prisma.$queryRaw<any[]>(buildReserveQuery({ source: "EMOZION", maxAttempts: MAX_ATTEMPTS, limit: 5, leaseId: "lease-B", now: t1, leaseUntil: new Date(t1.getTime() + 120_000) }));
      assert.equal(r2.length, 0, "lease vigente NO se re-reserva");
      const t2 = new Date(t0.getTime() + 121_000); // lease vencido
      const r3 = await prisma.$queryRaw<any[]>(buildReserveQuery({ source: "EMOZION", maxAttempts: MAX_ATTEMPTS, limit: 5, leaseId: "lease-C", now: t2, leaseUntil: new Date(t2.getTime() + 120_000) }));
      assert.equal(r3.length, 1, "lease vencido se re-reserva"); assert.equal(r3[0].prev_status, "COPYING"); assert.equal(r3[0].storageAttemptCount, 2);
      const old = await prisma.conversationAttachment.updateMany({ where: { id: a.id, storageStatus: "COPYING", storageLeaseId: "lease-A" }, data: { storageStatus: "STORED", sourceFetchUrl: null } });
      assert.equal(old.count, 0, "cierre fenced con el lease viejo → 0 filas");
      const r = await row(a.id);
      assert.equal(r.storageStatus, "COPYING"); assert.equal(r.storageLeaseId, "lease-C"); assert.ok(r.sourceFetchUrl);
    });

    await check("3. último intento varado (COPYING vencido, attempts=MAX) → M1 lo cierra; con attempts<MAX no", async () => {
      await reset();
      const past = new Date(now().getTime() - 1000);
      const stuck = await mkAtt({ status: "COPYING", attempts: MAX_ATTEMPTS, next: past, lease: "lease-X" });
      const notYet = await mkAtt({ status: "COPYING", attempts: 3, next: past, lease: "lease-Y" });
      const res = await captured(() => runMaintenance(prisma, now(), [new FakeFetcher()]));
      assert.equal(res.leasesRecovered, 1);
      const r = await row(stuck.id);
      assert.equal(r.storageStatus, "FAILED"); assert.equal(r.storageLastError, "LEASE_EXPIRED_MAX");
      assert.equal(r.sourceFetchUrl, null); assert.equal(r.storageLeaseId, null); assert.equal(r.storageNextRetryAt, null);
      assert.equal((await row(notYet.id)).storageStatus, "COPYING", "attempts<MAX: lo re-reserva la copia, no M1");
    });

    await check("4a. aborto por AUTH en R2: libera sin penalizar (attempts/estado/nextRetryAt previos), SyncLog", async () => {
      await reset();
      const r2 = new FakeR2(); r2.putAuthError = true; const f = new FakeFetcher();
      const prevNext = new Date(now().getTime() - 5000);
      const a1 = await mkAtt();
      const a2 = await mkAtt({ status: "FAILED", attempts: 2, next: prevNext });
      for (const a of [a1, a2]) f.behaviors.set(a.sourceFetchUrl!, { kind: "ok", bytes: Buffer.from("x") });
      const res = await run(r2, f);
      assert.equal(res.copy.aborted, true); assert.equal(res.copy.stored, 0); assert.equal(res.copy.released, 2);
      const r1 = await row(a1.id), rr2 = await row(a2.id);
      assert.equal(r1.storageStatus, "PENDING"); assert.equal(r1.storageAttemptCount, 0); assert.equal(r1.storageNextRetryAt, null); assert.equal(r1.storageLeaseId, null); assert.ok(r1.sourceFetchUrl);
      assert.equal(rr2.storageStatus, "FAILED"); assert.equal(rr2.storageAttemptCount, 2); assert.equal(rr2.storageNextRetryAt!.getTime(), prevNext.getTime()); assert.ok(rr2.sourceFetchUrl);
      const log = await prisma.syncLog.findFirstOrThrow({ where: { source: "ATTACHMENT_STORAGE" } });
      assert.equal(log.status, "ERROR"); assert.ok(JSON.stringify(log.warnings).includes("RUN_ABORTED"));
      await assertNoUrlInSinks();
    });

    await check("4b. aborto externo durante la descarga: libera sin penalizar", async () => {
      await reset();
      const r2 = new FakeR2(); const f = new FakeFetcher();
      const a = await mkAtt({ status: "FAILED", attempts: 1, next: new Date(now().getTime() - 1000) });
      f.behaviors.set(a.sourceFetchUrl!, { kind: "hang" });
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 50);
      const res = await run(r2, f, { signal: ctrl.signal });
      assert.equal(res.copy.released, 1); assert.equal(res.copy.aborted, true);
      const r = await row(a.id);
      assert.equal(r.storageStatus, "FAILED"); assert.equal(r.storageAttemptCount, 1); assert.equal(r.storageLeaseId, null); assert.ok(r.sourceFetchUrl);
      assert.equal(r2.putCalls, 0);
    });

    await check("4c. preflight falla → corrida abortada SIN reservar nada + SyncLog", async () => {
      await reset();
      const r2 = new FakeR2(); r2.headAuthError = true; const f = new FakeFetcher();
      const a = await mkAtt();
      f.behaviors.set(a.sourceFetchUrl!, { kind: "ok", bytes: Buffer.from("x") });
      const res = await run(r2, f);
      assert.equal(res.copy.preflight, "failed"); assert.equal(res.copy.reserved, 0);
      const r = await row(a.id);
      assert.equal(r.storageStatus, "PENDING"); assert.equal(r.storageAttemptCount, 0);
      assert.equal(f.calls.size, 0); assert.equal(r2.putCalls, 0);
      const log = await prisma.syncLog.findFirstOrThrow({ where: { source: "ATTACHMENT_STORAGE" } });
      assert.equal(log.status, "ERROR"); assert.ok(JSON.stringify(log.warnings).includes("PREFLIGHT_FAILED:copy.preflight|R2StorageError|AUTH_ERROR"));
      await assertNoUrlInSinks();
    });

    await check("5. drenaje con captura OFF (variable ausente): lo ya capturado se copia; copia apagada no reserva", async () => {
      await reset();
      const r2 = new FakeR2(); const f = new FakeFetcher();
      const a = await mkAtt();
      f.behaviors.set(a.sourceFetchUrl!, { kind: "ok", bytes: Buffer.from("drain") });
      const off = await run(r2, f, { env: {} }); // job apagado
      assert.equal(off.copy.enabled, false); assert.equal(off.copy.reserved, 0);
      assert.equal((await row(a.id)).storageStatus, "PENDING");
      const on = await run(r2, f, { env: { ATTACHMENT_COPY_JOB_ENABLED: "true", ATTACHMENT_SOURCE_CAPTURE: "off" } });
      assert.equal(on.copy.stored, 1);
      assert.equal((await row(a.id)).storageStatus, "STORED");
    });

    await check("6a. PRECONDITION_FAILED + hash igual → STORED idempotente, sin delete", async () => {
      await reset();
      const r2 = new FakeR2(); const f = new FakeFetcher();
      const a = await mkAtt(); const bytes = Buffer.from("mismo contenido");
      f.behaviors.set(a.sourceFetchUrl!, { kind: "ok", bytes });
      r2.objects.set(objectKeyFor(a.id), { body: bytes });
      const res = await run(r2, f);
      assert.equal(res.copy.stored, 1); assert.equal(r2.preconditionFailures, 1); assert.equal(r2.deleteCalls, 0);
      const r = await row(a.id);
      assert.equal(r.storageStatus, "STORED"); assert.equal(r.storageChecksumSha256, sha256(bytes)); assert.equal(r.sourceFetchUrl, null);
    });

    await check("6b. PRECONDITION_FAILED + hash distinto → FAILED terminal CHECKSUM_CONFLICT + alerta, sin delete ni pisar", async () => {
      await reset();
      const r2 = new FakeR2(); const f = new FakeFetcher();
      const a = await mkAtt();
      f.behaviors.set(a.sourceFetchUrl!, { kind: "ok", bytes: Buffer.from("nuevo") });
      const other = Buffer.from("OTRO contenido previo");
      r2.objects.set(objectKeyFor(a.id), { body: other });
      const res = await run(r2, f);
      assert.equal(res.copy.conflicts, 1); assert.equal(res.copy.failedTerminal, 1); assert.equal(r2.deleteCalls, 0);
      assert.ok(r2.objects.get(objectKeyFor(a.id))!.body.equals(other), "objeto previo intacto");
      const r = await row(a.id);
      assert.equal(r.storageStatus, "FAILED"); assert.equal(r.storageLastError, "CHECKSUM_CONFLICT"); assert.equal(r.sourceFetchUrl, null); assert.equal(r.storageLeaseId, null);
      const log = await prisma.syncLog.findFirstOrThrow({ where: { source: "ATTACHMENT_STORAGE" } });
      assert.equal(log.status, "ERROR"); assert.ok(JSON.stringify(log.warnings).includes(`ALERT_CHECKSUM_CONFLICT:${a.id}`));
      await assertNoUrlInSinks();
    });

    await check("7a. redirect (reintentable) → FAILED con backoff, URL conservada; SyncLog PARTIAL", async () => {
      await reset();
      const r2 = new FakeR2(); const f = new FakeFetcher();
      const a = await mkAtt();
      f.behaviors.set(a.sourceFetchUrl!, { kind: "error", code: "ORIGIN_REDIRECT_REJECTED", retryable: true });
      const res = await run(r2, f);
      assert.equal(res.copy.retryScheduled, 1);
      const r = await row(a.id);
      assert.equal(r.storageStatus, "FAILED"); assert.equal(r.storageLastError, "ORIGIN_REDIRECT_REJECTED"); assert.ok(r.sourceFetchUrl);
      assert.equal(r.storageAttemptCount, 1); assert.equal(r.storageLeaseId, null);
      assert.equal(r.storageNextRetryAt!.getTime() - now().getTime(), 5 * 60_000, "backoff intento 1 = 5 min (jitter neutro)");
      const log = await prisma.syncLog.findFirstOrThrow({ where: { source: "ATTACHMENT_STORAGE" } });
      assert.equal(log.status, "PARTIAL");
      // backoff respetado: una corrida inmediata no lo vuelve a tomar
      const again = await run(r2, f);
      assert.equal(again.copy.reserved, 0);
      await assertNoUrlInSinks();
    });

    await check("7b. >25 MB (TOO_LARGE) → FAILED terminal, URL NULL", async () => {
      await reset();
      const r2 = new FakeR2(); const f = new FakeFetcher();
      const a = await mkAtt();
      f.behaviors.set(a.sourceFetchUrl!, { kind: "error", code: "TOO_LARGE", retryable: false });
      const res = await run(r2, f);
      assert.equal(res.copy.failedTerminal, 1);
      const r = await row(a.id);
      assert.equal(r.storageStatus, "FAILED"); assert.equal(r.storageLastError, "TOO_LARGE"); assert.equal(r.sourceFetchUrl, null);
    });

    await check("7c. reintentable en el último intento (attempts llega a MAX) → terminal, URL NULL", async () => {
      await reset();
      const r2 = new FakeR2(); const f = new FakeFetcher();
      const a = await mkAtt({ status: "FAILED", attempts: MAX_ATTEMPTS - 1, next: new Date(now().getTime() - 1000) });
      f.behaviors.set(a.sourceFetchUrl!, { kind: "error", code: "ORIGIN_HTTP_5XX", retryable: true });
      const res = await run(r2, f);
      assert.equal(res.copy.failedTerminal, 1);
      const r = await row(a.id);
      assert.equal(r.storageAttemptCount, MAX_ATTEMPTS); assert.equal(r.storageStatus, "FAILED"); assert.equal(r.sourceFetchUrl, null); assert.equal(r.storageNextRetryAt, null);
    });

    await check("7d. BadDigest (Content-MD5 rechazado) → reintentable CHECKSUM_MISMATCH", async () => {
      await reset();
      const r2 = new FakeR2(); const f = new FakeFetcher();
      const a = await mkAtt();
      f.behaviors.set(a.sourceFetchUrl!, { kind: "ok", bytes: Buffer.from("x") });
      const orig = r2.send.bind(r2);
      r2.send = async (c: any) => { if (c?.constructor?.name === "PutObjectCommand") c.input.ContentMD5 = md5b64(Buffer.from("otro")); return orig(c); };
      await run(r2, f);
      const r = await row(a.id);
      assert.equal(r.storageStatus, "FAILED"); assert.equal(r.storageLastError, "CHECKSUM_MISMATCH"); assert.ok(r.sourceFetchUrl);
    });

    await check("8a. M2: TTL de origen vencido → NO_ORIGIN SOURCE_TTL_EXPIRED; no vencido y lease vivo intactos", async () => {
      await reset();
      const old = new Date(now().getTime() - 73 * 3600_000);
      const expired = await mkAtt({ capturedAt: old });
      const expiredFailed = await mkAtt({ status: "FAILED", attempts: 2, next: new Date(now().getTime() + 3600_000), capturedAt: old });
      const fresh = await mkAtt({ capturedAt: new Date(now().getTime() - 71 * 3600_000) });
      const live = await mkAtt({ status: "COPYING", attempts: 1, next: new Date(now().getTime() + 60_000), lease: "live", capturedAt: old });
      const res = await captured(() => runMaintenance(prisma, now(), [new FakeFetcher()]));
      assert.equal(res.attachmentsTtlNoOrigin, 2);
      for (const id of [expired.id, expiredFailed.id]) {
        const r = await row(id);
        assert.equal(r.storageStatus, "NO_ORIGIN"); assert.equal(r.storageLastError, "SOURCE_TTL_EXPIRED"); assert.equal(r.sourceFetchUrl, null);
      }
      assert.equal((await row(fresh.id)).storageStatus, "PENDING");
      const l = await row(live.id);
      assert.equal(l.storageStatus, "COPYING"); assert.ok(l.sourceFetchUrl, "no pisa un lease vigente");
    });

    await check("8b. M3: WebhookEvent RECEIVED/ERROR > 72 h → transientSourceUrls SQL NULL; recientes y PROCESSED intactos", async () => {
      await reset();
      const old = new Date(now().getTime() - 73 * 3600_000);
      const tsu = { v: 1, urls: { "emozion-attachment:1": urlFor(999) }, rejected: [] };
      const mk = (status: "RECEIVED" | "ERROR" | "PROCESSED", receivedAt: Date) =>
        prisma.webhookEvent.create({ data: { source: "EMOZION", eventType: "message_created", accountId: 22, status, receivedAt, transientSourceUrls: tsu }, select: { id: true } });
      const e1 = await mk("ERROR", old), e2 = await mk("RECEIVED", old), e3 = await mk("ERROR", new Date()), e4 = await mk("PROCESSED", old);
      const res = await captured(() => runMaintenance(prisma, now(), [new FakeFetcher()]));
      assert.equal(res.webhookUrlsCleared, 2);
      const isNull = async (id: string) => (await prisma.$queryRaw<{ n: boolean }[]>`SELECT ("transientSourceUrls" IS NULL) AS n FROM "WebhookEvent" WHERE id = ${id}`)[0].n;
      assert.equal(await isNull(e1.id), true); assert.equal(await isNull(e2.id), true);
      assert.equal(await isNull(e3.id), false, "reciente intacto"); assert.equal(await isNull(e4.id), false, "PROCESSED no es de M3");
    });

    await check("9. históricos sin URL intactos (PENDING sin URL, viejos): ninguna fase los toca", async () => {
      await reset();
      const hist = await mkAtt({ url: null, capturedAt: null, createdAt: new Date("2026-06-20T00:00:00Z") });
      const histNoOrigin = await mkAtt({ url: null, capturedAt: null, status: "NO_ORIGIN" });
      const before = [await row(hist.id), await row(histNoOrigin.id)];
      const r2 = new FakeR2(); const f = new FakeFetcher();
      const res = await run(r2, f);
      assert.equal(res.copy.reserved, 0);
      assert.deepEqual([await row(hist.id), await row(histNoOrigin.id)], before);
      assert.equal(await prisma.syncLog.count(), 0);
    });

    // ── Correcciones Codex sobre C3 ────────────────────────────────────────────────────
    console.log("\n== B6.3-C3 fix: descarga completa, redirecciones, cancelación R2, config ==");

    /** Corre una descarga "dudosa" y verifica: no STORED, reintentable con el código, URL intacta, sin PUT. */
    async function expectDubious(make: () => Response, code: string, attOpts: { sizeBytes?: number | null } = {}) {
      await reset();
      const r2 = new FakeR2();
      const a = await mkAtt(attOpts);
      const res = await run(r2, realFetcher({ [a.sourceFetchUrl!]: make }));
      assert.equal(res.copy.stored, 0); assert.equal(res.copy.retryScheduled, 1);
      const r = await row(a.id);
      assert.equal(r.storageStatus, "FAILED"); assert.equal(r.storageLastError, code);
      assert.equal(r.sourceFetchUrl, a.sourceFetchUrl, "URL intacta"); assert.equal(r.storageAttemptCount, 1);
      assert.ok(r.storageNextRetryAt && r.storageNextRetryAt > now(), "con backoff");
      assert.equal(r2.putCalls, 0, "nada se sube con un cuerpo dudoso");
      await assertNoUrlInSinks();
    }

    await check("11a. cuerpo truncado (7 de 100, Content-Length 100) → no STORED, INCOMPLETE_BODY, URL intacta", async () => {
      await expectDubious(() => new Response(Buffer.alloc(7, 1), { status: 200, headers: { "content-length": "100" } }), "INCOMPLETE_BODY");
    });

    await check("11b. stream que se corta a mitad → INCOMPLETE_BODY", async () => {
      await expectDubious(() => {
        let n = 0;
        return new Response(new ReadableStream<Uint8Array>({ pull(c) { if (n++ < 2) c.enqueue(new Uint8Array(10)); else c.error(new Error("reset")); } }), { status: 200 });
      }, "INCOMPLETE_BODY");
    });

    await check("11c. 0 bytes → EMPTY_BODY; 206 → INCOMPLETE_RESPONSE", async () => {
      await expectDubious(() => new Response(new Uint8Array(0), { status: 200 }), "EMPTY_BODY");
      await expectDubious(() => new Response(Buffer.from("parcial"), { status: 206, headers: { "content-range": "bytes 0-6/100" } }), "INCOMPLETE_RESPONSE");
    });

    await check("11d. sizeBytes ≠ recibido → SIZE_MISMATCH; gzip con Content-Length distinto y sizeBytes igual → STORED", async () => {
      await expectDubious(() => new Response(Buffer.alloc(40, 3), { status: 200 }), "SIZE_MISMATCH", { sizeBytes: 50 });
      await reset();
      const r2 = new FakeR2();
      const a = await mkAtt({ sizeBytes: 40 });
      const res = await run(r2, realFetcher({ [a.sourceFetchUrl!]: () => new Response(Buffer.alloc(40, 4), { status: 200, headers: { "content-length": "12", "content-encoding": "gzip" } }) }));
      assert.equal(res.copy.stored, 1);
      assert.equal((await row(a.id)).storageSizeBytes, 40);
    });

    const redirect = (location: string, status = 302) => () => new Response(null, { status, headers: { location } });
    await check("12a. 1 y 3 redirecciones permitidas → STORED", async () => {
      await reset();
      const r2 = new FakeR2();
      const a1 = await mkAtt(), a3 = await mkAtt();
      const body = Buffer.from("contenido-redirigido");
      const routes = {
        [a1.sourceFetchUrl!]: redirect("https://cdn.example/one"),
        "https://cdn.example/one": () => new Response(body, { status: 200 }),
        [a3.sourceFetchUrl!]: redirect("https://cdn.example/h1", 301),
        "https://cdn.example/h1": redirect("/h2", 307),
        "https://cdn.example/h2": redirect("https://files.example/h3", 308),
        "https://files.example/h3": () => new Response(body, { status: 200 }),
      };
      const res = await run(r2, realFetcher(routes));
      assert.equal(res.copy.stored, 2);
      for (const a of [a1, a3]) assert.equal((await row(a.id)).storageStatus, "STORED");
    });

    await check("12b. 4 redirecciones → TOO_MANY_REDIRECTS reintentable", async () => {
      await reset();
      const r2 = new FakeR2();
      const a = await mkAtt();
      const routes = {
        [a.sourceFetchUrl!]: redirect("https://cdn.example/1"), "https://cdn.example/1": redirect("https://cdn.example/2"),
        "https://cdn.example/2": redirect("https://cdn.example/3"), "https://cdn.example/3": redirect("https://cdn.example/4"),
        "https://cdn.example/4": () => new Response(Buffer.from("x"), { status: 200 }),
      };
      await run(r2, realFetcher(routes));
      const r = await row(a.id);
      assert.equal(r.storageStatus, "FAILED"); assert.equal(r.storageLastError, "TOO_MANY_REDIRECTS"); assert.ok(r.sourceFetchUrl);
    });

    await check("12c. salto a host no permitido / http / IP privada → rechazado; SyncLog SOLO con el hostname", async () => {
      for (const [loc, host] of [
        ["https://evil.example/SENTINEL_PATH/receta.pdf?SENTINEL_Q=1#SENTINEL_F", "evil.example"],
        ["http://cdn.example/SENTINEL_DOWNGRADE", "cdn.example"],
        ["https://10.0.0.5/SENTINEL_IP", "10.0.0.5"],
      ] as const) {
        await reset();
        const r2 = new FakeR2();
        const a = await mkAtt();
        await run(r2, realFetcher({ [a.sourceFetchUrl!]: redirect(loc) }));
        const r = await row(a.id);
        assert.equal(r.storageStatus, "FAILED"); assert.equal(r.storageLastError, "ORIGIN_REDIRECT_REJECTED"); assert.ok(r.sourceFetchUrl);
        const log = await prisma.syncLog.findFirstOrThrow({ where: { source: "ATTACHMENT_STORAGE" } });
        const w = JSON.stringify(log.warnings);
        assert.ok(w.includes(`REDIRECT_REJECTED_HOST:${host}`), `registra el hostname (${host})`);
        assert.ok(!/SENTINEL|receta|https?:|\/\//.test(JSON.stringify(log)), "ninguna otra parte de la URL en el SyncLog");
      }
    });

    await check("13a. R2 colgado en preflight → termina antes del deadline + margen, sin reservar", async () => {
      await reset();
      const r2 = new FakeR2(); r2.hang.add("head");
      const f = new FakeFetcher();
      const a = await mkAtt();
      f.behaviors.set(a.sourceFetchUrl!, { kind: "ok", bytes: Buffer.from("x") });
      const t0 = Date.now();
      const res = await run(r2, f, { deadlineMs: 5_000, r2OpTimeoutMs: 300 });
      assert.ok(Date.now() - t0 < 2_000, `terminó rápido (${Date.now() - t0} ms)`);
      assert.equal(res.copy.preflight, "failed"); assert.equal(res.copy.reserved, 0);
      const r = await row(a.id);
      assert.equal(r.storageStatus, "PENDING"); assert.equal(r.storageAttemptCount, 0);
      const log = await prisma.syncLog.findFirstOrThrow({ where: { source: "ATTACHMENT_STORAGE" } });
      assert.ok(JSON.stringify(log.warnings).includes("PREFLIGHT_FAILED:copy.preflight|r2_timeout"));
    });

    for (const op of ["put", "get"] as const) {
      await check(`13b. R2 colgado en ${op.toUpperCase()} → corta por timeout propio, libera sin consumir intento, corta la corrida`, async () => {
        await reset();
        const r2 = new FakeR2(); r2.hang.add(op);
        const f = new FakeFetcher();
        const a = await mkAtt({ status: "FAILED", attempts: 2, next: new Date(now().getTime() - 1000) });
        const b = await mkAtt();
        for (const x of [a, b]) f.behaviors.set(x.sourceFetchUrl!, { kind: "ok", bytes: Buffer.from(`b-${x.id}`) });
        const t0 = Date.now();
        const res = await run(r2, f, { deadlineMs: 5_000, r2OpTimeoutMs: 300 });
        assert.ok(Date.now() - t0 < 2_000, `terminó rápido (${Date.now() - t0} ms)`);
        assert.equal(res.copy.stopReason, "r2_timeout"); assert.equal(res.copy.stored, 0); assert.equal(res.copy.released, 2);
        const ra = await row(a.id), rb = await row(b.id);
        assert.equal(ra.storageStatus, "FAILED"); assert.equal(ra.storageAttemptCount, 2, "no consume intento"); assert.ok(ra.sourceFetchUrl);
        assert.equal(rb.storageStatus, "PENDING"); assert.equal(rb.storageAttemptCount, 0); assert.equal(rb.storageLeaseId, null);
      });
    }

    await check("13c. el deadline de la corrida corta un PUT colgado (timeout por op mayor) → libera sin penalizar", async () => {
      await reset();
      const r2 = new FakeR2(); r2.hang.add("put");
      const f = new FakeFetcher();
      const a = await mkAtt();
      f.behaviors.set(a.sourceFetchUrl!, { kind: "ok", bytes: Buffer.from("x") });
      const t0 = Date.now();
      const res = await run(r2, f, { deadlineMs: 600, r2OpTimeoutMs: 60_000 });
      assert.ok(Date.now() - t0 < 600 + 1_000, `cortó en el deadline + margen (${Date.now() - t0} ms)`);
      assert.equal(res.copy.stopReason, "deadline"); assert.equal(res.copy.aborted, false); assert.equal(res.copy.released, 1);
      const r = await row(a.id);
      assert.equal(r.storageStatus, "PENDING"); assert.equal(r.storageAttemptCount, 0);
    });

    await check("14. PUT cortado (llegó a guardar) → liberado; reintento recibe 412 → relectura con mismo hash → STORED", async () => {
      await reset();
      const r2 = new FakeR2(); r2.putStoresThenHangs = true;
      const f = new FakeFetcher();
      const a = await mkAtt();
      const bytes = Buffer.from("subido-pero-respuesta-perdida");
      f.behaviors.set(a.sourceFetchUrl!, { kind: "ok", bytes });
      const first = await run(r2, f, { r2OpTimeoutMs: 300 });
      assert.equal(first.copy.stopReason, "r2_timeout"); assert.equal(first.copy.released, 1);
      assert.ok(r2.objects.has(objectKeyFor(a.id)), "el objeto quedó en R2");
      assert.equal((await row(a.id)).storageAttemptCount, 0);
      r2.putStoresThenHangs = false;
      const second = await run(r2, f, { r2OpTimeoutMs: 300 });
      assert.equal(second.copy.stored, 1); assert.equal(r2.preconditionFailures, 1); assert.equal(r2.deleteCalls, 0);
      const r = await row(a.id);
      assert.equal(r.storageStatus, "STORED"); assert.equal(r.storageChecksumSha256, sha256(bytes)); assert.equal(r.storageAttemptCount, 1);
    });

    await check("15. allowlist vacía → aborto CONFIG antes de reservar (no se queman intentos)", async () => {
      await reset();
      const r2 = new FakeR2();
      const a = await mkAtt();
      const res = await run(r2, realFetcher({}, []));
      assert.equal(res.copy.aborted, true); assert.equal(res.copy.stopReason, "config"); assert.equal(res.copy.reserved, 0);
      assert.equal(res.copy.preflight, "skipped");
      const r = await row(a.id);
      assert.equal(r.storageStatus, "PENDING"); assert.equal(r.storageAttemptCount, 0);
      const log = await prisma.syncLog.findFirstOrThrow({ where: { source: "ATTACHMENT_STORAGE" } });
      assert.equal(log.status, "ERROR"); assert.ok(JSON.stringify(log.warnings).includes("CONFIG_INVALID:ATTACHMENT_SOURCE_ALLOWED_HOSTS"));
    });

    await check("10. ningún log (stdout/stderr) ni SyncLog contiene la URL / filename", async () => {
      // la captura NO está vacía: contiene las alertas que sí se loguean (con códigos e ids)
      assert.ok(capturedOutput.includes("CHECKSUM_CONFLICT") && capturedOutput.includes("preflight failed"), "la captura registró los logs del worker");
      assert.equal((capturedOutput.match(/SENTINEL|receta|https?:\/\//g) ?? []).length, 0, "0 apariciones en stdout/stderr");
      await assertNoUrlInSinks();
    });
  } finally {
    await prisma.$disconnect().catch(() => {});
    console.log("\n== teardown ==");
    try { await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`); console.log("teardown OK — DB efímera eliminada."); }
    catch (e) { console.error(`TEARDOWN FAILED: borrar manualmente "${TEST_DB}". ${e instanceof Error ? e.message : String(e)}`); }
  }

  console.log(`\nattachment-copy.smoke: ${pass} ok, ${fails.length} fail`);
  if (fails.length) process.exit(1);
}

main().catch(async (e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  try { await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`); } catch { /* best effort */ }
  process.exit(1);
});
