/**
 * Tests PUROS del endpoint del job de copia (B6.3-C4): auth, 503, disabled, forma de la
 * respuesta y 500. El worker y Prisma se inyectan (stubs que fallan si se los toca).
 *   npx tsx src/lib/call-center/attachment-copy/endpoint.test.ts
 */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { handleAttachmentCopy, ENDPOINT_DEADLINE_MS, type EndpointDeps } from "./endpoint";
import { verifyBearer, isUsableSecret, MIN_SECRET_LENGTH } from "@/lib/sync/bearer-auth";
import type { AttachmentCopyRunResult } from "./worker";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const SECRET = "s".repeat(31) + "SENTINEL_SECRET_TAIL"; // ≥ 32 chars
const ON = { ATTACHMENT_COPY_JOB_SECRET: SECRET, ATTACHMENT_COPY_JOB_ENABLED: "true" };
const okSignal = new AbortController().signal;

const RESULT: AttachmentCopyRunResult = {
  maintenance: { leasesRecovered: 1, attachmentsTtlNoOrigin: 2, webhookUrlsCleared: 3 },
  copy: { enabled: true, preflight: "ok", reserved: 4, stored: 3, retryScheduled: 1, failedTerminal: 0, conflicts: 0, leaseLost: 0, released: 0, aborted: false, stopReason: "none" },
};

/** Deps con contadores de uso; Prisma y el worker FALLAN si se los toca sin permiso. */
function mkDeps(env: Record<string, string | undefined>, over: Partial<EndpointDeps> = {}) {
  const used = { runCopy: 0, prisma: 0, synclogs: [] as any[], runOpts: [] as any[] };
  const deps: EndpointDeps = {
    env,
    runCopy: async (opts) => { used.runCopy++; used.runOpts.push(opts); return RESULT; },
    getPrisma: async () => {
      used.prisma++;
      return { syncLog: { create: async (a: any) => { used.synclogs.push(a); return {}; } } } as any;
    },
    nowMs: () => 1_000_000,
    ...over,
  };
  return { deps, used };
}

function captureConsole<T>(fn: () => Promise<T>): Promise<{ out: string; value: T }> {
  let out = "";
  const ol = console.log, oe = console.error, ow = console.warn;
  console.log = console.error = console.warn = (...a: unknown[]) => { out += a.map(String).join(" ") + "\n"; };
  return fn().then((value) => ({ out, value })).finally(() => { console.log = ol; console.error = oe; console.warn = ow; });
}

