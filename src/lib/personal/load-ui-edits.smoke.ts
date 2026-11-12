/**
 * SMOKE contra una DB Postgres LOCAL EFÍMERA. NO toca Neon. Datos SINTÉTICOS.
 * Teardown garantizado (DROP al final).
 *
 * La carga de personal no pisa lo que se editó en la plataforma:
 *   carga inicial → edición en la plataforma (el AuditLog que escribe
 *   PATCH /api/employees/[id]) → la carga siguiente no la pisa y la muestra
 *   como conflicto → la carga que le sigue TAMPOCO la pisa (aunque la anterior
 *   ya sea "la última carga") → con --overwrite-ui-edits sí se pisa.
 *
 *   npx tsx src/lib/personal/load-ui-edits.smoke.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";

const TEST_DB = "tkl_load_ui_edits_smoke";

function abort(m: string): never { console.error("ABORT:", m); process.exit(1); }
const m = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+?)"?\s*$/m);
if (!m) abort("No encontré DATABASE_URL en .env");
const baseUrl = m[1].trim();
if (!["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname)) abort(`SAFETY ABORT: ${new URL(baseUrl).hostname} no es local. NUNCA Neon.`);
const adminUrl = new URL(baseUrl); adminUrl.pathname = "/postgres";
const testUrl = new URL(baseUrl); testUrl.pathname = `/${TEST_DB}`;
const TEST_URL = testUrl.toString();
process.env.DATABASE_URL = TEST_URL;
const env = { ...process.env, DATABASE_URL: TEST_URL };

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const D = (s: string) => new Date(`${s}T00:00:00Z`);

const EMP_H = "apellido_nombre,contrato,trabaja_en,puesto,puesto_secundario,dt,rotativo,horas_semanales,fecha_ingreso,situacion,situacion_desde,situacion_hasta,tareas_adicionales";
const HOR_H = "apellido_nombre,contrato,vigente_desde,semana,referencia_ab,dia,tramo,entrada,salida,sucursal,otro_lugar";
const SAL = "apellido_nombre,contrato,anio,dias";
const emp = (rows: string[]) => [EMP_H, ...rows].join("\n");
const CAJERA = `"Cajera, Uno",TEK,TEK,Cajero/a,,N,N,40,2019-05-01,Activo/a,,,`;
const OTRA = `"Cajera, Dos",TEK,TEK,Cajero/a,,N,N,,,Activo/a,,,`;
const BAJA = `"Cajera, Tres",TEK,TEK,Cajero/a,,N,N,,,Activo/a,,,`;
const HOR = [HOR_H, ...[1, 2, 3].map((d) => `"Cajera, Uno",TEK,2026-01-01,TODAS,,${d},1,08:00,14:00,,`)].join("\n");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { buildLoadPlan } = await import("./load-plan");
  const { loadSnapshot, applyLoadPlan } = await import("./load-apply");
  const adminExec = async (sql: string) => {
    const a = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    try { await a.$executeRawUnsafe(sql); } finally { await a.$disconnect(); }
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "load-ui-edits-smoke-"));
  await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${TEST_DB}"`);
  const db = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  try {
    execSync("npx prisma db push --skip-generate", { env, stdio: ["ignore", "pipe", "pipe"] });
    await db.branch.createMany({ data: [
      { id: "b-tek", name: "Tekiel", code: "TEK", zone: "CABA" },
      { id: "b-gal", name: "Galesa", code: "GAL", zone: "CABA" },
    ] });
    await db.user.create({ data: { id: "u1", name: "Supervisión Prueba", email: "sup@example.test", passwordHash: "x", role: "SUPERVISOR" } });

    const load = async (rows: string[], opts: { overwriteUiEdits?: boolean } = {}, hor = HOR) => {
      const plan = buildLoadPlan({ "empleados.csv": emp(rows), "horarios.csv": hor, "saldos.csv": SAL }, await loadSnapshot(db), opts);
      assert.equal(plan.errors.length, 0, JSON.stringify(plan.errors));
      const result = await applyLoadPlan(db, plan, { userId: "u1" });
      return { plan, result };
    };
    const uno = () => db.employee.findFirstOrThrow({ where: { nameKey: "cajera, uno" }, include: { position: true, secondaryPosition: true } });
    const loads = () => db.auditLog.findMany({ where: { action: "PERSONAL_LOAD" }, orderBy: { createdAt: "asc" } });
    /** Lo mismo que hace PATCH /api/employees/[id]: actualiza y deja AuditLog UPDATE con { campo: { from, to } }. */
    const platformEdit = async (employeeId: string, data: Record<string, unknown>, unchanged: string[] = []) => {
      const before: any = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
      await db.employee.update({ where: { id: employeeId }, data });
      const detail: Record<string, unknown> = {};
      for (const k of unchanged) detail[k] = { from: before[k], to: before[k] instanceof Object && "toNumber" in before[k] ? before[k].toNumber() : before[k] };
      for (const [k, v] of Object.entries(data)) detail[k] = { from: before[k], to: v };
      await db.auditLog.create({ data: { userId: "u1", action: "UPDATE", entity: "Employee", entityId: employeeId, detail: JSON.parse(JSON.stringify(detail)) } });
    };

    await check("carga inicial: 3 personas y queda registrada como PERSONAL_LOAD", async () => {
      const { result, plan } = await load([CAJERA, OTRA, BAJA]);
      assert.equal(result.employeesCreated, 3);
      assert.equal(plan.conflicts.length, 0);
      assert.equal((await loads()).length, 1);
    });

    const e1 = await uno();
    const perf = await db.position.findFirstOrThrow({ where: { name: "Perfumería" } });
    const tres = await db.employee.findFirstOrThrow({ where: { nameKey: "cajera, tres" } });

    await check("edición en la plataforma: se la marca rotativa (el formulario manda también campos sin cambio)", async () => {
      await platformEdit(e1.id, { isRotating: true }, ["firstName", "positionId", "weeklyHours", "isTechnicalDirector"]);
      assert.equal((await uno()).isRotating, true);
    });

    await check("la carga siguiente NO la devuelve a \"no rotativa\" y lo muestra como conflicto", async () => {
      const { plan, result } = await load([CAJERA, OTRA, BAJA]);
      assert.equal((await uno()).isRotating, true);
      assert.deepEqual(plan.conflicts.map((c) => `${c.field}:${c.platform}>${c.csv}:${c.overwritten}`), ["rotativo:S>N:false"]);
      // Los campos que el formulario mandó sin cambiar (horas, puesto, DT) no son conflicto.
      assert.equal(result.employeesUpdated, 0);
      assert.equal((await loads()).length, 1, "no escribió nada: no hay PERSONAL_LOAD nuevo");
    });

    await check("vista previa del CLI: lista el conflicto y avisa que no se pisa", async () => {
      const dir = path.join(tmp, "datos");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "empleados.csv"), emp([CAJERA, OTRA, BAJA]));
      fs.writeFileSync(path.join(dir, "horarios.csv"), HOR);
      fs.writeFileSync(path.join(dir, "saldos.csv"), SAL);
      const out = execSync(`npx tsx scripts/load-personal.ts --dir "${dir}"`, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      assert.match(out, /Conflictos con cambios hechos en la plataforma.*: 1/);
      assert.match(out, /conflicto empleados\.csv:2 {2}Cajera, Uno · rotativo: plataforma "S".*planilla "N" → no se pisa/);
      assert.match(out, /Dry-run: no se escribió nada/);
      const forced = execSync(`npx tsx scripts/load-personal.ts --dir "${dir}" --overwrite-ui-edits`, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      assert.match(forced, /SE PISAN/);
      assert.match(forced, /→ se pisa/);
      assert.equal((await uno()).isRotating, true, "el dry-run con el flag tampoco escribe");
    });

    await check("más ediciones: puesto secundario, DT, tareas, horas y baja de otra persona", async () => {
      await platformEdit(e1.id, { secondaryPositionId: perf.id, isTechnicalDirector: true, extraTasks: "caja chica", weeklyHours: 36 });
      await platformEdit(tres.id, { active: false });
    });

    await check("carga con otros cambios en la planilla: aplica esos y respeta lo editado", async () => {
      // La planilla cambia la fecha de ingreso de Uno y las horas de Dos; lo demás sigue viejo.
      const { plan, result } = await load([CAJERA.replace("2019-05-01", "2019-06-01"), OTRA.replace(",N,N,,,", ",N,N,30,,"), BAJA]);
      assert.equal(result.employeesUpdated, 2);
      const e = await uno();
      assert.equal(e.hireDate?.toISOString().slice(0, 10), "2019-06-01", "el campo no editado se actualiza");
      assert.equal(e.isRotating, true);
      assert.equal(e.secondaryPosition?.name, "Perfumería");
      assert.equal(e.isTechnicalDirector, true);
      assert.equal(e.extraTasks, "caja chica");
      assert.equal(Number(e.weeklyHours), 36);
      assert.equal((await db.employee.findUniqueOrThrow({ where: { id: tres.id } })).active, false, "la baja no se revierte");
      assert.deepEqual(plan.conflicts.map((c) => c.field).sort(),
        ["activo", "dt", "horas_semanales", "puesto_secundario", "rotativo", "tareas_adicionales"]);
      const all = await loads();
      assert.equal(all.length, 2);
      const kept = (all[1].detail as any).keptUiEdits as Array<{ employeeId: string; field: string }>;
      assert.equal(kept.length, 6);
      assert.ok(kept.some((k) => k.employeeId === e1.id && k.field === "rotativo"));
      assert.equal((all[1].detail as any).employeesUpdated, 2);
    });

    await check("la carga que le sigue TAMPOCO pisa (la anterior ya es \"la última\", sin ediciones nuevas)", async () => {
      const { plan, result } = await load([CAJERA.replace("2019-05-01", "2019-06-01"), OTRA.replace(",N,N,,,", ",N,N,31,,"), BAJA]);
      assert.equal(result.employeesUpdated, 1); // solo las horas de Dos
      const e = await uno();
      assert.equal(e.isRotating, true);
      assert.equal(e.isTechnicalDirector, true);
      assert.equal(Number(e.weeklyHours), 36);
      assert.equal((await db.employee.findUniqueOrThrow({ where: { id: tres.id } })).active, false);
      assert.equal(plan.conflicts.length, 6);
      assert.equal((await loads()).length, 3);
    });

    await check("cuando la planilla se corrige y coincide, deja de ser conflicto", async () => {
      const fixed = `"Cajera, Uno",TEK,TEK,Cajero/a,Perfumería,S,S,36,2019-06-01,Activo/a,,,caja chica`;
      const { plan } = await load([fixed, OTRA.replace(",N,N,,,", ",N,N,31,,"), BAJA]);
      assert.deepEqual(plan.conflicts.map((c) => c.field), ["activo"]);
      assert.equal(plan.employees.find((x) => x.data.nameKey === "cajera, uno")!.action, "unchanged");
    });

    await check("--overwrite-ui-edits: pisa con la planilla y deja constancia de qué pisó", async () => {
      const { plan, result } = await load([CAJERA.replace("2019-05-01", "2019-06-01"), OTRA.replace(",N,N,,,", ",N,N,31,,"), BAJA], { overwriteUiEdits: true });
      assert.equal(result.employeesUpdated, 2);
      const e = await uno();
      assert.equal(e.isRotating, false);
      assert.equal(e.secondaryPositionId, null);
      assert.equal(e.isTechnicalDirector, false);
      assert.equal(e.extraTasks, null);
      assert.equal(Number(e.weeklyHours), 40);
      assert.equal((await db.employee.findUniqueOrThrow({ where: { id: tres.id } })).active, true);
      assert.ok(plan.conflicts.every((c) => c.overwritten));
      const last = (await loads()).pop()!;
      assert.equal(((last.detail as any).keptUiEdits as unknown[]).length, 0);
      const over = (last.detail as any).overwrittenUiEdits as Array<{ field: string; platform: string; csv: string }>;
      assert.ok(over.some((o) => o.field === "rotativo" && o.platform === "S" && o.csv === "N"));
    });

    await check("después de pisar, lo pisado ya no figura como conflicto", async () => {
      const { plan, result } = await load([CAJERA.replace("2019-05-01", "2019-06-01"), OTRA.replace(",N,N,,,", ",N,N,31,,"), BAJA]);
      assert.equal(plan.conflicts.length, 0);
      assert.ok(Object.values(result).every((n) => n === 0), JSON.stringify(result));
    });

    await check("sucursal cambiada en la plataforma: no vuelve a la de la planilla y el horario nuevo usa la de la plataforma", async () => {
      await platformEdit(e1.id, { currentBranchId: "b-gal" });
      const hor = [HOR, `"Cajera, Uno",TEK,2026-12-01,TODAS,,1,1,09:00,15:00,,`].join("\n");
      const { plan } = await load([CAJERA.replace("2019-05-01", "2019-06-01"), OTRA.replace(",N,N,,,", ",N,N,31,,"), BAJA], {}, hor);
      assert.equal((await uno()).currentBranchId, "b-gal");
      assert.ok(plan.conflicts.some((c) => c.field === "trabaja_en" && c.platform === "Galesa" && c.csv === "Tekiel"));
      const s = await db.workSchedule.findFirstOrThrow({ where: { employeeId: e1.id, validFrom: D("2026-12-01") }, include: { slots: true } });
      assert.deepEqual(s.slots.map((x) => x.branchId), ["b-gal"]);
      // No se abrió una asignación PERMANENT de vuelta a Tekiel.
      assert.equal(await db.employeeBranchAssignment.count({ where: { employeeId: e1.id, reason: { contains: "cambio de sucursal" } } }), 0);
    });

    await check("licencia cargada en la plataforma: la de la planilla para ese período no se suma encima", async () => {
      const dos = await db.employee.findFirstOrThrow({ where: { nameKey: "cajera, dos" } });
      const abs = await db.absenceRecord.create({ data: {
        employeeId: dos.id, branchId: "b-tek", employeeNameSnapshot: "x", branchNameSnapshot: "x", positionNameSnapshot: "x",
        reportedByUserId: "u1", startDate: D("2026-11-10"), endDate: D("2026-11-14"), absenceType: "MEDICAL_LEAVE",
      } });
      await db.auditLog.create({ data: { userId: "u1", action: "CREATE", entity: "AbsenceRecord", entityId: abs.id, detail: { type: "MEDICAL_LEAVE" } } });
      const lic = `"Cajera, Dos",TEK,TEK,Cajero/a,,N,N,31,,Licencia médica,2026-11-10,2026-11-20,`;
      const rows = [CAJERA.replace("2019-05-01", "2019-06-01"), lic, BAJA];
      const { plan, result } = await load(rows);
      assert.equal(result.leavesCreated, 0);
      assert.equal(await db.absenceRecord.count({ where: { employeeId: dos.id } }), 1);
      assert.ok(plan.conflicts.some((c) => c.field === "situacion" && !c.overwritten));
      const forced = await load(rows, { overwriteUiEdits: true });
      assert.equal(forced.result.leavesCreated, 1);
    });

    await check("horario editado en la plataforma (AuditLog WorkSchedule): la planilla no crea otro encima", async () => {
      const s = await db.workSchedule.findFirstOrThrow({ where: { employeeId: e1.id, validFrom: D("2026-12-01") } });
      await db.auditLog.create({ data: { userId: "u1", action: "UPDATE", entity: "WorkSchedule", entityId: s.id, detail: {} } });
      const hor = [HOR, `"Cajera, Uno",TEK,2026-12-01,TODAS,,1,1,09:00,15:00,,`, `"Cajera, Uno",TEK,2027-01-01,TODAS,,2,1,09:00,15:00,,`].join("\n");
      const before = await db.workSchedule.count({ where: { employeeId: e1.id } });
      const { plan } = await load([CAJERA.replace("2019-05-01", "2019-06-01"), OTRA.replace(",N,N,,,", ",N,N,31,,"), BAJA], {}, hor);
      assert.ok(plan.conflicts.some((c) => c.field === "horario" && !c.overwritten));
      assert.equal(await db.workSchedule.count({ where: { employeeId: e1.id } }), before);
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
