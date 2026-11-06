/**
 * SMOKE de "hoy" en Argentina contra una DB Postgres LOCAL EFÍMERA. NO toca
 * Neon. Datos SINTÉTICOS. Plantilla y dotación a las 22:30 de Argentina (ya es
 * el día siguiente en UTC) y al empezar el día siguiente.
 * Teardown garantizado (DROP al final).
 *
 *   npx tsx src/lib/dates/today.smoke.ts
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";

const TEST_DB = "tkl_today_smoke";

function abort(m: string): never { console.error("ABORT:", m); process.exit(1); }
const m = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+?)"?\s*$/m);
if (!m) abort("No encontré DATABASE_URL en .env");
const baseUrl = m[1].trim();
if (!["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname)) abort(`SAFETY ABORT: ${new URL(baseUrl).hostname} no es local. NUNCA Neon.`);
const adminUrl = new URL(baseUrl); adminUrl.pathname = "/postgres";
const testUrl = new URL(baseUrl); testUrl.pathname = `/${TEST_DB}`;
const TEST_URL = testUrl.toString();
process.env.DATABASE_URL = TEST_URL; // el singleton @/lib/prisma de plantilla.ts apunta a la DB de prueba

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const D = (s: string) => new Date(`${s}T00:00:00Z`);

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const adminExec = async (sql: string) => {
    const a = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    try { await a.$executeRawUnsafe(sql); } finally { await a.$disconnect(); }
  };
  await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${TEST_DB}"`);
  const db = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  const { prisma } = await import("@/lib/prisma");
  try {
    execSync("npx prisma db push --skip-generate", { env: { ...process.env, DATABASE_URL: TEST_URL }, stdio: ["ignore", "pipe", "pipe"] });
    const { todayAR, todayRangeAR } = await import("./today");
    const { getPlantillaReal, getDotacionMultiple } = await import("@/lib/plantilla");

    await db.branch.create({ data: { id: "b1", name: "Sucursal A" } });
    await db.position.create({ data: { id: "p1", name: "Cajero/a" } });
    await db.user.create({ data: { id: "u1", name: "Prueba", email: "p@example.test", passwordHash: "x", role: "SUPERVISOR" } });
    await db.employee.createMany({ data: [
      { id: "e1", firstName: "Fija", lastName: "Prueba", positionId: "p1", currentBranchId: "b1" },
      { id: "e2", firstName: "Otra", lastName: "Prueba", positionId: "p1", currentBranchId: "b1" },
      { id: "r1", firstName: "Rotativa", lastName: "Prueba", positionId: "p1", isRotating: true },
    ] });
    // Ausencia y cobertura que terminan el 06/11.
    await db.absenceRecord.create({ data: {
      id: "a1", employeeId: "e1", branchId: "b1", reportedByUserId: "u1", startDate: D("2026-11-06"), endDate: D("2026-11-06"), absenceType: "SICKNESS",
    } });
    await db.employeeBranchAssignment.create({ data: {
      employeeId: "r1", branchId: "b1", type: "TEMPORARY_COVERAGE", status: "ACTIVE",
      startDate: D("2026-11-06"), endDate: new Date("2026-11-06T23:59:59.999Z"),
    } });

    const NIGHT = new Date("2026-11-07T01:30:00Z");     // 22:30 del 06/11 en Argentina
    const NEXT_DAY = new Date("2026-11-07T03:00:00Z");  // 00:00 del 07/11 en Argentina

    await check("a las 22:30 del 06/11: la ausencia y la cobertura del día siguen contando", async () => {
      const p = await getPlantillaReal("b1", todayAR(NIGHT));
      assert.equal(p.rotativos.length, 1);
      assert.equal(p.summary.ausentesHoy, 1);
      const d = (await getDotacionMultiple(["b1"], todayAR(NIGHT))).get("b1")!;
      assert.equal(d.ausentes, 1);
      assert.equal(d.totalPlantel, 3);
    });
    await check("al empezar el 07/11: ya no cuentan", async () => {
      const p = await getPlantillaReal("b1", todayAR(NEXT_DAY));
      assert.equal(p.rotativos.length, 0);
      assert.equal(p.summary.ausentesHoy, 0);
      const d = (await getDotacionMultiple(["b1"], todayAR(NEXT_DAY))).get("b1")!;
      assert.equal(d.ausentes, 0);
      assert.equal(d.totalPlantel, 2);
    });
    await check("el filtro de ausentes de hoy (dashboard, sucursales, employees, absences) trae lo mismo", async () => {
      const count = (now: Date) => {
        const { today, todayEnd } = todayRangeAR(now);
        return db.absenceRecord.count({ where: { startDate: { lte: todayEnd }, endDate: { gte: today } } });
      };
      assert.equal(await count(NIGHT), 1);
      assert.equal(await count(NEXT_DAY), 0);
    });
    await check("el filtro de asignaciones de hoy (assignments, dashboard) trae lo mismo", async () => {
      const count = (now: Date) => {
        const { today, todayEnd } = todayRangeAR(now);
        return db.employeeBranchAssignment.count({ where: { startDate: { lte: todayEnd }, OR: [{ endDate: null }, { endDate: { gte: today } }] } });
      };
      assert.equal(await count(NIGHT), 1);
      assert.equal(await count(NEXT_DAY), 0);
    });
  } finally {
    await db.$disconnect();
    await prisma.$disconnect();
    await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  }
  console.log(`\n${pass} ok, ${fails.length} fallaron${fails.length ? `: ${fails.join(" · ")}` : ""}`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
