/**
 * SMOKE del detalle del día del calendario contra una DB Postgres LOCAL EFÍMERA.
 * NO toca Neon. Datos SINTÉTICOS. Teardown garantizado (DROP al final).
 *
 *   npx tsx src/lib/vacations/day-detail.smoke.ts
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";

const TEST_DB = "tkl_vacation_day_smoke";

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
  const { loadVacationDay } = await import("./day-detail");
  const { vacationFilterWhere } = await import("./list-where");
  const adminExec = async (sql: string) => {
    const a = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    try { await a.$executeRawUnsafe(sql); } finally { await a.$disconnect(); }
  };
  await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${TEST_DB}"`);
  const db = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  try {
    execSync("npx prisma db push --skip-generate", { env: { ...process.env, DATABASE_URL: TEST_URL }, stdio: ["ignore", "pipe", "pipe"] });

    await db.branch.createMany({ data: [{ id: "bA", name: "Sucursal A" }, { id: "bB", name: "Sucursal B" }] });
    await db.position.createMany({ data: [{ id: "caj", name: "Cajero/a" }, { id: "ate", name: "Atención al Cliente" }] });
    await db.user.create({ data: { id: "u1", name: "Supervisión Prueba", email: "sup@example.test", passwordHash: "x", role: "SUPERVISOR" } });

    const emp = (id: string, positionId: string, branch: string, extra: Record<string, unknown> = {}) => db.employee.create({ data: {
      id, firstName: `Nombre${id}`, lastName: "Prueba", positionId, currentBranchId: branch, ...extra,
    } });
    await emp("e1", "ate", "bA", { secondaryPositionId: "caj", isTechnicalDirector: true });
    await emp("e2", "ate", "bA");
    await emp("e3", "caj", "bA");
    await emp("e4", "caj", "bB");
    await emp("e5", "caj", "bA");
    await emp("rot", "caj", "bA", { isRotating: true });
    await db.vacationBalance.create({ data: { employeeId: "e1", year: 2026, days: 20 } });
    await db.vacationBalance.create({ data: { employeeId: "e3", year: 2026, days: 13 } });

    // Lunes 08/02/2027 es semana B si la referencia es el lunes 01/02.
    await db.workSchedule.create({ data: {
      employeeId: "e1", validFrom: D("2026-01-01"), abReferenceDate: D("2027-02-01"),
      slots: { create: [
        { week: "A", dayOfWeek: 1, slot: 1, startMinute: 480, endMinute: 840, branchId: "bA" },
        { week: "B", dayOfWeek: 1, slot: 1, startMinute: 540, endMinute: 780, branchId: "bA" },
        { week: "B", dayOfWeek: 1, slot: 2, startMinute: 840, endMinute: 1140, branchId: "bB" },
      ] },
    } });
    await db.workSchedule.create({ data: {
      employeeId: "e2", validFrom: D("2026-01-01"),
      slots: { create: [{ dayOfWeek: 1, slot: 1, startMinute: 420, endMinute: 780, otherPlace: "Depósito" }] },
    } });
    await db.workSchedule.create({ data: {
      employeeId: "e3", validFrom: D("2026-01-01"),
      slots: { create: [{ dayOfWeek: 2, slot: 1, startMinute: 420, endMinute: 780, branchId: "bA" }] },
    } });

    const req = (id: string, employeeId: string, branchId: string, positionId: string, status: string, extra: Record<string, unknown> = {}) =>
      db.vacationRequest.create({ data: {
        id, employeeId, branchId, positionId, status: status as any,
        employeeNameSnapshot: `Nombre${employeeId} Prueba`, branchNameSnapshot: "x", positionNameSnapshot: "x",
        startDate: D("2027-02-08"), endDate: D("2027-02-14"), daysCount: 7, requestedByUserId: "u1", ...extra,
      } });
    await req("r1", "e1", "bA", "ate", "PENDING_SUPERVISOR", { conflictLevel: "WARNING" });
    await req("r2", "e2", "bA", "ate", "APPROVED", { approvedWithWarnings: true, withoutCoverage: true });
    await req("r3", "e3", "bA", "caj", "APPROVED", { startDate: D("2027-02-01"), endDate: D("2027-02-08") }); // termina ese día
    await req("r4", "e4", "bB", "caj", "PENDING_SUPERVISOR", { startDate: D("2027-02-08"), endDate: D("2027-02-08") });
    await req("r5", "e5", "bA", "caj", "REJECTED");
    await req("fuera", "e5", "bA", "caj", "APPROVED", { startDate: D("2027-03-01"), endDate: D("2027-03-07") });
    await req("termino-antes", "e5", "bA", "caj", "APPROVED", { startDate: D("2027-02-01"), endDate: D("2027-02-07") });
    await req("empieza-despues", "e5", "bA", "caj", "APPROVED", { startDate: D("2027-02-09"), endDate: D("2027-02-10") });
    await db.employeeBranchAssignment.create({ data: {
      employeeId: "rot", branchId: "bA", type: "TEMPORARY_COVERAGE", status: "ACTIVE", startDate: D("2027-02-08"),
      endDate: D("2027-02-14"), vacationRequestId: "r2",
    } });
    await db.employeeBranchAssignment.create({ data: {
      employeeId: "e5", branchId: "bA", type: "TEMPORARY_COVERAGE", status: "CANCELLED", startDate: D("2027-02-08"),
      endDate: D("2027-02-14"), vacationRequestId: "r2",
    } });

    const ADMIN = { role: "ADMIN", branchId: null };
    const load = (qs: string, user: { role: string; branchId: string | null } = ADMIN, date = "2027-02-08") =>
      loadVacationDay(db, date, vacationFilterWhere(new URLSearchParams(qs), user)!);
    const ids = (d: { people: Array<{ requests: Array<{ id: string }> }> }) =>
      d.people.flatMap((p) => p.requests.map((r) => r.id)).sort();

    await check("muestra todas las que incluyen el día: bordes incluidos, sin las que no lo tocan", async () => {
      assert.deepEqual(ids(await load("")), ["r1", "r2", "r3", "r4", "r5"]);
    });
    await check("sin tope: 250 solicitudes del mismo día (la lista corta en 200)", async () => {
      await db.employee.createMany({ data: Array.from({ length: 250 }, (_, i) => ({
        id: `m${i}`, firstName: `Masiva${i}`, lastName: "Prueba", positionId: "caj", currentBranchId: "bA",
      })) });
      await db.vacationRequest.createMany({ data: Array.from({ length: 250 }, (_, i) => ({
        id: `mr${i}`, employeeId: `m${i}`, branchId: "bA", positionId: "caj", employeeNameSnapshot: "x", branchNameSnapshot: "x",
        positionNameSnapshot: "x", startDate: D("2028-02-08"), endDate: D("2028-02-08"), daysCount: 1, requestedByUserId: "u1",
      })) });
      assert.equal((await load("", ADMIN, "2028-02-08")).total, 250);
    });
    await check("filtro de sucursal", async () => {
      assert.deepEqual(ids(await load("branchId=bB")), ["r4"]);
    });
    await check("filtro de estado", async () => {
      assert.deepEqual(ids(await load("status=APPROVED")), ["r2", "r3"]);
    });
    await check("filtro de marcas", async () => {
      assert.deepEqual(ids(await load("withoutCoverage=true")), ["r2"]);
      assert.deepEqual(ids(await load("withWarnings=true")), ["r2"]);
    });
    await check("búsqueda por persona y por nombre", async () => {
      assert.deepEqual(ids(await load("employeeId=e3")), ["r3"]);
      assert.deepEqual(ids(await load("q=nombree4")), ["r4"]);
    });
    await check("encargado: solo su sucursal, aunque pida otra", async () => {
      const d = await load("branchId=bA", { role: "BRANCH_MANAGER", branchId: "bB" });
      assert.deepEqual(ids(d), ["r4"]);
    });
    await check("tarjeta: puestos, DT, semana A/B y dos tramos en dos sucursales", async () => {
      const p = (await load("employeeId=e1")).people[0];
      assert.equal(p.name, "Nombree1 Prueba");
      assert.equal(p.branchName, "Sucursal A");
      assert.equal(p.position, "Atención al Cliente");
      assert.equal(p.secondaryPosition, "Cajero/a");
      assert.equal(p.isTechnicalDirector, true);
      assert.equal(p.schedule.week, "B");
      assert.deepEqual(p.schedule.slots.map((s) => [s.start, s.end, s.place]), [["09:00", "13:00", "Sucursal A"], ["14:00", "19:00", "Sucursal B"]]);
      assert.deepEqual(p.requests[0].balance, { loaded: true, current: 20, after: 13, effect: "PENDING", insufficient: false });
      assert.equal(p.requests[0].withWarnings, true);
    });
    await check("tarjeta: otro lugar, marcas y solo la cobertura activa", async () => {
      const p = (await load("employeeId=e2")).people[0];
      assert.equal(p.schedule.slots[0].place, "Depósito");
      assert.equal(p.requests[0].withoutCoverage, true);
      assert.deepEqual(p.requests[0].coveredBy, ["Nombrerot Prueba"]);
      assert.equal(p.requests[0].balance.loaded, false);
    });
    await check("tarjeta: no trabaja ese día y la aprobada no resta el saldo otra vez", async () => {
      const p = (await load("employeeId=e3")).people[0];
      assert.equal(p.schedule.kind, "OFF");
      assert.deepEqual(p.requests[0].balance, { loaded: true, current: 13, after: 13, effect: "DISCOUNTED", insufficient: false });
    });
    await check("orden y resumen: la rechazada no suma", async () => {
      const d = await load("");
      assert.equal(d.people[0].position, "Atención al Cliente");
      assert.deepEqual(d.summary, [{ position: "Atención al Cliente", count: 2 }, { position: "Cajero/a", count: 2 }]);
      assert.equal(d.total, 5);
    });
    await check("día sin solicitudes: vacío, sin error", async () => {
      const d = await load("", ADMIN, "2027-06-01");
      assert.equal(d.total, 0);
      assert.deepEqual(d.people, []);
    });
  } finally {
    await db.$disconnect();
    await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  }
  console.log(`\n${pass} ok, ${fails.length} fallaron${fails.length ? `: ${fails.join(" · ")}` : ""}`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
