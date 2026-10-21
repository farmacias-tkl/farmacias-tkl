/**
 * Tests PUROS de la carga de coseguros (sync-coseguros + coseguros-upsert).
 * Drive, sucursales, SyncLog y la tabla se inyectan. El store en memoria tiene la
 * misma clave única (branchId + date + code) y transacción por archivo: si la
 * escritura falla o vence su timeout, no queda nada de ese archivo. Datos inventados.
 *   npx tsx src/lib/sync/sync-coseguros.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import type { Prisma } from "@prisma/client";
import type { CoseguroFileRef, DriveCallLimits } from "@/lib/integrations/google-drive";
import type { BranchMapping } from "@/lib/integrations/excel-parser";
import {
  syncCoseguros, deadlineFromEnv, EXPECTED_SIAF_BRANCHES, DEFAULT_DEADLINE_MS, LOG_RESERVE_MS,
  type SyncCosegurosDeps,
} from "./sync-coseguros";
import {
  planCoseguroChanges, totalsOf, formatCents, toCents, transactionLimits, TX_MAX_WAIT_MS,
  type CoseguroRow, type CoseguroStore,
} from "./coseguros-upsert";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const H = "fecha,codigo_coseguro,nombre_coseguro,comprobantes,notas_credito,importe_coseguro";
const ALL_BRANCHES: BranchMapping[] = EXPECTED_SIAF_BRANCHES.map((name) => ({ id: `b-${name}`, name, aliases: [] }));
const bid = (name: string) => `b-${name}`;

// ---- Store en memoria con transacción por archivo ---------------------------
type StoreOpts = { delayMs?: (branchId: string) => number; failAfterCreate?: (branchId: string) => boolean };
function memoryStore(opts: StoreOpts = {}) {
  const rows = new Map<string, CoseguroRow & { branchId: string; sourceFile: string }>();
  const k = (b: string, d: string, c: string) => `${b}|${d}|${c}`;
  let writes = 0;
  const existing = (branchId: string, dates: string[]) => [...rows.values()]
    .filter((r) => r.branchId === branchId && dates.includes(r.date))
    .map(({ date, code, name, receipts, creditNotes, amount }) => ({ date, code, name, receipts, creditNotes, amount }));
  const store: CoseguroStore = {
    async findExisting(branchId, dates) { return existing(branchId, dates); },
    async upsertFile(branchId, fileRows, sourceFile, { timeoutMs }) {
      const delay = opts.delayMs?.(branchId) ?? 0;
      if (delay > timeoutMs) { await sleep(timeoutMs); throw new Error(`Transaction timeout after ${timeoutMs} ms (rollback)`); }
      await sleep(delay);
      const plan = planCoseguroChanges(fileRows, existing(branchId, [...new Set(fileRows.map((r) => r.date))]));
      // Copia de trabajo: se publica solo si toda la "transacción" termina bien.
      const work = new Map(rows);
      let created = 0;
      for (const r of plan.toCreate) {
        if (work.has(k(branchId, r.date, r.code))) continue;
        work.set(k(branchId, r.date, r.code), { ...r, branchId, sourceFile }); created++;
      }
      if (opts.failAfterCreate?.(branchId)) throw new Error("falla a mitad del archivo (rollback)");
      for (const { row } of plan.toUpdate) work.set(k(branchId, row.date, row.code), { ...row, branchId, sourceFile });
      rows.clear(); for (const [kk, v] of work) rows.set(kk, v);
      writes += created + plan.toUpdate.length;
      return { plan, created, updated: plan.toUpdate.length };
    },
  };
  return { store, rows, writes: () => writes };
}

// ---- Drive en memoria (respeta signal y timeoutMs) ---------------------------
type DriveOpts = { hangList?: boolean; hangDownload?: (name: string) => boolean };
function fakeDrive(files: Record<string, string>, opts: DriveOpts = {}) {
  // `cut` cuenta requests colgados que se cortaron, por su timeout o por la señal
  // (vencen casi a la vez: cualquiera de los dos vale; lo que importa es que se cortó).
  const calls = { list: 0, download: 0, cut: 0, timeouts: [] as number[] };
  const hang = (limits: DriveCallLimits) => new Promise<never>((_, rej) => {
    let done = false;
    const cut = (msg: string) => { if (done) return; done = true; clearTimeout(t); calls.cut++; rej(new Error(msg)); };
    const t = setTimeout(() => cut(`timeout of ${limits.timeoutMs}ms exceeded`), limits.timeoutMs);
    limits.signal.addEventListener("abort", () => cut("The operation was aborted"), { once: true });
  });
  const refs = (): CoseguroFileRef[] => Object.keys(files).sort().map((name) => ({
    sucursalName: name.replace(/_coseguros\.csv$/i, ""), driveFileId: `id:${name}`, driveFileName: name, modifiedTime: "2026-10-19T06:00:00.000Z",
  }));
  return {
    calls,
    listFiles: async (_folder: string, limits: DriveCallLimits) => {
      calls.list++; calls.timeouts.push(limits.timeoutMs);
      if (opts.hangList) return hang(limits);
      return refs();
    },
    downloadText: async (fileId: string, limits: DriveCallLimits) => {
      calls.download++; calls.timeouts.push(limits.timeoutMs);
      const name = fileId.slice(3);
      if (opts.hangDownload?.(name)) return hang(limits);
      return files[name];
    },
  };
}

function rowFor(name: string, code = "AAA", amount = "100.0") {
  return [H, `2026-10-18,${code},COSEGURO ${code} ${name.toUpperCase()},2,1,${amount}`].join("\r\n");
}
function allFiles(over: Record<string, string | null> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of EXPECTED_SIAF_BRANCHES) out[`${n}_coseguros.csv`] = rowFor(n);
  for (const [k, v] of Object.entries(over)) { if (v === null) delete out[k]; else out[k] = v; }
  return out;
}

function setup(files: Record<string, string>, o: { env?: Record<string, string | undefined>; drive?: DriveOpts; store?: StoreOpts; branches?: BranchMapping[]; deps?: Partial<SyncCosegurosDeps> } = {}) {
  const logs: Prisma.SyncLogCreateInput[] = [];
  const mem = memoryStore(o.store);
  const drive = fakeDrive(files, o.drive);
  const d: SyncCosegurosDeps = {
    env: { COSEGUROS_SYNC_ENABLED: "true", GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID: "folder-diario", ...o.env },
    listFiles: drive.listFiles,
    downloadText: drive.downloadText,
    getBranches: async () => o.branches ?? ALL_BRANCHES,
    store: mem.store,
    writeLog: async (data) => { logs.push(data); },
    ...o.deps,
  };
  return { d, logs, mem, drive };
}

async function main() {
  console.log("Completa / incompleta");

  await test("las 11 con archivo (una con solo encabezado) → SUCCESS 'Completa: 11 de 11'", async () => {
    const t = setup(allFiles({ "Galesa_coseguros.csv": H + "\r\n" }));
    const r = await syncCoseguros(t.d);
    assert.equal(r?.status, "SUCCESS");
    assert.equal(r?.complete, true);
    assert.equal(r?.message, "Completa: 11 de 11 sucursales. 10 filas nuevas, 0 actualizadas, 0 sin cambios.");
    assert.equal(t.logs.length, 1);
    assert.equal(t.logs[0].status, "SUCCESS");
    assert.equal(t.logs[0].message, r?.message);
  });

  await test("falta el archivo de una sucursal esperada → PARTIAL y el mensaje la nombra", async () => {
    const t = setup(allFiles({ "Naveira_coseguros.csv": null }));
    const r = await syncCoseguros(t.d);
    assert.equal(r?.status, "PARTIAL");
    assert.equal(r?.complete, false);
    assert.equal(r?.message, "Incompleta: 10 de 11 sucursales. Faltan: Naveira (sin archivo). 10 filas nuevas, 0 actualizadas, 0 sin cambios.");
    assert.equal(t.logs[0].status, "PARTIAL");
  });

  await test("sucursal esperada que no se reconoce en DB → PARTIAL '(no reconocida en DB)'", async () => {
    const t = setup(allFiles(), { branches: ALL_BRANCHES.filter((b) => b.name !== "Quintana") });
    const r = await syncCoseguros(t.d);
    assert.equal(r?.status, "PARTIAL");
    assert.match(r!.message, /Faltan: Quintana \(no reconocida en DB\)/);
    assert.ok(r!.warnings.some((w) => w.includes("Quintana_coseguros.csv: no corresponde")));
  });

  await test("archivo inválido → esa sucursal no carga nada (ni sus filas válidas), PARTIAL '(archivo inválido)'", async () => {
    const t = setup(allFiles({ "La Perla_coseguros.csv": `${H}\n2026-10-18,AAA,A,1,0,1\n2026-10-18,BBB,B,x,0,1` }));
    const r = await syncCoseguros(t.d);
    assert.equal(r?.status, "PARTIAL");
    assert.match(r!.message, /Faltan: La Perla \(archivo inválido\)/);
    assert.equal([...t.mem.rows.values()].filter((x) => x.branchId === bid("La Perla")).length, 0);
    assert.ok(r!.warnings.some((w) => /\[La Perla\] La Perla_coseguros\.csv inválido: línea 3: comprobantes inválido/.test(w)));
  });

  await test("varias faltantes con motivos distintos → todas en el mensaje, en el orden de las esperadas", async () => {
    const t = setup(allFiles({ "America_coseguros.csv": null, "Tekiel_coseguros.csv": "basura" }));
    const r = await syncCoseguros(t.d);
    assert.match(r!.message, /^Incompleta: 9 de 11 sucursales\. Faltan: America \(sin archivo\), Tekiel \(archivo inválido\)\./);
  });

  await test("ninguna cargada → ERROR", async () => {
    const t = setup({});
    const r = await syncCoseguros(t.d);
    assert.equal(r?.status, "ERROR");
    assert.match(r!.message, /^Incompleta: 0 de 11 sucursales\. Faltan: America \(sin archivo\)/);
  });

  await test("archivo extra que no es de una esperada → aviso; con las 11 completas sigue SUCCESS", async () => {
    const t = setup(allFiles({ "Sucursal Inventada_coseguros.csv": rowFor("x") }));
    const r = await syncCoseguros(t.d);
    assert.equal(r?.status, "SUCCESS");
    assert.ok(r!.warnings.some((w) => w.startsWith("Archivo Sucursal Inventada_coseguros.csv: no corresponde")));
  });

  await test("dos archivos de la misma sucursal → no se carga ninguno, '(archivo duplicado)'", async () => {
    const t = setup(allFiles({ "LA PERLA_coseguros.csv": rowFor("otra", "ZZZ") }));
    const r = await syncCoseguros(t.d);
    assert.equal(r?.status, "PARTIAL");
    assert.match(r!.message, /La Perla \(archivo duplicado\)/);
    assert.equal([...t.mem.rows.values()].filter((x) => x.branchId === bid("La Perla")).length, 0);
  });

  await test("las 11 esperadas son exactamente las de FOLDER_MAP en siaf_to_drive.py", () => {
    const py = fs.readFileSync("scripts/server/siaf_to_drive.py", "utf8");
    const block = /FOLDER_MAP: dict\[str, str\] = \{([\s\S]*?)\n\}/.exec(py)?.[1] ?? "";
    const names = [...block.matchAll(/"[A-Z]{2}":\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...names].sort(), [...EXPECTED_SIAF_BRANCHES].sort());
    assert.equal(names.length, 11);
  });

  console.log("\nTiempo límite real");

  await test("deadlineFromEnv: default 8 s; acepta 2 s–600 s", () => {
    assert.equal(deadlineFromEnv(undefined), DEFAULT_DEADLINE_MS);
    assert.equal(deadlineFromEnv("abc"), DEFAULT_DEADLINE_MS);
    assert.equal(deadlineFromEnv("1000"), DEFAULT_DEADLINE_MS);
    assert.equal(deadlineFromEnv("45000"), 45_000);
    assert.equal(deadlineFromEnv("700000"), DEFAULT_DEADLINE_MS);
  });

  await test("Drive colgado en el listado: se corta (timeout o signal), ERROR con 'tiempo agotado' y SyncLog dentro del límite", async () => {
    const t = setup(allFiles(), { env: { COSEGUROS_DEADLINE_MS: "2000" }, drive: { hangList: true } });
    const t0 = Date.now();
    const r = await syncCoseguros(t.d);
    const ms = Date.now() - t0;
    assert.ok(ms < 2000, `tardó ${ms} ms`);
    assert.equal(t.drive.calls.cut, 1, "el request colgado de Drive se cortó");
    assert.equal(r?.status, "ERROR");
    assert.match(r!.message, /^Incompleta: 0 de 11 sucursales\. Falló la carga: tiempo agotado/);
    assert.equal(t.logs.length, 1);
    assert.equal(t.logs[0].source, "SALES_COSEGUROS");
  });

  await test("ninguna llamada a Drive tiene un timeout mayor que el tiempo restante", async () => {
    const t = setup(allFiles(), { env: { COSEGUROS_DEADLINE_MS: "2000" } });
    await syncCoseguros(t.d);
    assert.ok(t.drive.calls.timeouts.every((ms) => ms > 0 && ms <= 2000 - LOG_RESERVE_MS), String(t.drive.calls.timeouts));
  });

  await test("descarga colgada a mitad: las anteriores quedan, el resto 'tiempo agotado', y después no se escribe nada más", async () => {
    const t = setup(allFiles(), { env: { COSEGUROS_DEADLINE_MS: "2000" }, drive: { hangDownload: (n) => n.startsWith("Larcade") } });
    const r = await syncCoseguros(t.d);
    assert.equal(r?.status, "PARTIAL");
    assert.deepEqual(r?.loaded, ["America", "Facultad", "Etcheverry", "Galesa"]);
    assert.match(r!.message, /Faltan: Larcade \(tiempo agotado\), La Perla \(tiempo agotado\), .*Tekiel \(tiempo agotado\)\./);
    assert.equal(t.drive.calls.cut, 1, "la descarga colgada se cortó");
    assert.equal(t.drive.calls.download, 5, "no se empezaron descargas después de vencer");
    assert.match(String(t.logs[0].warnings), /Tiempo agotado: límite de la corrida 2000 ms/);
    const writes = t.mem.writes();
    await sleep(1500);
    assert.equal(t.mem.writes(), writes, "nada escribe después de terminar");
  });

  await test("transacción que no termina a tiempo: se revierte (nada de esa sucursal) y no se empiezan más", async () => {
    const t = setup(allFiles(), {
      env: { COSEGUROS_DEADLINE_MS: "2000" },
      store: { delayMs: (b) => (b === bid("Galesa") ? 60_000 : 0) },
    });
    const t0 = Date.now();
    const r = await syncCoseguros(t.d);
    assert.ok(Date.now() - t0 < 2000);
    assert.equal(r?.status, "PARTIAL");
    assert.deepEqual(r?.loaded, ["America", "Facultad", "Etcheverry"]);
    assert.match(r!.message, /Galesa \(tiempo agotado\)/);
    assert.equal([...t.mem.rows.values()].filter((x) => x.branchId === bid("Galesa")).length, 0);
    assert.ok(r!.warnings.some((w) => w.startsWith("[Galesa] escritura revertida: Transaction timeout")));
  });

  await test("falla a mitad de un archivo: todo o nada (no quedan las filas ya creadas de ese archivo)", async () => {
    const t = setup(allFiles({ "Tekiel_coseguros.csv": [H, "2026-10-18,AAA,A,1,0,1", "2026-10-18,BBB,B,1,0,2"].join("\n") }), {
      store: { failAfterCreate: (b) => b === bid("Tekiel") },
    });
    const r = await syncCoseguros(t.d);
    assert.equal(r?.status, "PARTIAL");
    assert.match(r!.message, /Faltan: Tekiel \(error\)/);
    assert.equal([...t.mem.rows.values()].filter((x) => x.branchId === bid("Tekiel")).length, 0);
  });

  await test("lectura de sucursales colgada → ERROR por tiempo, dentro del límite", async () => {
    const t = setup(allFiles(), { env: { COSEGUROS_DEADLINE_MS: "2000" }, deps: { getBranches: () => new Promise(() => {}) } });
    const t0 = Date.now();
    const r = await syncCoseguros(t.d);
    assert.ok(Date.now() - t0 < 2000);
    assert.equal(r?.status, "ERROR");
    assert.match(r!.message, /tiempo agotado/);
    assert.equal(t.drive.calls.list, 0);
  });

  await test("SyncLog colgado: no pasa del límite total y el resultado es ERROR (no éxito)", async () => {
    const t = setup(allFiles(), { env: { COSEGUROS_DEADLINE_MS: "2000" }, deps: { writeLog: () => new Promise(() => {}) } });
    const t0 = Date.now();
    const r = await syncCoseguros(t.d);
    assert.ok(Date.now() - t0 < 2000 + 200, `tardó ${Date.now() - t0} ms`);
    assert.deepEqual([r?.status, r?.loadStatus, r?.logWritten, r?.complete], ["ERROR", "SUCCESS", false, true]);
    assert.match(r!.message, /^No quedó registrada en SyncLog \(SyncLog: sin respuesta en 1000 ms\)\. Resultado de la carga: Completa: 11 de 11/);
  });

  await test("SyncLog que falla (Neon rechaza): ERROR con el resultado de la carga, también si era incompleta", async () => {
    for (const [files, loadStatus] of [[allFiles(), "SUCCESS"], [allFiles({ "Galesa_coseguros.csv": null }), "PARTIAL"]] as const) {
      const t = setup(files, { deps: { writeLog: async () => { throw new Error("connection terminated"); } } });
      const r = await syncCoseguros(t.d);
      assert.deepEqual([r?.status, r?.loadStatus, r?.logWritten], ["ERROR", loadStatus, false]);
      assert.match(r!.message, /^No quedó registrada en SyncLog \(connection terminated\)\. Resultado de la carga: /);
    }
  });

  await test("SyncLog escrito: logWritten y status igual a loadStatus", async () => {
    const t = setup(allFiles({ "Galesa_coseguros.csv": null }));
    const r = await syncCoseguros(t.d);
    assert.deepEqual([r?.status, r?.loadStatus, r?.logWritten], ["PARTIAL", "PARTIAL", true]);
    assert.equal(t.logs[0].status, "PARTIAL");
  });

  console.log("\nTransacción: esperar + ejecutar comparten el tiempo");

  await test("transactionLimits: maxWait + timeout = tiempo que queda, espera ≤ 1/4 y ≤ 2 s", () => {
    for (const budget of [2, 3, 300, 999, 1_000, 6_700, 7_000, 8_000, 120_000, 599_000]) {
      const { maxWait, timeout } = transactionLimits(budget);
      assert.equal(maxWait + timeout, budget, `budget ${budget}`);
      assert.ok(maxWait >= 1 && timeout >= 1, `budget ${budget}`);
      assert.ok(maxWait <= TX_MAX_WAIT_MS && maxWait <= Math.max(1, budget / 4), `budget ${budget}: maxWait ${maxWait}`);
    }
    assert.deepEqual(transactionLimits(6_700), { maxWait: 1_675, timeout: 5_025 });
    assert.deepEqual(transactionLimits(120_000), { maxWait: 2_000, timeout: 118_000 });
    // Lo de antes (maxWait 2 s + timeout = todo lo que quedaba) podía sumar 2 s de más.
  });

  await test("cada archivo recibe como tiempo total lo que queda de la corrida (nunca más)", async () => {
    const seen: { at: number; timeoutMs: number }[] = [];
    const t = setup(allFiles());
    const inner = t.d.store.upsertFile;
    t.d.store = { ...t.d.store, upsertFile: (b, r, s, o) => { seen.push({ at: Date.now(), timeoutMs: o.timeoutMs }); return inner(b, r, s, o); } };
    const t0 = Date.now();
    await syncCoseguros(t.d);
    assert.equal(seen.length, 11);
    for (const x of seen) assert.ok(x.at + x.timeoutMs <= t0 + DEFAULT_DEADLINE_MS - LOG_RESERVE_MS + 5, JSON.stringify(x));
  });

  console.log("\nUpsert");

  await test("idempotente: la segunda corrida no escribe y la tabla queda idéntica", async () => {
    const t = setup(allFiles());
    await syncCoseguros(t.d);
    const w1 = t.mem.writes();
    const snap = JSON.stringify([...t.mem.rows.entries()]);
    const r2 = await syncCoseguros(t.d);
    assert.equal(t.mem.writes(), w1);
    assert.equal(JSON.stringify([...t.mem.rows.entries()]), snap);
    assert.equal(r2?.message, "Completa: 11 de 11 sucursales. 0 filas nuevas, 0 actualizadas, 11 sin cambios.");
  });

  await test("recarga con otro valor reemplaza la fila (no la duplica)", async () => {
    const files = allFiles();
    const t = setup(files);
    await syncCoseguros(t.d);
    files["Tekiel_coseguros.csv"] = rowFor("Tekiel", "AAA", "-250.5");
    const r = await syncCoseguros(t.d);
    assert.match(r!.message, /0 filas nuevas, 1 actualizadas, 10 sin cambios\./);
    assert.equal(t.mem.rows.size, 11);
    assert.equal(t.mem.rows.get(`${bid("Tekiel")}|2026-10-18|AAA`)?.amount, "-250.50");
  });

  await test("filas de Neon sin par en el archivo → aviso, no se borran", async () => {
    const files = allFiles({ "Tekiel_coseguros.csv": [H, "2026-10-18,AAA,A,1,0,1", "2026-10-18,BBB,B,1,0,2"].join("\n") });
    const t = setup(files);
    await syncCoseguros(t.d);
    files["Tekiel_coseguros.csv"] = [H, "2026-10-18,AAA,A,1,0,1"].join("\n");
    const r = await syncCoseguros(t.d);
    assert.equal([...t.mem.rows.values()].filter((x) => x.branchId === bid("Tekiel")).length, 2);
    assert.ok(r!.warnings.includes("[Tekiel] 1 fila(s) en Neon sin par en el archivo para esas fechas — no se borran"));
  });

  await test("clave: el mismo código en dos sucursales queda en dos filas, cada una con su nombre", async () => {
    const t = setup(allFiles());
    await syncCoseguros(t.d);
    assert.equal(t.mem.rows.get(`${bid("La Perla")}|2026-10-18|AAA`)?.name, "COSEGURO AAA LA PERLA");
    assert.equal(t.mem.rows.get(`${bid("San Agustin")}|2026-10-18|AAA`)?.name, "COSEGURO AAA SAN AGUSTIN");
  });

  await test("plan: nuevas, cambian, iguales y huérfanas", () => {
    const row = (code: string, amount: string): CoseguroRow => ({ date: "2026-01-02", code, name: code, receipts: 1, creditNotes: 0, amount });
    const p = planCoseguroChanges([row("A", "1.00"), row("B", "2.00"), row("C", "3.00")], [row("B", "2.00"), row("C", "9.00"), row("D", "4.00")]);
    assert.deepEqual(p.toCreate.map((r) => r.code), ["A"]);
    assert.deepEqual(p.toUpdate.map((u) => [u.row.code, u.before.amount, u.row.amount]), [["C", "9.00", "3.00"]]);
    assert.equal(p.unchanged, 1);
    assert.deepEqual(p.orphans.map((r) => r.code), ["D"]);
  });

  await test("totales de control en centavos exactos", () => {
    const rows: CoseguroRow[] = [
      { date: "2026-01-01", code: "A", name: "A", receipts: 2, creditNotes: 1, amount: "0.10" },
      { date: "2026-01-01", code: "B", name: "B", receipts: 1, creditNotes: 0, amount: "0.20" },
      { date: "2026-01-02", code: "A", name: "A", receipts: 1, creditNotes: 1, amount: "-1000.05" },
    ];
    const t = totalsOf(rows);
    assert.deepEqual({ r: t.receipts, n: t.creditNotes, a: formatCents(t.amountCents) }, { r: 4, n: 2, a: "-999.75" });
    assert.equal(toCents("12345678.91"), 1234567891);
    assert.equal(formatCents(-5), "-0.05");
  });

  console.log("\nApagada y registro");

  await test("apagada (sin COSEGUROS_SYNC_ENABLED=true): no lista, no descarga, no escribe, no deja SyncLog", async () => {
    for (const env of [{ COSEGUROS_SYNC_ENABLED: undefined }, { COSEGUROS_SYNC_ENABLED: "1" }, { COSEGUROS_SYNC_ENABLED: "TRUE" }]) {
      const t = setup(allFiles(), { env });
      assert.equal(await syncCoseguros(t.d), null);
      assert.deepEqual([t.drive.calls.list, t.drive.calls.download, t.logs.length, t.mem.rows.size], [0, 0, 0, 0]);
    }
  });

  await test("su SyncLog es siempre SALES_COSEGUROS, también si falta la carpeta", async () => {
    const t = setup(allFiles(), { env: { GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID: undefined } });
    const r = await syncCoseguros(t.d);
    assert.equal(r?.status, "ERROR");
    assert.equal(r?.message, "Incompleta: 0 de 11 sucursales. Falló la carga: GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID not set");
    assert.deepEqual(t.logs.map((l) => l.source), ["SALES_COSEGUROS"]);
  });

  console.log(`\n${passed} de ${passed + failures.length} verificaciones pasan`);
  if (failures.length > 0) process.exit(1);
}

main();
