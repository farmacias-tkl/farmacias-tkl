/**
 * Test de la RUTA REAL POST /api/sync/trigger contra la ruta de b3af746 (antes de
 * coseguros). syncSales, syncBalances, Drive y Prisma se reemplazan en el caché de
 * módulos ANTES de importar las rutas (sin red ni base); la ruta vieja se copia a un
 * directorio temporal con sus imports apuntando a los mismos módulos reemplazados.
 *
 * - balances / sales / all: respuesta idéntica (status + JSON) a la ruta vieja, con
 *   coseguros apagada o encendida, y coseguros nunca se ejecuta.
 * - coseguros: su propia llamada; apagada → DISABLED; completa → SUCCESS;
 *   incompleta → PARTIAL; falla total → 500.
 *   npx tsx src/lib/sync/trigger-coseguros.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const req = createRequire(__filename);
let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

// ---- stubs -----------------------------------------------------------------
type Out = { status: string; message: string; rowsProcessed?: number };
let salesBehavior: () => Promise<Out> = async () => ({ status: "SUCCESS", message: "11 filas procesadas, 0 ignoradas. 11 sucursales.", rowsProcessed: 11 });
let balancesBehavior: () => Promise<Out> = async () => ({ status: "SUCCESS", message: "5 filas procesadas, 0 ignoradas. Archivo: SALDOS.xlsx", rowsProcessed: 5 });
let salesCalls = 0, listCalls = 0;
let listBehavior: () => Promise<unknown[]> = async () => [];
const files: Record<string, string> = {};
const syncLogWrites: { source: string; status: string }[] = [];
let syncLogBehavior: (data: { source: string; status: string }) => Promise<unknown> = async (data) => { syncLogWrites.push(data); return data; };
const txOptions: { maxWait: number; timeout: number }[] = [];

function stub(p: string, exports: Record<string, unknown>) {
  const id = req.resolve(p);
  req.cache[id] = { id, filename: id, loaded: true, exports } as NodeJS.Module;
  return id;
}
const salesId    = stub("./sync-sales", { syncSales: () => { salesCalls++; return salesBehavior(); } });
const balancesId = stub("./sync-balances", { syncBalances: () => balancesBehavior() });
stub("../integrations/google-drive", {
  listCosegurosFiles: () => { listCalls++; return listBehavior(); },
  downloadDriveFileText: async (id: string) => files[id],
});
const prismaStub = {
  branch:        { findMany: async () => EXPECTED.map((name) => ({ id: `b-${name}`, name, aliases: [] })) },
  coseguroDaily: { findMany: async () => [], createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length }), update: async () => ({}) },
  $executeRawUnsafe: async () => 0,   // SET LOCAL statement_timeout
  $transaction:  async (fn: (tx: unknown) => Promise<unknown>, o: { maxWait: number; timeout: number }) => { txOptions.push(o); return fn(prismaStub); },
  syncLog:       { create: ({ data }: { data: { source: string; status: string } }) => syncLogBehavior(data) },
};
stub("../prisma", { prisma: prismaStub });

const sc = req("./sync-coseguros") as typeof import("./sync-coseguros");
const EXPECTED: readonly string[] = sc.EXPECTED_SIAF_BRANCHES;

type Post = (r: never) => Promise<Response>;
const { POST: POST_NEW } = req("../../app/api/sync/trigger/route") as { POST: Post };

// Ruta de b3af746 con los imports apuntando a los mismos módulos (reemplazados).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trigger-b3af746-"));
const oldSrc = execSync("git show b3af746:src/app/api/sync/trigger/route.ts", { encoding: "utf8" })
  .replace('"next/server"', JSON.stringify(req.resolve("next/server")))
  .replace('"@/lib/sync/sync-balances"', JSON.stringify(balancesId))
  .replace('"@/lib/sync/sync-sales"', JSON.stringify(salesId));
fs.writeFileSync(path.join(tmp, "route.ts"), oldSrc);
const { POST: POST_OLD } = req(path.join(tmp, "route.ts")) as { POST: Post };

const SECRET = "secreto-de-prueba";
process.env.SYNC_WEBHOOK_SECRET = SECRET;
process.env.GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID = "folder-diario";

async function call(post: Post, body: unknown, auth = `Bearer ${SECRET}`) {
  const r = await post(new Request("http://x/api/sync/trigger", {
    method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body),
  }) as never);
  return { status: r.status, body: await r.json() };
}

const H = "fecha,codigo_coseguro,nombre_coseguro,comprobantes,notas_credito,importe_coseguro";
function driveWith(names: readonly string[]) {
  for (const k of Object.keys(files)) delete files[k];
  for (const n of names) files[`id:${n}`] = `${H}\n2026-10-18,AAA,A,1,0,10`;
  listBehavior = async () => names.map((n) => ({ sucursalName: n, driveFileId: `id:${n}`, driveFileName: `${n}_coseguros.csv`, modifiedTime: "" }));
}

async function main() {
  driveWith(EXPECTED);

  for (const enabled of [undefined, "true"]) {
    for (const source of ["balances", "sales", "all"]) {
      await test(`source=${source}, coseguros ${enabled ? "encendida" : "apagada"}: respuesta idéntica a b3af746 y coseguros no corre`, async () => {
        if (enabled) process.env.COSEGUROS_SYNC_ENABLED = enabled; else delete process.env.COSEGUROS_SYNC_ENABLED;
        salesCalls = 0; listCalls = 0; syncLogWrites.length = 0;
        const oldR = await call(POST_OLD, { source });
        const callsOld = salesCalls;
        const newR = await call(POST_NEW, { source });
        assert.deepEqual(newR, oldR);
        assert.equal(salesCalls, callsOld * 2, "syncSales se llama igual en las dos");
        assert.equal(listCalls, 0, "coseguros no se ejecuta");
        assert.equal(syncLogWrites.length, 0);
      });
    }
  }

  await test("ventas y saldos en ERROR: mismo 500 que b3af746 (con coseguros encendida)", async () => {
    process.env.COSEGUROS_SYNC_ENABLED = "true";
    salesBehavior = async () => { throw new Error("ventas caídas"); };
    balancesBehavior = async () => { throw new Error("saldos caídos"); };
    for (const source of ["sales", "all"]) {
      const a = await call(POST_OLD, { source });
      const b = await call(POST_NEW, { source });
      assert.equal(a.status, 500);
      assert.deepEqual(b, a);
    }
    salesBehavior = async () => ({ status: "SUCCESS", message: "ok", rowsProcessed: 1 });
    balancesBehavior = async () => ({ status: "SUCCESS", message: "ok", rowsProcessed: 1 });
  });

  await test("sin auth: mismo 401", async () => {
    assert.deepEqual(await call(POST_NEW, { source: "sales" }, "Bearer otro"), await call(POST_OLD, { source: "sales" }, "Bearer otro"));
  });

  await test("source desconocido: 400; la única diferencia es que la lista de válidos suma 'coseguros'", async () => {
    const a = await call(POST_OLD, { source: "x" });
    const b = await call(POST_NEW, { source: "x" });
    assert.equal(b.status, 400);
    assert.deepEqual(b.body, { ...a.body, valid: [...a.body.valid, "coseguros"] });
  });

  await test("source=coseguros apagada → 200 DISABLED, no lista Drive, sin SyncLog, ventas no corre", async () => {
    delete process.env.COSEGUROS_SYNC_ENABLED;
    salesCalls = 0; listCalls = 0; syncLogWrites.length = 0;
    const r = await call(POST_NEW, { source: "coseguros" });
    assert.equal(r.status, 200);
    assert.equal(r.body.results.coseguros.status, "DISABLED");
    assert.deepEqual([salesCalls, listCalls, syncLogWrites.length], [0, 0, 0]);
  });

  await test("source=coseguros completa → 200 SUCCESS 'Completa: 11 de 11', SyncLog SALES_COSEGUROS, ventas no corre", async () => {
    process.env.COSEGUROS_SYNC_ENABLED = "true";
    driveWith(EXPECTED); salesCalls = 0; syncLogWrites.length = 0;
    const r = await call(POST_NEW, { source: "coseguros" });
    assert.equal(r.status, 200);
    assert.equal(r.body.results.coseguros.status, "SUCCESS");
    assert.match(r.body.results.coseguros.message, /^Completa: 11 de 11 sucursales\./);
    assert.equal(r.body.results.sales, undefined);
    assert.equal(salesCalls, 0);
    assert.deepEqual(syncLogWrites.map((w) => [w.source, w.status]), [["SALES_COSEGUROS", "SUCCESS"]]);
  });

  await test("cada transacción recibe espera + ejecución que suman a lo sumo el tiempo de la corrida", async () => {
    driveWith(EXPECTED); txOptions.length = 0;
    await call(POST_NEW, { source: "coseguros" });
    assert.equal(txOptions.length, 11);
    for (const o of txOptions) {
      assert.ok(o.maxWait >= 1 && o.timeout >= 1, JSON.stringify(o));
      assert.ok(o.maxWait + o.timeout <= sc.DEFAULT_DEADLINE_MS - sc.LOG_RESERVE_MS, JSON.stringify(o));
    }
  });

  for (const [what, behavior] of [
    ["falla", async () => { throw new Error("Neon no responde"); }],
    ["se cuelga", () => new Promise(() => {})],
  ] as const) {
    await test(`carga completa pero el SyncLog ${what} → 500 ERROR (rojo en Actions), con el resultado de la carga`, async () => {
      driveWith(EXPECTED);
      syncLogBehavior = behavior;
      try {
        const r = await call(POST_NEW, { source: "coseguros" });
        assert.equal(r.status, 500);
        assert.equal(r.body.ok, false);
        const c = r.body.results.coseguros;
        assert.deepEqual([c.status, c.loadStatus, c.logWritten, c.complete], ["ERROR", "SUCCESS", false, true]);
        assert.match(c.message, /^No quedó registrada en SyncLog (.+). Resultado de la carga: Completa: 11 de 11 sucursales./);
        assert.ok(r.body.errors.some((e: string) => e.startsWith("coseguros: No quedó registrada en SyncLog")));
      } finally {
        syncLogBehavior = async (data) => { syncLogWrites.push(data); return data; };
      }
    });
  }

  await test("source=coseguros incompleta → 200 PARTIAL con las faltantes (el workflow lo marca en rojo)", async () => {
    driveWith(EXPECTED.filter((n) => n !== "Galesa"));
    const r = await call(POST_NEW, { source: "coseguros" });
    assert.equal(r.status, 200);
    assert.equal(r.body.results.coseguros.status, "PARTIAL");
    assert.match(r.body.results.coseguros.message, /Faltan: Galesa \(sin archivo\)/);
  });

  await test("source=coseguros con Drive caído → 500 (ERROR) y SyncLog registrado", async () => {
    listBehavior = async () => { throw new Error("Drive caído"); };
    syncLogWrites.length = 0;
    const r = await call(POST_NEW, { source: "coseguros" });
    assert.equal(r.status, 500);
    assert.equal(r.body.results.coseguros.status, "ERROR");
    assert.deepEqual(syncLogWrites.map((w) => [w.source, w.status]), [["SALES_COSEGUROS", "ERROR"]]);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} de ${passed + failures.length} verificaciones pasan`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main();
