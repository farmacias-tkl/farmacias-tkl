/**
 * SMOKE de la carga en lote de solicitudes de vacaciones contra una DB
 * Postgres LOCAL EFÍMERA. NO toca Neon. Datos SINTÉTICOS.
 *
 * 1. Validación igual a la de la API: las advertencias y los bloqueos del plan
 *    son los de validateVacationRequest, y lo que se guarda es lo mismo que
 *    arma POST /api/vacations (vacationRequestCreateData).
 * 2. Errores: persona inexistente, inactiva, fechas invertidas, la misma
 *    persona con una solicitud activa superpuesta (en la base y dentro del
 *    archivo). Con un solo error no se escribe nada.
 * 3. Idempotencia: misma persona y mismas fechas no rechazada ni cancelada =
 *    "ya existe"; la segunda corrida no escribe.
 * 4. El saldo no se toca. Historial y auditoría por solicitud.
 * 5. CLI: dry-run (sale 0 / 1), --apply sin --actor (sale 2).
 * 6. Consultas: el apply hace pocas consultas sin importar la cantidad de filas.
 * Teardown garantizado (DROP al final).
 *
 *   npx tsx src/lib/vacations/bulk-requests.smoke.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";

const TEST_DB = "tkl_vacation_bulk_smoke";

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
const env = { ...process.env, DATABASE_URL: TEST_URL };

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const run = (cmd: string) => execSync(cmd, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const H = "apellido_nombre,contrato,desde,hasta,nota";

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const adminExec = async (sql: string) => {
    const a = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    try { await a.$executeRawUnsafe(sql); } finally { await a.$disconnect(); }
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vac-bulk-smoke-"));
  await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${TEST_DB}"`);
  const db = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  try {
    run(`npx prisma db push --skip-generate`);
    const { planVacationRequests, applyVacationRequests, formatRequestsReport, planHasErrors } = await import("./bulk-requests");
    const { validateVacationRequest } = await import("./validation");
    const { warningMessages } = await import("./rules");
    const { vacationRequestCreateData } = await import("./create");

    // --- Base sintética
    await db.branch.createMany({ data: [
      { id: "bT", name: "Tekiel", code: "TEK", zone: "CABA" },
      { id: "bF", name: "Facultad", code: "AYA", zone: "CABA" },
    ] });
    await db.position.create({ data: { id: "pC", name: "Cajero/a" } });
    await db.user.createMany({ data: [
      { id: "uS", name: "Supervisora Prueba", email: "sup@example.test", passwordHash: "x", role: "SUPERVISOR" },
      { id: "uH", name: "RRHH Prueba", email: "rrhh@example.test", passwordHash: "x", role: "HR" },
    ] });
    const emp = (id: string, last: string, first: string, extra: Record<string, unknown> = {}) => ({
      id, firstName: first, lastName: last, nameKey: `${last.toLowerCase()}, ${first.toLowerCase()}`,
      contractBranchId: "bT", currentBranchId: "bT", positionId: "pC", ...extra,
    });
    await db.employee.createMany({ data: [
      emp("e1", "Cajera", "Uno"), emp("e2", "Cajera", "Dos"), emp("e3", "Cajera", "Tres"),
      emp("e4", "Cajera", "Cuatro"), emp("e5", "Cajera", "Cinco"), emp("e6", "Inactiva", "Ana", { active: false }),
      emp("eR", "Rotativo", "Uno", { isRotating: true }),
    ] });
    const schedule = async (employeeId: string, from: number, to: number) => db.workSchedule.create({ data: {
      employeeId, validFrom: D("2026-01-01"),
      slots: { create: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, slot: 1, startMinute: from * 60, endMinute: to * 60, branchId: "bT" })) },
    } });
    await schedule("e1", 8, 14); await schedule("e2", 12, 18); await schedule("e3", 18, 22);
    await db.vacationBalance.createMany({ data: [
      { employeeId: "e1", year: 2025, days: 30 }, { employeeId: "e2", year: 2025, days: 30 },
      { employeeId: "e3", year: 2025, days: 5 }, { employeeId: "e5", year: 2025, days: 21 },
    ] });
    const snapshot = { employeeNameSnapshot: "x", branchNameSnapshot: "Tekiel", positionNameSnapshot: "Cajero/a", requestedByUserId: "uS", branchId: "bT", positionId: "pC" };
    await db.vacationRequest.create({ data: { ...snapshot, id: "v-dos", employeeId: "e2", startDate: D("2026-11-09"), endDate: D("2026-11-22"), daysCount: 14, status: "APPROVED" } });
    await db.vacationRequest.create({ data: { ...snapshot, id: "v-cinco", employeeId: "e5", startDate: D("2026-12-07"), endDate: D("2026-12-13"), daysCount: 7, status: "PENDING_SUPERVISOR" } });
    await db.vacationRequest.create({ data: { ...snapshot, id: "v-cinco-rech", employeeId: "e5", startDate: D("2027-01-04"), endDate: D("2027-01-10"), daysCount: 7, status: "REJECTED" } });

    const balanceFingerprint = async () => JSON.stringify([
      await db.vacationBalance.findMany({ orderBy: [{ employeeId: "asc" }, { year: "asc" }], select: { employeeId: true, year: true, days: true } }),
      await db.vacationBalanceMovement.count(),
    ]);
    const balancesBefore = await balanceFingerprint();

    const OK_ROWS = [
      `"Cajera, Uno",TEK,2026-11-02,2026-11-15,"Pedido por mail, gracias"`,  // lunes, 14 días; cruza con Cajera Dos (aprobada)
      `"Cajera, Tres",TEK,03/11/2026,12/11/2026,`,                           // martes, 10 días, saldo 5
      `"Cajera, Cinco",TEK,2026-12-07,2026-12-13,`,                          // ya existe (solicitada)
      `"Cajera, Cinco",TEK,2027-01-04,2027-01-10,reintento`,                 // la igual está rechazada: se crea
    ];
    const BAD_ROWS = [
      `"Cajera, Dos",TEK,2026-11-16,2026-11-29,`,      // superpuesta con su aprobada
      `"Noexiste, Persona",TEK,2026-11-02,2026-11-08,`, // no existe
      `"Inactiva, Ana",TEK,2026-11-02,2026-11-08,`,     // inactiva
      `"Cajera, Cuatro",TEK,2026-12-20,2026-12-10,`,    // fechas invertidas
      `"Cajera, Cuatro",AYA,2026-11-02,2026-11-08,`,    // existe el nombre pero con otro contrato
      `"Cajera, Uno",TEK,2026-11-09,2026-11-22,`,       // se pisa con la línea 2 del archivo
    ];
    const csv = (rows: string[]) => [H, ...rows].join("\r\n");

    // ------------------------------------------------------------- 1 y 2
    const bad = await planVacationRequests(db, csv([...OK_ROWS, ...BAD_ROWS]));
    const line = (n: number) => bad.rows.find((r) => r.line === n)!;
    await check("bloqueos: superpuesta con su solicitud activa, inexistente, inactiva, fechas invertidas, otro contrato", async () => {
      assert.equal(line(6).action, "error"); assert.match(line(6).errors.join(" "), /Ya tiene una solicitud activa/);
      assert.match(line(7).errors.join(" "), /No existe "Noexiste, Persona"/);
      assert.match(line(8).errors.join(" "), /inactivo/);
      assert.match(line(9).errors.join(" "), /fecha fin es anterior/);
      assert.match(line(10).errors.join(" "), /No existe "Cajera, Cuatro" con contrato/);
    });
    await check("la misma persona dos veces en el archivo con fechas que se pisan → error en las dos líneas", async () => {
      assert.match(line(11).errors.join(" "), /línea 2 del archivo/);
      assert.match(line(2).errors.join(" "), /línea 11 del archivo/);
    });
    await check("con un solo error, apply no escribe nada", async () => {
      const before = await db.vacationRequest.count();
      assert.ok(planHasErrors(bad));
      await assert.rejects(applyVacationRequests(db, bad, { userId: "uS" }), /errores/);
      assert.equal(await db.vacationRequest.count(), before);
    });

    const plan = await planVacationRequests(db, csv(OK_ROWS));
    await check("plan limpio: 3 a crear, 1 ya existe (la rechazada igual no cuenta), sin errores", async () => {
      assert.deepEqual(plan.totals, { create: 3, exists: 1, error: 0 });
      assert.equal(plan.rows.find((r) => r.line === 4)!.action, "exists");
      assert.equal(plan.rows.find((r) => r.line === 4)!.existingId, "v-cinco");
      assert.equal(plan.rows.find((r) => r.line === 5)!.action, "create");
    });
    await check("validación igual a la de la API: mismas advertencias y mismos datos guardados", async () => {
      for (const r of plan.rows.filter((x) => x.action === "create")) {
        const v = await validateVacationRequest({ employeeId: r.employee!.id, startDate: D(r.startDate!), endDate: D(r.endDate!) }, db);
        assert.deepEqual(r.warnings, warningMessages(v), `línea ${r.line}`);
        assert.equal(r.days, v.calculatedDays);
      }
      const uno = plan.rows.find((r) => r.line === 2)!;
      assert.ok(uno.warnings.some((w) => /Dos Cajera.*misma franja/.test(w)), uno.warnings.join(" | "));
      assert.equal(uno.balanceNow, 30); assert.equal(uno.balanceAfter, 16);
      const tres = plan.rows.find((r) => r.line === 3)!;
      assert.equal(tres.startDate, "2026-11-03");
      assert.ok(tres.warnings.some((w) => /No empieza un lunes/.test(w)));
      assert.ok(tres.warnings.some((w) => /no es múltiplo de 7/.test(w)));
      assert.ok(tres.warnings.some((w) => /Saldo insuficiente/.test(w)));
      assert.equal(tres.balanceAfter, -5);
    });
    await check("informe del dry-run por sucursal con totales", async () => {
      const out = formatRequestsReport(bad);
      assert.match(out, /== Tekiel \(/);
      assert.match(out, /línea 2 · ERROR · Cajera, Uno · 2026-11-02 → 2026-11-15 · 14 días/);
      assert.match(out, /a crear: \d+ · ya existentes: 1 · con error: \d+/);
    });

    // ------------------------------------------------------------- 3 y 4
    const counted = new PrismaClient({ datasources: { db: { url: TEST_URL } }, log: [{ emit: "event", level: "query" }] });
    let queries = 0;
    counted.$on("query", () => { queries++; });
    try {
      await check("apply: crea 3 Solicitadas con advertencias guardadas, historial y auditoría, en pocas consultas", async () => {
        queries = 0;
        const steps: string[] = [];
        const r = await applyVacationRequests(counted, plan, { userId: "uS" }, { onProgress: (s) => steps.push(s) });
        console.log(`      apply (3 solicitudes): ${queries} consultas`);
        assert.deepEqual(r, { created: 3, existing: 1 });
        assert.ok(queries <= 10, `hizo ${queries} consultas`);
        const v = await db.vacationRequest.findFirstOrThrow({ where: { employeeId: "e1", startDate: D("2026-11-02") } });
        assert.equal(v.status, "PENDING_SUPERVISOR");
        assert.equal(v.requestedByUserId, "uS");
        assert.equal(v.requesterNote, "Pedido por mail, gracias");
        assert.equal(v.daysCount, 14);
        assert.equal(v.branchNameSnapshot, "Tekiel");
        assert.equal(v.conflictLevel, "WARNING");
        const row = plan.rows.find((x) => x.line === 2)!;
        const expected = vacationRequestCreateData({ employee: row.employee!, startDate: D(row.startDate!), endDate: D(row.endDate!),
          requesterNote: row.note, validation: row.validation!, requestedByUserId: "uS" });
        assert.deepEqual(v.conflictReasons, JSON.parse(JSON.stringify(expected.conflictReasons)));
        assert.equal(await db.vacationStateHistory.count({ where: { vacationId: v.id, fromStatus: "PENDING_SUPERVISOR", toStatus: "PENDING_SUPERVISOR" } }), 1);
        assert.equal(await db.auditLog.count({ where: { action: "VACATION_REQUEST_CREATED" } }), 3);
        assert.ok(steps.length >= 2);
      });
      await check("no toca el saldo (ni balances ni movimientos)", async () => {
        assert.equal(await balanceFingerprint(), balancesBefore);
      });
      await check("idempotencia: la segunda corrida informa 4 \"ya existe\" y no escribe", async () => {
        const again = await planVacationRequests(db, csv(OK_ROWS));
        assert.deepEqual(again.totals, { create: 0, exists: 4, error: 0 });
        const audits = await db.auditLog.count();
        const r = await applyVacationRequests(db, again, { userId: "uS" });
        assert.deepEqual(r, { created: 0, existing: 4 });
        assert.equal(await db.auditLog.count(), audits);
      });

      // ------------------------------------------------------------- 5
      const dir = path.join(tmp, "datos");
      fs.mkdirSync(dir);
      await check("CLI: dry-run sin errores sale 0 y no escribe; con errores sale 1; --apply sin --actor sale 2; RRHH no puede ser actor", async () => {
        fs.writeFileSync(path.join(dir, "solicitudes.csv"), csv(OK_ROWS));
        const before = await db.vacationRequest.count();
        const out = run(`npx tsx scripts/load-vacation-requests.ts --dir "${dir}"`);
        assert.match(out, /Dry-run: no se escribió nada/);
        assert.match(out, /a crear: 0 · ya existentes: 4 · con error: 0/);
        fs.writeFileSync(path.join(dir, "solicitudes.csv"), csv(BAD_ROWS));
        try { run(`npx tsx scripts/load-vacation-requests.ts --dir "${dir}"`); assert.fail("no falló"); }
        catch (e: any) { assert.equal(e.status, 1); assert.match(e.stdout, /Hay errores: no se escribe nada/); }
        try { run(`npx tsx scripts/load-vacation-requests.ts --dir "${dir}" --apply --host localhost`); assert.fail("no falló"); }
        catch (e: any) { assert.equal(e.status, 2); }
        try { run(`npx tsx scripts/load-vacation-requests.ts --dir "${dir}" --apply --host localhost --actor rrhh@example.test`); assert.fail("no falló"); }
        catch (e: any) { assert.equal(e.status, 2); assert.match(e.stderr, /no puede crear solicitudes/); }
        assert.equal(await db.vacationRequest.count(), before);
      });
      await check("CLI --apply crea y queda confirmado; advierte \"sin rotativo libre\" sin bloquear", async () => {
        // El único rotativo está de vacaciones en ese período.
        await db.vacationRequest.create({ data: { ...snapshot, employeeId: "eR", startDate: D("2027-02-01"), endDate: D("2027-02-14"), daysCount: 14, status: "APPROVED" } });
        fs.writeFileSync(path.join(dir, "solicitudes.csv"), csv([`"Cajera, Cuatro",TEK,2027-02-01,2027-02-14,por mail`]));
        const out = run(`npx tsx scripts/load-vacation-requests.ts --dir "${dir}" --apply --host localhost --actor sup@example.test`);
        assert.match(out, /advertencia: No hay ningún rotativo libre/);
        assert.match(out, /transacción confirmada/);
        assert.equal(await db.vacationRequest.count({ where: { employeeId: "e4", status: "PENDING_SUPERVISOR" } }), 1);
      });

      // ------------------------------------------------------------- 6
      await check("volumen: 60 solicitudes → el apply sigue en pocas consultas", async () => {
        await db.employee.createMany({ data: Array.from({ length: 60 }, (_, i) => emp(`ev${i}`, "Volumen", `Persona${String(i).padStart(2, "0")}`)) });
        const rows = Array.from({ length: 60 }, (_, i) => `"Volumen, Persona${String(i).padStart(2, "0")}",TEK,2027-03-01,2027-03-07,`);
        queries = 0;
        const t0 = Date.now();
        const p = await planVacationRequests(counted, csv(rows));
        const planQueries = queries, planMs = Date.now() - t0;
        assert.deepEqual(p.totals, { create: 60, exists: 0, error: 0 });
        queries = 0;
        const t1 = Date.now();
        const r = await applyVacationRequests(counted, p, { userId: "uS" });
        console.log(`      volumen: plan ${planQueries} consultas (${planMs} ms, fuera de la transacción) · apply ${queries} consultas (${Date.now() - t1} ms)`);
        assert.equal(r.created, 60);
        assert.ok(queries <= 10, `apply hizo ${queries} consultas`);
        assert.equal(await balanceFingerprint(), balancesBefore);
      });
    } finally {
      await counted.$disconnect();
    }
  } finally {
    await db.$disconnect();
    await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n${pass} ok, ${fails.length} fallaron${fails.length ? `: ${fails.join(" · ")}` : ""}`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
