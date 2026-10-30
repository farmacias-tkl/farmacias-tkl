/**
 * SMOKE de los indicadores de Vacaciones contra una DB Postgres LOCAL
 * EFÍMERA. NO toca Neon. Datos SINTÉTICOS.
 *
 * Crea la DB con el schema actual, carga solicitudes en los bordes (fin hoy,
 * empieza hoy, futuras, pasadas, rechazos en el primer y último instante del
 * mes en Argentina, rechazo en el paso de RRHH, canceladas, otra sucursal) y
 * comprueba los 4 conteos y que el filtro de la lista (kpiWhere) trae
 * exactamente las mismas solicitudes. Teardown garantizado (DROP al final).
 *
 *   npx tsx src/lib/vacations/kpis.smoke.ts
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";

const TEST_DB = "tkl_vacation_kpis_smoke";

function abort(m: string): never { console.error("ABORT:", m); process.exit(1); }
const m = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+?)"?\s*$/m);
if (!m) abort("No encontré DATABASE_URL en .env");
const baseUrl = m[1].trim();
if (!["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname)) abort(`SAFETY ABORT: ${new URL(baseUrl).hostname} no es local. NUNCA Neon.`);
const adminUrl = new URL(baseUrl); adminUrl.pathname = "/postgres";
const testUrl = new URL(baseUrl); testUrl.pathname = `/${TEST_DB}`;
const TEST_URL = testUrl.toString();
process.env.DATABASE_URL = TEST_URL;

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const D = (s: string) => new Date(`${s}T00:00:00Z`);

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { countVacationKpis, kpiWhere, VACATION_KPIS } = await import("./kpis");
  const adminExec = async (sql: string) => {
    const a = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    try { await a.$executeRawUnsafe(sql); } finally { await a.$disconnect(); }
  };
  await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${TEST_DB}"`);
  const db = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  try {
    execSync(`npx prisma db push --skip-generate`, { env: { ...process.env, DATABASE_URL: TEST_URL }, stdio: ["ignore", "pipe", "pipe"] });

    await db.branch.createMany({ data: [{ id: "bA", name: "Sucursal A" }, { id: "bB", name: "Sucursal B" }] });
    await db.position.create({ data: { id: "p1", name: "Cajero/a" } });
    await db.user.create({ data: { id: "u1", name: "Supervisora Prueba", email: "sup@example.test", passwordHash: "x", role: "SUPERVISOR" } });
    await db.employee.createMany({ data: Array.from({ length: 16 }, (_, i) => ({
      id: `e${i}`, firstName: `Persona${i}`, lastName: "Prueba", positionId: "p1", currentBranchId: i === 15 ? "bB" : "bA",
    })) });

    // "Ahora": 15/10/2026 12:00 UTC (09:00 en Argentina). Hoy = 2026-10-15.
    const NOW = new Date("2026-10-15T12:00:00Z");
    let n = 0;
    const req = async (key: string, status: string, start: string, end: string, extra: Record<string, unknown> = {}) => {
      const i = n++;
      await db.vacationRequest.create({ data: {
        id: key, employeeId: `e${i}`, branchId: i === 15 ? "bB" : "bA", positionId: "p1",
        employeeNameSnapshot: `Persona${i} Prueba`, branchNameSnapshot: "x", positionNameSnapshot: "Cajero/a",
        startDate: D(start), endDate: D(end), daysCount: 7, requestedByUserId: "u1", status: status as any, ...extra,
      } });
    };
    await req("ps-futura",      "PENDING_SUPERVISOR", "2026-11-02", "2026-11-08");
    await req("ps-pasada",      "PENDING_SUPERVISOR", "2026-09-07", "2026-09-13");          // solicitada vieja: cuenta igual
    await req("prrhh",          "PENDING_RRHH",       "2026-11-09", "2026-11-15");          // no es ningún indicador
    await req("ap-termina-hoy", "APPROVED",           "2026-10-09", "2026-10-15");
    await req("ap-empieza-hoy", "APPROVED",           "2026-10-15", "2026-10-21");
    await req("ap-futura",      "APPROVED",           "2026-11-16", "2026-11-22");
    await req("ap-termino-ayer","APPROVED",           "2026-10-08", "2026-10-14");
    await req("cancelada-hoy",  "CANCELLED",          "2026-10-12", "2026-10-18");
    await req("re-1ro-oct",     "REJECTED", "2026-12-07", "2026-12-13", { supervisorActionAt: new Date("2026-10-01T03:00:00Z") }); // 1/10 00:00 AR
    await req("re-30-sep",      "REJECTED", "2026-12-07", "2026-12-13", { supervisorActionAt: new Date("2026-10-01T02:59:59Z") }); // 30/9 23:59 AR
    await req("re-31-oct",      "REJECTED", "2026-12-07", "2026-12-13", { supervisorActionAt: new Date("2026-11-01T02:59:59Z") }); // 31/10 23:59 AR
    await req("re-1ro-nov",     "REJECTED", "2026-12-07", "2026-12-13", { supervisorActionAt: new Date("2026-11-01T03:00:00Z") }); // 1/11 00:00 AR
    await req("re-rrhh-oct",    "REJECTED", "2026-12-07", "2026-12-13", {
      supervisorActionAt: new Date("2026-09-20T15:00:00Z"), rrhhActionAt: new Date("2026-10-05T15:00:00Z") });
    await req("re-rrhh-sep",    "REJECTED", "2026-12-07", "2026-12-13", {
      supervisorActionAt: new Date("2026-10-02T15:00:00Z"), rrhhActionAt: new Date("2026-09-25T15:00:00Z") });
    await req("ap-un-dia-futura", "APPROVED",           "2026-10-20", "2026-10-20");          // futura de un día
    await req("ps-otra-suc",    "PENDING_SUPERVISOR", "2026-11-02", "2026-11-08");          // e15, sucursal B

    const EXPECTED: Record<string, string[]> = {
      solicitadas: ["ps-futura", "ps-otra-suc", "ps-pasada"],
      aprobadas:   ["ap-empieza-hoy", "ap-futura", "ap-termina-hoy", "ap-un-dia-futura"],
      rechazadas:  ["re-1ro-oct", "re-31-oct", "re-rrhh-oct"],
      hoy:         ["ap-empieza-hoy", "ap-termina-hoy"],
    };

    await check("conteos de los 4 indicadores (toda la cadena)", async () => {
      const c = await countVacationKpis(db, { now: NOW });
      assert.deepEqual(c, { solicitadas: 3, aprobadas: 4, rechazadas: 3, hoy: 2 });
    });
    await check("cada indicador filtra la lista con las mismas solicitudes que cuenta", async () => {
      for (const k of VACATION_KPIS) {
        const ids = (await db.vacationRequest.findMany({ where: kpiWhere(k, NOW), select: { id: true } })).map((r) => r.id).sort();
        assert.deepEqual(ids, EXPECTED[k], k);
      }
    });
    await check("por sucursal: la otra sucursal no cuenta", async () => {
      assert.deepEqual(await countVacationKpis(db, { branchId: "bA", now: NOW }), { solicitadas: 2, aprobadas: 4, rechazadas: 3, hoy: 2 });
      assert.deepEqual(await countVacationKpis(db, { branchId: "bB", now: NOW }), { solicitadas: 1, aprobadas: 0, rechazadas: 0, hoy: 0 });
    });
    await check("a las 23:30 del 14/10 en Argentina (02:30 UTC del 15) hoy es 14/10", async () => {
      const c = await countVacationKpis(db, { now: new Date("2026-10-15T02:30:00Z") });
      // termina-hoy (9–15) y terminó-ayer (8–14) incluyen el 14; empieza-hoy (15–21) todavía no.
      assert.equal(c.hoy, 2);
      const ids = (await db.vacationRequest.findMany({ where: kpiWhere("hoy", new Date("2026-10-15T02:30:00Z")), select: { id: true } })).map((r) => r.id).sort();
      assert.deepEqual(ids, ["ap-termina-hoy", "ap-termino-ayer"]);
      assert.equal(c.aprobadas, 5);
    });
    await check("el 1/11 a las 00:00 en Argentina ya es noviembre: cuenta el rechazo de esa hora y no los de octubre", async () => {
      const ids = (await db.vacationRequest.findMany({ where: kpiWhere("rechazadas", new Date("2026-11-01T03:00:00Z")), select: { id: true } })).map((r) => r.id);
      assert.deepEqual(ids, ["re-1ro-nov"]);
    });
  } finally {
    await db.$disconnect();
    await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  }
  console.log(`\n${pass} ok, ${fails.length} fallaron${fails.length ? `: ${fails.join(" · ")}` : ""}`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