async function main() {
  await test("1. sin secreto configurado → 503, sin tocar la base ni el worker", async () => {
    const { deps, used } = mkDeps({ ATTACHMENT_COPY_JOB_ENABLED: "true" });
    const r = await handleAttachmentCopy({ authorization: `Bearer ${SECRET}`, signal: okSignal }, deps);
    assert.equal(r.status, 503); assert.deepEqual(r.body, { status: "unavailable" });
    assert.equal(used.prisma, 0); assert.equal(used.runCopy, 0);
  });

  await test("2. secreto corto (< 32) → 503 aunque el header coincida", async () => {
    const short = "x".repeat(MIN_SECRET_LENGTH - 1);
    const { deps, used } = mkDeps({ ATTACHMENT_COPY_JOB_SECRET: short, ATTACHMENT_COPY_JOB_ENABLED: "true" });
    const r = await handleAttachmentCopy({ authorization: `Bearer ${short}`, signal: okSignal }, deps);
    assert.equal(r.status, 503); assert.equal(used.prisma + used.runCopy, 0);
    assert.equal(isUsableSecret("y".repeat(MIN_SECRET_LENGTH)), true);
  });

  await test("3. header ausente / incorrecto / de otro largo / sin 'Bearer ' → 401 sin cuerpo, sin tocar nada", async () => {
    for (const authorization of [null, "", `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, SECRET, `bearer ${SECRET}`, "Bearer " + "z".repeat(500)]) {
      const { deps, used } = mkDeps(ON);
      const { out, value: r } = await captureConsole(() => handleAttachmentCopy({ authorization, signal: okSignal }, deps));
      assert.equal(r.status, 401, String(authorization)); assert.equal(r.body, null);
      assert.equal(used.prisma + used.runCopy, 0);
      assert.ok(!out.includes("SENTINEL") && !out.includes("Bearer"), "nunca se loguea el header");
    }
  });

  await test("4. verifyBearer: tiempo constante sobre hashes de igual largo (no lanza con largos distintos)", () => {
    assert.equal(verifyBearer(`Bearer ${SECRET}`, SECRET), true);
    assert.equal(verifyBearer("Bearer corto", SECRET), false);
    assert.equal(verifyBearer("B".repeat(10_000), SECRET), false);
    assert.equal(verifyBearer(null, SECRET), false);
  });

  await test("5. flag apagado (ausente / 'false' / '1') → 200 disabled SIN tocar la base ni el worker", async () => {
    for (const flag of [undefined, "false", "1", "TRUE"]) {
      const { deps, used } = mkDeps({ ATTACHMENT_COPY_JOB_SECRET: SECRET, ATTACHMENT_COPY_JOB_ENABLED: flag });
      const r = await handleAttachmentCopy({ authorization: `Bearer ${SECRET}`, signal: okSignal }, deps);
      assert.equal(r.status, 200); assert.deepEqual(r.body, { status: "disabled" });
      assert.equal(used.prisma, 0, "no tocó la base"); assert.equal(used.runCopy, 0);
    }
  });

  await test("6. corrida OK → status ok + SOLO contadores (whitelist) + duración; deadline 40 s y señal del request", async () => {
    const extra = { ...RESULT, copy: { ...RESULT.copy, secretField: "SENTINEL_ID_cm123", url: "https://SENTINEL" } } as any;
    const { deps, used } = mkDeps(ON, { runCopy: async (opts) => { used.runOpts.push(opts); return extra; } });
    const ctrl = new AbortController();
    const r = await handleAttachmentCopy({ authorization: `Bearer ${SECRET}`, signal: ctrl.signal }, deps);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {
      status: "ok",
      maintenance: { leasesRecovered: 1, attachmentsTtlNoOrigin: 2, webhookUrlsCleared: 3 },
      copy: { enabled: true, preflight: "ok", reserved: 4, stored: 3, retryScheduled: 1, failedTerminal: 0, conflicts: 0, leaseLost: 0, released: 0, aborted: false, stopReason: "none" },
      durationMs: 0,
    });
    assert.ok(!JSON.stringify(r.body).includes("SENTINEL"), "campos extra del worker NO se filtran");
    assert.equal(used.runOpts[0].deadline, 1_000_000 + ENDPOINT_DEADLINE_MS);
    assert.equal(ENDPOINT_DEADLINE_MS, 40_000);
    assert.equal(used.runOpts[0].signal, ctrl.signal);
  });

  await test("7. error inesperado → 500 { status: 'error', code } seguro + SyncLog ATTACHMENT_STORAGE", async () => {
    const leaky = new Prisma.PrismaClientKnownRequestError("args { url: 'https://SENTINEL_URL/x', body: 'SENTINEL_TXT' }", { code: "P1001", clientVersion: "5.22.0" } as any);
    const { deps, used } = mkDeps(ON, { runCopy: async () => { throw leaky; } });
    const { out, value: r } = await captureConsole(() => handleAttachmentCopy({ authorization: `Bearer ${SECRET}`, signal: okSignal }, deps));
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { status: "error", code: "copy.endpoint|PrismaClientKnownRequestError|P1001|" });
    assert.equal(used.synclogs.length, 1);
    assert.equal(used.synclogs[0].data.source, "ATTACHMENT_STORAGE"); assert.equal(used.synclogs[0].data.status, "ERROR");
    for (const s of [JSON.stringify(r.body), JSON.stringify(used.synclogs), out]) assert.ok(!s.includes("SENTINEL"), "sin message ni args");
  });

  await test("8. error inesperado y el SyncLog también falla → igual 500 seguro", async () => {
    const { deps } = mkDeps(ON, {
      runCopy: async () => { throw new Error("SENTINEL"); },
      getPrisma: async () => ({ syncLog: { create: async () => { throw new Error("SENTINEL db down"); } } }) as any,
    });
    const { out, value: r } = await captureConsole(() => handleAttachmentCopy({ authorization: `Bearer ${SECRET}`, signal: okSignal }, deps));
    assert.equal(r.status, 500); assert.deepEqual(r.body, { status: "error", code: "copy.endpoint|Error||" });
    assert.ok(!out.includes("SENTINEL"));
  });

  console.log(`\nendpoint: ${passed} ok, ${failures.length} fail`);
  if (failures.length) process.exit(1);
}

main();
