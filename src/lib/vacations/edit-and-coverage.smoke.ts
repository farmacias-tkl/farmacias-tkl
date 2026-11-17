/**
 * SMOKE contra una DB Postgres LOCAL EFÍMERA. NO toca Neon. Datos SINTÉTICOS.
 * Teardown garantizado (DROP al final).
 *
 *  A. Editar fechas de una solicitud pendiente (editVacationDates): recalcula
 *     días y avisos, deja las fechas originales y las nuevas en AuditLog y en el
 *     historial, no guarda con bloqueos, y no pisa si la solicitud cambió.
 *  B. "Cambiar cobertura" en una solicitud APROBADA cuyas fechas YA PASARON,
 *     con una persona que se marcó como rotativa después de la aprobación.
 *
 *  C. Rotativa de perfumería: se propone solo para perfumería y solo en CABA,
 *     y cubre el puesto secundario de quien tiene otro puesto principal.
 *
 *   npx tsx src/lib/vacations/edit-and-coverage.smoke.ts
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";

const TEST_DB = "tkl_vacation_edit_smoke";

function abort(m: string): never { console.error("ABORT:", m); process.exit(1); }
const m = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+?)"?\s*$/m);
if (!m) abort("No encontré DATABASE_URL en .env");
const baseUrl = m[1].trim();
if (!["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname)) abort(`SAFETY ABORT: ${new URL(baseUrl).hostname} no es local. NUNCA Neon.`);
const adminUrl = new URL(baseUrl); adminUrl.pathname = "/postgres";
const testUrl = new URL(baseUrl); testUrl.pathname = `/${TEST_DB}`;
const TEST_URL = testUrl.toString();
process.env.DATABASE_URL = TEST_URL;
delete process.env.VACATIONS_RRHH_STEP;

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const actions = await import("./actions");
  const { loadCoverPositions, loadRotativeOptions } = await import("./coverage-data");
  const adminExec = async (sql: string) => {
    const a = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    try { await a.$executeRawUnsafe(sql); } finally { await a.$disconnect(); }
  };
  await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${TEST_DB}"`);
  const db = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  try {
    execSync("npx prisma db push --skip-generate", { env: { ...process.env, DATABASE_URL: TEST_URL }, stdio: ["ignore", "pipe", "pipe"] });

    await db.branch.create({ data: { id: "bA", name: "Sucursal A", zone: "CABA" } });
    await db.position.create({ data: { id: "caj", name: "Cajero/a" } });
    await db.user.create({ data: { id: "u1", name: "Supervisión Prueba", email: "sup@example.test", passwordHash: "x", role: "SUPERVISOR" } });
    const emp = (id: string, extra: Record<string, unknown> = {}) => db.employee.create({ data: {
      id, firstName: `Nombre${id}`, lastName: "Prueba", positionId: "caj", currentBranchId: "bA", ...extra,
    } });
    await emp("pide");
    await emp("otra");
    await emp("cubre");            // todavía NO es rotativa
    await emp("rot", { isRotating: true });
    for (const id of ["pide", "otra"]) {
      await db.workSchedule.create({ data: {
        employeeId: id, validFrom: D("2026-01-01"),
        slots: { create: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, slot: 1, startMinute: 480, endMinute: 840, branchId: "bA" })) },
      } });
    }
    await db.vacationBalance.create({ data: { employeeId: "pide", year: 2026, days: 21 } });

    const request = (id: string, employeeId: string, start: string, end: string, extra: Record<string, unknown> = {}) =>
      db.vacationRequest.create({ data: {
        id, employeeId, branchId: "bA", positionId: "caj",
        employeeNameSnapshot: `Nombre${employeeId} Prueba`, branchNameSnapshot: "Sucursal A", positionNameSnapshot: "Cajero/a",
        startDate: D(start), endDate: D(end),
        daysCount: Math.round((D(end).getTime() - D(start).getTime()) / 86_400_000) + 1,
        requestedByUserId: "u1", ...extra,
      } });
    const get = (id: string) => db.vacationRequest.findUniqueOrThrow({ where: { id } });

    // ------------------------------------------------------------------ A
    // Lunes 01/02/2027 → domingo 21/02/2027: 21 días pedidos.
    await request("r1", "pide", "2027-02-01", "2027-02-21");

    await check("editar fechas: 21 días pedidos pasan a 14, con días recalculados", async () => {
      const r = await actions.editVacationDates(db, { id: "r1", userId: "u1", endDate: D("2027-02-14") });
      assert.ok(r.ok, !r.ok ? r.error : "");
      const v = await get("r1");
      assert.equal(iso(v.startDate), "2027-02-01");
      assert.equal(iso(v.endDate), "2027-02-14");
      assert.equal(v.daysCount, 14);
      assert.equal(v.status, "PENDING_SUPERVISOR");
    });
    await check("AuditLog guarda las fechas originales y las nuevas", async () => {
      const a = await db.auditLog.findFirstOrThrow({ where: { entityId: "r1", action: "VACATION_REQUEST_EDITED" } });
      const d = a.detail as any;
      assert.equal(a.userId, "u1");
      assert.deepEqual(d.original, { startDate: "2027-02-01", endDate: "2027-02-21", days: 21 });
      assert.deepEqual(d.updated, { startDate: "2027-02-01", endDate: "2027-02-14", days: 14 });
      assert.equal(d.datesChanged, true);
    });
    await check("el historial de la solicitud muestra el cambio de fechas", async () => {
      const h = await db.vacationStateHistory.findMany({ where: { vacationId: "r1" } });
      assert.equal(h.length, 1);
      assert.equal(h[0].fromStatus, "PENDING_SUPERVISOR");
      assert.equal(h[0].toStatus, "PENDING_SUPERVISOR");
      assert.equal(h[0].note, "Fechas editadas: 01/02/2027 → 21/02/2027 (21 d) pasa a 01/02/2027 → 14/02/2027 (14 d)");
    });
    await check("avisos recalculados con las fechas nuevas: inicio a mitad de semana y no múltiplo de 7", async () => {
      // Miércoles 03/02 → martes 16/02 son 14 días (sin aviso de duración);
      // miércoles 03/02 → lunes 15/02 son 13 (aviso de duración) y arranca miércoles.
      const r = await actions.editVacationDates(db, { id: "r1", userId: "u1", startDate: D("2027-02-03"), endDate: D("2027-02-15") });
      assert.ok(r.ok, !r.ok ? r.error : "");
      const v = await get("r1");
      assert.equal(v.daysCount, 13);
      assert.equal(v.conflictLevel, "WARNING");
      const warned = ((v.conflictReasons as any).ruleResults as Array<{ status: string }>).filter((x) => x.status === "WARNING");
      assert.ok(warned.length >= 2, JSON.stringify(warned));
    });
    await check("avisos recalculados: superposición con otra persona del mismo puesto", async () => {
      await request("r-otra", "otra", "2027-03-01", "2027-03-07", { status: "APPROVED" });
      const r = await actions.editVacationDates(db, { id: "r1", userId: "u1", startDate: D("2027-03-01"), endDate: D("2027-03-14") });
      assert.ok(r.ok, !r.ok ? r.error : "");
      assert.equal(r.ok && r.validation?.overlaps.length, 1);
      assert.equal(r.ok && r.validation?.overlaps[0].employeeName, "Nombreotra Prueba");
      assert.equal((await get("r1")).conflictLevel, "WARNING");
    });
    await check("la aprobación usa las fechas editadas: descuenta 14 días, no 21", async () => {
      const r = await actions.approveVacation(db, { id: "r1", userId: "u1", confirmWarnings: true, rotativeEmployeeId: "rot" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      assert.equal((await db.vacationBalance.findFirstOrThrow({ where: { employeeId: "pide" } })).days, 7);
      const c = await db.employeeBranchAssignment.findFirstOrThrow({ where: { vacationRequestId: "r1", status: "ACTIVE" } });
      assert.equal(iso(c.startDate), "2027-03-01");
      assert.equal(iso(c.endDate!), "2027-03-14");
    });
    await check("una solicitud ya aprobada no se edita (409) y queda igual", async () => {
      const r = await actions.editVacationDates(db, { id: "r1", userId: "u1", endDate: D("2027-03-07") });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.status, 409);
      assert.equal(iso((await get("r1")).endDate), "2027-03-14");
    });
    await check("con un bloqueo (hasta anterior a desde, o se pisa con otra propia) no guarda", async () => {
      await request("r2", "pide", "2027-05-03", "2027-05-09");
      const audits = await db.auditLog.count();
      const inv = await actions.editVacationDates(db, { id: "r2", userId: "u1", endDate: D("2027-05-01") });
      assert.equal(inv.ok, false);
      const self = await actions.editVacationDates(db, { id: "r2", userId: "u1", startDate: D("2027-03-08"), endDate: D("2027-03-14") });
      assert.equal(self.ok, false);
      if (!self.ok) assert.equal(self.status, 409);
      const v = await get("r2");
      assert.equal(`${iso(v.startDate)} ${iso(v.endDate)} ${v.daysCount}`, "2027-05-03 2027-05-09 7");
      assert.equal(await db.auditLog.count(), audits);
    });
    await check("mismas fechas: no agrega línea al historial", async () => {
      const r = await actions.editVacationDates(db, { id: "r2", userId: "u1", startDate: D("2027-05-03"), endDate: D("2027-05-09") });
      assert.ok(r.ok);
      assert.equal(await db.vacationStateHistory.count({ where: { vacationId: "r2" } }), 0);
    });
    await check("fecha inválida → 400", async () => {
      const r = await actions.editVacationDates(db, { id: "r2", userId: "u1", startDate: new Date("no-es-fecha") });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.status, 400);
    });
    await check("dos ediciones a la vez: gana una sola, la otra recibe 409 y no pisa", async () => {
      const [a, b] = await Promise.all([
        actions.editVacationDates(db, { id: "r2", userId: "u1", endDate: D("2027-05-16") }),
        actions.editVacationDates(db, { id: "r2", userId: "u1", endDate: D("2027-05-23") }),
      ]);
      assert.equal([a, b].filter((x) => x.ok).length, 1);
      const loser = [a, b].find((x) => !x.ok)!;
      assert.equal(!loser.ok && loser.status, 409);
      const v = await get("r2");
      const winnerEnd = a.ok ? "2027-05-16" : "2027-05-23";
      assert.equal(iso(v.endDate), winnerEnd);
      assert.equal(v.daysCount, a.ok ? 14 : 21);
      assert.equal(await db.vacationStateHistory.count({ where: { vacationId: "r2" } }), 1);
    });

    // ------------------------------------------------------------------ B
    // Solicitud aprobada, sin cobertura, con fechas que ya pasaron hace meses.
    await request("pasada", "pide", "2026-06-01", "2026-06-07", { status: "APPROVED", withoutCoverage: true });
    const options = () => loadRotativeOptions(db, {
      employeeId: "pide", positionKey: "CAJERO", branchId: "bA",
      startDate: D("2026-06-01"), endDate: D("2026-06-07"), excludeRequestId: "pasada",
    });

    await check("fechas pasadas, antes de marcarla: quien cubrió no figura y no se la puede elegir", async () => {
      assert.equal((await options()).availability.some((a) => a.employeeId === "cubre"), false);
      const r = await actions.changeCoverage(db, { id: "pasada", userId: "u1", rotativeEmployeeId: "cubre" });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.status, 409);
    });
    await check("fechas pasadas: una vez marcada como rotativa, aparece libre todo el período", async () => {
      await db.employee.update({ where: { id: "cubre" }, data: { isRotating: true } });
      const o = await options();
      assert.equal(o.applies, true);
      assert.equal(o.availability.find((a) => a.employeeId === "cubre")?.freeAll, true);
    });
    await check("fechas pasadas: \"Cambiar cobertura\" registra quién cubrió y saca el \"sin cobertura\"", async () => {
      const r = await actions.changeCoverage(db, { id: "pasada", userId: "u1", rotativeEmployeeId: "cubre" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      assert.equal((await get("pasada")).withoutCoverage, false);
      const c = await db.employeeBranchAssignment.findFirstOrThrow({ where: { vacationRequestId: "pasada", status: "ACTIVE" } });
      assert.equal(c.employeeId, "cubre");
      assert.equal(`${iso(c.startDate)} ${iso(c.endDate!)}`, "2026-06-01 2026-06-07");
      assert.equal((c.coverageSlots as unknown[]).length, 5);
      const a = await db.auditLog.findFirstOrThrow({ where: { entityId: "pasada", action: "VACATION_COVERAGE_CHANGED" } });
      assert.deepEqual([(a.detail as any).from, (a.detail as any).to], [null, "cubre"]);
    });
    await check("fechas pasadas: se puede corregir a otro rotativo y también quitarlo", async () => {
      assert.ok((await actions.changeCoverage(db, { id: "pasada", userId: "u1", rotativeEmployeeId: "rot" })).ok);
      const active = await db.employeeBranchAssignment.findMany({ where: { vacationRequestId: "pasada", status: "ACTIVE" } });
      assert.deepEqual(active.map((x) => x.employeeId), ["rot"]);
      assert.ok((await actions.changeCoverage(db, { id: "pasada", userId: "u1", rotativeEmployeeId: null })).ok);
      assert.equal((await get("pasada")).withoutCoverage, true);
    });
    await check("cobertura marcada \"Completada\" desde Rotativas: al cambiarla no quedan dos", async () => {
      assert.ok((await actions.changeCoverage(db, { id: "pasada", userId: "u1", rotativeEmployeeId: "rot" })).ok);
      await db.employeeBranchAssignment.updateMany({ where: { vacationRequestId: "pasada", status: "ACTIVE" }, data: { status: "COMPLETED" } });
      const r = await actions.changeCoverage(db, { id: "pasada", userId: "u1", rotativeEmployeeId: "cubre" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      const live = await db.employeeBranchAssignment.findMany({
        where: { vacationRequestId: "pasada", status: { in: ["ACTIVE", "COMPLETED"] } },
      });
      assert.deepEqual(live.map((x) => `${x.employeeId}:${x.status}`), ["cubre:ACTIVE"]);
      const last = await db.auditLog.findFirstOrThrow({
        where: { entityId: "pasada", action: "VACATION_COVERAGE_CHANGED" }, orderBy: { createdAt: "desc" },
      });
      assert.deepEqual([(last.detail as any).from, (last.detail as any).to], ["rot", "cubre"]);
    });
    await check("una rotativa ocupada en esas fechas pasadas no se puede elegir para otra solicitud", async () => {
      await request("pasada2", "otra", "2026-06-01", "2026-06-07", { status: "APPROVED", withoutCoverage: true });
      const r = await actions.changeCoverage(db, { id: "pasada2", userId: "u1", rotativeEmployeeId: "cubre" });
      assert.equal(r.ok, false);
      assert.ok((await actions.changeCoverage(db, { id: "pasada2", userId: "u1", rotativeEmployeeId: "rot" })).ok);
    });

    // ------------------------------------------------------------------ C
    await db.branch.create({ data: { id: "bP", name: "Sucursal Provincia", zone: "PROVINCIA" } });
    await db.position.createMany({ data: [{ id: "perf", name: "Perfumería" }, { id: "ate", name: "Representante de Atención al Cliente" }] });
    await emp("rotperf", { isRotating: true, positionId: "perf" });
    await emp("perfCaba", { positionId: "perf" });
    await emp("perfProv", { positionId: "perf", currentBranchId: "bP" });
    await emp("ateSec", { positionId: "ate", secondaryPositionId: "perf" });
    await emp("ateSola", { positionId: "ate" });
    for (const id of ["perfCaba", "perfProv", "ateSec", "ateSola"]) {
      await db.workSchedule.create({ data: {
        employeeId: id, validFrom: D("2026-01-01"),
        slots: { create: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, slot: 1, startMinute: 480, endMinute: 840, branchId: id === "perfProv" ? "bP" : "bA" })) },
      } });
    }
    const perfOptions = (employeeId: string, branchId: string, positionKey: "PERFUMERIA" | "CAJERO" = "PERFUMERIA") => loadRotativeOptions(db, {
      employeeId, positionKey, branchId, startDate: D("2027-03-01"), endDate: D("2027-03-07"),
    });
    const names = (o: Awaited<ReturnType<typeof perfOptions>>) => o.availability.map((a) => a.employeeId).sort();

    await check("perfumería en CABA: se propone la rotativa de perfumería (y no las de caja)", async () => {
      const o = await perfOptions("perfCaba", "bA");
      assert.equal(o.applies, true);
      assert.deepEqual(names(o), ["rotperf"]);
    });
    await check("perfumería en PROVINCIA: no se proponen rotativas", async () => {
      const o = await perfOptions("perfProv", "bP");
      assert.equal(o.applies, false);
      assert.deepEqual(names(o), []);
    });
    await check("una cajera no recibe la rotativa de perfumería", async () => {
      const o = await perfOptions("pide", "bA", "CAJERO");
      assert.equal(o.applies, true);
      assert.equal(names(o).includes("rotperf"), false);
      assert.ok(names(o).length > 0);
    });

    const reqRow = (id: string, employeeId: string, positionId: string, positionName: string, extra: Record<string, unknown> = {}) =>
      db.vacationRequest.create({ data: {
        id, employeeId, branchId: "bA", positionId,
        employeeNameSnapshot: `Nombre${employeeId} Prueba`, branchNameSnapshot: "Sucursal A", positionNameSnapshot: positionName,
        startDate: D("2027-03-01"), endDate: D("2027-03-07"), daysCount: 7, requestedByUserId: "u1", status: "APPROVED", ...extra,
      } as any });
    await reqRow("vSec", "ateSec", "ate", "Representante de Atención al Cliente");
    await reqRow("vSola", "ateSola", "ate", "Representante de Atención al Cliente");

    await check("puesto secundario: Atención + Perfumería ofrece cubrir Perfumería; Atención sola, nada", async () => {
      const c = await loadCoverPositions(db, { employeeId: "ateSec", positionId: "ate" });
      assert.deepEqual(c.map((x) => [x.id, x.key, x.secondary]), [["perf", "PERFUMERIA", true]]);
      assert.deepEqual(await loadCoverPositions(db, { employeeId: "ateSola", positionId: "ate" }), []);
    });
    await check("puesto secundario: la rotativa de perfumería la cubre y queda asignada como Perfumería", async () => {
      const r = await actions.changeCoverage(db, { id: "vSec", userId: "u1", rotativeEmployeeId: "rotperf", coverPositionId: "perf" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      const a = await db.employeeBranchAssignment.findFirstOrThrow({ where: { vacationRequestId: "vSec", status: "ACTIVE" } });
      assert.deepEqual([a.employeeId, a.positionId], ["rotperf", "perf"]);
    });
    await check("puesto secundario: sin indicar el puesto también cubre el secundario (el principal no lleva rotativos)", async () => {
      const r = await actions.changeCoverage(db, { id: "vSec", userId: "u1", rotativeEmployeeId: "rotperf" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      const a = await db.employeeBranchAssignment.findFirstOrThrow({ where: { vacationRequestId: "vSec", status: "ACTIVE" } });
      assert.equal(a.positionId, "perf");
    });
    await check("puesto secundario: una rotativa de caja no la puede cubrir, ni se acepta un puesto que no es suyo", async () => {
      const caja = await actions.changeCoverage(db, { id: "vSec", userId: "u1", rotativeEmployeeId: "rot", coverPositionId: "perf" });
      assert.equal(caja.ok, false);
      const ajeno = await actions.changeCoverage(db, { id: "vSec", userId: "u1", rotativeEmployeeId: "rot", coverPositionId: "caj" });
      assert.equal(ajeno.ok, false);
      const sola = await actions.changeCoverage(db, { id: "vSola", userId: "u1", rotativeEmployeeId: "rotperf" });
      assert.equal(sola.ok, false);
    });
    await check("puesto secundario: al quitar la rotativa no queda \"sin cobertura\" (eso sigue al puesto principal)", async () => {
      assert.ok((await actions.changeCoverage(db, { id: "vSec", userId: "u1", rotativeEmployeeId: "rotperf", coverPositionId: "perf" })).ok);
      const r = await actions.changeCoverage(db, { id: "vSec", userId: "u1", rotativeEmployeeId: null });
      assert.ok(r.ok);
      assert.equal((await db.vacationRequest.findUniqueOrThrow({ where: { id: "vSec" } })).withoutCoverage, false);
    });
  } finally {
    await db.$disconnect();
    await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  }
  console.log(`\n${pass} ok, ${fails.length} fallaron${fails.length ? `: ${fails.join(" · ")}` : ""}`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
