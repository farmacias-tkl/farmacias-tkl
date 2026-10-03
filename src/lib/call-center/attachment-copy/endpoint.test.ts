/**
 * Tests PUROS del endpoint del job de copia (B6.3-C4 + C4b): auth, 503, límite por corrida,
 * maintenance_only, healthy, forma de la respuesta y 500. Worker/mantenimiento/Prisma se
 * inyectan (stubs con contadores de uso).
 *   npx tsx src/lib/call-center/attachment-copy/endpoint.test.ts
 */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { handleAttachmentCopy, parseRunLimit, ENDPOINT_DEADLINE_MS, DEFAULT_RUN_LIMIT, type EndpointDeps } from "./endpoint";
import { verifyBearer, isUsableSecret, MIN_SECRET_LENGTH } from "@/lib/sync/bearer-auth";
import type { AttachmentCopyRunResult, StopReason } from "./worker";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const SECRET = "s".repeat(31) + "SENTINEL_SECRET_TAIL"; // ≥ 32 chars
const AUTH = `Bearer ${SECRET}`;
const ON = { ATTACHMENT_COPY_JOB_SECRET: SECRET, ATTACHMENT_COPY_JOB_ENABLED: "true" };
const OFF = { ATTACHMENT_COPY_JOB_SECRET: SECRET };
const MAINT = { leasesRecovered: 1, attachmentsTtlNoOrigin: 2, webhookUrlsCleared: 3 };
const okSignal = new AbortController().signal;
const req = (authorization: string | null, body = "", signal = okSignal) => ({ authorization, signal, readBody: async () => body });

const result = (stopReason: StopReason = "none", maintenanceOk = true): AttachmentCopyRunResult => ({
  maintenance: MAINT,
  maintenanceOk,
  copy: { enabled: true, preflight: "ok", reserved: 4, stored: 3, retryScheduled: 1, failedTerminal: 0, conflicts: 0, leaseLost: 0, released: 0, aborted: false, stopReason },
});

/** Deps con contadores de uso de cada dependencia (para afirmar "no tocó la base"). */
function mkDeps(env: Record<string, string | undefined>, over: Partial<EndpointDeps> = {}) {
  const used = { runCopy: 0, maintenanceOnly: 0, prisma: 0, synclogs: [] as any[], runOpts: [] as any[] };
  const deps: EndpointDeps = {
    env,
    runCopy: async (opts) => { used.runCopy++; used.runOpts.push(opts); return result(); },
    runMaintenanceOnly: async () => { used.maintenanceOnly++; return { maintenance: MAINT, ok: true }; },
    getPrisma: async () => {
      used.prisma++;
      return { syncLog: { create: async (a: any) => { used.synclogs.push(a); return {}; } } } as any;
    },
    nowMs: () => 1_000_000,
    ...over,
  };
  const touched = () => used.runCopy + used.maintenanceOnly + used.prisma;
  return { deps, used, touched };
}

function captureConsole<T>(fn: () => Promise<T>): Promise<{ out: string; value: T }> {
  let out = "";
  const ol = console.log, oe = console.error, ow = console.warn;
  console.log = console.error = console.warn = (...a: unknown[]) => { out += a.map(String).join(" ") + "\n"; };
  return fn().then((value) => ({ out, value })).finally(() => { console.log = ol; console.error = oe; console.warn = ow; });
}

