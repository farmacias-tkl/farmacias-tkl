/**
 * SMOKE de coseguros contra una DB Postgres LOCAL EFÍMERA. NO toca Neon ni Drive.
 *
 * 1. Crea la DB con el schema de b3af746 (antes de CoseguroDaily) y siembra Branch,
 *    SalesSnapshot y SyncLog.
 * 2. Aplica prisma/gates/2026-10-19-coseguro-daily.sql tal cual.
 * 3. `prisma migrate diff --from-url <DB> --to-schema-datamodel <schema.prisma de 5c2ba5b>`
 *    tiene que dar vacío: el SQL deja la base igual al schema del repo.
 * 4. Las tablas existentes quedan idénticas.
 * 5. Store real (Prisma): insert, idempotencia, update, clave por sucursal, Decimal exacto.
 * 5b. Transacción real por archivo: falla a mitad → no queda nada; vence el timeout → se revierte;
 *     con el pool ocupado, esperar para empezar + ejecutar no pasan juntos del tiempo dado.
 * 6. syncCoseguros con Prisma real (Drive falso): completa / incompleta y SyncLog SALES_COSEGUROS.
 * 7. scripts/load-coseguros-history.ts: dry-run (no escribe) y --apply.
 * Teardown garantizado (DROP al final).
 *
 *   npx tsx src/lib/sync/coseguros.smoke.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { prismaCoseguroStore, processCoseguroFile } from "./coseguros-upsert";
import { syncCoseguros, EXPECTED_SIAF_BRANCHES } from "./sync-coseguros";

const TEST_DB = "tkl_coseguros_smoke";
const BASE_COMMIT = "b3af746";
const GATE_COMMIT = "5c2ba5b"; // commit que agregó CoseguroDaily y prisma/gates/2026-10-19-coseguro-daily.sql

function abort(m: string): never { console.error("ABORT:", m); process.exit(1); }
const m = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+?)"?\s*$/m);
if (!m) abort("No encontré DATABASE_URL en .env");
const baseUrl = m[1].trim();
if (!["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname)) abort(`SAFETY ABORT: ${new URL(baseUrl).hostname} no es local. NUNCA Neon.`);
const adminUrl = new URL(baseUrl); adminUrl.pathname = "/postgres";
const testUrl = new URL(baseUrl); testUrl.pathname = `/${TEST_DB}`;
const ADMIN_URL = adminUrl.toString();
const TEST_URL = testUrl.toString();
const TEST_HOST = testUrl.host;
const env = { ...process.env, DATABASE_URL: TEST_URL };

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
const run = (cmd: string) => execSync(cmd, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Sentencias del archivo SQL (sin comentarios), en orden. */
function gateStatements(): string[] {
  const sql = fs.readFileSync("prisma/gates/2026-10-19-coseguro-daily.sql", "utf8")
    .split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
  return sql.split(";").map((s) => s.trim()).filter(Boolean);
}

