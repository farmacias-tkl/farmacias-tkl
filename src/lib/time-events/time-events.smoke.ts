/**
 * SMOKE de Asistencia contra una DB Postgres LOCAL EFÍMERA. NO toca Neon.
 * Datos SINTÉTICOS. Teardown garantizado (DROP al final).
 *
 *  1. El gate prisma/gates/2026-11-13-asistencia-ausencias-y-compensacion.sql
 *     aplicado sobre el esquema de main deja la base igual a schema.prisma y no
 *     cambia las filas que ya había.
 *  2. La migración de datos pasa a ausencia los registros cargados como llegada
 *     tarde con la nota "Ausencia del día completo", conserva minutos y estado,
 *     y es idempotente.
 *  3. Total por persona: cuenta lo pendiente de revisión; orden y sucursal.
 *  4. Resolver varias deudas juntas: todo o nada, AuditLog por deuda.
 *  5. Compensación por persona: reparto por antigüedad, tope, una fila por
 *     deuda tocada; deshacer; dos cargas simultáneas.
 *  6. Ausencia → deuda con las horas del turno (turno partido incluido),
 *     descuento con días, condonar; la ausencia sigue contando como ausencia.
 *  7. El banco de horas resta exactamente lo pendiente a compensar.
 *
 *   npx tsx src/lib/time-events/time-events.smoke.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";

const TEST_DB = "tkl_time_events_smoke";
const BASE_COMMIT = "e1cbcde"; // main antes de este cambio
const GATE = "prisma/gates/2026-11-13-asistencia-ausencias-y-compensacion.sql";
const MIGRATION = "prisma/gates/2026-11-13-asistencia-migracion-ausencias.sql";

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
const env = { ...process.env, DATABASE_URL: TEST_URL };

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const run = (cmd: string) => execSync(cmd, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const statementsOf = (file: string) => fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n")
  .split(";").map((x) => x.trim()).filter(Boolean);

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const actions = await import("./actions");
  const hourBank = await import("@/lib/hour-bank/actions");
  const { loadAbsences } = await import("@/lib/vacations/people");
  const adminExec = async (sql: string) => {
    const a = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    try { await a.$executeRawUnsafe(sql); } finally { await a.$disconnect(); }
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "time-events-smoke-"));
  await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${TEST_DB}"`);
  const db = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  try {
    // ---------------------------------------------------------------- 1 · gate
    const oldSchema = path.join(tmp, "schema.prisma");
    fs.writeFileSync(oldSchema, execSync(`git show ${BASE_COMMIT}:prisma/schema.prisma`, { encoding: "utf8" }));
    run(`npx prisma db push --skip-generate --schema "${oldSchema}"`);

    // Filas previas al gate, con SQL (el cliente ya conoce las columnas nuevas).
    await db.$executeRawUnsafe(`INSERT INTO "Branch" (id, name, zone, aliases, "updatedAt") VALUES ('bA', 'Sucursal A', 'CABA', '{}', now()), ('bB', 'Sucursal B', 'CABA', '{}', now())`);
    await db.$executeRawUnsafe(`INSERT INTO "Position" (id, name, "updatedAt") VALUES ('caj', 'Cajero/a', now())`);
    await db.$executeRawUnsafe(`INSERT INTO "User" (id, name, email, "passwordHash", role, "branchId", "updatedAt") VALUES
      ('sup', 'Supervisión Prueba', 'sup@example.test', 'x', 'SUPERVISOR', NULL, now()),
      ('encA', 'Encargada A Prueba', 'enca@example.test', 'x', 'BRANCH_MANAGER', 'bA', now())`);
    for (const [id, branch] of [["ana", "bA"], ["beto", "bA"], ["ceci", "bB"], ["dani", "bB"]] as const) {
      await db.$executeRawUnsafe(`INSERT INTO "Employee" (id, "firstName", "lastName", "positionId", "currentBranchId", "updatedAt")
        VALUES ('${id}', 'Nombre${id}', 'Prueba', 'caj', '${branch}', now())`);
    }
    const te = (id: string, emp: string, branch: string, date: string, minutes: number, status: string, note: string | null, comp = 0) =>
      `('${id}', '${emp}', '${branch}', 'Nombre${emp} Prueba', 'Sucursal', 'Cajero/a', '${date}', 'LATE_ARRIVAL', '${status}',
        '${date} 11:00:00', '${date} 11:00:00'::timestamp + interval '${minutes} minutes', ${minutes}, ${comp}, ${minutes - comp},
        ${note === null ? "NULL" : `'${note}'`}, 'sup', now())`;
    await db.$executeRawUnsafe(`INSERT INTO "TimeEvent" (id, "employeeId", "branchId", "employeeNameSnapshot", "branchNameSnapshot", "positionNameSnapshot",
        date, type, status, "expectedTime", "actualTime", "minutesOwed", "minutesCompensated", "minutesRemaining", "reporterNote", "reportedByUserId", "updatedAt") VALUES
      ${te("temail0001", "dani", "bB", "2027-01-04", 40, "PENDING_REVIEW", "[Mail RRHH prueba] Llegada tarde")},
      ${te("temail0002", "dani", "bB", "2027-01-05", 360, "PENDING_REVIEW", "[Mail RRHH prueba] Ausencia del día completo")},
      ${te("temail0003", "ceci", "bB", "2027-01-06", 480, "PENDING_REVIEW", "[Mail RRHH prueba] Ausencia del día completo")},
      ${te("viejo-parcial", "ceci", "bB", "2026-12-01", 90, "PARTIALLY_COMPENSATED", null, 30)}`);
    await db.$executeRawUnsafe(`INSERT INTO "TimeEventCompensation" (id, "timeEventId", date, "minutesCompensated", "registeredByUserId")
      VALUES ('comp-vieja', 'viejo-parcial', '2026-12-10', 30, 'sup')`);
    const fingerprint = async () => JSON.stringify(await Promise.all([
      db.$queryRawUnsafe(`SELECT id, "employeeId", "branchId", date, type::text, status::text, "expectedTime", "actualTime", "minutesOwed", "minutesCompensated", "minutesRemaining", "reporterNote" FROM "TimeEvent" ORDER BY id`),
      db.$queryRawUnsafe(`SELECT id, "timeEventId", date, "minutesCompensated", "registeredByUserId", note FROM "TimeEventCompensation" ORDER BY id`),
      db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "AbsenceRecord"`),
    ]));
    const before = await fingerprint();

    const gate = statementsOf(GATE);
    await check(`gate: solo BEGIN/COMMIT, ADD VALUE, ADD COLUMN/CONSTRAINT y CREATE INDEX (${gate.length} sentencias)`, async () => {
      for (const s of gate) {
        assert.match(s, /^(BEGIN|COMMIT|ALTER TYPE "TimeEventType" ADD VALUE 'ABSENCE'|CREATE (UNIQUE )?INDEX|ALTER TABLE "\w+" ADD (COLUMN|CONSTRAINT))/, s.slice(0, 80));
        const body = s.replace(/ON (DELETE|UPDATE) (RESTRICT|CASCADE|SET NULL|NO ACTION)/g, "");
        assert.doesNotMatch(body, /\b(DROP|TRUNCATE|UPDATE|DELETE|RENAME|INSERT)\b|ALTER COLUMN/i, s.slice(0, 80));
      }
    });
    await check("gate: se aplica tal cual, en una transacción", async () => {
      await db.$transaction(gate.filter((s) => s !== "BEGIN" && s !== "COMMIT").map((s) => db.$executeRawUnsafe(s)));
    });
    await check("migrate diff (DB con el gate aplicado → schema.prisma) da vacío", async () => {
      const out = run(`npx prisma migrate diff --from-url "${TEST_URL}" --to-schema-datamodel prisma/schema.prisma --script`);
      assert.match(out, /empty migration/i);
    });
    await check("el gate no cambia ninguna fila: las columnas nuevas quedan en NULL", async () => {
      assert.equal(await fingerprint(), before);
      assert.equal(await db.timeEvent.count({ where: { absenceRecordId: { not: null } } }), 0);
      assert.equal(await db.timeEventCompensation.count({ where: { batchId: { not: null } } }), 0);
    });

    // ---------------------------------------------------------------- 2 · migración de datos
    const migration = statementsOf(MIGRATION).filter((s) => s !== "BEGIN" && s !== "COMMIT");
    const runMigration = () => db.$transaction(migration.map((s) => db.$executeRawUnsafe(s)));
    await check("migración: solo INSERT en AbsenceRecord y AuditLog y UPDATE de TimeEvent, acotados a temail + nota", async () => {
      assert.equal(migration.length, 3);
      assert.match(migration[0], /^INSERT INTO "AbsenceRecord"/);
      assert.match(migration[1], /^INSERT INTO "AuditLog"/);
      assert.match(migration[2], /^UPDATE "TimeEvent"/);
      for (const s of migration) {
        assert.match(s, /LIKE 'temail%'/);
        assert.match(s, /"type" = 'LATE_ARRIVAL'/);
        assert.match(s, /LIKE '%Ausencia del día completo%'/);
        assert.doesNotMatch(s, /\b(DROP|TRUNCATE|DELETE)\b/i);
      }
    });
    await check("migración: los 2 registros pasan a Ausencia, vinculados, con los mismos minutos y estado", async () => {
      const counts = await runMigration();
      assert.deepEqual(counts, [2, 2, 2]);
      const moved = await db.timeEvent.findMany({ where: { type: "ABSENCE" }, orderBy: { id: "asc" }, include: { absenceRecord: true } });
      assert.deepEqual(moved.map((e) => `${e.id} ${e.status} ${e.minutesOwed} ${e.minutesCompensated} ${e.minutesRemaining} ${e.absenceRecordId}`),
        ["temail0002 PENDING_REVIEW 360 0 360 absmail0002", "temail0003 PENDING_REVIEW 480 0 480 absmail0003"]);
      const a = moved[0].absenceRecord!;
      assert.equal(`${a.employeeId} ${a.branchId} ${a.absenceType} ${a.status} ${a.reportedByUserId}`, "dani bB OTHER REPORTED sup");
      assert.equal(a.startDate.toISOString(), "2027-01-05T00:00:00.000Z");
      assert.equal(a.endDate.toISOString(), "2027-01-05T00:00:00.000Z");
      assert.equal(a.employeeNameSnapshot, "Nombredani Prueba");
      assert.equal(await db.auditLog.count({ where: { action: "TIME_EVENT_MIGRATED_TO_ABSENCE" } }), 2);
    });
    await check("migración: la llegada tarde del mismo mail y el resto no se tocan", async () => {
      const late = await db.timeEvent.findUniqueOrThrow({ where: { id: "temail0001" } });
      assert.equal(`${late.type} ${late.absenceRecordId} ${late.minutesOwed}`, "LATE_ARRIVAL null 40");
      const old = await db.timeEvent.findUniqueOrThrow({ where: { id: "viejo-parcial" } });
      assert.equal(`${old.type} ${old.status} ${old.minutesRemaining}`, "LATE_ARRIVAL PARTIALLY_COMPENSATED 60");
      assert.equal(await db.absenceRecord.count(), 2);
    });
    await check("migración: es idempotente (la segunda corrida no escribe nada)", async () => {
      assert.deepEqual(await runMigration(), [0, 0, 0]);
      assert.equal(await db.absenceRecord.count(), 2);
    });

    // Horarios: Ana de lunes a viernes de 8 a 14 (6 h). Beto, turno partido de 8 a 12 y de 16 a 20 (8 h).
    await db.workSchedule.create({ data: { employeeId: "ana", validFrom: D("2026-01-01"),
      slots: { create: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, slot: 1, startMinute: 480, endMinute: 840, branchId: "bA" })) } } });
    await db.workSchedule.create({ data: { employeeId: "beto", validFrom: D("2026-01-01"),
      slots: { create: [1, 2, 3, 4, 5].flatMap((d) => [
        { dayOfWeek: d, slot: 1, startMinute: 480, endMinute: 720, branchId: "bA" },
        { dayOfWeek: d, slot: 2, startMinute: 960, endMinute: 1200, branchId: "bA" },
      ]) } } });

    const SUP = { id: "sup", role: "SUPERVISOR" as const, branchId: null };
    const ENC_A = { id: "encA", role: "BRANCH_MANAGER" as const, branchId: "bA" };
    const late = (id: string, emp: string, branch: string, date: string, minutes: number) => db.timeEvent.create({ data: {
      id, employeeId: emp, branchId: branch, employeeNameSnapshot: `Nombre${emp} Prueba`, branchNameSnapshot: "Sucursal", positionNameSnapshot: "Cajero/a",
      date: D(date), type: "LATE_ARRIVAL", status: "PENDING_REVIEW",
      expectedTime: new Date(`${date}T11:00:00Z`), actualTime: new Date(new Date(`${date}T11:00:00Z`).getTime() + minutes * 60_000),
      minutesOwed: minutes, minutesRemaining: minutes, reportedByUserId: "encA" } });
    // Ana: tres deudas. La del medio se carga última a propósito (el reparto va por fecha de la deuda).
    await late("a-vieja", "ana", "bA", "2027-01-05", 60);
    await late("a-nueva", "ana", "bA", "2027-01-20", 30);
    await late("a-media", "ana", "bA", "2027-01-12", 45);
    await late("b-1", "beto", "bA", "2027-01-08", 20);
    const ev = (id: string) => db.timeEvent.findUniqueOrThrow({ where: { id } });
    const person = async (id: string, actor = SUP) => { const r = await actions.loadPerson(db, actor, id); assert.ok(r.ok); return r.data; };

    // ---------------------------------------------------------------- 3 · total por persona
    await check("saldos: cuenta lo que está pendiente de revisión, de mayor a menor pendiente", async () => {
      const rows = await actions.loadBalances(db, SUP);
      assert.deepEqual(rows.map((r) => `${r.employeeId}:${r.pending}`), ["ceci:540", "dani:400", "ana:135", "beto:20"]);
      const ana = rows.find((r) => r.employeeId === "ana")!;
      assert.equal(`${ana.owed} ${ana.compensated} ${ana.inReview} ${ana.toCompensate} ${ana.payroll}`, "135 0 135 0 0");
      const ceci = rows.find((r) => r.employeeId === "ceci")!;
      assert.equal(`${ceci.owed} ${ceci.compensated} ${ceci.inReview} ${ceci.toCompensate}`, "570 30 480 60");
    });
    await check("saldos: filtro por sucursal; el encargado solo ve la suya", async () => {
      assert.deepEqual((await actions.loadBalances(db, SUP, { branchId: "bA" })).map((r) => r.employeeId), ["ana", "beto"]);
      assert.deepEqual((await actions.loadBalances(db, ENC_A, { branchId: "bB" })).map((r) => r.employeeId), ["ana", "beto"]);
      const other = await actions.loadPerson(db, ENC_A, "ceci");
      assert.ok(other.ok);
      assert.equal(other.data.events.length, 0, "el encargado no ve deudas registradas en otra sucursal");
    });

    // ---------------------------------------------------------------- 4 · resolver varias
    await check("resolver varias: descuento y condonación exigen motivo; sin elegir nada, 400", async () => {
      for (const action of ["payroll", "waive"] as const) {
        const r = await actions.resolveEvents(db, SUP, { ids: ["a-vieja", "a-media"], action, note: "  " });
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.status, 400);
      }
      const none = await actions.resolveEvents(db, SUP, { ids: [], action: "compensation" });
      assert.equal(none.ok, false);
      assert.equal((await ev("a-vieja")).status, "PENDING_REVIEW");
    });
    await check("resolver varias: aprobar compensación de las tres de Ana con una nota común; AuditLog e historial por cada una", async () => {
      const r = await actions.resolveEvents(db, SUP, { ids: ["a-vieja", "a-media", "a-nueva", "a-vieja"], action: "compensation", note: "Compensa en enero" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      assert.equal(r.data.resolved, 3);
      for (const id of ["a-vieja", "a-media", "a-nueva"]) {
        const e = await ev(id);
        assert.equal(`${e.status} ${e.resolvedByUserId} ${e.resolutionNote}`, "APPROVED_FOR_COMPENSATION sup Compensa en enero");
        assert.equal(await db.auditLog.count({ where: { action: "TIME_EVENT_RESOLUTION_APPROVED", entityId: id, userId: "sup" } }), 1);
        assert.equal(await db.timeEventStateHistory.count({ where: { timeEventId: id, fromStatus: "PENDING_REVIEW", toStatus: "APPROVED_FOR_COMPENSATION" } }), 1);
      }
    });
    await check("resolver varias: todo o nada (una que no admite la resolución frena todas)", async () => {
      const r = await actions.resolveEvents(db, SUP, { ids: ["b-1", "a-vieja"], action: "waive", note: "Prueba" });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.status, 409);
      assert.equal((await ev("b-1")).status, "PENDING_REVIEW");
      assert.equal((await ev("a-vieja")).status, "APPROVED_FOR_COMPENSATION");
      assert.equal(await db.auditLog.count({ where: { action: "TIME_EVENT_WAIVED" } }), 0);
    });
    await check("resolver varias: enviar a descuento mezcla en revisión y a compensar; condonar deja el saldo en cero", async () => {
      await late("b-2", "beto", "bA", "2027-01-09", 15);
      await late("b-3", "beto", "bA", "2027-01-10", 25);
      assert.ok((await actions.resolveEvents(db, SUP, { ids: ["b-2"], action: "compensation" })).ok);
      const pay = await actions.resolveEvents(db, SUP, { ids: ["b-1", "b-2"], action: "payroll", note: "No compensa" });
      assert.ok(pay.ok, !pay.ok ? pay.error : "");
      assert.equal((await ev("b-1")).status, "SENT_TO_PAYROLL_DEDUCTION");
      assert.equal((await ev("b-2")).status, "SENT_TO_PAYROLL_DEDUCTION");
      const waive = await actions.resolveEvents(db, SUP, { ids: ["b-3"], action: "waive", note: "Corte de luz" });
      assert.ok(waive.ok);
      const w = await ev("b-3");
      assert.equal(`${w.status} ${w.minutesRemaining}`, "WAIVED 0");
      const t = (await person("beto")).totals;
      assert.equal(`${t.owed} ${t.pending} ${t.payroll} ${t.waived}`, "35 0 35 25");
    });

    // ---------------------------------------------------------------- 5 · compensación por persona
    let batch = "";
    await check("compensación por persona: 1 h 30 min salda la más vieja (1 h) y sigue con la siguiente (30 de 45 min)", async () => {
      const r = await actions.compensatePerson(db, SUP, { employeeId: "ana", minutes: 90, date: D("2027-01-25"), note: "Se quedó después de hora" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      batch = r.data.batchId;
      assert.deepEqual(r.data.applied.map((a) => `${a.eventId}:${a.minutes}:${a.newStatus}`), ["a-vieja:60:COMPENSATED", "a-media:30:PARTIALLY_COMPENSATED"]);
      assert.equal(r.data.remainingToCompensate, 45);
      const [v, me, n] = await Promise.all([ev("a-vieja"), ev("a-media"), ev("a-nueva")]);
      assert.equal(`${v.status} ${v.minutesCompensated} ${v.minutesRemaining}`, "COMPENSATED 60 0");
      assert.equal(`${me.status} ${me.minutesCompensated} ${me.minutesRemaining}`, "PARTIALLY_COMPENSATED 30 15");
      assert.equal(`${n.status} ${n.minutesCompensated} ${n.minutesRemaining}`, "APPROVED_FOR_COMPENSATION 0 30");
    });
    await check("cada deuda tocada guarda su fila (día y minutos), con el mismo lote", async () => {
      const comps = await db.timeEventCompensation.findMany({ where: { batchId: batch }, orderBy: { minutesCompensated: "desc" } });
      assert.deepEqual(comps.map((c) => `${c.timeEventId} ${c.minutesCompensated} ${c.date.toISOString().slice(0, 10)} ${c.registeredByUserId} ${c.authorizedByUserId} ${c.note}`),
        ["a-vieja 60 2027-01-25 sup sup Se quedó después de hora", "a-media 30 2027-01-25 sup sup Se quedó después de hora"]);
      assert.equal(await db.auditLog.count({ where: { action: "TIME_EVENT_COMPENSATION_ADDED", entityId: { in: ["a-vieja", "a-media"] } } }), 2);
      const t = (await person("ana")).totals;
      assert.equal(`${t.owed} ${t.compensated} ${t.pending} ${t.toCompensate} ${t.inReview}`, "135 90 45 45 0");
    });
    await check("tope: más que lo pendiente a compensar no se acepta e informa el máximo; no escribe nada", async () => {
      const r = await actions.compensatePerson(db, SUP, { employeeId: "ana", minutes: 46, date: D("2027-01-26") });
      assert.equal(r.ok, false);
      if (!r.ok) { assert.equal(r.status, 400); assert.equal(r.max, 45); assert.match(r.error, /45 min/); }
      assert.equal(await db.timeEventCompensation.count({ where: { timeEvent: { employeeId: "ana" } } }), 2);
    });
    await check("lo que está en revisión no recibe compensación: sin deudas aprobadas, no se acepta", async () => {
      const r = await actions.compensatePerson(db, SUP, { employeeId: "dani", minutes: 10, date: D("2027-01-26") });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.max, 0);
      const bad = await actions.compensatePerson(db, SUP, { employeeId: "ana", minutes: 0, date: D("2027-01-26") });
      assert.equal(bad.ok, false);
    });
    await check("la compensación por registro sigue funcionando y no acepta más que el pendiente de ese registro", async () => {
      const over = await actions.addCompensation(db, SUP, { eventId: "a-nueva", minutes: 31, date: D("2027-01-27") });
      assert.equal(over.ok, false);
      const r = await actions.addCompensation(db, SUP, { eventId: "a-nueva", minutes: 10, date: D("2027-01-27") });
      assert.ok(r.ok, !r.ok ? r.error : "");
      assert.equal(`${r.data.event.status} ${r.data.event.minutesRemaining} ${r.data.compensation.batchId}`, "PARTIALLY_COMPENSATED 20 null");
      const closed = await actions.addCompensation(db, SUP, { eventId: "a-vieja", minutes: 5, date: D("2027-01-27") });
      assert.equal(closed.ok, false);
    });

    // ---------------------------------------------------------------- 7 · banco de horas (con compensaciones a medio camino)
    await check("banco de horas: resta exactamente lo pendiente a compensar (lo que está en revisión no resta)", async () => {
      process.env.HOUR_BANK_TIME_EVENTS = "true";
      try {
        for (const id of ["ana", "beto", "ceci", "dani"]) {
          const t = (await person(id)).totals;
          const b = await hourBank.loadBalance(db, id);
          assert.equal(Math.abs(Math.round(b.timeDebt.hours * 60)), t.toCompensate, `${id}: banco ${b.timeDebt.hours} h vs a compensar ${t.toCompensate} min`);
        }
        const ana = await hourBank.loadBalance(db, "ana");
        assert.equal(Math.round(-ana.timeDebt.hours * 60), 35);
        const dani = await hourBank.loadBalance(db, "dani");
        assert.equal(Math.abs(dani.timeDebt.hours), 0, "400 min en revisión no restan");
      } finally { delete process.env.HOUR_BANK_TIME_EVENTS; }
    });

    // ---------------------------------------------------------------- 5 (sigue) · deshacer
    await check("deshacer la carga por persona: las dos deudas recuperan sus minutos; queda en AuditLog", async () => {
      const r = await actions.undoCompensation(db, SUP, { batchId: batch });
      assert.ok(r.ok, !r.ok ? r.error : "");
      assert.equal(`${r.data.undone} ${r.data.minutes}`, "2 90");
      const [v, me] = await Promise.all([ev("a-vieja"), ev("a-media")]);
      assert.equal(`${v.status} ${v.minutesCompensated} ${v.minutesRemaining}`, "APPROVED_FOR_COMPENSATION 0 60");
      assert.equal(`${me.status} ${me.minutesCompensated} ${me.minutesRemaining}`, "APPROVED_FOR_COMPENSATION 0 45");
      assert.equal(await db.timeEventCompensation.count({ where: { batchId: batch } }), 0);
      const logs = await db.auditLog.findMany({ where: { action: "TIME_EVENT_COMPENSATION_UNDONE", userId: "sup" }, orderBy: { createdAt: "asc" } });
      assert.equal(logs.length, 2);
      const d = logs[0].detail as any;
      assert.equal(`${d.minutes} ${d.date} ${d.batchId === batch} ${d.registeredByUserId} ${d.newStatus} ${d.note}`, "60 2027-01-25 true sup APPROVED_FOR_COMPENSATION Se quedó después de hora");
      assert.equal(await db.timeEventStateHistory.count({ where: { timeEventId: "a-vieja", fromStatus: "COMPENSATED", toStatus: "APPROVED_FOR_COMPENSATION" } }), 1);
    });
    await check("deshacer dos veces: la segunda no encuentra nada (404) y no cambia el saldo", async () => {
      const r = await actions.undoCompensation(db, SUP, { batchId: batch });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.status, 404);
      assert.equal((await person("ana")).totals.toCompensate, 125);
    });
    await check("deshacer una compensación puntual: una deuda con dos compensaciones queda en parcial", async () => {
      const r2 = await actions.addCompensation(db, SUP, { eventId: "a-nueva", minutes: 5, date: D("2027-01-28") });
      assert.ok(r2.ok);
      const undo = await actions.undoCompensation(db, SUP, { compensationId: r2.data.compensation.id });
      assert.ok(undo.ok, !undo.ok ? undo.error : "");
      const n = await ev("a-nueva");
      assert.equal(`${n.status} ${n.minutesCompensated} ${n.minutesRemaining}`, "PARTIALLY_COMPENSATED 10 20");
    });
    await check("dos cargas simultáneas por el máximo: entra una sola", async () => {
      const max = (await person("ana")).totals.toCompensate;
      assert.equal(max, 125);
      const rs = await Promise.all([
        actions.compensatePerson(db, SUP, { employeeId: "ana", minutes: max, date: D("2027-01-29") }),
        actions.compensatePerson(db, SUP, { employeeId: "ana", minutes: max, date: D("2027-01-29") }),
      ]);
      assert.equal(rs.filter((r) => r.ok).length, 1);
      const t = (await person("ana")).totals;
      assert.equal(`${t.owed} ${t.compensated} ${t.pending}`, "135 135 0");
      const events = (await person("ana")).events;
      assert.ok(events.every((e) => e.status === "COMPENSATED" && e.minutesRemaining === 0));
    });

    // ---------------------------------------------------------------- 6 · ausencias
    const absence = (id: string, emp: string, branch: string, start: string, end: string, type: string, status: string) => db.absenceRecord.create({ data: {
      id, employeeId: emp, branchId: branch, reportedByUserId: "encA", startDate: D(start), endDate: D(end),
      absenceType: type as any, status: status as any, employeeNameSnapshot: `Nombre${emp} Prueba`, branchNameSnapshot: "Sucursal A", positionNameSnapshot: "Cajero/a" } });
    await absence("abs-beto", "beto", "bA", "2027-02-01", "2027-02-01", "NO_SHOW", "UNJUSTIFIED"); // lunes
    await check("ausencia: la vista previa da las horas del turno de ese día (turno partido: 4 h + 4 h)", async () => {
      const p = await actions.previewAbsenceDebt(db, SUP, "abs-beto");
      assert.ok(p.ok);
      assert.equal(`${p.data.eligible} ${p.data.scheduleMinutes} ${p.data.totalDays} ${p.data.debt}`, "true 480 1 null");
    });
    await check("ausencia a compensar: genera la deuda con las horas del turno, ya aprobada y vinculada", async () => {
      const r = await actions.resolveAbsenceDebt(db, SUP, { absenceId: "abs-beto", resolution: "compensation" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      const e = r.data;
      assert.equal(`${e.type} ${e.status} ${e.minutesOwed} ${e.minutesRemaining} ${e.absenceRecordId} ${e.employeeId} ${e.branchId}`,
        "ABSENCE APPROVED_FOR_COMPENSATION 480 480 abs-beto beto bA");
      assert.equal(e.date.toISOString(), "2027-02-01T00:00:00.000Z");
      assert.equal(`${e.resolvedByUserId} ${e.reporterNote}`, "sup Ausencia del 2027-02-01 (1 día)");
      assert.ok(await db.auditLog.findFirst({ where: { action: "ABSENCE_DEBT_RESOLVED", entity: "AbsenceRecord", entityId: "abs-beto" } }));
    });
    await check("esa deuda se comporta como las demás: suma al total, se compensa por persona y resta del banco", async () => {
      const t = (await person("beto")).totals;
      assert.equal(`${t.toCompensate} ${t.pending}`, "480 480");
      const c = await actions.compensatePerson(db, SUP, { employeeId: "beto", minutes: 60, date: D("2027-02-03") });
      assert.ok(c.ok, !c.ok ? c.error : "");
      assert.equal(c.data.applied[0].type, "ABSENCE");
      process.env.HOUR_BANK_TIME_EVENTS = "true";
      try {
        const b = await hourBank.loadBalance(db, "beto");
        assert.equal(b.timeDebt.hours, -7);
        assert.equal((await person("beto")).totals.toCompensate, 420);
      } finally { delete process.env.HOUR_BANK_TIME_EVENTS; }
    });
    await check("la ausencia sigue contando como ausencia (calendario, ausentes y cruces) y no cambia", async () => {
      const a = await db.absenceRecord.findUniqueOrThrow({ where: { id: "abs-beto" } });
      assert.equal(`${a.status} ${a.absenceType}`, "UNJUSTIFIED NO_SHOW");
      // En cruces de vacaciones cuentan las licencias y enfermedades (como hasta ahora): resolver
      // las horas de una de esas ausencias no la saca de ahí ni la duplica.
      await absence("abs-beto-enf", "beto", "bA", "2027-02-04", "2027-02-04", "SICKNESS", "UNJUSTIFIED");
      const cross = async () => ((await loadAbsences(db, ["beto"], D("2027-02-04"), D("2027-02-04"))).get("beto") ?? []).length;
      assert.equal(await cross(), 1);
      const r = await actions.resolveAbsenceDebt(db, SUP, { absenceId: "abs-beto-enf", resolution: "waive", note: "Presentó certificado tarde" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      assert.equal(await cross(), 1);
      assert.equal(await db.absenceRecord.count({ where: { employeeId: "beto" } }), 2);
    });
    await check("una ausencia ya resuelta no se resuelve dos veces", async () => {
      const r = await actions.resolveAbsenceDebt(db, SUP, { absenceId: "abs-beto", resolution: "waive", note: "x" });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.status, 409);
      assert.equal(await db.timeEvent.count({ where: { absenceRecordId: "abs-beto" } }), 1);
    });
    await check("ausencia de varios días a descuento: registra los días y suma en 'enviado a descuento'", async () => {
      await absence("abs-ana", "ana", "bA", "2027-02-05", "2027-02-08", "PERSONAL_REASON", "REPORTED"); // viernes a lunes
      const p = await actions.previewAbsenceDebt(db, SUP, "abs-ana");
      assert.ok(p.ok);
      assert.deepEqual(p.data.days.map((d) => d.minutes), [360, 0, 0, 360]);
      const r = await actions.resolveAbsenceDebt(db, SUP, { absenceId: "abs-ana", resolution: "payroll", note: "Sin aviso" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      assert.equal(`${r.data.status} ${r.data.minutesOwed} ${r.data.resolutionNote}`, "SENT_TO_PAYROLL_DEDUCTION 720 Descuento de 4 días. Sin aviso");
      const t = (await person("ana")).totals;
      assert.equal(`${t.payroll} ${t.pending} ${t.owed}`, "720 0 855");
      const log = await db.auditLog.findFirstOrThrow({ where: { action: "ABSENCE_DEBT_RESOLVED", entityId: "abs-ana" } });
      assert.equal(`${(log.detail as any).days} ${(log.detail as any).minutes} ${(log.detail as any).scheduleMinutes}`, "4 720 720");
    });
    await check("horas editadas antes de confirmar; condonar exige motivo y deja el saldo en cero", async () => {
      await absence("abs-ana2", "ana", "bA", "2027-02-10", "2027-02-10", "NO_SHOW", "UNDER_REVIEW");
      const noNote = await actions.resolveAbsenceDebt(db, SUP, { absenceId: "abs-ana2", resolution: "waive" });
      assert.equal(noNote.ok, false);
      const r = await actions.resolveAbsenceDebt(db, SUP, { absenceId: "abs-ana2", resolution: "waive", minutes: 300, note: "Paro de transporte" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      assert.equal(`${r.data.status} ${r.data.minutesOwed} ${r.data.minutesRemaining}`, "WAIVED 300 0");
      assert.equal((await person("ana")).totals.waived, 300);
    });
    await check("sin horario cargado hay que indicar las horas; justificada o de otro tipo no genera deuda", async () => {
      await absence("abs-ceci", "ceci", "bB", "2027-02-01", "2027-02-01", "NO_SHOW", "UNJUSTIFIED");
      const p = await actions.previewAbsenceDebt(db, SUP, "abs-ceci");
      assert.ok(p.ok);
      assert.equal(p.data.scheduleMinutes, null);
      const no = await actions.resolveAbsenceDebt(db, SUP, { absenceId: "abs-ceci", resolution: "compensation" });
      assert.equal(no.ok, false);
      const yes = await actions.resolveAbsenceDebt(db, SUP, { absenceId: "abs-ceci", resolution: "compensation", minutes: 330 });
      assert.ok(yes.ok, !yes.ok ? yes.error : "");
      assert.equal(yes.data.minutesOwed, 330);
      await absence("abs-just", "beto", "bA", "2027-02-02", "2027-02-02", "NO_SHOW", "JUSTIFIED");
      await absence("abs-enf", "beto", "bA", "2027-02-03", "2027-02-03", "SICKNESS", "REPORTED");
      for (const id of ["abs-just", "abs-enf"]) {
        const r = await actions.resolveAbsenceDebt(db, SUP, { absenceId: id, resolution: "compensation" });
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.status, 409);
      }
      const sunday = await absence("abs-dom", "beto", "bA", "2027-02-07", "2027-02-07", "NO_SHOW", "UNJUSTIFIED");
      const zero = await actions.resolveAbsenceDebt(db, SUP, { absenceId: sunday.id, resolution: "compensation" });
      assert.equal(zero.ok, false, "según el horario no trabajaba: pide las horas");
      const tooMany = await actions.resolveAbsenceDebt(db, SUP, { absenceId: sunday.id, resolution: "compensation", minutes: 24 * 60 + 1 });
      assert.equal(tooMany.ok, false);
    });
    await check("si la deuda se cancela, la ausencia se puede volver a resolver", async () => {
      const debt = await db.timeEvent.findFirstOrThrow({ where: { absenceRecordId: "abs-ceci" } });
      await db.timeEvent.update({ where: { id: debt.id }, data: { status: "CANCELLED", minutesRemaining: 0 } });
      const p = await actions.previewAbsenceDebt(db, SUP, "abs-ceci");
      assert.ok(p.ok);
      assert.equal(p.data.debt, null);
      const r = await actions.resolveAbsenceDebt(db, SUP, { absenceId: "abs-ceci", resolution: "payroll", minutes: 360 });
      assert.ok(r.ok, !r.ok ? r.error : "");
      assert.equal(await db.timeEvent.count({ where: { absenceRecordId: "abs-ceci" } }), 1);
      assert.equal((await db.timeEvent.findUniqueOrThrow({ where: { id: debt.id } })).absenceRecordId, null);
    });
    await check("las ausencias migradas del mail se resuelven junto con el resto y se compensan por persona", async () => {
      const r = await actions.resolveEvents(db, SUP, { ids: ["temail0001", "temail0002"], action: "compensation", note: "Compensa" });
      assert.ok(r.ok, !r.ok ? r.error : "");
      const c = await actions.compensatePerson(db, SUP, { employeeId: "dani", minutes: 100, date: D("2027-02-04") });
      assert.ok(c.ok, !c.ok ? c.error : "");
      assert.deepEqual(c.data.applied.map((a) => `${a.eventId}:${a.type}:${a.minutes}`), ["temail0001:LATE_ARRIVAL:40", "temail0002:ABSENCE:60"]);
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
