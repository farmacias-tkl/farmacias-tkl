/**
 * Tests PUROS del plan de carga de personal (load-plan.ts + csv.ts).
 * Archivos y base SINTÉTICOS: ningún dato real.
 *
 *   npx tsx src/lib/personal/load-plan.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
import { buildLoadPlan, formatPlanReport, type DbSnapshot, type LoadPlan } from "./load-plan";
import { parseCsv } from "./csv";
import { POSITION_CATALOG } from "./catalog";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

const EMP_H = "apellido_nombre,contrato,trabaja_en,puesto,puesto_secundario,dt,rotativo,horas_semanales,fecha_ingreso,situacion,situacion_desde,situacion_hasta,tareas_adicionales";
const HOR_H = "apellido_nombre,contrato,vigente_desde,semana,referencia_ab,dia,tramo,entrada,salida,sucursal,otro_lugar";
const SAL_H = "apellido_nombre,contrato,anio,dias";

const emptyDb = (): DbSnapshot => ({
  branches: [
    { id: "b-tek", name: "Tekiel", code: "TEK" },
    { id: "b-aya", name: "Facultad", code: null },   // sin code: se resuelve por nombre real
    { id: "b-gal", name: "Galesa", code: "GAL" },
    { id: "b-etc", name: "Etcheverry", code: "ETC" },
    { id: "b-cc", name: "Call Center", code: null },
  ],
  positions: POSITION_CATALOG.map((p, i) => ({ id: `p${i}`, name: p.name })),
  employees: [], schedules: [], balances: [], employeesWithConsumption: [], leaves: [],
});

const files = (emp: string[], hor: string[] = [], sal: string[] = []) => ({
  "empleados.csv": [EMP_H, ...emp].join("\r\n"),
  "horarios.csv": [HOR_H, ...hor].join("\r\n"),
  "saldos.csv": [SAL_H, ...sal].join("\r\n"),
});

const BASE_EMP = [
  `"Prueba, Ana",TEK,TEK,Encargado/a,,S,N,,2020-03-01,Activo/a,,,`,
  `"Prueba, Ana",AYA,AYA,Cajero/a,,N,N,,,Activo/a,,,`,                          // homónima en otra sucursal de contrato
  `"Ejemplo, Beto",GAL,CALLCENTER,Call Center,Cajero/a,N,N,,,Activo/a,,,auditoría de 10 a 12`,
  `"Rotativo, Ceci",ETC,ETC,Reposición / Cadetería,Maestranza / Limpieza,N,S,45,,Activo/a,,,`,
  `"Licencia, Dani",TEK,TEK,Farmacéutico/a,,N,N,,,Licencia por maternidad,2026-10-01,2026-12-31,`,
  `"Vacas, Eli",TEK,TEK,Perfumería,,N,N,,,Vacaciones,2026-11-02,2026-11-15,`,
];
const BASE_HOR = [
  `"Prueba, Ana",TEK,2026-01-01,TODAS,,1,1,08:00,12:00,,`,
  `"Prueba, Ana",TEK,2026-01-01,TODAS,,1,2,16:00,20:00,AYA,`,
  `"Prueba, Ana",TEK,2026-01-01,A,2026-11-02,6,1,09:00,13:00,,`,
  `"Ejemplo, Beto",GAL,2026-01-01,TODAS,,2,1,09:00,13:00,,Oficina central`,
];
const BASE_SAL = [
  `"Prueba, Ana",TEK,2023,4`,
  `"Prueba, Ana",TEK,2024,14`,
  `"Prueba, Ana",AYA,2025,21`,
];

console.log("\nCSV");
{
  const c = parseCsv(`﻿a;b;c\r\n"x; y";"con ""comillas""";\r\n`);
  assert("separador ; detectado, comillas y BOM", c.headers.join() === "a,b,c" && c.rows[0].values.a === "x; y" && c.rows[0].values.b === 'con "comillas"');
}

console.log("\nPlan sobre base vacía");
const plan = buildLoadPlan(files(BASE_EMP, BASE_HOR, BASE_SAL), emptyDb());
{
  assert("sin errores", plan.errors.length === 0);
  assert("6 empleados a crear", plan.employees.length === 6 && plan.employees.every((e) => e.action === "create"));
  const anas = plan.employees.filter((e) => e.data.nameKey === "prueba, ana");
  assert("dos personas con el mismo nombre en sucursales distintas = dos personas", anas.length === 2
    && new Set(anas.map((a) => a.data.contractBranchId)).size === 2);
  const beto = plan.employees.find((e) => e.data.nameKey === "ejemplo, beto")!;
  assert("contrato en Galesa y trabaja en Call Center", beto.data.contractBranchId === "b-gal" && beto.data.currentBranchId === "b-cc");
  assert("puesto secundario y tareas adicionales", beto.data.secondaryPositionName === "Cajero/a" && beto.data.extraTasks === "auditoría de 10 a 12");
  assert("sucursal sin code se resuelve por nombre real (AYA → Facultad)", anas.some((a) => a.data.contractBranchId === "b-aya"));
  assert("DT es una marca (Encargado/a + DT)", anas.find((a) => a.data.contractBranchId === "b-tek")!.data.isTechnicalDirector);
  const ceci = plan.employees.find((e) => e.data.nameKey === "rotativo, ceci")!;
  assert("rotativo con horas semanales y sin horario", ceci.data.isRotating && ceci.data.weeklyHours === 45);
  assert("1 horario por persona y vigencia (Ana TEK y Beto)", plan.schedules.length === 2);
  const anaSch = plan.schedules.find((s) => s.personKey.startsWith("prueba, ana|b-tek"))!;
  assert("tramo sin sucursal ni lugar → donde trabaja; otro en AYA; sábado semana A", anaSch.slots[0].branchId === "b-tek"
    && anaSch.slots[1].branchId === "b-aya" && anaSch.slots[2].week === "A" && anaSch.abReferenceDate === "2026-11-02");
  assert("horas A 12 / B 8", anaSch.hours.A === 12 && anaSch.hours.B === 8);
  assert("otro lugar como texto", plan.schedules.find((s) => s.personKey.startsWith("ejemplo"))!.slots[0].otherPlace === "Oficina central");
  assert("3 saldos a crear", plan.balances.length === 3 && plan.balances.every((b) => b.action === "create"));
  assert("licencia por maternidad → AbsenceRecord MATERNITY_LEAVE", plan.leaves.length === 1 && plan.leaves[0].absenceType === "MATERNITY_LEAVE");
  assert("situación Vacaciones: solo se lista (sin solicitud)", plan.vacationSituations.length === 1 && plan.vacationSituations[0].startDate === "2026-11-02");
}

console.log("\nIdempotencia: la base ya tiene lo mismo → todo igual");
{
  const ids = new Map(plan.employees.map((e, i) => [e.personKey, `e${i}`]));
  const posId = (n: string | null) => (n ? emptyDb().positions.find((p) => p.name === n)!.id : null);
  const db: DbSnapshot = {
    ...emptyDb(),
    employees: plan.employees.map((e) => ({
      id: ids.get(e.personKey)!, nameKey: e.data.nameKey, contractBranchId: e.data.contractBranchId,
      firstName: e.data.firstName, lastName: e.data.lastName, positionId: posId(e.data.positionName)!,
      secondaryPositionId: posId(e.data.secondaryPositionName), isTechnicalDirector: e.data.isTechnicalDirector,
      isRotating: e.data.isRotating, currentBranchId: e.data.currentBranchId, weeklyHours: e.data.weeklyHours,
      hireDate: e.data.hireDate, extraTasks: e.data.extraTasks, active: true,
    })),
    schedules: plan.schedules.map((s) => ({ employeeId: ids.get(s.personKey)!, validFrom: s.validFrom, abReferenceDate: s.abReferenceDate, slots: s.slots })),
    balances: plan.balances.map((b) => ({ employeeId: ids.get(b.personKey)!, year: b.year, days: b.days })),
    leaves: plan.leaves.map((l) => ({ employeeId: ids.get(l.personKey)!, absenceType: l.absenceType, startDate: l.startDate, endDate: l.endDate })),
  };
  const again = buildLoadPlan(files(BASE_EMP, BASE_HOR, BASE_SAL), db);
  const allSame = (p: LoadPlan) => p.employees.every((e) => e.action === "unchanged") && p.schedules.every((s) => s.action === "unchanged")
    && p.balances.every((b) => b.action === "unchanged") && p.leaves.every((l) => l.action === "unchanged");
  assert("segunda corrida: nada que crear ni actualizar", again.errors.length === 0 && allSame(again));

  const changed = buildLoadPlan(files(BASE_EMP, BASE_HOR, [BASE_SAL[0].replace(",4", ",6"), ...BASE_SAL.slice(1)]), db);
  assert("cambia un saldo → update con el valor anterior", changed.balances.some((b) => b.action === "update" && b.previous === 4 && b.days === 6));

  // La persona ya consumió o le devolvieron días: su saldo no se recarga sin --force-saldos.
  const anaTek = ids.get(plan.employees.find((e) => e.personKey.startsWith("prueba, ana|b-tek"))!.personKey)!;
  const consumedDb: DbSnapshot = { ...db, employeesWithConsumption: [anaTek] };
  const salChanged = [BASE_SAL[0].replace(",4", ",6"), BASE_SAL[1], BASE_SAL[2], `"Prueba, Ana",TEK,2025,21`];
  const blocked = buildLoadPlan(files(BASE_EMP, BASE_HOR, salChanged), consumedDb);
  const anaRows = blocked.balances.filter((b) => b.personKey.startsWith("prueba, ana|b-tek"));
  assert("con consumos: cambio y año nuevo quedan frenados; lo igual sigue igual",
    anaRows.find((b) => b.year === 2023)?.action === "blocked" && anaRows.find((b) => b.year === 2025)?.action === "blocked"
    && anaRows.find((b) => b.year === 2024)?.action === "unchanged");
  assert("frenado no es error (se puede aplicar lo demás) y se informa", blocked.errors.length === 0
    && blocked.warnings.some((w) => w.message.includes("--force-saldos")) && formatPlanReport(blocked).includes("frenados: 2"));
  assert("la homónima de otra sucursal (sin consumos) no se frena",
    blocked.balances.filter((b) => b.personKey.startsWith("prueba, ana|b-aya")).every((b) => b.action === "unchanged"));
  const forced = buildLoadPlan(files(BASE_EMP, BASE_HOR, salChanged), consumedDb, { forceBalances: true });
  assert("--force-saldos: update y create (LOAD_ADJUST) con aviso de que pisa consumos", forced.forceBalances
    && forced.balances.some((b) => b.year === 2023 && b.action === "update") && forced.balances.some((b) => b.year === 2025 && b.action === "create")
    && forced.warnings.some((w) => w.message.includes("incluidos consumos")));
  const otherSchedule = buildLoadPlan(files(BASE_EMP, [BASE_HOR[0].replace("12:00", "13:00"), ...BASE_HOR.slice(1)], BASE_SAL), db);
  assert("mismo vigente_desde con otro contenido → error (no se pisa)", otherSchedule.errors.some((e) => e.message.includes("no se pisa")));
}

console.log("\nErrores por fila");
{
  const bad = buildLoadPlan(files([
    `Sin Coma Nombre,TEK,TEK,Encargado/a,,N,N,,,,,,`,
    `"Uno, Dos",XXX,TEK,Encargado/a,,N,N,,,,,,`,
    `"Tres, Cuatro",TEK,TEK,Gerente,,N,N,,,,,,`,
    `"Cinco, Seis",TEK,ZZZ,Cajero/a,,N,N,,,,,,`,
    `"Siete, Ocho",TEK,TEK,Cajero/a,,N,N,cuarenta,,,,,`,
    `"Siete, Ocho",TEK,TEK,Cajero/a,,N,N,,,,,,`,
    `"Nueve, Diez",TEK,TEK,Cajero/a,,X,N,,,,,,`,
    `"Once, Doce",TEK,TEK,Cajero/a,,N,N,,,Licencia médica,2026-01-10,,`,
    `"Trece, Catorce",TEK,TEK,Cajero/a,,N,N,,,,,,`,
  ], [
    `"Trece, Catorce",TEK,2026-01-01,TODAS,,1,1,08:00,12:00,,`,
    `"Trece, Catorce",TEK,2026-01-01,TODAS,,1,2,11:00,15:00,,`,
    `"Trece, Catorce",TEK,2026-02-01,TODAS,,1,1,8h,12:00,,`,
    `"Nadie, Existe",TEK,2026-01-01,TODAS,,1,1,08:00,12:00,,`,
  ], [
    `"Trece, Catorce",TEK,2024,diez`,
  ]), emptyDb());
  const has = (file: string, line: number, text: string) => bad.errors.some((e) => e.file === file && e.line === line && e.message.includes(text));
  assert("nombre sin coma", has("empleados.csv", 2, "Apellido, Nombre"));
  assert("sucursal de contrato desconocida", has("empleados.csv", 3, "contrato desconocida"));
  assert("puesto desconocido", has("empleados.csv", 4, "Puesto desconocido"));
  assert("sucursal donde trabaja desconocida", has("empleados.csv", 5, "trabaja desconocida"));
  assert("horas mal escritas", has("empleados.csv", 6, "horas_semanales"));
  assert("duplicado", has("empleados.csv", 7, "duplicada"));
  assert("S/N inválido", has("empleados.csv", 8, "S o N"));
  assert("licencia sin fecha de fin", has("empleados.csv", 9, "situacion_hasta"));
  assert("tramos superpuestos", bad.errors.some((e) => e.file === "horarios.csv" && e.message.includes("superpuestos")));
  assert("hora mal escrita en horario", has("horarios.csv", 4, "entrada"));
  assert("persona de horarios que no existe", has("horarios.csv", 5, "no está en empleados.csv"));
  assert("días de saldo no numéricos", has("saldos.csv", 2, "entero"));
  assert("las filas buenas no se pierden (Trece, Catorce se crea)", bad.employees.some((e) => e.data.nameKey === "trece, catorce"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
