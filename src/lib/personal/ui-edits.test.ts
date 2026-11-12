/**
 * Tests PUROS: la carga de personal no pisa lo que se editó en la plataforma.
 * (ui-edits.ts + los conflictos de load-plan.ts). Datos SINTÉTICOS: ningún dato real.
 *
 *   npx tsx src/lib/personal/ui-edits.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
import { buildLoadPlan, formatPlanReport, type DbSnapshot, type SnapshotEmployee } from "./load-plan";
import { POSITION_CATALOG } from "./catalog";
import { employeeUiEdits, keptUiEditsOf, type AuditRow, type UiEdit } from "./ui-edits";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

const EMP_H = "apellido_nombre,contrato,trabaja_en,puesto,puesto_secundario,dt,rotativo,horas_semanales,fecha_ingreso,situacion,situacion_desde,situacion_hasta,tareas_adicionales";
const HOR_H = "apellido_nombre,contrato,vigente_desde,semana,referencia_ab,dia,tramo,entrada,salida,sucursal,otro_lugar";
const SAL_H = "apellido_nombre,contrato,anio,dias";
const files = (emp: string[], hor: string[] = []) => ({
  "empleados.csv": [EMP_H, ...emp].join("\n"),
  "horarios.csv": [HOR_H, ...hor].join("\n"),
  "saldos.csv": SAL_H,
});

const posId = (name: string) => `p${POSITION_CATALOG.findIndex((p) => p.name === name)}`;
const person = (over: Partial<SnapshotEmployee> = {}): SnapshotEmployee => ({
  id: "e1", nameKey: "prueba, ana", contractBranchId: "b-tek", firstName: "Ana", lastName: "Prueba",
  positionId: posId("Cajero/a"), secondaryPositionId: null, isTechnicalDirector: false, isRotating: false,
  currentBranchId: "b-tek", weeklyHours: null, hireDate: null, extraTasks: null, active: true, ...over,
});
const snapshot = (employees: SnapshotEmployee[], uiEdits: UiEdit[] = [], extra: Partial<DbSnapshot> = {}): DbSnapshot => ({
  branches: [
    { id: "b-tek", name: "Tekiel", code: "TEK" },
    { id: "b-gal", name: "Galesa", code: "GAL" },
  ],
  positions: POSITION_CATALOG.map((p, i) => ({ id: `p${i}`, name: p.name })),
  employees, schedules: [], balances: [], employeesWithConsumption: [], leaves: [],
  lastLoadAt: "2026-11-01T10:00:00.000Z", uiEdits, ...extra,
});
const edit = (field: UiEdit["field"], at = "2026-11-05T12:00:00.000Z", employeeId = "e1"): UiEdit => ({ employeeId, field, at });

// La planilla dice: cajera, no rotativa, sin puesto secundario, no DT, sin horas, sin tareas.
const ROW = `"Prueba, Ana",TEK,TEK,Cajero/a,,N,N,,,Activo/a,,,`;

console.log("\nAuditLog → ediciones de la plataforma");
{
  const load = (createdAt: string, detail: unknown = {}): AuditRow => ({ action: "PERSONAL_LOAD", entity: "Employee", entityId: null, detail, createdAt });
  const update = (createdAt: string, detail: unknown, entityId = "e1"): AuditRow => ({ action: "UPDATE", entity: "Employee", entityId, detail, createdAt });

  // El formulario manda todos los campos: solo cuenta el que cambió de verdad.
  const formDetail = {
    firstName: { from: "Ana", to: "Ana" },
    positionId: { from: "p3", to: "p3" },
    isRotating: { from: false, to: true },
    weeklyHours: { from: "45", to: 45 },                          // Decimal de la base vs número del formulario
    hireDate: { from: "2020-03-01T00:00:00.000Z", to: "2020-03-01" },
    extraTasks: { from: null, to: null },
    notes: { from: null, to: "una nota" },                        // no es un campo de la planilla
  };
  const r = employeeUiEdits([load("2026-11-01T10:00:00Z"), update("2026-11-05T12:00:00Z", formDetail)]);
  assert("última carga = el PERSONAL_LOAD más reciente", r.lastLoadAt === "2026-11-01T10:00:00.000Z");
  assert("solo cuenta el campo que cambió (rotativo); los que el formulario mandó iguales no",
    r.edits.length === 1 && r.edits[0].field === "rotativo" && r.edits[0].employeeId === "e1");

  const before = employeeUiEdits([update("2026-10-20T12:00:00Z", formDetail), load("2026-11-01T10:00:00Z")]);
  assert("una edición anterior a la última carga no cuenta", before.edits.length === 0);

  const noLoad = employeeUiEdits([update("2026-10-20T12:00:00Z", formDetail)]);
  assert("sin cargas previas cuentan todas las ediciones", noLoad.lastLoadAt === null && noLoad.edits.length === 1);

  const many = employeeUiEdits([
    load("2026-11-01T10:00:00Z"),
    update("2026-11-02T12:00:00Z", { isRotating: { from: false, to: true }, positionId: { from: "p3", to: "p1" } }),
    update("2026-11-04T12:00:00Z", { isRotating: { from: true, to: false }, secondaryPositionId: { from: null, to: "p7" },
      isTechnicalDirector: { from: false, to: true }, extraTasks: { from: null, to: "caja chica" },
      active: { from: true, to: false }, weeklyHours: { from: "40", to: 36 }, currentBranchId: { from: "b-tek", to: "b-gal" } }),
    update("2026-11-03T12:00:00Z", { isRotating: { from: true, to: true } }, "e2"),
  ]);
  const fields = many.edits.filter((e) => e.employeeId === "e1").map((e) => e.field).sort().join();
  assert("todos los campos de la planilla: rotativo, puesto, secundario, DT, tareas, situación (activo), horas, sucursal",
    fields === "activo,dt,horas_semanales,puesto,puesto_secundario,rotativo,tareas_adicionales,trabaja_en");
  assert("por campo queda la edición más reciente",
    many.edits.find((e) => e.employeeId === "e1" && e.field === "rotativo")?.at === "2026-11-04T12:00:00.000Z");
  assert("otra persona sin cambios reales no aparece", !many.edits.some((e) => e.employeeId === "e2"));

  const assign = employeeUiEdits([
    load("2026-11-01T10:00:00Z"),
    { action: "ASSIGN_BRANCH", entity: "Employee", entityId: "e1", detail: { type: "PERMANENT", newBranch: "x" }, createdAt: "2026-11-02T10:00:00Z" },
    { action: "ASSIGN_BRANCH", entity: "Employee", entityId: "e2", detail: { type: "TEMPORARY_COVERAGE" }, createdAt: "2026-11-02T10:00:00Z" },
  ]);
  assert("asignación PERMANENT desde la plataforma = cambio de sucursal; una cobertura temporal no",
    assign.edits.length === 1 && assign.edits[0].field === "trabaja_en" && assign.edits[0].employeeId === "e1");

  // La carga del 01/11 dejó sin pisar una edición del 28/10: sigue protegida.
  const kept = employeeUiEdits([
    load("2026-10-25T10:00:00Z"),
    update("2026-10-28T12:00:00Z", { isRotating: { from: false, to: true } }),
    load("2026-11-01T10:00:00Z", { employeesUpdated: 3, keptUiEdits: [{ employeeId: "e1", field: "rotativo", at: "2026-10-28T12:00:00.000Z" }] }),
  ]);
  assert("lo que la última carga dejó sin pisar sigue protegido en la siguiente",
    kept.edits.length === 1 && kept.edits[0].field === "rotativo" && kept.edits[0].at === "2026-10-28T12:00:00.000Z");
  assert("keptUiEdits mal formado o ausente no rompe", keptUiEditsOf({ keptUiEdits: [{ x: 1 }, null, "a"] }).length === 0
    && keptUiEditsOf(null).length === 0 && keptUiEditsOf({ employeesUpdated: 1 }).length === 0);
}

console.log("\nCaso real: marcada rotativa en la plataforma, la planilla dice N");
{
  const db = snapshot([person({ isRotating: true })], [edit("rotativo")]);
  const plan = buildLoadPlan(files([ROW]), db);
  const e = plan.employees[0];
  assert("no hay errores y la persona queda igual (no se actualiza)", plan.errors.length === 0 && e.action === "unchanged");
  assert("sigue rotativa en lo que se escribiría", e.data.isRotating === true);
  assert("aparece como conflicto, sin pisar", plan.conflicts.length === 1 && plan.conflicts[0].field === "rotativo"
    && plan.conflicts[0].platform === "S" && plan.conflicts[0].csv === "N" && plan.conflicts[0].overwritten === false);
  const report = formatPlanReport(plan);
  assert("la vista previa lo muestra como \"conflicto\" con los dos valores y cómo pisarlo",
    report.includes("conflicto empleados.csv:2") && report.includes("rotativo: plataforma \"S\"") && report.includes("planilla \"N\"")
    && report.includes("no se pisa") && report.includes("--overwrite-ui-edits") && report.includes("desde la última carga (01/11/2026)"));

  const forced = buildLoadPlan(files([ROW]), db, { overwriteUiEdits: true });
  assert("con --overwrite-ui-edits se pisa: update con rotativo en N, y queda informado",
    forced.employees[0].action === "update" && forced.employees[0].changes.join() === "rotativo"
    && forced.employees[0].data.isRotating === false && forced.conflicts[0].overwritten === true
    && formatPlanReport(forced).includes("SE PISAN"));

  const sinEdicion = buildLoadPlan(files([ROW]), snapshot([person({ isRotating: true })]));
  assert("sin edición en la plataforma, la planilla manda como siempre",
    sinEdicion.employees[0].action === "update" && sinEdicion.conflicts.length === 0 && sinEdicion.employees[0].data.isRotating === false);

  const coincide = buildLoadPlan(files([ROW.replace(",N,N,,,Activo", ",N,S,,,Activo")]), db);
  assert("si la planilla ya dice lo mismo que la plataforma no hay conflicto",
    coincide.conflicts.length === 0 && coincide.employees[0].action === "unchanged");
  assert("sin conflictos, la vista previa lo dice", formatPlanReport(coincide).includes("plataforma desde la última carga (01/11/2026): 0"));
}

console.log("\nCada campo de empleados.csv");
{
  const base = person({
    positionId: posId("Farmacéutico/a"), secondaryPositionId: posId("Perfumería"), isTechnicalDirector: true,
    weeklyHours: 36, extraTasks: "caja chica", active: false, currentBranchId: "b-gal", hireDate: "2021-05-01",
  });
  const all: UiEdit["field"][] = ["puesto", "puesto_secundario", "dt", "horas_semanales", "tareas_adicionales", "activo", "trabaja_en", "fecha_ingreso"];
  const plan = buildLoadPlan(files([ROW]), snapshot([base], all.map((f) => edit(f))));
  const d = plan.employees[0].data;
  assert("los 8 campos editados quedan como conflicto y nada se actualiza",
    plan.conflicts.length === 8 && plan.employees[0].action === "unchanged");
  assert("puesto y puesto secundario quedan los de la plataforma", d.positionName === "Farmacéutico/a" && d.secondaryPositionName === "Perfumería");
  assert("DT, horas y tareas adicionales quedan los de la plataforma", d.isTechnicalDirector && d.weeklyHours === 36 && d.extraTasks === "caja chica");
  assert("situación: la baja hecha en la plataforma no se revierte", d.active === false);
  assert("sucursal donde trabaja y fecha de ingreso quedan las de la plataforma", d.currentBranchId === "b-gal" && d.hireDate === "2021-05-01");
  const c = (f: string) => plan.conflicts.find((x) => x.field === f)!;
  assert("los valores se muestran legibles (sucursal por nombre, S/N, baja)", c("trabaja_en").platform === "Galesa" && c("trabaja_en").csv === "Tekiel"
    && c("dt").platform === "S" && c("activo").platform === "dado/a de baja" && c("puesto_secundario").csv === "(vacío)");

  // Solo se editó el puesto en la plataforma: lo demás lo actualiza la planilla.
  const mixed = buildLoadPlan(files([ROW]), snapshot([base], [edit("puesto")]));
  assert("campo editado no se pisa; los otros campos de la misma persona sí se actualizan",
    mixed.employees[0].action === "update" && !mixed.employees[0].changes.includes("puesto")
    && mixed.employees[0].changes.includes("dt") && mixed.employees[0].data.positionName === "Farmacéutico/a"
    && mixed.employees[0].data.isTechnicalDirector === false && mixed.employees[0].data.active === true);

  const other = buildLoadPlan(files([ROW]), snapshot([base], [edit("puesto", undefined, "otra-persona")]));
  assert("la edición de otra persona no protege a esta", other.conflicts.length === 0 && other.employees[0].changes.includes("puesto"));
}

console.log("\nLicencia de la columna situacion");
{
  const LIC = `"Prueba, Ana",TEK,TEK,Cajero/a,,N,N,,,Licencia médica,2026-11-10,2026-11-20,`;
  const touched: UiEdit = { employeeId: "e1", field: "situacion", at: "2026-11-08T09:00:00.000Z", range: { startDate: "2026-11-10", endDate: "2026-11-14" } };
  const plan = buildLoadPlan(files([LIC]), snapshot([person()], [touched]));
  assert("licencia tocada en la plataforma en ese período: la de la planilla no se crea encima",
    plan.leaves[0].action === "conflict" && plan.conflicts.some((c) => c.field === "situacion" && !c.overwritten));
  assert("la vista previa cuenta la licencia en conflicto", formatPlanReport(plan).includes("en conflicto (no se crean): 1"));
  assert("con el flag se crea", buildLoadPlan(files([LIC]), snapshot([person()], [touched]), { overwriteUiEdits: true }).leaves[0].action === "create");
  const far: UiEdit = { ...touched, range: { startDate: "2026-08-01", endDate: "2026-08-10" } };
  assert("una licencia de otro período no frena la de la planilla",
    buildLoadPlan(files([LIC]), snapshot([person()], [far])).leaves[0].action === "create");
  const same = snapshot([person()], [touched], { leaves: [{ employeeId: "e1", absenceType: "MEDICAL_LEAVE", startDate: "2026-11-10", endDate: "2026-11-20" }] });
  const p = buildLoadPlan(files([LIC]), same);
  assert("si la licencia ya está igual en la base, queda igual y sin conflicto", p.leaves[0].action === "unchanged" && p.conflicts.length === 0);
}

console.log("\nhorarios.csv");
{
  const slot = (branchId: string | null, start = 480, end = 840) =>
    ({ week: "ALL" as const, dayOfWeek: 1, slot: 1, startMinute: start, endMinute: end, branchId, otherPlace: null });
  const HOR_OLD = `"Prueba, Ana",TEK,2026-01-01,TODAS,,1,1,08:00,14:00,,`;
  const HOR_NEW = `"Prueba, Ana",TEK,2026-12-01,TODAS,,1,1,09:00,15:00,,`;

  // La sucursal se cambió en la plataforma (Galesa); la planilla sigue diciendo Tekiel.
  const moved = snapshot([person({ currentBranchId: "b-gal" })], [edit("trabaja_en")]);
  const plan = buildLoadPlan(files([ROW], [HOR_NEW]), moved);
  assert("tramo sin sucursal: usa la sucursal de la plataforma, no la de la planilla (WorkScheduleSlot.branchId)",
    plan.errors.length === 0 && plan.schedules[0].action === "create" && plan.schedules[0].slots[0].branchId === "b-gal");
  const pisado = buildLoadPlan(files([ROW], [HOR_NEW]), moved, { overwriteUiEdits: true });
  assert("con el flag, el tramo va a la sucursal de la planilla", pisado.schedules[0].slots[0].branchId === "b-tek");

  // El horario viejo ya estaba cargado con la sucursal de la planilla: sigue "igual", no frena la carga.
  const movedWithOld: DbSnapshot = { ...moved, schedules: [{ employeeId: "e1", validFrom: "2026-01-01", abReferenceDate: null, slots: [slot("b-tek")] }] };
  const both = buildLoadPlan(files([ROW], [HOR_OLD, HOR_NEW]), movedWithOld);
  assert("el horario ya cargado con la sucursal anterior queda igual (sin error) y el nuevo usa la de la plataforma",
    both.errors.length === 0 && both.schedules.find((s) => s.validFrom === "2026-01-01")?.action === "unchanged"
    && both.schedules.find((s) => s.validFrom === "2026-12-01")?.slots[0].branchId === "b-gal");

  // Horario editado en la plataforma después de la última carga.
  const edited = snapshot([person()], [edit("horario")], {
    schedules: [{ employeeId: "e1", validFrom: "2026-01-01", abReferenceDate: null, slots: [slot("b-gal", 600, 960)] }],
  });
  const nuevo = buildLoadPlan(files([ROW], [HOR_NEW]), edited);
  assert("horario nuevo de la planilla sobre uno editado en la plataforma: conflicto, no se crea",
    nuevo.errors.length === 0 && nuevo.schedules[0].action === "conflict"
    && nuevo.conflicts.some((c) => c.field === "horario" && c.file === "horarios.csv" && !c.overwritten));
  const mismo = buildLoadPlan(files([ROW], [HOR_OLD]), edited);
  assert("misma vigencia con otras horas u otra sucursal: conflicto en vez de error que frena toda la carga",
    mismo.errors.length === 0 && mismo.schedules[0].action === "conflict");
  assert("la vista previa cuenta los horarios en conflicto", formatPlanReport(nuevo).includes("en conflicto (no se crean): 1"));
  const forzado = buildLoadPlan(files([ROW], [HOR_NEW]), edited, { overwriteUiEdits: true });
  assert("con el flag, el horario nuevo se crea", forzado.schedules[0].action === "create" && forzado.conflicts[0].overwritten);

  const igual = snapshot([person()], [edit("horario")], {
    schedules: [{ employeeId: "e1", validFrom: "2026-01-01", abReferenceDate: null, slots: [slot("b-tek")] }],
  });
  const sinCambio = buildLoadPlan(files([ROW], [HOR_OLD]), igual);
  assert("si el horario de la planilla es igual al de la base, queda igual y sin conflicto",
    sinCambio.schedules[0].action === "unchanged" && sinCambio.conflicts.length === 0);

  const sinEdicion = snapshot([person()], [], {
    schedules: [{ employeeId: "e1", validFrom: "2026-01-01", abReferenceDate: null, slots: [slot("b-tek")] }],
  });
  assert("sin edición en la plataforma, un horario nuevo se crea como siempre",
    buildLoadPlan(files([ROW], [HOR_NEW]), sinEdicion).schedules[0].action === "create");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