async function main() {
  await test("1. sin secreto configurado → 503 sin tocar nada (flag on y off)", async () => {
    for (const env of [{ ATTACHMENT_COPY_JOB_ENABLED: "true" }, {}]) {
      const { deps, touched } = mkDeps(env);
      const r = await handleAttachmentCopy(req(AUTH), deps);
      assert.equal(r.status, 503); assert.deepEqual(r.body, { status: "unavailable" }); assert.equal(touched(), 0);
    }
  });

  await test("2. secreto corto (< 32) → 503 aunque el header coincida", async () => {
    const short = "x".repeat(MIN_SECRET_LENGTH - 1);
    const { deps, touched } = mkDeps({ ATTACHMENT_COPY_JOB_SECRET: short });
    assert.equal((await handleAttachmentCopy(req(`Bearer ${short}`), deps)).status, 503);
    assert.equal(touched(), 0);
    assert.equal(isUsableSecret("y".repeat(MIN_SECRET_LENGTH)), true);
  });

  await test("3. header ausente / incorrecto / de otro largo → 401 sin cuerpo, sin tocar nada (flag on y off); nunca se loguea", async () => {
    for (const env of [ON, OFF]) {
      for (const authorization of [null, "", `${AUTH}x`, `Bearer ${SECRET.slice(0, -1)}`, SECRET, `bearer ${SECRET}`, "Bearer " + "z".repeat(500)]) {
        const { deps, touched } = mkDeps(env);
        const { out, value: r } = await captureConsole(() => handleAttachmentCopy(req(authorization), deps));
        assert.equal(r.status, 401); assert.equal(r.body, null); assert.equal(touched(), 0);
        assert.ok(!out.includes("SENTINEL") && !out.includes("Bearer"));
      }
    }
  });

  await test("4. verifyBearer: tiempo constante sobre hashes de igual largo", () => {
    assert.equal(verifyBearer(AUTH, SECRET), true);
    assert.equal(verifyBearer("Bearer corto", SECRET), false);
    assert.equal(verifyBearer("B".repeat(10_000), SECRET), false);
    assert.equal(verifyBearer(null, SECRET), false);
  });

  await test("5. parseRunLimit: ausente/vacío/{} → 25; 1 y 50 ok; inválidos → null", () => {
    assert.equal(parseRunLimit(""), DEFAULT_RUN_LIMIT);
    assert.equal(parseRunLimit("   "), DEFAULT_RUN_LIMIT);
    assert.equal(parseRunLimit("{}"), DEFAULT_RUN_LIMIT);
    assert.equal(parseRunLimit('{"limit":1}'), 1);
    assert.equal(parseRunLimit('{"limit":50}'), 50);
    for (const bad of ['{"limit":0}', '{"limit":51}', '{"limit":"3"}', '{"limit":2.5}', '{"limit":null}', '{"limit":-1}',
      "{roto", '{"limit":3,"x":1}', '{"other":1}', "[1]", "3", '"x"', "null", '{"limit":1e400}', "x".repeat(2000)]) {
      assert.equal(parseRunLimit(bad), null, bad);
    }
  });

  await test("6. body inválido + auth OK → 400 bad_request sin tocar la base; sin auth → 401 (no 400)", async () => {
    for (const body of ['{"limit":0}', '{"limit":51}', '{"limit":"3"}', '{"limit":2.5}', "{roto", '{"limit":3,"extra":true}']) {
      for (const env of [ON, OFF]) {
        const { deps, touched } = mkDeps(env);
        const r = await handleAttachmentCopy(req(AUTH, body), deps);
        assert.equal(r.status, 400, body); assert.deepEqual(r.body, { status: "bad_request" }); assert.equal(touched(), 0);
        const { deps: d2, touched: t2 } = mkDeps(env);
        const r2 = await handleAttachmentCopy(req("Bearer mal", body), d2);
        assert.equal(r2.status, 401); assert.equal(t2(), 0);
      }
    }
    // lectura del body que falla → 400
    const { deps, touched } = mkDeps(ON);
    const r = await handleAttachmentCopy({ authorization: AUTH, signal: okSignal, readBody: async () => { throw new Error("SENTINEL"); } }, deps);
    assert.equal(r.status, 400); assert.equal(touched(), 0);
  });

  await test("7. limit válido se pasa al worker (1, 50, default 25)", async () => {
    for (const [body, expected] of [['{"limit":1}', 1], ['{"limit":50}', 50], ["", 25], ["{}", 25]] as const) {
      const { deps, used } = mkDeps(ON);
      const r = await handleAttachmentCopy(req(AUTH, body), deps);
      assert.equal(r.status, 200); assert.equal(used.runOpts[0].limit, expected);
    }
  });

  await test("8. flag apagado + auth OK → maintenance_only: SOLO mantenimiento, sin worker/copia", async () => {
    for (const flag of [undefined, "false", "1", "TRUE"]) {
      const { deps, used } = mkDeps({ ...OFF, ATTACHMENT_COPY_JOB_ENABLED: flag });
      const r = await handleAttachmentCopy(req(AUTH), deps);
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { status: "maintenance_only", maintenance: MAINT, healthy: true, durationMs: 0 });
      assert.equal(used.maintenanceOnly, 1); assert.equal(used.runCopy, 0, "no se carga ni corre el worker");
    }
  });

  await test("9. maintenance_only con mantenimiento fallido → 200 healthy=false, maintenance null", async () => {
    const { deps } = mkDeps(OFF, { runMaintenanceOnly: async () => ({ maintenance: null, ok: false }) });
    const r = await handleAttachmentCopy(req(AUTH), deps);
    assert.deepEqual(r.body, { status: "maintenance_only", maintenance: null, healthy: false, durationMs: 0 });
  });

  await test("10. corrida OK → status ok + SOLO contadores (whitelist) + healthy; deadline 35 s y señal del request", async () => {
    const extra = { ...result(), copy: { ...result().copy, secretField: "SENTINEL_ID_cm123", url: "https://SENTINEL" } } as any;
    const { deps, used } = mkDeps(ON, { runCopy: async (opts) => { used.runOpts.push(opts); return extra; } });
    const ctrl = new AbortController();
    const r = await handleAttachmentCopy(req(AUTH, "", ctrl.signal), deps);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {
      status: "ok",
      maintenance: MAINT,
      copy: { enabled: true, preflight: "ok", reserved: 4, stored: 3, retryScheduled: 1, failedTerminal: 0, conflicts: 0, leaseLost: 0, released: 0, aborted: false, stopReason: "none" },
      healthy: true,
      durationMs: 0,
    });
    assert.ok(!JSON.stringify(r.body).includes("SENTINEL"), "campos extra del worker NO se filtran");
    assert.equal(ENDPOINT_DEADLINE_MS, 35_000);
    assert.equal(used.runOpts[0].deadline, 1_000_000 + 35_000);
    assert.equal(used.runOpts[0].signal, ctrl.signal);
  });

  await test("11. healthy: false con r2_auth/config/preflight/r2_timeout o mantenimiento fallido; true con none/deadline/external", async () => {
    const cases: [StopReason, boolean, boolean][] = [
      ["none", true, true], ["deadline", true, true], ["external", true, true],
      ["r2_auth", true, false], ["config", true, false], ["preflight", true, false], ["r2_timeout", true, false],
      ["none", false, false],
    ];
    for (const [stop, mOk, healthy] of cases) {
      const { deps } = mkDeps(ON, { runCopy: async () => result(stop, mOk) });
      const r = await handleAttachmentCopy(req(AUTH), deps);
      assert.equal((r.body as any).healthy, healthy, `${stop}/${mOk}`);
      if (!mOk) assert.equal((r.body as any).maintenance, null);
    }
  });

  await test("12. error inesperado → 500 { status: 'error', code } seguro + SyncLog ATTACHMENT_STORAGE", async () => {
    const leaky = new Prisma.PrismaClientKnownRequestError("args { url: 'https://SENTINEL_URL/x', body: 'SENTINEL_TXT' }", { code: "P1001", clientVersion: "5.22.0" } as any);
    for (const env of [ON, OFF]) {
      const { deps, used } = mkDeps(env, { runCopy: async () => { throw leaky; }, runMaintenanceOnly: async () => { throw leaky; } });
      const { out, value: r } = await captureConsole(() => handleAttachmentCopy(req(AUTH), deps));
      assert.equal(r.status, 500);
      assert.deepEqual(r.body, { status: "error", code: "copy.endpoint|PrismaClientKnownRequestError|P1001|" });
      assert.equal(used.synclogs.length, 1); assert.equal(used.synclogs[0].data.source, "ATTACHMENT_STORAGE");
      for (const s of [JSON.stringify(r.body), JSON.stringify(used.synclogs), out]) assert.ok(!s.includes("SENTINEL"));
    }
  });

  await test("13. error inesperado y el SyncLog también falla → igual 500 seguro", async () => {
    const { deps } = mkDeps(ON, {
      runCopy: async () => { throw new Error("SENTINEL"); },
      getPrisma: async () => ({ syncLog: { create: async () => { throw new Error("SENTINEL db down"); } } }) as any,
    });
    const { out, value: r } = await captureConsole(() => handleAttachmentCopy(req(AUTH), deps));
    assert.equal(r.status, 500); assert.deepEqual(r.body, { status: "error", code: "copy.endpoint|Error||" });
    assert.ok(!out.includes("SENTINEL"));
  });

  console.log(`\nendpoint: ${passed} ok, ${failures.length} fail`);
  if (failures.length) process.exit(1);
}

main();
