/**
 * Tests PUROS de las reglas de vacaciones (adenda C y D): advertencias vs.
 * bloqueos, cruces por horario real y rotativos libres. Datos sintéticos.
 *
 *   npx tsx src/lib/vacations/rules.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
// Hora local argentina: "inicio en lunes" no tiene que depender de ella.
process.env.TZ = "America/Argentina/Buenos_Aires";

import { evaluateVacationRules, warningMessages, type RuleContext } from "./rules";
import { findScheduleOverlaps, rotativeAvailability, workedSlots, type OtherPerson, type RotativeCandidate } from "@/lib/personal/coverage";
import { parseISODate } from "@/lib/personal/dates";
import { coveredByRotatives } from "@/lib/personal/catalog";
import type { Schedule, ScheduleSlot } from "@/lib/personal/schedule";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}
const D = (s: string) => parseISODate(s)!;
const H = (h: number) => h * 60;
const slot = (p: Partial<ScheduleSlot> & Pick<ScheduleSlot, "dayOfWeek" | "startMinute" | "endMinute">): ScheduleSlot =>
  ({ week: "ALL", slot: 1, branchId: "b-tek", otherPlace: null, ...p });
const sched = (slots: ScheduleSlot[], abReferenceDate: Date | null = null): Schedule =>
  ({ validFrom: D("2026-01-01"), abReferenceDate, slots });
const weekdays = (from: number, to: number, branchId = "b-tek", week: ScheduleSlot["week"] = "ALL") =>
  [1, 2, 3, 4, 5].map((d) => slot({ dayOfWeek: d, startMinute: H(from), endMinute: H(to), branchId, week }));

// Solicitud base: lunes 2/11/2026 a domingo 15/11 (14 días)
const base = (over: Partial<RuleContext> = {}): RuleContext => ({
  startDate: D("2026-11-02"),
  endDate: D("2026-11-15"),
  employee: { id: "e1", active: true, positionKey: "CAJERO", positionName: "Cajero/a", branchId: "b-tek", branchZone: "CABA", schedules: [sched(weekdays(8, 14))] },
  otherVacations: [],
  selfOverlap: null,
  others: [],
  balances: [{ year: 2025, days: 30 }],
  rotativos: [],
  branchNames: { "b-tek": "Sucursal T", "b-aya": "Sucursal F" },
  ...over,
});
const ruleStatus = (r: ReturnType<typeof evaluateVacationRules>, rule: string) =>
  r.ruleResults.find((x) => x.rule === rule)?.status;

console.log("\nReglas de negocio advierten, no bloquean");
{
  const r = evaluateVacationRules(base({ startDate: D("2026-11-03"), endDate: D("2026-11-12") })); // martes, 10 días
  assert("no empieza lunes → WARNING", ruleStatus(r, "inicio") === "WARNING");
  assert("10 días → duración WARNING", ruleStatus(r, "duracion") === "WARNING");
  assert("sigue siendo válida (no BLOCKING)", r.isValid && r.conflictLevel === "WARNING");
  assert("lunes 2/11 se reconoce como lunes con TZ argentina", ruleStatus(evaluateVacationRules(base()), "inicio") === "OK");
  assert("días corridos: 2/11 → 15/11 = 14", evaluateVacationRules(base()).calculatedDays === 14);
}
{
  const r = evaluateVacationRules(base({ balances: [{ year: 2024, days: 5 }] }));
  assert("saldo insuficiente → WARNING, no bloquea", ruleStatus(r, "saldo") === "WARNING" && r.isValid);
  assert("muestra saldo y cómo quedaría (5 → -9)", r.balance?.total === 5 && r.balance?.totalAfter === -9);
}
{
  const r = evaluateVacationRules(base({ balances: [] }));
  assert("persona sin saldo: aviso, no error", r.isValid && ruleStatus(r, "saldo") === "WARNING");
}
{
  const r = evaluateVacationRules(base({
    employee: { id: "e1", active: true, positionKey: "ENCARGADO", positionName: "Encargado/a", branchId: "b-tek", branchZone: "CABA", schedules: [] },
    otherVacations: [{
      id: "v2", employeeId: "e2", employeeName: "Prueba Dos", positionKey: "ENCARGADO",
      branchId: "b-tek", branchName: "Sucursal T", startDate: D("2026-11-09"), endDate: D("2026-11-22"),
    }],
  }));
  assert("conflicto A (dos Encargados/as misma sucursal) → WARNING", r.warnings.some((w) => w.type === "MANAGER_SAME_BRANCH") && r.isValid);
}
{
  const r = evaluateVacationRules(base({ rotativos: [] }));
  assert("puesto con rotativos y ninguno libre → WARNING (reemplaza a B)", r.warnings.some((w) => w.type === "NO_FREE_ROTATIVE") && r.isValid);
  assert("warningMessages lista lo que se confirma con Aprobar igual", warningMessages(r).length >= 1);
}
{
  const r = evaluateVacationRules(base({ employee: { ...base().employee!, branchZone: "PROVINCIA" }, rotativos: null }));
  assert("sucursal de PROVINCIA: sin advertencia de rotativos ni regla aplicada", !r.warnings.some((w) => w.type === "NO_FREE_ROTATIVE")
    && r.rotativos === null && !r.ruleResults.some((x) => x.rule === "rotativos"));
  const r2 = evaluateVacationRules(base({ employee: { ...base().employee!, branchZone: null }, rotativos: null }));
  assert("sucursal sin zona: tampoco aplica", r2.rotativos === null && !r2.warnings.some((w) => w.type === "NO_FREE_ROTATIVE"));
}

console.log("\nBloqueos que se mantienen");
{
  const r = evaluateVacationRules(base({ startDate: D("2026-11-15"), endDate: D("2026-11-02") }));
  assert("fechas invertidas → BLOCKING", !r.isValid && ruleStatus(r, "rango") === "BLOCKING");
}
{
  const r = evaluateVacationRules(base({ employee: { ...base().employee!, active: false } }));
  assert("empleado inactivo → BLOCKING", !r.isValid && ruleStatus(r, "empleado") === "BLOCKING");
  const r2 = evaluateVacationRules(base({ employee: null }));
  assert("empleado inexistente → BLOCKING", !r2.isValid);
}
{
  const r = evaluateVacationRules(base({
    selfOverlap: { id: "v0", startDate: D("2026-11-09"), endDate: D("2026-11-22"), branchName: "Sucursal T" },
  }));
  assert("misma persona con dos solicitudes superpuestas → BLOCKING", !r.isValid && r.blockingConflicts[0]?.type === "SELF_OVERLAP");
}

console.log("\nCruces por horario real");
const other = (schedules: Schedule[], over: Partial<OtherPerson> = {}): OtherPerson => ({
  employeeId: "e2", name: "Prueba Dos", positionName: "Cajero/a", positionKeys: ["CAJERO"],
  absences: [{ id: "v2", kind: "APROBADA", startDate: D("2026-11-09"), endDate: D("2026-11-22") }],
  schedules, ...over,
});
{
  const r = evaluateVacationRules(base({ others: [other([sched(weekdays(12, 18))])] }));
  assert("mismo puesto, franjas que se pisan → advertencia", r.overlaps.length === 1 && r.warnings.some((w) => w.type === "SCHEDULE_OVERLAP"));
  const o = r.overlaps[0];
  assert("detalle: 5 días (9 a 13/11), franja 12:00–14:00, sucursal, estado", o?.dates.length === 5 && o.dates[0] === "2026-11-09"
    && o.ranges[0] === "12:00–14:00" && o.branchName === "Sucursal T" && o.stateLabel === "vacaciones aprobadas");
}
{
  const r = evaluateVacationRules(base({ others: [other([sched(weekdays(14, 20))])] }));
  assert("mismo puesto, franjas que no se pisan (14 a 14) → sin advertencia", r.overlaps.length === 0);
}
{
  const r = evaluateVacationRules(base({ others: [other([sched(weekdays(8, 14))], { positionKeys: ["CADETERIA"], positionName: "Reposición / Cadetería" })] }));
  assert("otro puesto → sin advertencia", r.overlaps.length === 0);
}
{
  const r = evaluateVacationRules(base({ others: [other([sched(weekdays(8, 14, "b-aya"))])] }));
  assert("misma franja en otra sucursal → sin advertencia", r.overlaps.length === 0);
}
{
  // Semanas A/B: la otra persona trabaja el sábado solo en semana A (ref 2/11 → A, 9/11 → B, 16/11 → A).
  const mine = sched([slot({ dayOfWeek: 6, startMinute: H(9), endMinute: H(13) })]);
  const theirsA = sched([slot({ dayOfWeek: 6, week: "A", startMinute: H(9), endMinute: H(13) })], D("2026-11-02"));
  const found = findScheduleOverlaps({
    positionKey: "CAJERO", startDate: D("2026-11-02"), endDate: D("2026-11-22"), schedules: [mine],
    others: [other([theirsA], { absences: [{ id: "v2", kind: "SOLICITADA", startDate: D("2026-11-02"), endDate: D("2026-11-22") }] })],
  });
  assert("A/B: se pisan solo los sábados de semana A (7/11 y 21/11)", found.length === 1 && JSON.stringify(found[0].dates) === JSON.stringify(["2026-11-07", "2026-11-21"]));
  assert("estado solicitada", found[0]?.kind === "SOLICITADA");
}
{
  // Persona con tramos en dos sucursales: mañana en T, tarde en F.
  const mine = sched([
    slot({ dayOfWeek: 2, slot: 1, startMinute: H(8), endMinute: H(12), branchId: "b-tek" }),
    slot({ dayOfWeek: 2, slot: 2, startMinute: H(15), endMinute: H(19), branchId: "b-aya" }),
  ]);
  const theirs = sched([slot({ dayOfWeek: 2, startMinute: H(16), endMinute: H(20), branchId: "b-aya" })]);
  const r = evaluateVacationRules(base({
    employee: { ...base().employee!, schedules: [mine] },
    others: [other([theirs], { absences: [{ id: "a1", kind: "LICENCIA", startDate: D("2026-11-01"), endDate: D("2026-11-30") }] })],
  }));
  assert("dos sucursales: cruza solo en la de la tarde (Sucursal F, 16–19)", r.overlaps.length === 1
    && r.overlaps[0].branchName === "Sucursal F" && r.overlaps[0].ranges[0] === "16:00–19:00" && r.overlaps[0].stateLabel === "licencia");
}
{
  const r = evaluateVacationRules(base({
    others: [other([sched(weekdays(12, 18))], { absences: [{ id: "s1", kind: "ENFERMEDAD", startDate: D("2026-11-04"), endDate: D("2026-11-05") }] })],
  }));
  assert("ausente por enfermedad cuenta en el cruce (2 días)", r.overlaps.length === 1 && r.overlaps[0].dates.length === 2
    && r.overlaps[0].stateLabel === "ausente por enfermedad");
}

console.log("\nRotativos libres");
assert("cobertura con rotativos: Cajero/a en CABA sí; en PROVINCIA o sin zona no; Encargado/a no",
  coveredByRotatives("CAJERO", "CABA") && coveredByRotatives("MAESTRANZA", "caba") && !coveredByRotatives("CAJERO", "PROVINCIA")
  && !coveredByRotatives("CAJERO", null) && !coveredByRotatives("ENCARGADO", "CABA"));
const needed = workedSlots([sched(weekdays(8, 14))], D("2026-11-02"), D("2026-11-15"));
const cand = (over: Partial<RotativeCandidate>): RotativeCandidate => ({
  employeeId: "r1", name: "Rotativo Uno", positionKeys: ["CAJERO"], zone: "CABA", weeklyHours: 45,
  absences: [], coverages: [], ...over,
});
const avail = (candidates: RotativeCandidate[]) => rotativeAvailability({
  positionKey: "CAJERO", startDate: D("2026-11-02"), endDate: D("2026-11-15"), needed, candidates,
});
{
  const a = avail([cand({})]);
  assert("libre todo el período", a.length === 1 && a[0].freeAll && a[0].freeDays.length === 10);
  assert("horas: 45 semanales y la cobertura suma 30 h/sem", a[0].weeklyHours === 45 && a[0].coverageWeeklyHours === 30);
}
{
  const a = avail([cand({ coverages: [{ id: "c1", startDate: D("2026-11-09"), endDate: D("2026-11-13"), slots: null }] })]);
  assert("libre solo algunos días (otra cobertura la 2ª semana)", a.length === 1 && !a[0].freeAll && a[0].freeDays.length === 5
    && a[0].busyDays.every((b) => b.reason === "otra cobertura"));
}
{
  const a = avail([cand({ coverages: [{ id: "c1", startDate: D("2026-11-01"), endDate: D("2026-11-30"), slots: null }] })]);
  assert("ocupado todo el período por otra cobertura → no aparece", a.length === 0);
}
{
  const slotsTarde = workedSlots([sched(weekdays(15, 20))], D("2026-11-01"), D("2026-11-30"));
  const a = avail([cand({ coverages: [{ id: "c1", startDate: D("2026-11-01"), endDate: D("2026-11-30"), slots: slotsTarde }] })]);
  assert("otra cobertura en franja que no se pisa (tarde) → libre", a.length === 1 && a[0].freeAll);
}
{
  const a = avail([cand({ absences: [{ id: "v9", kind: "APROBADA", startDate: D("2026-11-02"), endDate: D("2026-11-08") }] })]);
  assert("ocupado por sus propias vacaciones la 1ª semana", a.length === 1 && a[0].freeDays.length === 5
    && a[0].busyDays[0].reason === "vacaciones aprobadas");
}
{
  const a = avail([cand({ absences: [{ id: "s9", kind: "ENFERMEDAD", startDate: D("2026-11-02"), endDate: D("2026-11-03") }] })]);
  assert("ausente por enfermedad: ocupado esos días", a.length === 1 && a[0].freeDays.length === 8
    && a[0].busyDays.every((b) => b.reason === "ausente por enfermedad"));
  const v = avail([cand({ absences: [{ id: "v8", kind: "SOLICITADA", startDate: D("2026-11-02"), endDate: D("2026-11-15") }] })]);
  assert("vacaciones solicitadas (no aprobadas) también ocupan → no aparece", v.length === 0);
}
{
  const list = [
    cand({ employeeId: "r1", name: "Rotativo Uno", zone: "CABA" }),
    cand({ employeeId: "r2", name: "Rotativo Dos", zone: "PROVINCIA" }),
    cand({ employeeId: "r3", name: "Rotativo Tres", zone: null }),
    cand({ employeeId: "r4", name: "Rotativo Cuatro", positionKeys: ["MAESTRANZA"] }),
    cand({ employeeId: "r6", name: "Rotativo Seis", zone: "caba" }),
  ];
  const ids = avail(list).map((r) => r.employeeId).sort();
  assert("solo rotativos de zona CABA (no PROVINCIA, no sin zona, no otro puesto)", JSON.stringify(ids) === JSON.stringify(["r1", "r6"]));
  const withSecondary = avail([cand({ employeeId: "r5", positionKeys: ["CADETERIA", "CAJERO"] })]);
  assert("puesto como secundario también cuenta", withSecondary.length === 1);
}
{
  const a = avail([
    cand({ employeeId: "rp", name: "A Parcial", coverages: [{ id: "c1", startDate: D("2026-11-09"), endDate: D("2026-11-13"), slots: null }] }),
    cand({ employeeId: "rf", name: "Z Libre" }),
  ]);
  assert("orden: primero los libres todo el período", a[0].employeeId === "rf" && a[1].employeeId === "rp");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