const H = "fecha,codigo_coseguro,nombre_coseguro,comprobantes,notas_credito,importe_coseguro";

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coseguros-smoke-"));
  await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${TEST_DB}"`);
  const db = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  try {
    // 1. Schema anterior + datos existentes
    const oldSchema = path.join(tmp, "schema.prisma");
    fs.writeFileSync(oldSchema, execSync(`git show ${BASE_COMMIT}:prisma/schema.prisma`, { encoding: "utf8" }));
    run(`npx prisma db push --skip-generate --schema "${oldSchema}"`);

    await db.$executeRawUnsafe(`INSERT INTO "Branch" (id, name, code, aliases, "createdAt", "updatedAt") VALUES
      ('b-perla','La Perla','MU','{}',now(),now()), ('b-agustin','San Agustin','SA','{}',now(),now()), ('b-tekiel','Tekiel','TK','{}',now(),now()),
      ('b-am','America','AM','{}',now(),now()), ('b-ay','Facultad','AY','{}',now(),now()), ('b-et','Etcheverry','ET','{}',now(),now()),
      ('b-gl','Galesa','GL','{}',now(),now()), ('b-la','Larcade','LA','{}',now(),now()), ('b-nv','Naveira','NV','{}',now(),now()),
      ('b-qn','Quintana','QN','{}',now(),now()), ('b-sm','San Miguel','SM','{}',now(),now())`);
    await db.$executeRawUnsafe(`INSERT INTO "SalesSnapshot" (id, "branchId", "snapshotDate", "totalSales", units, receipts, "avgTicket", "rawData", "dataSource")
      VALUES ('s1','b-tekiel','2026-10-18', 1234.56, 10, 3, 411.52, '{"source":"siaf"}', 'siaf')`);
    await db.$executeRawUnsafe(`INSERT INTO "SyncLog" (id, source, status, message, "syncDate", "triggeredBy")
      VALUES ('l1','SALES_API','SUCCESS','11 filas procesadas, 0 ignoradas. 11 sucursales.','2026-10-19','WEBHOOK')`);
    const fingerprint = async () => JSON.stringify(await db.$queryRawUnsafe(`SELECT
      (SELECT json_agg(t ORDER BY id) FROM "Branch" t) AS b,
      (SELECT json_agg(t ORDER BY id) FROM "SalesSnapshot" t) AS s,
      (SELECT json_agg(t ORDER BY id) FROM "SyncLog" t) AS l`));
    const before = await fingerprint();

    // 2. Gate SQL
    const stmts = gateStatements();
    await check(`el SQL del gate tiene 6 sentencias, solo ADD VALUE / CREATE / ADD CONSTRAINT (${stmts.length})`, async () => {
      assert.equal(stmts.length, 6);
      for (const s of stmts) assert.match(s, /^(ALTER TYPE "SyncSource" ADD VALUE|CREATE TABLE "CoseguroDaily"|CREATE (UNIQUE )?INDEX "CoseguroDaily_|ALTER TABLE "CoseguroDaily" ADD CONSTRAINT)/);
      // La FK trae "ON DELETE RESTRICT ON UPDATE CASCADE" (reglas de la FK, no sentencias): se excluye del scan.
      const scanned = stmts.join("\n").replace(/ON (DELETE|UPDATE) (RESTRICT|CASCADE)/g, "");
      assert.equal(/\b(DROP|DELETE|UPDATE|TRUNCATE|RENAME|INSERT)\b/i.test(scanned), false);
    });
    for (const s of stmts) await db.$executeRawUnsafe(s);

    // 3. Igual al schema del commit que trajo este gate (GATE_COMMIT). Contra el
    //    schema.prisma actual no da vacío en cuanto un gate posterior agrega algo.
    await check(`migrate diff (DB con el SQL aplicado → schema.prisma de ${GATE_COMMIT}) da vacío`, async () => {
      const gateSchema = path.join(tmp, "gate-schema.prisma");
      fs.writeFileSync(gateSchema, execSync(`git show ${GATE_COMMIT}:prisma/schema.prisma`, { encoding: "utf8" }));
      const out = run(`npx prisma migrate diff --from-url "${TEST_URL}" --to-schema-datamodel "${gateSchema}" --script`);
      assert.match(out, /This is an empty migration/);
    });

    // 4. Tablas existentes intactas
    await check("Branch, SalesSnapshot y SyncLog idénticos después del SQL", async () => {
      assert.equal(await fingerprint(), before);
    });

    // 5. Store real
    const store = prismaCoseguroStore(db);
    const branches = await db.branch.findMany({ select: { id: true, name: true, aliases: true } });
    const perla = [H, "2026-10-18,AAA,COSEGURO A,3,1,1500.0", "2026-10-18,BBB,\"COSEGURO B, PLAN\",1,1,-250.5", "2026-10-18,CCC,C,1,0,0.0"].join("\r\n");
    const load = (name: string, csv: string, write = true) =>
      processCoseguroFile({ sucursalName: name, csvContent: csv, sourceFile: `test:${name}` }, branches, store, { write });

    await check("insert real: 3 filas, Decimal exacto, negativo y cero", async () => {
      const out = await load("La Perla", perla);
      assert.equal(out.kind, "ok");
      if (out.kind === "ok") assert.deepEqual(out.written, { created: 3, updated: 0 });
      const rows = await db.coseguroDaily.findMany({ where: { branchId: "b-perla" }, orderBy: { code: "asc" } });
      assert.deepEqual(rows.map((r) => [r.date.toISOString().slice(0, 10), r.code, r.name, r.receipts, r.creditNotes, r.amount.toFixed(2)]), [
        ["2026-10-18", "AAA", "COSEGURO A", 3, 1, "1500.00"],
        ["2026-10-18", "BBB", "COSEGURO B, PLAN", 1, 1, "-250.50"],
        ["2026-10-18", "CCC", "C", 1, 0, "0.00"],
      ]);
    });

    await check("idempotente: segunda carga no escribe (updatedAt igual)", async () => {
      const t0 = (await db.coseguroDaily.findMany({ orderBy: { code: "asc" } })).map((r) => r.updatedAt.getTime());
      const out = await load("La Perla", perla);
      if (out.kind !== "ok") throw new Error(out.kind);
      assert.deepEqual({ c: out.plan.toCreate.length, u: out.plan.toUpdate.length, same: out.plan.unchanged }, { c: 0, u: 0, same: 3 });
      assert.deepEqual(out.written, { created: 0, updated: 0 });
      const t1 = (await db.coseguroDaily.findMany({ orderBy: { code: "asc" } })).map((r) => r.updatedAt.getTime());
      assert.deepEqual(t1, t0);
      assert.equal(await db.coseguroDaily.count(), 3);
    });

    await check("recarga con otro valor reemplaza (update por clave), no duplica", async () => {
      const out = await load("La Perla", perla.replace("3,1,1500.0", "4,1,1600.10"));
      if (out.kind !== "ok") throw new Error(out.kind);
      assert.deepEqual(out.written, { created: 0, updated: 1 });
      const a = await db.coseguroDaily.findUniqueOrThrow({ where: { branchId_date_code: { branchId: "b-perla", date: new Date("2026-10-18T00:00:00Z"), code: "AAA" } } });
      assert.deepEqual([a.receipts, a.amount.toFixed(2)], [4, "1600.10"]);
      assert.equal(await db.coseguroDaily.count(), 3);
    });

    await check("clave: el mismo código en otra sucursal es otra fila; la DB rechaza duplicar la clave", async () => {
      await load("San Agustin", `${H}\n2026-10-18,AAA,OTRO NOMBRE,2,0,800`);
      assert.equal(await db.coseguroDaily.count({ where: { code: "AAA" } }), 2);
      await assert.rejects(db.coseguroDaily.create({ data: { branchId: "b-agustin", date: new Date("2026-10-18T00:00:00Z"), code: "AAA", name: "x", receipts: 1, creditNotes: 0, amount: "1", sourceFile: "x" } }), /Unique constraint/);
    });

    await check("dry-run (write:false) no escribe", async () => {
      const n = await db.coseguroDaily.count();
      const out = await load("Tekiel", `${H}\n2026-10-18,ZZZ,Z,1,0,5`, false);
      if (out.kind !== "ok") throw new Error(out.kind);
      assert.equal(out.written, null);
      assert.equal(out.plan.toCreate.length, 1);
      assert.equal(await db.coseguroDaily.count(), n);
    });

    // 5b. Transacción real por archivo
    await check("transacción real: falla a mitad del archivo (update fuera de rango) → no queda la fila ya creada", async () => {
      await load("Tekiel", `${H}\n2026-10-10,UPD,U,1,0,10`);
      const rows = [
        { date: "2026-10-10", code: "NEW1", name: "N", receipts: 1, creditNotes: 0, amount: "5.00" },
        { date: "2026-10-10", code: "UPD", name: "U", receipts: 1, creditNotes: 0, amount: "99999999999999.99" }, // > Decimal(15,2)
      ];
      await assert.rejects(store.upsertFile("b-tekiel", rows, "test", { timeoutMs: 10_000 }));
      assert.equal(await db.coseguroDaily.count({ where: { branchId: "b-tekiel", code: "NEW1" } }), 0, "el createMany se revirtió");
      const u = await db.coseguroDaily.findFirstOrThrow({ where: { branchId: "b-tekiel", code: "UPD" } });
      assert.equal(u.amount.toFixed(2), "10.00");
    });

    await check("transacción real que vence su timeout → se revierte y no escribe después; esperar + ejecutar caben en el tiempo dado", async () => {
      await db.$executeRawUnsafe(`CREATE FUNCTION smoke_slow() RETURNS trigger AS $$
        BEGIN IF NEW.code = 'SLOW' THEN PERFORM pg_sleep(1.5); ELSIF NEW.code = 'SLOWER' THEN PERFORM pg_sleep(6); END IF;
        RETURN NEW; END $$ LANGUAGE plpgsql`);
      await db.$executeRawUnsafe(`CREATE TRIGGER smoke_slow BEFORE INSERT ON "CoseguroDaily" FOR EACH ROW EXECUTE FUNCTION smoke_slow()`);
      try {
        const rows = [
          { date: "2026-10-11", code: "FAST", name: "F", receipts: 1, creditNotes: 0, amount: "1.00" },
          { date: "2026-10-11", code: "SLOW", name: "S", receipts: 1, creditNotes: 0, amount: "2.00" },
        ];
        const t0 = Date.now();
        await assert.rejects(store.upsertFile("b-tekiel", rows, "test", { timeoutMs: 500 }));
        assert.ok(Date.now() - t0 <= 500 + 150, `tardó ${Date.now() - t0} ms (tope 500)`);
        await new Promise((r) => setTimeout(r, 2500));
        assert.equal(await db.coseguroDaily.count({ where: { date: new Date("2026-10-11T00:00:00Z") } }), 0, "nada de ese archivo, ni después");

        // Esperar para empezar + ejecutar comparten el tiempo. Cliente con UNA conexión,
        // ocupada por otra transacción: la del archivo primero espera y después corre.
        const oneUrl = new URL(TEST_URL); oneUrl.searchParams.set("connection_limit", "1");
        const one = new PrismaClient({ datasources: { db: { url: oneUrl.toString() } } });
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const slower = [{ date: "2026-10-12", code: "SLOWER", name: "S", receipts: 1, creditNotes: 0, amount: "2.00" }];
        try {
          await one.$connect();
          // a) La conexión se libera a los ~0,8 s: entra a esperar y después la ejecución
          //    vence. Con 4 s: espera ≤ 1 s + ejecución ≤ 3 s. (Antes: hasta 2 s + 4 s.)
          let busy = one.$transaction(async (tx) => { await tx.$executeRawUnsafe("SELECT pg_sleep(0.8)"); }, { timeout: 10_000 });
          await sleep(50);
          let t1 = Date.now();
          await assert.rejects(prismaCoseguroStore(one).upsertFile("b-tekiel", slower, "test", { timeoutMs: 4_000 }));
          let ms = Date.now() - t1;
          await busy;
          assert.ok(ms >= 2_500 && ms <= 4_000 + 150, `a) tardó ${ms} ms (tope 4000)`);
          // Y en el servidor la sentencia se canceló (statement_timeout), no sigue corriendo.
          await sleep(300);
          const running = await db.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT count(*) AS n FROM pg_stat_activity WHERE state = 'active' AND query ILIKE '%CoseguroDaily%' AND pid <> pg_backend_pid()`);
          assert.equal(Number(running[0].n), 0, "la sentencia lenta tenía que quedar cancelada en Postgres");

          // b) La conexión sigue ocupada más que la espera permitida: rechaza al vencer la
          //    espera (1/4 de 1 s), sin llegar a empezar.
          busy = one.$transaction(async (tx) => { await tx.$executeRawUnsafe("SELECT pg_sleep(1.5)"); }, { timeout: 10_000 });
          await sleep(50);
          t1 = Date.now();
          await assert.rejects(prismaCoseguroStore(one).upsertFile("b-tekiel", slower, "test", { timeoutMs: 1_000 }));
          ms = Date.now() - t1;
          await busy;
          assert.ok(ms <= 1_000 + 150, `b) tardó ${ms} ms (tope 1000)`);
          assert.equal(await db.coseguroDaily.count({ where: { code: "SLOWER" } }), 0, "nada escrito");
        } finally {
          await one.$disconnect();
        }
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER smoke_slow ON "CoseguroDaily"`);
        await db.$executeRawUnsafe(`DROP FUNCTION smoke_slow()`);
      }
    });

    // 6. syncCoseguros con Prisma real
    const allBranches = await db.branch.findMany({ select: { id: true, name: true, aliases: true } });
    const realDeps = (names: readonly string[], csv: (n: string) => string) => ({
      env: { COSEGUROS_SYNC_ENABLED: "true", GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID: "f" },
      listFiles: async () => names.map((n) => ({ sucursalName: n, driveFileId: n, driveFileName: `${n}_coseguros.csv`, modifiedTime: "2026-10-19T06:00:00Z" })),
      downloadText: async (id: string) => csv(id),
      getBranches: async () => allBranches,
      store,
      writeLog: (data: Parameters<typeof db.syncLog.create>[0]["data"]) => db.syncLog.create({ data }),
    });

    await check("syncCoseguros real con las 11: SUCCESS 'Completa', SyncLog SALES_COSEGUROS, SalesSnapshot intacta", async () => {
      const salesBefore = JSON.stringify(await db.salesSnapshot.findMany());
      const r = await syncCoseguros(realDeps(EXPECTED_SIAF_BRANCHES, (n) => n === "Galesa" ? H : `${H}\n2026-10-16,QQQ,Q ${n},1,0,5`));
      assert.equal(r?.status, "SUCCESS");
      const log = await db.syncLog.findFirstOrThrow({ where: { source: "SALES_COSEGUROS" }, orderBy: { createdAt: "desc" } });
      assert.equal(log.status, "SUCCESS");
      assert.equal(log.message, "Completa: 11 de 11 sucursales. 10 filas nuevas, 0 actualizadas, 0 sin cambios.");
      assert.equal(await db.syncLog.count({ where: { source: "SALES_API" } }), 1);
      assert.equal(JSON.stringify(await db.salesSnapshot.findMany()), salesBefore);
    });

    await check("syncCoseguros real incompleta: PARTIAL y el SyncLog nombra las faltantes", async () => {
      const r = await syncCoseguros(realDeps(EXPECTED_SIAF_BRANCHES.filter((n) => n !== "Naveira"), (n) => n === "Quintana" ? "basura" : `${H}\n2026-10-16,QQQ,Q ${n},1,0,5`));
      assert.equal(r?.status, "PARTIAL");
      const log = await db.syncLog.findFirstOrThrow({ where: { source: "SALES_COSEGUROS" }, orderBy: { createdAt: "desc" } });
      assert.equal(log.status, "PARTIAL");
      assert.equal(log.message, "Incompleta: 9 de 11 sucursales. Faltan: Naveira (sin archivo), Quintana (archivo inválido). 1 filas nuevas, 0 actualizadas, 8 sin cambios.");
    });

    // 7. Script del histórico (parte de una fila existente de Tekiel con otro importe)
    await load("Tekiel", `${H}\n2026-10-18,ZZZ,Z,1,0,5`);
    const dir = path.join(tmp, "hist");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "Tekiel_coseguros.csv"), [H, "2026-10-17,AAA,A,2,1,100.5", "2026-10-18,ZZZ,Z,1,0,6"].join("\r\n"));
    fs.writeFileSync(path.join(dir, "La Perla_coseguros.csv"), perla);
    fs.writeFileSync(path.join(dir, "Tekiel_ventas.csv"), "no se lee");
    const script = `npx tsx scripts/load-coseguros-history.ts --dir "${dir}"`;

    await check("histórico dry-run: cuenta insertar / existen / cambian y no escribe", async () => {
      const n = await db.coseguroDaily.count();
      const out = run(script);
      assert.match(out, /\[Tekiel\] Tekiel_coseguros\.csv: 2 filas · 2026-10-17 → 2026-10-18 · comprobantes=3 · NCR=1 · importe=106\.50/);
      assert.match(out, /\[Tekiel\][^\n]*\n\s+se insertarían 1 · ya existen 1 \(cambian de valor 1, iguales 0\)/);
      assert.match(out, /cambia 2026-10-18 ZZZ: comprobantes 1→1, NCR 0→0, importe 5\.00→6\.00/);
      assert.match(out, /\[La Perla\][^\n]*\n\s+se insertarían 0 · ya existen 3 \(cambian de valor 1, iguales 2\)/);
      assert.match(out, /DRY-RUN: no se escribió nada/);
      assert.equal(await db.coseguroDaily.count(), n);
    });

    await check("histórico --apply exige el host correcto", async () => {
      assert.throws(() => run(`${script} --apply --host otro.host`), /no coincide/);
    });

    await check("histórico --apply escribe lo planeado y una segunda vez no cambia nada", async () => {
      const out = run(`${script} --apply --host ${TEST_HOST}`);
      assert.match(out, /APPLY terminado: 1 nuevas, 2 actualizadas\./);
      const z = await db.coseguroDaily.findUniqueOrThrow({ where: { branchId_date_code: { branchId: "b-tekiel", date: new Date("2026-10-18T00:00:00Z"), code: "ZZZ" } } });
      assert.equal(z.amount.toFixed(2), "6.00");
      assert.equal(z.sourceFile, "historico:Tekiel_coseguros.csv");
      const again = run(`${script} --apply --host ${TEST_HOST}`);
      assert.match(again, /APPLY terminado: 0 nuevas, 0 actualizadas\./);
    });

    await check("histórico: un archivo inválido cancela el apply entero", async () => {
      fs.writeFileSync(path.join(dir, "San Agustin_coseguros.csv"), `${H}\n2026-10-18,AAA,X,1,0,abc`);
      const n = await db.coseguroDaily.count();
      assert.throws(() => run(`${script} --apply --host ${TEST_HOST}`));
      assert.equal(await db.coseguroDaily.count(), n);
    });

    const docQueries = () => [...fs.readFileSync("docs/integrations/siaf-coseguros.md", "utf8").matchAll(/```sql\r?\n([\s\S]*?)```/g)]
      .map((x) => x[1].trim().replace(/;\s*$/, ""));

    await check("consultas del doc: 7, corren tal cual, solo lectura y nunca agrupan ni filtran por código solo", async () => {
      const queries = docQueries();
      assert.equal(queries.length, 7);
      for (const q of queries) {
        assert.match(q, /^SELECT\b/);
        const groupBy = /GROUP BY ([^\n]+)/.exec(q)?.[1] ?? "";
        if (/c\.code/.test(groupBy)) assert.match(groupBy, /b\.name/, `agrupa por código sin sucursal: ${groupBy}`);
        assert.equal(/c\.code\s*=/.test(q), false, "filtra por código solo");
        await db.$queryRawUnsafe(q);
      }
    });

    await check("coseguro puntual por nombre: encuentra los dos códigos de sus sucursales y no el mismo código de otra", async () => {
      // Caso inventado con la forma del real: el mismo coseguro es MA1 en Tekiel y PB2 en La Perla;
      // en San Agustin, PB2 es OTRO coseguro.
      await load("Tekiel",      `${H}\n2026-09-01,MA1,MUTUAL ALFA,2,0,100\n2026-10-01,MA1,MUTUAL ALFA,1,1,-20`);
      await load("La Perla",    `${H}\n2026-09-02,PB2,MUTUAL ALFA SALUD,3,0,300`);
      await load("San Agustin", `${H}\n2026-09-03,PB2,PLAN BETA,7,0,700`);
      const q = docQueries();
      const byName = (sql: string) => sql.replace("'%texto%'", "'%alfa%'");
      type R = Record<string, unknown>;
      const pairs = (rows: R[]) => rows.map((r) => `${r.sucursal} ${r.codigo}`).sort();

      assert.deepEqual(pairs(await db.$queryRawUnsafe<R[]>(byName(q[1]))), ["La Perla PB2", "Tekiel MA1"]);
      const r3 = await db.$queryRawUnsafe<R[]>(byName(q[2]));
      assert.deepEqual(pairs(r3), ["La Perla PB2", "Tekiel MA1"]);
      assert.deepEqual(r3.map((r) => [r.sucursal, Number(r.comprobantes), Number(r.cobertura_coseguro)]).sort(),
        [["La Perla", 3, 300], ["Tekiel", 3, 80]]);
      const r4 = await db.$queryRawUnsafe<R[]>(q[3].replace("('Sucursal A', 'AAA'), ('Sucursal B', 'BBB')", "('Tekiel', 'MA1'), ('La Perla', 'PB2')"));
      assert.deepEqual(pairs(r4), ["La Perla PB2", "Tekiel MA1"]);
      const r5 = await db.$queryRawUnsafe<R[]>(byName(q[4]));
      assert.deepEqual(r5.map((r) => [r.mes, r.sucursal_codigo, Number(r.comprobantes)]),
        [["2026-09", "La Perla PB2, Tekiel MA1", 5], ["2026-10", "Tekiel MA1", 1]]);
      // Contraejemplo: filtrar por código solo mezclaría PB2 de La Perla (3) con PB2 de San Agustin (7).
      const wrong = await db.$queryRawUnsafe<R[]>(`SELECT sum(receipts) AS n FROM "CoseguroDaily" WHERE code = 'PB2'`);
      assert.equal(Number(wrong[0].n), 10);
    });

    await check("consulta 6 (control por sucursal) da los totales esperados", async () => {
      const r = await db.$queryRawUnsafe<{ sucursal: string; comprobantes: bigint; ncr: bigint; cobertura_coseguro: { toFixed(n: number): string } }[]>(
        docQueries()[5].replace("'2026-01-01' AND '2026-10-12'", "'2026-10-17' AND '2026-10-18'"));
      const tk = r.find((x) => x.sucursal === "Tekiel");
      assert.deepEqual([Number(tk?.comprobantes), Number(tk?.ncr), tk?.cobertura_coseguro.toFixed(2)], [3, 1, "106.50"]);
    });

    await check("Branch, SalesSnapshot y el SyncLog de SALES_API siguen idénticos al final", async () => {
      const now = JSON.parse(await fingerprint());
      const prev = JSON.parse(before);
      assert.deepEqual(now[0].b, prev[0].b);
      assert.deepEqual(now[0].s, prev[0].s);
      assert.deepEqual(now[0].l.filter((x: { source: string }) => x.source === "SALES_API"), prev[0].l);
    });
  } finally {
    await db.$disconnect();
    try { await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`); console.log("teardown OK — DB efímera eliminada."); }
    catch (e) { console.error("teardown falló:", e); }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\ncoseguros smoke: ${pass} ok, ${fails.length} fail`);
  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try { await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`); } catch { /* best effort */ }
  process.exit(1);
});
