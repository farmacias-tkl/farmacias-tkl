/**
 * SMOKE de personal real contra una DB Postgres LOCAL EFÍMERA. NO toca Neon.
 * Todos los datos son SINTÉTICOS.
 *
 * 1. Crea la DB con el schema de 5c2ba5b y siembra filas en tablas existentes.
 * 2. Aplica prisma/gates/2026-10-29-personal-real.sql tal cual (parte 1 + 2).
 * 3. `prisma migrate diff --from-url <DB> --to-schema-datamodel prisma/schema.prisma` da vacío.
 * 4. Las filas existentes quedan iguales (columnas viejas); Branch.code de las 11;
 *    Branch.zone: 8 CABA y 3 PROVINCIA.
 * 5. Carga (load-plan + load-apply + CLI dry-run): crea, y la segunda corrida no escribe.
 * 6. Circuito de vacaciones con Prisma real: aprobación de supervisión (saldo del
 *    año más viejo, sin PENDING_RRHH), "Aprobar igual", cobertura vinculada,
 *    deshacer (nota, devuelve días, libera cobertura), cambiar/quitar cobertura,
 *    cancelar y rechazar liberan, paso de RRHH reactivado, bloqueos; ausencia
 *    por enfermedad ocupa; en PROVINCIA no hay rotativos ni "sin cobertura";
 *    recarga de saldos frenada con consumos salvo --force-saldos.
 * 7. Limpieza: frena con User → Employee ficticio y con PositionPermission; sin
 *    frenos borra los ficticios y deja idénticas las tablas excluidas.
 * Teardown garantizado (DROP al final).
 *
 *   npx tsx src/lib/personal/personal.smoke.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";

const TEST_DB = "tkl_personal_smoke";
const BASE_COMMIT = "5c2ba5b";
const GATE = "prisma/gates/2026-10-29-personal-real.sql";

function abort(m: string): never { console.error("ABORT:", m); process.exit(1); }
const m = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+?)"?\s*$/m);
if (!m) abort("No encontré DATABASE_URL en .env");
const baseUrl = m[1].trim();
if (!["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname)) abort(`SAFETY ABORT: ${new URL(baseUrl).hostname} no es local. NUNCA Neon.`);
const adminUrl = new URL(baseUrl); adminUrl.pathname = "/postgres";
const testUrl = new URL(baseUrl); testUrl.pathname = `/${TEST_DB}`;
const ADMIN_URL = adminUrl.toString();
const TEST_URL = testUrl.toString();
process.env.DATABASE_URL = TEST_URL; // el singleton @/lib/prisma (si se importa) apunta a la DB de prueba
delete process.env.VACATIONS_RRHH_STEP;
const env = { ...process.env, DATABASE_URL: TEST_URL };

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const run = (cmd: string) => execSync(cmd, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function gateStatements(): { schema: string[]; data: string[] } {
  const raw = fs.readFileSync(GATE, "utf8");
  const [p1, p2] = raw.split(/^-- PARTE 2 ·.*$/m);
  const stmts = (s: string) => s.split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n")
    .split(";").map((x) => x.trim()).filter(Boolean);
  return { schema: stmts(p1), data: stmts(p2) };
}

const D = (s: string) => new Date(`${s}T00:00:00Z`);

const EMP = [
  "apellido_nombre,contrato,trabaja_en,puesto,puesto_secundario,dt,rotativo,horas_semanales,fecha_ingreso,situacion,situacion_desde,situacion_hasta,tareas_adicionales",
  `"Cajera, Uno",TEK,TEK,Cajero/a,,N,N,,2019-05-01,Activo/a,,,`,
  `"Cajera, Dos",TEK,TEK,Cajero/a,,N,N,,,Activo/a,,,`,
  `"Rotativo, Uno",ETC,TEK,Cajero/a,Reposición / Cadetería,N,S,45,,Activo/a,,,`,
  `"Homonimo, Igual",TEK,TEK,Encargado/a,,S,N,,,Activo/a,,,`,
  `"Homonimo, Igual",GAL,GAL,Encargado/a,,N,N,,,Activo/a,,,`,
  `"Contrato, Distinto",GAL,CALLCENTER,Call Center,Cajero/a,N,N,,,Licencia médica,2026-10-01,2026-10-20,`,
].join("\n");
const HOR = [
  "apellido_nombre,contrato,vigente_desde,semana,referencia_ab,dia,tramo,entrada,salida,sucursal,otro_lugar",
  ...[1, 2, 3, 4, 5].map((d) => `"Cajera, Uno",TEK,2026-01-01,TODAS,,${d},1,08:00,14:00,,`),
  ...[1, 2, 3, 4, 5].map((d) => `"Cajera, Dos",TEK,2026-01-01,TODAS,,${d},1,12:00,18:00,,`),
  `"Homonimo, Igual",TEK,2026-01-01,TODAS,,1,1,08:00,12:00,,`,
  `"Homonimo, Igual",TEK,2026-01-01,TODAS,,1,2,15:00,19:00,GAL,`,
].join("\n");
const SAL = [
  "apellido_nombre,contrato,anio,dias",
  `"Cajera, Uno",TEK,2024,14`,
  `"Cajera, Uno",TEK,2023,4`,
  `"Cajera, Dos",TEK,2025,30`,
].join("\n");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const adminExec = async (sql: string) => {
    const a = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
    try { await a.$executeRawUnsafe(sql); } finally { await a.$disconnect(); }
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "personal-smoke-"));
  await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${TEST_DB}"`);
  const db = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  try {
    // ---------------------------------------------------------------- 1
    const oldSchema = path.join(tmp, "schema.prisma");
    fs.writeFileSync(oldSchema, execSync(`git show ${BASE_COMMIT}:prisma/schema.prisma`, { encoding: "utf8" }));
    run(`npx prisma db push --skip-generate --schema "${oldSchema}"`);

    const names = ["America", "Facultad", "San Miguel", "Etcheverry", "Galesa", "Larcade", "La Perla", "Naveira", "Quintana", "San Agustin", "Tekiel", "Call Center"];
    for (const [i, n] of names.entries()) {
      await db.$executeRawUnsafe(`INSERT INTO "Branch" (id, name, aliases, "updatedAt") VALUES ('b${i}', '${n}', '{}', now())`);
    }
    await db.$executeRawUnsafe(`INSERT INTO "Branch" (id, name, code, aliases, "showInOperative", "updatedAt") VALUES ('b-pat', 'Patricios', 'PAT', '{}', false, now())`);
    await db.$executeRawUnsafe(`INSERT INTO "User" (id, name, email, "passwordHash", role, "updatedAt") VALUES ('u1', 'Supervisora Prueba', 'sup@example.test', 'x', 'SUPERVISOR', now())`);
    await db.$executeRawUnsafe(`INSERT INTO "Position" (id, name, "updatedAt") VALUES ('p-fict', 'Cajera', now()), ('p-fict2', 'Mostrador', now())`);
    await db.$executeRawUnsafe(`INSERT INTO "Employee" (id, "firstName", "lastName", "positionId", "currentBranchId", "updatedAt")
      VALUES ('e-fict1', 'Mostrador', 'America', 'p-fict2', 'b0', now()), ('e-fict2', 'Cadete', 'America', 'p-fict', 'b0', now())`);
    const OLD_COLS: Record<string, string> = {
      Branch: `id, name, aliases, address, phone, active, "showInExecutive", "showInOperative", notes`,
      Employee: `id, "firstName", "lastName", "positionId", "currentBranchId", active, "hireDate", "isRotating", zone, "maxConcurrentAssignments", "workScheduleNotes", notes, "userId"`,
      Position: `id, name, "requiresCoverage", "isRotatingRole", scope, active, notes`,
      User: `id, name, email, role, active, "branchId", "employeeId"`,
    };
    const oldFingerprint = async () => JSON.stringify(await Promise.all(Object.entries(OLD_COLS).map(([t, c]) =>
      db.$queryRawUnsafe(`SELECT ${c} FROM "${t}" ORDER BY id`))));
    const before = await oldFingerprint();

    // ---------------------------------------------------------------- 2
    const gate = gateStatements();
    await check(`parte 1 del gate: solo CREATE / ALTER ... ADD / ADD VALUE (${gate.schema.length} sentencias)`, async () => {
      for (const s of gate.schema) {
        assert.match(s, /^(CREATE TYPE|CREATE TABLE|CREATE (UNIQUE )?INDEX|ALTER TYPE "AbsenceType" ADD VALUE|ALTER TABLE "\w+" ADD (COLUMN|CONSTRAINT))/);
      }
      const scanned = gate.schema.join("\n").replace(/ON (DELETE|UPDATE) (RESTRICT|CASCADE|SET NULL)/g, "");
      assert.equal(/\b(DROP|DELETE|UPDATE|TRUNCATE|RENAME|INSERT)\b/i.test(scanned), false);
    });
    await check("parte 2 del gate: 11 UPDATE de Branch.code y 2 de Branch.zone, solo sobre NULL", async () => {
      assert.equal(gate.data.length, 13);
      for (const s of gate.data.slice(0, 11)) assert.match(s, /^UPDATE "Branch" SET "code" = '[A-Z]{3}' WHERE "name" = '[^']+'\s+AND "code" IS NULL$/);
      for (const s of gate.data.slice(11)) assert.match(s, /^UPDATE "Branch" SET "zone" = '(CABA|PROVINCIA)'\s+WHERE "name" IN \([^)]+\)\s+AND "zone" IS NULL$/);
    });
    for (const s of [...gate.schema, ...gate.data]) await db.$executeRawUnsafe(s);

    // ---------------------------------------------------------------- 3
    await check("migrate diff (DB con el SQL aplicado → schema.prisma) da vacío", async () => {
      const out = run(`npx prisma migrate diff --from-url "${TEST_URL}" --to-schema-datamodel prisma/schema.prisma --script`);
      assert.match(out, /This is an empty migration/);
    });

    // ---------------------------------------------------------------- 4
    await check("filas existentes idénticas en sus columnas (Branch, Employee, Position, User)", async () => {
      assert.equal(await oldFingerprint(), before);
    });
    await check("Branch.code: 11 operativas con código; Call Center null; Patricios sigue PAT", async () => {
      const rows = await db.branch.findMany({ select: { name: true, code: true } });
      const code = (n: string) => rows.find((r) => r.name === n)?.code;
      assert.equal(code("San Miguel"), "CSM");
      assert.equal(code("La Perla"), "MUN");
      assert.equal(code("Facultad"), "AYA");
      assert.equal(rows.filter((r) => r.code && r.code !== "PAT").length, 11);
      assert.equal(code("Call Center"), null);
      assert.equal(code("Patricios"), "PAT");
    });
    await check("Branch.zone: 8 CABA, 3 PROVINCIA (La Perla, San Miguel, Larcade); Call Center y Patricios sin zona", async () => {
      const rows = await db.branch.findMany({ select: { name: true, zone: true } });
      const by = (z: string) => rows.filter((r) => r.zone === z).map((r) => r.name).sort();
      assert.deepEqual(by("CABA"), ["America", "Etcheverry", "Facultad", "Galesa", "Naveira", "Quintana", "San Agustin", "Tekiel"]);
      assert.deepEqual(by("PROVINCIA"), ["La Perla", "Larcade", "San Miguel"]);
      assert.equal(rows.find((r) => r.name === "Call Center")?.zone, null);
      assert.equal(rows.find((r) => r.name === "Patricios")?.zone, null);
    });

    // ---------------------------------------------------------------- 5
    const { buildLoadPlan } = await import("./load-plan");
    const { loadSnapshot, applyLoadPlan } = await import("./load-apply");
    const files = { "empleados.csv": EMP, "horarios.csv": HOR, "saldos.csv": SAL };
    const dataDir = path.join(tmp, "datos");
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, "empleados.csv"), EMP);
    fs.writeFileSync(path.join(dataDir, "horarios.csv"), HOR);
    fs.writeFileSync(path.join(dataDir, "saldos.csv"), SAL);

    await check("CLI load-personal dry-run: no escribe y sale 0", async () => {
      const out = run(`npx tsx scripts/load-personal.ts --dir "${dataDir}"`);
      assert.match(out, /Dry-run: no se escribió nada/);
      assert.match(out, /Errores \(0\)/);
      assert.equal(await db.employee.count({ where: { nameKey: { not: null } } }), 0);
    });
    await check("CLI load-personal --apply sin --actor: uso incorrecto (sale 2)", async () => {
      try { run(`npx tsx scripts/load-personal.ts --dir "${dataDir}" --apply --host localhost`); assert.fail("no falló"); }
      catch (e: any) { assert.equal(e.status, 2); }
    });

    let firstResult: Awaited<ReturnType<typeof applyLoadPlan>> | null = null;
    await check("apply: crea 11 puestos, 6 empleados, 3 horarios, 3 saldos, 1 licencia", async () => {
      const plan = buildLoadPlan(files, await loadSnapshot(db));
      assert.equal(plan.errors.length, 0, JSON.stringify(plan.errors));
      firstResult = await applyLoadPlan(db, plan, { userId: "u1" }, { today: D("2026-10-29") });
      assert.deepEqual(firstResult, {
        positionsCreated: 11, employeesCreated: 6, employeesUpdated: 0, schedulesCreated: 3,
        balancesCreated: 3, balancesUpdated: 0, balancesBlocked: 0, leavesCreated: 1,
      });
      assert.equal(await db.vacationBalanceMovement.count({ where: { type: "LOAD" } }), 3);
      const lic = await db.absenceRecord.findFirstOrThrow({ where: { absenceType: "MEDICAL_LEAVE" } });
      assert.equal(lic.reasonDetail, null);
    });
    await check("homónimos en sucursales distintas = 2 empleados; contrato ≠ trabaja", async () => {
      assert.equal(await db.employee.count({ where: { nameKey: "homonimo, igual" } }), 2);
      const cd = await db.employee.findFirstOrThrow({ where: { nameKey: "contrato, distinto" }, include: { currentBranch: true, contractBranch: true } });
      assert.equal(cd.currentBranch?.name, "Call Center");
      assert.equal(cd.contractBranch?.name, "Galesa");
    });
    await check("idempotente: la segunda corrida no escribe nada", async () => {
      const audits = await db.auditLog.count();
      const plan = buildLoadPlan(files, await loadSnapshot(db));
      assert.ok(plan.employees.every((e) => e.action === "unchanged"));
      const r = await applyLoadPlan(db, plan, { userId: "u1" }, { today: D("2026-10-30") });
      assert.ok(Object.values(r).every((n) => n === 0), JSON.stringify(r));
      assert.equal(await db.auditLog.count(), audits);
      assert.equal(await db.employeeBranchAssignment.count({ where: { type: "PERMANENT", employee: { nameKey: { not: null } } } }), 6);
    });
    await check("con errores en los archivos, apply no escribe", async () => {
      const bad = { ...files, "saldos.csv": `${SAL}\n"Cajera, Uno",TEK,2025,muchos` };
      const plan = buildLoadPlan(bad, await loadSnapshot(db));
      await assert.rejects(applyLoadPlan(db, plan, { userId: "u1" }), /error/);
    });

    // ---------------------------------------------------------------- 6
    const actions = await import("@/lib/vacations/actions");
    const { validateVacationRequest } = await import("@/lib/vacations/validation");
    const { loadRotativeOptions } = await import("@/lib/vacations/coverage-data");
    const emp = (nameKey: string) => db.employee.findFirstOrThrow({ where: { nameKey }, include: { position: true, currentBranch: true } });
    const uno = await emp("cajera, uno");
    const dos = await emp("cajera, dos");
    const rot = await emp("rotativo, uno");
    const newRequest = async (e: typeof uno, start: string, end: string) => {
      const days = Math.round((D(end).getTime() - D(start).getTime()) / 86_400_000) + 1;
      return db.vacationRequest.create({
        data: {
          employeeId: e.id, branchId: e.currentBranchId!, positionId: e.positionId,
          employeeNameSnapshot: `${e.firstName} ${e.lastName}`, branchNameSnapshot: e.currentBranch!.name,
          positionNameSnapshot: e.position.name, startDate: D(start), endDate: D(end), daysCount: days,
          requestedByUserId: "u1",
        },
      });
    };
    const balances = async (employeeId: string) =>
      (await db.vacationBalance.findMany({ where: { employeeId }, orderBy: { year: "asc" } })).map((b) => `${b.year}:${b.days}`).join(" ");
    const activeCoverage = (vacationRequestId: string) =>
      db.employeeBranchAssignment.findFirst({ where: { vacationRequestId, status: "ACTIVE" } });

    const r1 = await newRequest(uno, "2026-11-02", "2026-11-22"); // 21 días, saldo 18

    await check("aprobar con advertencias sin confirmar → 409 WARNINGS_REQUIRE_CONFIRMATION", async () => {
      const r = await actions.approveVacation(db, { id: r1.id, userId: "u1", rotativeEmployeeId: rot.id });
      assert.equal(r.ok, false);
      if (!r.ok) { assert.equal(r.code, "WARNINGS_REQUIRE_CONFIRMATION"); assert.ok(r.validation?.balance?.insufficient); }
      assert.equal((await db.vacationRequest.findUniqueOrThrow({ where: { id: r1.id } })).status, "PENDING_SUPERVISOR");
    });
    await check("Aprobar igual: APPROVED directo, sin PENDING_RRHH, advertencias registradas", async () => {
      const r = await actions.approveVacation(db, { id: r1.id, userId: "u1", confirmWarnings: true, rotativeEmployeeId: rot.id });
      assert.ok(r.ok, !r.ok ? r.error : "");
      const v = await db.vacationRequest.findUniqueOrThrow({ where: { id: r1.id }, include: { stateHistory: true } });
      assert.equal(v.status, "APPROVED");
      assert.equal(v.approvedWithWarnings, true);
      assert.ok(((v.approvalWarnings as any).warnings as string[]).some((w) => w.includes("Saldo insuficiente")));
      assert.deepEqual(v.stateHistory.map((h) => `${h.fromStatus}>${h.toStatus}`), ["PENDING_SUPERVISOR>APPROVED"]);
      const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: r1.id, action: "VACATION_SUPERVISOR_APPROVED" } });
      assert.equal((audit.detail as any).approvedWithWarnings, true);
    });
    await check("descuenta del año más viejo: 2023 4→0, 2024 14→-3 (excedente)", async () => {
      assert.equal(await balances(uno.id), "2023:0 2024:-3");
      const movs = await db.vacationBalanceMovement.findMany({ where: { vacationRequestId: r1.id }, orderBy: { year: "asc" } });
      assert.deepEqual(movs.map((x) => [x.year, x.days, x.type]), [[2023, -4, "CONSUME"], [2024, -17, "CONSUME"]]);
    });
    await check("cobertura vinculada: TEMPORARY_COVERAGE activa con los tramos de quien se va", async () => {
      const c = await activeCoverage(r1.id);
      assert.ok(c);
      assert.equal(c!.employeeId, rot.id);
      assert.equal(c!.type, "TEMPORARY_COVERAGE");
      assert.equal((c!.coverageSlots as any[]).length, 15); // 3 semanas × 5 días
      assert.equal((await db.vacationRequest.findUniqueOrThrow({ where: { id: r1.id } })).withoutCoverage, false);
    });
    await check("otra cajera en el mismo período: cruce por horario y el rotativo ya no está libre", async () => {
      const v = await validateVacationRequest({ employeeId: dos.id, startDate: D("2026-11-02"), endDate: D("2026-11-15") }, db);
      assert.ok(v.isValid);
      assert.equal(v.overlaps.length, 1);
      assert.equal(v.overlaps[0].employeeName, "Uno Cajera");
      assert.deepEqual(v.overlaps[0].ranges, ["12:00–14:00"]);
      assert.equal(v.overlaps[0].stateLabel, "vacaciones aprobadas");
      assert.ok(v.warnings.some((w) => w.type === "NO_FREE_ROTATIVE"));
    });
    await check("deshacer sin nota → 400", async () => {
      const r = await actions.undoApproval(db, { id: r1.id, userId: "u1", note: "  " });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.status, 400);
    });
    await check("deshacer: PENDING_SUPERVISOR, días a los mismos años, cobertura liberada, historial con nota", async () => {
      const r = await actions.undoApproval(db, { id: r1.id, userId: "u1", note: "Se reprograma" });
      assert.ok(r.ok);
      const v = await db.vacationRequest.findUniqueOrThrow({ where: { id: r1.id }, include: { stateHistory: { orderBy: { changedAt: "asc" } } } });
      assert.equal(v.status, "PENDING_SUPERVISOR");
      assert.equal(v.approvedWithWarnings, false);
      assert.equal(v.approvalWarnings, null);
      assert.equal(await balances(uno.id), "2023:4 2024:14");
      assert.equal(await activeCoverage(r1.id), null);
      const last = v.stateHistory[v.stateHistory.length - 1];
      assert.equal(`${last.fromStatus}>${last.toStatus}`, "APPROVED>PENDING_SUPERVISOR");
      assert.equal(last.note, "Se reprograma");
      assert.ok(await db.auditLog.findFirst({ where: { entityId: r1.id, action: "VACATION_APPROVAL_UNDONE" } }));
    });
    await check("con el rotativo liberado, vuelve a estar libre todo el período", async () => {
      const o = await loadRotativeOptions(db, {
        employeeId: dos.id, positionKey: "CAJERO", branchId: dos.currentBranchId!,
        startDate: D("2026-11-02"), endDate: D("2026-11-15"),
      });
      assert.equal(o.applies, true);
      assert.equal(o.availability.find((a) => a.employeeId === rot.id)?.freeAll, true);
      assert.equal(o.requestZone, "CABA");
    });
    await check("aprobar sin rotativo → sin cobertura; cambiar a rotativo y quitarlo", async () => {
      assert.ok((await actions.approveVacation(db, { id: r1.id, userId: "u1", confirmWarnings: true })).ok);
      assert.equal((await db.vacationRequest.findUniqueOrThrow({ where: { id: r1.id } })).withoutCoverage, true);
      assert.ok((await actions.changeCoverage(db, { id: r1.id, userId: "u1", rotativeEmployeeId: rot.id })).ok);
      assert.equal((await db.vacationRequest.findUniqueOrThrow({ where: { id: r1.id } })).withoutCoverage, false);
      assert.equal((await activeCoverage(r1.id))?.employeeId, rot.id);
      assert.ok((await actions.changeCoverage(db, { id: r1.id, userId: "u1", rotativeEmployeeId: null })).ok);
      assert.equal(await activeCoverage(r1.id), null);
      assert.equal((await db.vacationRequest.findUniqueOrThrow({ where: { id: r1.id } })).withoutCoverage, true);
      assert.ok((await actions.changeCoverage(db, { id: r1.id, userId: "u1", rotativeEmployeeId: rot.id })).ok);
    });
    await check("cancelar una aprobada (lo que hace la ruta cancel): devuelve saldo y libera cobertura", async () => {
      await db.$transaction(async (tx) => {
        const cas = await tx.vacationRequest.updateMany({ where: { id: r1.id, status: "APPROVED" }, data: { status: "CANCELLED" } });
        assert.equal(cas.count, 1);
        await actions.releaseOnExit(tx, r1, "u1", "cancelada");
      });
      assert.equal(await balances(uno.id), "2023:4 2024:14");
      assert.equal(await activeCoverage(r1.id), null);
    });

    await check("paso de RRHH activo: supervisión → PENDING_RRHH (sin descontar); rechazo de RRHH libera cobertura", async () => {
      process.env.VACATIONS_RRHH_STEP = "true";
      try {
        const r3 = await newRequest(dos, "2026-11-02", "2026-11-15");
        assert.ok((await actions.approveVacation(db, { id: r3.id, userId: "u1", confirmWarnings: true, rotativeEmployeeId: rot.id })).ok);
        assert.equal((await db.vacationRequest.findUniqueOrThrow({ where: { id: r3.id } })).status, "PENDING_RRHH");
        assert.equal(await balances(dos.id), "2025:30");
        assert.ok(await activeCoverage(r3.id));
        await db.$transaction(async (tx) => {
          await tx.vacationRequest.updateMany({ where: { id: r3.id, status: "PENDING_RRHH" }, data: { status: "REJECTED" } });
          await actions.releaseOnExit(tx, r3, "u1", "rechazo");
        });
        assert.equal(await activeCoverage(r3.id), null);
        assert.equal(await balances(dos.id), "2025:30");

        const r4 = await newRequest(dos, "2026-11-02", "2026-11-15");
        assert.ok((await actions.approveVacation(db, { id: r4.id, userId: "u1", confirmWarnings: true })).ok);
        assert.ok((await actions.rrhhApproveVacation(db, { id: r4.id, userId: "u1" })).ok);
        assert.equal((await db.vacationRequest.findUniqueOrThrow({ where: { id: r4.id } })).status, "APPROVED");
        assert.equal(await balances(dos.id), "2025:16");
      } finally {
        delete process.env.VACATIONS_RRHH_STEP;
      }
    });
    await check("rechazo desde solicitada (supervisor-reject) libera la cobertura si hubiera", async () => {
      const r6 = await newRequest(uno, "2026-12-07", "2026-12-13");
      await db.employeeBranchAssignment.create({ data: {
        employeeId: rot.id, branchId: uno.currentBranchId!, type: "TEMPORARY_COVERAGE", status: "ACTIVE",
        startDate: D("2026-12-07"), endDate: D("2026-12-13"), vacationRequestId: r6.id,
      } });
      await db.$transaction(async (tx) => {
        await tx.vacationRequest.updateMany({ where: { id: r6.id, status: "PENDING_SUPERVISOR" }, data: { status: "REJECTED" } });
        await actions.releaseOnExit(tx, r6, "u1", "rechazo");
      });
      assert.equal(await activeCoverage(r6.id), null);
    });
    await check("bloqueos: misma persona con dos solicitudes superpuestas; empleado inactivo", async () => {
      const v = await validateVacationRequest({ employeeId: dos.id, startDate: D("2026-11-09"), endDate: D("2026-11-22") }, db);
      assert.equal(v.isValid, false);
      assert.equal(v.blockingConflicts[0]?.type, "SELF_OVERLAP");
      const homo = await db.employee.findFirstOrThrow({ where: { nameKey: "homonimo, igual", contractBranch: { name: "Galesa" } } });
      await db.employee.update({ where: { id: homo.id }, data: { active: false } });
      const v2 = await validateVacationRequest({ employeeId: homo.id, startDate: D("2026-11-02"), endDate: D("2026-11-08") }, db);
      assert.equal(v2.isValid, false);
      assert.ok(v2.ruleResults.some((r) => r.rule === "empleado" && r.status === "BLOCKING"));
      await db.employee.update({ where: { id: homo.id }, data: { active: true } });
    });
    await check("ausencia por enfermedad (SICKNESS): el rotativo queda ocupado esos días y cuenta en el cruce", async () => {
      const sick = await db.absenceRecord.create({ data: {
        employeeId: rot.id, branchId: rot.currentBranchId!, reportedByUserId: "u1",
        startDate: D("2026-11-16"), endDate: D("2026-11-17"), absenceType: "SICKNESS",
      } });
      const o = await loadRotativeOptions(db, {
        employeeId: uno.id, positionKey: "CAJERO", branchId: uno.currentBranchId!,
        startDate: D("2026-11-16"), endDate: D("2026-11-22"),
      });
      const r = o.availability.find((a) => a.employeeId === rot.id);
      assert.equal(r?.freeAll, false);
      assert.deepEqual(r?.busyDays.map((b) => `${b.date} ${b.reason}`), ["2026-11-16 ausente por enfermedad", "2026-11-17 ausente por enfermedad"]);
      await db.absenceRecord.delete({ where: { id: sick.id } });

      const sickDos = await db.absenceRecord.create({ data: {
        employeeId: dos.id, branchId: dos.currentBranchId!, reportedByUserId: "u1",
        startDate: D("2026-11-16"), endDate: D("2026-11-17"), absenceType: "SICKNESS",
      } });
      const v = await validateVacationRequest({ employeeId: uno.id, startDate: D("2026-11-16"), endDate: D("2026-11-22") }, db);
      assert.equal(v.overlaps.length, 1);
      assert.equal(v.overlaps[0].stateLabel, "ausente por enfermedad");
      assert.deepEqual(v.overlaps[0].dates, ["2026-11-16", "2026-11-17"]);
      await db.absenceRecord.delete({ where: { id: sickDos.id } });
    });
    await check("sucursal de PROVINCIA: sin rotativos propuestos, sin advertencia, no queda \"sin cobertura\"", async () => {
      await db.branch.update({ where: { id: "b10" }, data: { zone: "PROVINCIA" } }); // Tekiel, solo para esta prueba
      try {
        const v = await validateVacationRequest({ employeeId: uno.id, startDate: D("2026-12-14"), endDate: D("2026-12-20") }, db);
        assert.equal(v.rotativos, null);
        assert.equal(v.warnings.some((w) => w.type === "NO_FREE_ROTATIVE"), false);
        const o = await loadRotativeOptions(db, {
          employeeId: uno.id, positionKey: "CAJERO", branchId: uno.currentBranchId!,
          startDate: D("2026-12-14"), endDate: D("2026-12-20"),
        });
        assert.equal(o.applies, false);
        assert.equal(o.availability.length, 0);
        const r7 = await newRequest(uno, "2026-12-14", "2026-12-20");
        assert.ok((await actions.approveVacation(db, { id: r7.id, userId: "u1", confirmWarnings: true })).ok);
        assert.equal((await db.vacationRequest.findUniqueOrThrow({ where: { id: r7.id } })).withoutCoverage, false);
        const c = await actions.changeCoverage(db, { id: r7.id, userId: "u1", rotativeEmployeeId: rot.id });
        assert.equal(c.ok, false);
        assert.ok((await actions.undoApproval(db, { id: r7.id, userId: "u1", note: "prueba PROVINCIA" })).ok);
        await db.vacationRequest.update({ where: { id: r7.id }, data: { status: "CANCELLED" } });
      } finally {
        await db.branch.update({ where: { id: "b10" }, data: { zone: "CABA" } });
      }
    });
    await check("recarga de saldos: con consumos se frena (dry-run lo informa); con --force-saldos queda LOAD_ADJUST", async () => {
      const salChanged = SAL.replace(`"Cajera, Uno",TEK,2023,4`, `"Cajera, Uno",TEK,2023,10`);
      const dir2 = path.join(tmp, "datos2");
      fs.mkdirSync(dir2);
      fs.writeFileSync(path.join(dir2, "empleados.csv"), EMP);
      fs.writeFileSync(path.join(dir2, "horarios.csv"), HOR);
      fs.writeFileSync(path.join(dir2, "saldos.csv"), salChanged);
      // Cajera Dos también consumió (2025: 16 en la base, 30 en la planilla): se frena igual.
      const before = await balances(uno.id);
      const beforeDos = await balances(dos.id);
      const out = run(`npx tsx scripts/load-personal.ts --dir "${dir2}"`);
      assert.match(out, /frenados: 2/);
      assert.match(out, /--force-saldos/);
      const plan = buildLoadPlan({ ...files, "saldos.csv": salChanged }, await loadSnapshot(db));
      assert.equal(plan.balances.find((b) => b.personKey.startsWith("cajera, uno") && b.year === 2023)?.action, "blocked");
      const r = await applyLoadPlan(db, plan, { userId: "u1" }, { today: D("2026-10-31") });
      assert.equal(r.balancesBlocked, 2);
      assert.equal(r.balancesUpdated, 0);
      assert.equal(await balances(uno.id), before);
      assert.equal(await balances(dos.id), beforeDos);

      const outF = run(`npx tsx scripts/load-personal.ts --dir "${dir2}" --force-saldos`);
      assert.match(outF, /actualizar: 2/);
      const forced = buildLoadPlan({ ...files, "saldos.csv": salChanged }, await loadSnapshot(db), { forceBalances: true });
      const rf = await applyLoadPlan(db, forced, { userId: "u1" }, { today: D("2026-10-31") });
      assert.equal(rf.balancesUpdated, 2);
      assert.equal(await balances(uno.id), before.replace("2023:4", "2023:10"));
      assert.equal(await balances(dos.id), "2025:30");
      const adj = await db.vacationBalanceMovement.findFirstOrThrow({ where: { employeeId: uno.id, type: "LOAD_ADJUST" } });
      assert.deepEqual([adj.year, adj.days], [2023, 6]);
    });

    // ---------------------------------------------------------------- 7
    // Datos ficticios con todo lo que cuelga, y filas en las tablas excluidas.
    await db.actionPlan.create({ data: {
      employeeId: "e-fict1", branchId: "b0", createdByUserId: "u1", date: D("2026-01-01"), reason: "Prueba",
      requiredActions: "Prueba", deadline: D("2026-02-01"),
      form: { create: { templateType: "MOSTRADOR", formData: {}, generalScore: "B" } },
    } });
    const abs = await db.absenceRecord.create({ data: {
      employeeId: "e-fict1", branchId: "b0", reportedByUserId: "u1", startDate: D("2026-01-05"), endDate: D("2026-01-05"), absenceType: "SICKNESS",
    } });
    await db.absenceStateHistory.create({ data: { absenceId: abs.id, fromStatus: "REPORTED", toStatus: "JUSTIFIED", changedByUserId: "u1" } });
    await db.overtimeRecord.create({ data: { employeeId: "e-fict2", branchId: "b0", reportedByUserId: "u1", date: D("2026-01-06"), hours: 2, reason: "OTHER" } });
    const te = await db.timeEvent.create({ data: {
      employeeId: "e-fict2", branchId: "b0", employeeNameSnapshot: "x", branchNameSnapshot: "x", positionNameSnapshot: "x",
      date: D("2026-01-07"), type: "LATE_ARRIVAL", status: "PENDING_REVIEW", expectedTime: D("2026-01-07"), actualTime: D("2026-01-07"),
      minutesOwed: 10, minutesRemaining: 10, reportedByUserId: "u1",
    } });
    await db.timeEventCompensation.create({ data: { timeEventId: te.id, date: D("2026-01-08"), minutesCompensated: 5, registeredByUserId: "u1" } });
    await db.timeEventStateHistory.create({ data: { timeEventId: te.id, fromStatus: "PENDING_REVIEW", toStatus: "PARTIALLY_COMPENSATED", changedByUserId: "u1" } });
    const vf = await db.vacationRequest.create({ data: {
      employeeId: "e-fict1", branchId: "b0", positionId: "p-fict2", employeeNameSnapshot: "x", branchNameSnapshot: "x",
      positionNameSnapshot: "x", startDate: D("2026-03-02"), endDate: D("2026-03-08"), daysCount: 7, requestedByUserId: "u1", status: "CANCELLED",
    } });
    await db.vacationStateHistory.create({ data: { vacationId: vf.id, fromStatus: "PENDING_SUPERVISOR", toStatus: "CANCELLED", changedByUserId: "u1" } });
    await db.employeeBranchAssignment.create({ data: { employeeId: "e-fict1", branchId: "b0", startDate: D("2025-01-01"), type: "PERMANENT" } });
    await db.positionBranchScope.create({ data: { positionId: "p-fict", branchId: "b0" } });

    const perm = await db.permission.create({ data: { key: "prueba.ver", module: "prueba", description: "Prueba" } });
    await db.userPermission.create({ data: { userId: "u1", permissionId: perm.id } });
    await db.account.create({ data: { userId: "u1", type: "credentials", provider: "prueba", providerAccountId: "1" } });
    await db.session.create({ data: { sessionToken: "tok", userId: "u1", expires: D("2027-01-01") } });
    await db.salesSnapshot.create({ data: { branchId: "b0", snapshotDate: D("2026-10-01"), totalSales: 1, units: 1, receipts: 1, avgTicket: 1, rawData: {}, dataSource: "siaf" } });
    await db.coseguroDaily.create({ data: { branchId: "b0", date: D("2026-10-01"), code: "AAA", name: "A", receipts: 1, creditNotes: 0, amount: 1, sourceFile: "t" } });
    await db.bankBalanceSnapshot.create({ data: { branchId: "b-pat", bankName: "B", accountLabel: "C", balance: 1, snapshotDate: D("2026-10-01"), sourceSheet: "s" } });
    const cust = await db.customer.create({ data: { phone: "+5400000000" } });
    const conv = await db.conversation.create({ data: { customerId: cust.id } });
    await db.conversationMessage.create({ data: { conversationId: conv.id, author: "CUSTOMER", body: "hola", sentAt: D("2026-10-01") } });
    await db.webhookEvent.create({ data: { eventType: "t", accountId: 1 } });
    await db.syncLog.create({ data: { source: "SALES_API", status: "SUCCESS", syncDate: D("2026-10-01"), triggeredBy: "WEBHOOK" } });
    await db.securityEvent.create({ data: { userId: "u1", type: "USER_CREATED" } });

    const { planCleanup, applyCleanup } = await import("./cleanup");

    await check("limpieza frena: User apunta a empleado ficticio y PositionPermission en puesto ficticio", async () => {
      await db.user.update({ where: { id: "u1" }, data: { employeeId: "e-fict1" } });
      await db.positionPermission.create({ data: { positionId: "p-fict", permissionId: perm.id } });
      const plan = await planCleanup(db);
      assert.equal(plan.blockers.length, 2, plan.blockers.join(" | "));
      await assert.rejects(applyCleanup(db, plan), /frenada/);
      const out = run(`npx tsx scripts/clean-operational-demo-data.ts || true`);
      assert.match(out, /FRENA/);
      assert.equal(await db.employee.count({ where: { nameKey: null } }), 2);
      await db.user.update({ where: { id: "u1" }, data: { employeeId: null } });
      await db.positionPermission.deleteMany({});
    });

    const EXCLUDED = ["User", "UserPermission", "Permission", "Account", "Session", "Branch", "SalesSnapshot", "CoseguroDaily",
      "BankBalanceSnapshot", "Customer", "Conversation", "ConversationMessage", "WebhookEvent", "SyncLog", "AuditLog", "SecurityEvent"];
    const excludedFingerprint = async () => JSON.stringify(await Promise.all(EXCLUDED.map((t) =>
      db.$queryRawUnsafe(`SELECT json_agg(t ORDER BY t.id) AS rows FROM "${t}" t`))));

    await check("dry-run de limpieza (CLI): cuenta y no borra", async () => {
      const out = run(`npx tsx scripts/clean-operational-demo-data.ts`);
      assert.match(out, /Dry-run: no se borró nada/);
      assert.match(out, /ActionPlan\s+1/);
      assert.equal(await db.employee.count({ where: { nameKey: null } }), 2);
    });
    await check("limpieza: borra lo ficticio y no toca ninguna tabla excluida ni al personal real", async () => {
      const beforeExcluded = await excludedFingerprint();
      const realBefore = await db.employee.count({ where: { nameKey: { not: null } } });
      const realBalances = await db.vacationBalance.count();
      const plan = await planCleanup(db);
      assert.equal(plan.blockers.length, 0);
      assert.deepEqual(plan.positionNames.sort(), ["Cajera", "Mostrador"]);
      const deleted = await applyCleanup(db, plan);
      assert.equal(deleted.Employee, 2);
      assert.equal(deleted.ActionPlan, 1);
      assert.equal(deleted.ActionPlanForm, 1);
      assert.equal(deleted.TimeEventCompensation, 1);
      assert.equal(deleted.Position, 2);
      assert.equal(await excludedFingerprint(), beforeExcluded);
      assert.equal(await db.employee.count({ where: { nameKey: null } }), 0);
      assert.equal(await db.employee.count({ where: { nameKey: { not: null } } }), realBefore);
      assert.equal(await db.vacationBalance.count(), realBalances);
      assert.equal(await db.position.count(), 11);
      assert.equal(await db.timeEvent.count(), 0);
      assert.equal(await db.actionPlan.count(), 0);
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
