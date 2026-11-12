/**
 * SMOKE del banco de horas contra una DB Postgres LOCAL EFÍMERA. NO toca Neon.
 * Datos SINTÉTICOS. Teardown garantizado (DROP al final).
 *
 *  1. El gate prisma/gates/2026-11-12-banco-de-horas.sql aplicado sobre el
 *     esquema de main deja la base igual a schema.prisma (migrate diff vacío),
 *     y no cambia las filas que ya había.
 *  2. Horas extra: aprobar con destino Pagar o Banco, rechazar, destino de una
 *     aprobada sin destino; una hora extra suma al banco una sola vez.
 *  3. Pedido de día o franja: horas por defecto del horario, editables; lo pide
 *     el encargado (su sucursal) y recién descuenta cuando supervisión
 *     autoriza; saldo negativo; rechazo; cancelación con devolución.
 *  4. Saldo inicial, compensación y ajuste.
 *  5. Los días cuentan en cruces de vacaciones y disponibilidad de rotativos.
 *  6. Minutos adeudados de Asistencia: apagado por defecto; encendido, restan.
 *
 *   npx tsx src/lib/hour-bank/hour-bank.smoke.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";

const TEST_DB = "tkl_hour_bank_smoke";
const BASE_COMMIT = "acc42ac"; // main antes del banco de horas
const GATE = "prisma/gates/2026-11-12-banco-de-horas.sql";

function abort(m: string): never { console.error("ABORT:", m); process.exit(1); }
const m = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+?)"?\s*$/m);
if (!m) abort("No encontré DATABASE_URL en .env");
const baseUrl = m[1].trim();
if (!["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname)) abort(`SAFETY ABORT: ${new URL(baseUrl).hostname} no es local. NUNCA Neon.`);
const adminUrl = new URL(baseUrl); adminUrl.pathname = "/postgres";
const testUrl = new URL(baseUrl); testUrl.pathname = `/${TEST_DB}`;
const TEST_URL = testUrl.toString();
process.env.DATABASE_URL = TEST_URL;
delete process.env.HOUR_BANK_TIME_EVENTS;
delete process.env.VACATIONS_RRHH_STEP;
const env = { ...process.env, DATABASE_URL: TEST_URL };

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const run = (cmd: string) => execSync(cmd, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const actions = await import("./actions");
  const { validateVacationRequest } = await import("@/lib/vacations/validation");
  const { loadRotativeOptions } = await import("@/lib/vacations/coverage-data");
  const adminExec = async (sql: string) => {
    const a = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    try { await a.$executeRawUnsafe(sql); } finally { await a.$disconnect(); }
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hour-bank-smoke-"));
  await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${TEST_DB}"`);
  const db = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  try {
    // ---------------------------------------------------------------- 1 · gate
    const oldSchema = path.join(tmp, "schema.prisma");
    fs.writeFileSync(oldSchema, execSync(`git show ${BASE_COMMIT}:prisma/schema.prisma`, { encoding: "utf8" }));
    run(`npx prisma db push --skip-generate --schema "${oldSchema}"`);

    // Filas previas al gate (con SQL: el cliente ya conoce las columnas nuevas).
    await db.$executeRawUnsafe(`INSERT INTO "Branch" (id, name, zone, aliases, "updatedAt") VALUES ('bA', 'Sucursal A', 'CABA', '{}', now()), ('bB', 'Sucursal B', 'CABA', '{}', now())`);
    await db.$executeRawUnsafe(`INSERT INTO "Position" (id, name, "updatedAt") VALUES ('caj', 'Cajero/a', now())`);
    await db.$executeRawUnsafe(`INSERT INTO "User" (id, name, email, "passwordHash", role, "branchId", "updatedAt") VALUES
      ('sup', 'Supervisión Prueba', 'sup@example.test', 'x', 'SUPERVISOR', NULL, now()),
      ('encA', 'Encargada A Prueba', 'enca@example.test', 'x', 'BRANCH_MANAGER', 'bA', now()),
      ('encB', 'Encargada B Prueba', 'encb@example.test', 'x', 'BRANCH_MANAGER', 'bB', now())`);
    for (const [id, branch, rot] of [["ana", "bA", false], ["beto", "bA", false], ["ceci", "bB", false], ["rot", "bA", true]] as const) {
      await db.$executeRawUnsafe(`INSERT INTO "Employee" (id, "firstName", "lastName", "positionId", "currentBranchId", "isRotating", "updatedAt")
        VALUES ('${id}', 'Nombre${id}', 'Prueba', 'caj', '${branch}', ${rot}, now())`);
    }
    await db.$executeRawUnsafe(`INSERT INTO "OvertimeRecord" (id, "employeeId", "branchId", "reportedByUserId", date, hours, reason, status, "updatedAt") VALUES
      ('ot-vieja', 'ana', 'bA', 'encA', '2026-09-01', 3, 'OTHER', 'APPROVED', now()),
      ('ot1', 'ana', 'bA', 'encA', '2027-01-11', 4, 'HIGH_DEMAND', 'REPORTED', now()),
      ('ot2', 'ana', 'bA', 'encA', '2027-01-12', 2.5, 'HIGH_DEMAND', 'REPORTED', now()),
      ('ot3', 'ana', 'bA', 'encA', '2027-01-13', 1, 'OTHER', 'REPORTED', now())`);
    const fingerprint = async () => JSON.stringify(await Promise.all([
      db.$queryRawUnsafe(`SELECT id, "employeeId", "branchId", date, hours::text, reason, status, "approvedByUserId", notes FROM "OvertimeRecord" ORDER BY id`),
      db.$queryRawUnsafe(`SELECT id, "firstName", "lastName", "positionId", "currentBranchId", active, "isRotating" FROM "Employee" ORDER BY id`),
      db.$queryRawUnsafe(`SELECT id, name, email, role, active, "branchId" FROM "User" ORDER BY id`),
    ]));
    const before = await fingerprint();

    const gateSql = fs.readFileSync(GATE, "utf8");
    const statements = gateSql.split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n")
      .split(";").map((x) => x.trim()).filter(Boolean);
    await check(`gate: solo BEGIN/COMMIT, CREATE y ALTER ... ADD (${statements.length} sentencias)`, async () => {
      for (const s of statements) {
        assert.match(s, /^(BEGIN|COMMIT|CREATE TYPE|CREATE TABLE|CREATE (UNIQUE )?INDEX|ALTER TABLE "\w+" ADD (COLUMN|CONSTRAINT))/, s.slice(0, 80));
        // "ON DELETE ..." y "ON UPDATE ..." son la regla de la clave foránea, no sentencias.
        const body = s.replace(/ON (DELETE|UPDATE) (RESTRICT|CASCADE|SET NULL|NO ACTION)/g, "");
        assert.doesNotMatch(body, /\b(DROP|TRUNCATE|UPDATE|DELETE|RENAME)\b|ALTER COLUMN/i, s.slice(0, 80));
      }
    });
    await check("gate: se aplica tal cual", async () => {
      for (const s of statements) await db.$executeRawUnsafe(s);
    });
    await check("migrate diff (DB con el gate aplicado → schema.prisma) da vacío", async () => {
      const out = run(`npx prisma migrate diff --from-url "${TEST_URL}" --to-schema-datamodel prisma/schema.prisma --script`);
      assert.match(out, /empty migration/i);
    });
    await check("las filas que ya había quedan idénticas y ninguna hora extra suma al banco por el gate", async () => {
      assert.equal(await fingerprint(), before);
      assert.equal(await db.overtimeRecord.count({ where: { destination: { not: null } } }), 0);
      assert.equal(await db.hourBankMovement.count(), 0);
    });

    // Horarios: Ana y Beto de lunes a viernes de 8 a 14 (6 h) en la sucursal A.
    for (const id of ["ana", "beto"]) {
      await db.workSchedule.create({ data: { employeeId: id, validFrom: D("2026-01-01"),
        slots: { create: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, slot: 1, startMinute: 480, endMinute: 840, branchId: "bA" })) } } });
    }
    const SUP = { id: "sup", role: "SUPERVISOR" as const, branchId: null };
    const ENC_A = { id: "encA", role: "BRANCH_MANAGER" as const, branchId: "bA" };
    const ENC_B = { id: "encB", role: "BRANCH_MANAGER" as const, branchId: "bB" };
    const balance = async (id: string) => (await actions.loadBalance(db, id)).balance;

    // ---------------------------------------------------------------- 2 · horas extra
    await check("aprobar sin destino → 400: el destino se decide caso por caso", async () => {
      const r = await actions.decideOvertime(db, SUP, { id: "ot1", action: "approve" });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.status, 400);
      assert.equal((await db.overtimeRecord.findUniqueOrThrow({ where: { id: "ot1" } })).status, "REPORTED");
    });
    await check("aprobar con destino Banco: suma las horas al banco", async () => {
      const r = await actions.decideOvertime(db, SUP, { id: "ot1", action: "approve", destination: "BANK" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      const o = await db.overtimeRecord.findUniqueOrThrow({ where: { id: "ot1" } });
      assert.equal(`${o.status} ${o.destination} ${o.approvedByUserId}`, "APPROVED BANK sup");
      assert.equal(await balance("ana"), 4);
      const mv = await db.hourBankMovement.findFirstOrThrow({ where: { overtimeRecordId: "ot1" } });
      assert.equal(`${mv.type} ${Number(mv.hours)}`, "OVERTIME 4");
      assert.ok(await db.auditLog.findFirst({ where: { action: "OVERTIME_APPROVED", entityId: "ot1" } }));
    });
    await check("aprobar con destino Pagar: no toca el banco", async () => {
      const r = await actions.decideOvertime(db, SUP, { id: "ot2", action: "approve", destination: "PAY" });
      assert.ok(r.ok);
      assert.equal((await db.overtimeRecord.findUniqueOrThrow({ where: { id: "ot2" } })).destination, "PAY");
      assert.equal(await balance("ana"), 4);
    });
    await check("aprobar dos veces la misma: 409 y no suma de nuevo", async () => {
      const r = await actions.decideOvertime(db, SUP, { id: "ot1", action: "approve", destination: "BANK" });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.status, 409);
      assert.equal(await balance("ana"), 4);
    });
    await check("rechazar: motivo obligatorio; queda rechazada, sin destino y sin movimiento", async () => {
      assert.equal((await actions.decideOvertime(db, SUP, { id: "ot3", action: "reject", rejectionReason: "  " })).ok, false);
      const r = await actions.decideOvertime(db, SUP, { id: "ot3", action: "reject", rejectionReason: "No correspondía" });
      assert.ok(r.ok);
      const o = await db.overtimeRecord.findUniqueOrThrow({ where: { id: "ot3" } });
      assert.equal(`${o.status} ${o.destination} ${o.rejectionReason}`, "REJECTED null No correspondía");
      assert.equal(await balance("ana"), 4);
    });
    await check("hora extra aprobada antes del banco (sin destino): se le define y suma una sola vez", async () => {
      const r = await actions.setOvertimeDestination(db, SUP, { id: "ot-vieja", destination: "BANK" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      assert.equal(await balance("ana"), 7);
      const again = await actions.setOvertimeDestination(db, SUP, { id: "ot-vieja", destination: "BANK" });
      assert.equal(again.ok, false);
      assert.equal(await balance("ana"), 7);
    });
    await check("dos aprobaciones simultáneas con destino Banco: gana una, suma una vez", async () => {
      await db.overtimeRecord.create({ data: { id: "ot4", employeeId: "beto", branchId: "bA", reportedByUserId: "encA", date: D("2027-01-14"), hours: 2, reason: "OTHER" } });
      const rs = await Promise.all([
        actions.decideOvertime(db, SUP, { id: "ot4", action: "approve", destination: "BANK" }),
        actions.decideOvertime(db, SUP, { id: "ot4", action: "approve", destination: "BANK" }),
      ]);
      assert.equal(rs.filter((r) => r.ok).length, 1);
      assert.equal(await balance("beto"), 2);
    });

    // ---------------------------------------------------------------- 3 · pedidos
    const DAY = { startDate: D("2027-02-01"), endDate: D("2027-02-01") }; // lunes
    let req1 = "";
    await check("vista previa: las horas del turno de ese día según el horario, y el saldo", async () => {
      const p = await actions.previewRequest(db, ENC_A, { employeeId: "ana", ...DAY });
      assert.ok(p.ok);
      if (p.ok) assert.deepEqual([p.data.scheduleHours, p.data.balance, p.data.hasSchedule], [6, 7, true]);
      const out = await actions.previewRequest(db, ENC_B, { employeeId: "ana", ...DAY });
      assert.equal(!out.ok && out.status, 403);
    });
    await check("la encargada pide un día para alguien de su sucursal: queda pendiente y NO descuenta", async () => {
      const r = await actions.createRequest(db, ENC_A, { employeeId: "ana", ...DAY, coveredByEmployeeId: "beto", requesterNote: "Trámite" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      if (!r.ok) return;
      req1 = r.data.id;
      assert.equal(`${r.data.status} ${Number(r.data.hours)} ${Number(r.data.scheduleHours)} ${r.data.coveredByEmployeeId}`, "PENDING 6 6 beto");
      assert.equal(r.data.branchId, "bA");
      assert.equal(await balance("ana"), 7);
      const b = await actions.loadBalance(db, "ana");
      assert.deepEqual([b.pendingHours, b.balanceAfterPending], [6, 1]);
    });
    await check("la encargada de otra sucursal no puede pedir ni cancelar ese pedido", async () => {
      const r = await actions.createRequest(db, ENC_B, { employeeId: "ana", startDate: D("2027-02-02"), endDate: D("2027-02-02") });
      assert.equal(!r.ok && r.status, 403);
      const c = await actions.cancelRequest(db, ENC_B, { id: req1, canAuthorize: false });
      assert.equal(!c.ok && c.status, 403);
    });
    await check("no se pisa con otro pedido propio el mismo día", async () => {
      const r = await actions.createRequest(db, ENC_A, { employeeId: "ana", ...DAY });
      assert.equal(!r.ok && r.status, 409);
    });
    await check("supervisión autoriza: descuenta, registra quién cubre y quién autorizó", async () => {
      const r = await actions.decideRequest(db, SUP, { id: req1, action: "approve" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      if (r.ok) assert.equal(`${r.data.status} ${r.data.decidedByUserId} ${r.data.coveredByEmployeeId}`, "APPROVED sup beto");
      assert.equal(await balance("ana"), 1);
      const mv = await db.hourBankMovement.findFirstOrThrow({ where: { hourBankRequestId: req1 } });
      assert.equal(`${mv.type} ${Number(mv.hours)}`, "TAKEN -6");
      const a = await db.auditLog.findFirstOrThrow({ where: { action: "HOUR_BANK_APPROVED", entityId: req1 } });
      assert.deepEqual([(a.detail as any).balanceBefore, (a.detail as any).balanceAfter], [7, 1]);
    });
    await check("autorizar dos veces: 409 y no descuenta de nuevo", async () => {
      const r = await actions.decideRequest(db, SUP, { id: req1, action: "approve" });
      assert.equal(!r.ok && r.status, 409);
      assert.equal(await balance("ana"), 1);
    });
    let req2 = "";
    await check("franja de 10 a 12: descuenta 2 h por defecto; supervisión las edita a 3 al autorizar", async () => {
      const r = await actions.createRequest(db, ENC_A, { employeeId: "ana", startDate: D("2027-02-02"), endDate: D("2027-02-02"), startMinute: 600, endMinute: 720 });
      assert.ok(r.ok, !r.ok ? r.error : "");
      if (!r.ok) return;
      req2 = r.data.id;
      assert.equal(Number(r.data.hours), 2);
      const ok = await actions.decideRequest(db, SUP, { id: req2, action: "approve", hours: 3, coverageNote: "Cubre el turno tarde" });
      assert.ok(ok.ok);
      const saved = await db.hourBankRequest.findUniqueOrThrow({ where: { id: req2 } });
      assert.equal(`${Number(saved.hours)} ${Number(saved.scheduleHours)} ${saved.coverageNote}`, "3 2 Cubre el turno tarde");
      assert.equal(await balance("ana"), -2, "el saldo puede quedar en negativo");
    });
    await check("horas editadas al pedir; una franja de varios días no se acepta", async () => {
      const r = await actions.createRequest(db, SUP, { employeeId: "beto", startDate: D("2027-02-03"), endDate: D("2027-02-04"), hours: 10 });
      assert.ok(r.ok, !r.ok ? r.error : "");
      if (r.ok) assert.equal(`${Number(r.data.hours)} ${Number(r.data.scheduleHours)}`, "10 12");
      const bad = await actions.createRequest(db, SUP, { employeeId: "beto", startDate: D("2027-02-08"), endDate: D("2027-02-09"), startMinute: 600, endMinute: 720 });
      assert.equal(!bad.ok && bad.status, 400);
    });
    await check("persona sin horario: hay que indicar las horas", async () => {
      const no = await actions.createRequest(db, ENC_B, { employeeId: "ceci", ...DAY });
      assert.equal(!no.ok && no.status, 400);
      const yes = await actions.createRequest(db, ENC_B, { employeeId: "ceci", ...DAY, hours: 8 });
      assert.ok(yes.ok);
      if (yes.ok) assert.equal(yes.data.scheduleHours, null);
    });
    await check("día en que no trabaja según su horario (domingo): pide indicar las horas", async () => {
      const r = await actions.createRequest(db, ENC_A, { employeeId: "ana", startDate: D("2027-02-07"), endDate: D("2027-02-07") });
      assert.equal(!r.ok && r.status, 400);
    });
    await check("rechazo: motivo obligatorio; no descuenta", async () => {
      const pending = await db.hourBankRequest.findFirstOrThrow({ where: { employeeId: "ceci", status: "PENDING" } });
      assert.equal((await actions.decideRequest(db, SUP, { id: pending.id, action: "reject" })).ok, false);
      const r = await actions.decideRequest(db, SUP, { id: pending.id, action: "reject", note: "Sin cobertura ese día" });
      assert.ok(r.ok);
      assert.equal(await balance("ceci"), 0);
      assert.equal(await db.hourBankMovement.count({ where: { employeeId: "ceci" } }), 0);
    });
    await check("cancelar un pedido pendiente: lo puede hacer la encargada; no mueve el saldo", async () => {
      const pending = await db.hourBankRequest.findFirstOrThrow({ where: { employeeId: "beto", status: "PENDING" } });
      const r = await actions.cancelRequest(db, ENC_A, { id: pending.id, canAuthorize: false });
      assert.ok(r.ok, !r.ok ? r.error : "");
      assert.equal(await balance("beto"), 2);
    });
    await check("cancelar uno ya autorizado: solo supervisión, con motivo, y vuelven las horas", async () => {
      const enc = await actions.cancelRequest(db, ENC_A, { id: req2, note: "x", canAuthorize: false });
      assert.equal(!enc.ok && enc.status, 403);
      const sinMotivo = await actions.cancelRequest(db, SUP, { id: req2, canAuthorize: true });
      assert.equal(!sinMotivo.ok && sinMotivo.status, 400);
      const r = await actions.cancelRequest(db, SUP, { id: req2, note: "Al final vino", canAuthorize: true });
      assert.ok(r.ok, !r.ok ? r.error : "");
      assert.equal(await balance("ana"), 1);
      const mvs = await db.hourBankMovement.findMany({ where: { hourBankRequestId: req2 }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(mvs.map((x) => `${x.type}:${Number(x.hours)}`), ["TAKEN:-3", "TAKEN_REVERSAL:3"]);
      const again = await actions.cancelRequest(db, SUP, { id: req2, note: "otra vez", canAuthorize: true });
      assert.equal(!again.ok && again.status, 409);
    });
    await check("no se puede pedir un día en el que tiene vacaciones o licencia", async () => {
      await db.vacationRequest.create({ data: {
        employeeId: "beto", branchId: "bA", positionId: "caj", employeeNameSnapshot: "x", branchNameSnapshot: "x", positionNameSnapshot: "x",
        startDate: D("2027-03-01"), endDate: D("2027-03-07"), daysCount: 7, requestedByUserId: "sup", status: "APPROVED" } });
      const v = await actions.createRequest(db, SUP, { employeeId: "beto", startDate: D("2027-03-03"), endDate: D("2027-03-03") });
      assert.equal(!v.ok && v.status, 409);
      await db.absenceRecord.create({ data: { employeeId: "beto", branchId: "bA", reportedByUserId: "sup",
        startDate: D("2027-04-05"), endDate: D("2027-04-09"), absenceType: "MEDICAL_LEAVE" } });
      const l = await actions.createRequest(db, SUP, { employeeId: "beto", startDate: D("2027-04-06"), endDate: D("2027-04-06") });
      assert.equal(!l.ok && l.status, 409);
    });
    await check("quien cubre no puede ser la misma persona ni alguien dado de baja", async () => {
      const self = await actions.createRequest(db, SUP, { employeeId: "ana", startDate: D("2027-02-10"), endDate: D("2027-02-10"), coveredByEmployeeId: "ana" });
      assert.equal(!self.ok && self.status, 400);
      await db.employee.create({ data: { id: "baja", firstName: "Baja", lastName: "Prueba", positionId: "caj", currentBranchId: "bA", active: false } });
      const off = await actions.createRequest(db, SUP, { employeeId: "ana", startDate: D("2027-02-10"), endDate: D("2027-02-10"), coveredByEmployeeId: "baja" });
      assert.equal(!off.ok && off.status, 400);
    });

    // ---------------------------------------------------------------- 4 · movimientos manuales
    await check("saldo inicial: se carga una vez por persona (puede ser negativo); la segunda vez pide usar Ajuste", async () => {
      const r = await actions.addMovement(db, SUP, { employeeId: "ceci", type: "INITIAL", hours: -4 });
      assert.ok(r.ok, !r.ok ? r.error : "");
      assert.equal(await balance("ceci"), -4);
      const again = await actions.addMovement(db, SUP, { employeeId: "ceci", type: "INITIAL", hours: 10 });
      assert.equal(!again.ok && again.status, 409);
    });
    await check("compensación: suma, con motivo obligatorio; ajuste: con signo y motivo", async () => {
      assert.equal((await actions.addMovement(db, SUP, { employeeId: "ceci", type: "COMPENSATION", hours: 8 })).ok, false);
      assert.equal((await actions.addMovement(db, SUP, { employeeId: "ceci", type: "COMPENSATION", hours: -8, note: "x" })).ok, false);
      assert.ok((await actions.addMovement(db, SUP, { employeeId: "ceci", type: "COMPENSATION", hours: 8, note: "Feriado trabajado" })).ok);
      assert.ok((await actions.addMovement(db, SUP, { employeeId: "ceci", type: "ADJUST", hours: -1.5, note: "Corrección de carga" })).ok);
      assert.equal(await balance("ceci"), 2.5);
      assert.equal((await actions.addMovement(db, SUP, { employeeId: "ceci", type: "ADJUST", hours: 0, note: "x" })).ok, false);
      assert.equal(await db.auditLog.count({ where: { action: "HOUR_BANK_MOVEMENT" } }), 3);
    });
    await check("ficha: movimientos del más nuevo al más viejo y el saldo es su suma", async () => {
      const b = await actions.loadBalance(db, "ana");
      assert.deepEqual(b.movements.map((x) => `${x.type}:${Number(x.hours)}`),
        ["TAKEN_REVERSAL:3", "TAKEN:-3", "TAKEN:-6", "OVERTIME:3", "OVERTIME:4"]);
      assert.equal(b.balance, 1);
      assert.equal(b.movementsBalance, 1);
    });

    // ---------------------------------------------------------------- 5 · cruces y rotativos
    await check("el día por banco de horas de Ana cuenta en el cruce de vacaciones de Beto", async () => {
      // Beto pide la semana del 01/02/2027; Ana tiene autorizado el lunes 01/02.
      const v = await validateVacationRequest({ employeeId: "beto", startDate: D("2027-02-01"), endDate: D("2027-02-07") }, db);
      const o = v.overlaps.find((x) => x.employeeName === "Nombreana Prueba");
      assert.ok(o, JSON.stringify(v.overlaps));
      assert.equal(o!.stateLabel, "banco de horas autorizado");
      assert.deepEqual(o!.dates, ["2027-02-01"]);
    });
    await check("el pedido cancelado deja de contar", async () => {
      const v = await validateVacationRequest({ employeeId: "beto", startDate: D("2027-02-02"), endDate: D("2027-02-02") }, db);
      assert.equal(v.overlaps.length, 0);
    });
    await check("rotativa con día por banco de horas: no está libre ese día para cubrir", async () => {
      const r = await actions.createRequest(db, SUP, { employeeId: "rot", startDate: D("2027-02-03"), endDate: D("2027-02-03"), hours: 6 });
      assert.ok(r.ok, !r.ok ? r.error : "");
      const o = await loadRotativeOptions(db, { employeeId: "beto", positionKey: "CAJERO", branchId: "bA", startDate: D("2027-02-01"), endDate: D("2027-02-05") });
      const a = o.availability.find((x) => x.employeeId === "rot")!;
      assert.equal(a.freeAll, false);
      assert.deepEqual(a.busyDays.map((b) => `${b.date} ${b.reason}`), ["2027-02-03 banco de horas pedido"]);
    });

    // ---------------------------------------------------------------- 6 · minutos adeudados
    await check("minutos adeudados de Asistencia: apagado por defecto, no tocan el saldo", async () => {
      await db.timeEvent.create({ data: {
        employeeId: "ana", branchId: "bA", employeeNameSnapshot: "x", branchNameSnapshot: "x", positionNameSnapshot: "x",
        date: D("2027-01-20"), type: "LATE_ARRIVAL", status: "PARTIALLY_COMPENSATED",
        expectedTime: new Date("2027-01-20T11:00:00Z"), actualTime: new Date("2027-01-20T12:30:00Z"),
        minutesOwed: 90, minutesCompensated: 30, minutesRemaining: 60, reportedByUserId: "sup" } });
      await db.timeEvent.create({ data: {
        employeeId: "ana", branchId: "bA", employeeNameSnapshot: "x", branchNameSnapshot: "x", positionNameSnapshot: "x",
        date: D("2027-01-21"), type: "LATE_ARRIVAL", status: "SENT_TO_PAYROLL_DEDUCTION",
        expectedTime: new Date("2027-01-21T11:00:00Z"), actualTime: new Date("2027-01-21T12:00:00Z"),
        minutesOwed: 60, minutesRemaining: 60, reportedByUserId: "sup" } });
      const b = await actions.loadBalance(db, "ana");
      assert.equal(b.timeDebt.enabled, false);
      assert.equal(b.balance, 1);
    });
    await check("encendido (HOUR_BANK_TIME_EVENTS=true): resta lo pendiente de compensar; lo enviado a sueldo no", async () => {
      process.env.HOUR_BANK_TIME_EVENTS = "true";
      try {
        const b = await actions.loadBalance(db, "ana");
        assert.equal(b.timeDebt.enabled, true);
        assert.equal(b.timeDebt.hours, -1);
        assert.equal(b.timeDebt.events.length, 1);
        assert.equal(b.balance, 0);
        assert.equal(b.movementsBalance, 1, "no escribe movimientos: se calcula al mostrar");
      } finally {
        delete process.env.HOUR_BANK_TIME_EVENTS;
      }
    });
  } finally {
    await db.$disconnect();
    await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n${pass} ok, ${fails.length} fallaron${fails.length ? `: ${fails.join(" · ")}` : ""}`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
