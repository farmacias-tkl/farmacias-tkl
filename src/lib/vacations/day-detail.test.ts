/**
 * Tests PUROS del detalle del día del calendario, las marcas de feriado y los
 * botones por rol. Datos SINTÉTICOS. Los filtros contra Postgres están en
 * day-detail.smoke.ts.
 *
 *   npx tsx src/lib/vacations/day-detail.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
import type { UserRole, VacationStatus } from "@prisma/client";
import { getMonthGrid, parseCalendarDate, toLocalISODate } from "@/lib/dates/calendar";
import { getHolidayByISO, holidayFullName, holidayShortName } from "@/lib/holidays";
import { AR_HOLIDAYS_2026 } from "@/lib/holidays/ar-2026";
import { AR_HOLIDAYS_2027 } from "@/lib/holidays/ar-2027";
import type { Schedule, ScheduleSlot } from "@/lib/personal/schedule";
import { vacationActionsFor } from "./available-actions";
import { buildVacationDay, dayBalance, daySchedule, isIsoDay, type DayInputRow } from "./day-detail";
import { vacationFilterWhere } from "./list-where";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const slot = (dayOfWeek: number, start: number, end: number, extra: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  week: "ALL", dayOfWeek, slot: 1, startMinute: start * 60, endMinute: end * 60, branchId: "b1", otherPlace: null, ...extra,
});
const schedule = (slots: ScheduleSlot[], abReferenceDate: Date | null = null): Schedule => ({ validFrom: D("2026-01-01"), abReferenceDate, slots });
const NAMES = { b1: "Sucursal A", b2: "Sucursal B" };

let seq = 0;
function row(employeeId: string, position: string, startHour: number | null, over: Partial<DayInputRow> = {}): DayInputRow {
  return {
    id: `r${seq++}`, status: "PENDING_SUPERVISOR", startDate: D("2027-02-08"), endDate: D("2027-02-14"), daysCount: 7,
    conflictLevel: "NONE", approvedWithWarnings: false, withoutCoverage: false, branchNameSnapshot: "Sucursal vieja", coveredBy: [],
    employee: {
      id: employeeId, name: `Persona ${employeeId}`, branchName: "Sucursal A", position, secondaryPosition: null,
      isTechnicalDirector: false, balances: [{ year: 2026, days: 20 }],
      schedules: startHour === null ? [] : [schedule([slot(1, startHour, startHour + 4)])],
    },
    ...over,
  };
}

console.log("\nDetalle del día");
{
  const rows = [row("a", "Cajero/a", 9), row("b", "Atención al Cliente", 14), row("c", "Atención al Cliente", 8),
    row("d", "Atención al Cliente", null), row("e", "Cajero/a", 7)];
  const day = buildVacationDay("2027-02-08", rows, NAMES);
  assert("muestra todas, aunque en la celda entren 2", day.total === 5 && day.people.length === 5);
  assert("orden: por puesto y, dentro del puesto, por hora de entrada; sin horario al final",
    day.people.map((p) => p.employeeId).join() === "c,b,d,e,a");
  assert("resumen por puesto", JSON.stringify(day.summary) === JSON.stringify([
    { position: "Atención al Cliente", count: 3 }, { position: "Cajero/a", count: 2 },
  ]));
  assert("sucursal donde trabaja, no la de la solicitud", day.people[0].branchName === "Sucursal A");
}
{
  const a = row("a", "Cajero/a", 9, { status: "REJECTED", startDate: D("2027-02-01") });
  const b = row("a", "Cajero/a", 9, { status: "PENDING_SUPERVISOR" });
  const c = row("z", "Cajero/a", 9, { status: "CANCELLED" });
  const day = buildVacationDay("2027-02-08", [a, b, c], NAMES);
  assert("una tarjeta por persona, con todas sus solicitudes", day.total === 3 && day.people.length === 2 && day.people[0].requests.length === 2);
  assert("la solicitud activa va primero", day.people[0].requests[0].status === "PENDING_SUPERVISOR");
  assert("rechazadas y canceladas no suman al resumen", day.summary.length === 1 && day.summary[0].count === 1);
}
{
  const flags = (over: Partial<DayInputRow>) => buildVacationDay("2027-02-08", [row("a", "Cajero/a", 9, over)], NAMES).people[0].requests[0];
  assert("aprobada con advertencias y sin cobertura", (() => {
    const r = flags({ status: "APPROVED", approvedWithWarnings: true, withoutCoverage: true });
    return r.withWarnings && r.withoutCoverage;
  })());
  assert("solicitada con avisos pendientes de revisar: con advertencias", flags({ conflictLevel: "WARNING" }).withWarnings);
  assert("rechazada: sin marcas viejas", (() => {
    const r = flags({ status: "REJECTED", conflictLevel: "WARNING", withoutCoverage: true, approvedWithWarnings: true });
    return !r.withWarnings && !r.withoutCoverage && !r.blocking;
  })());
  assert("quién cubre", flags({ status: "APPROVED", coveredBy: ["Rotativa Prueba"] }).coveredBy[0] === "Rotativa Prueba");
}

console.log("\nHorario del día");
{
  const ab = schedule([
    slot(1, 8, 14, { week: "A" }),
    slot(1, 14, 20, { week: "B" }),
  ], D("2027-02-01")); // lunes de una semana A
  const a = daySchedule([ab], D("2027-02-15"), NAMES);
  const b = daySchedule([ab], D("2027-02-08"), NAMES);
  assert("semana A: el tramo de la semana A", a.week === "A" && a.slots.length === 1 && a.slots[0].start === "08:00");
  assert("semana B: el tramo de la semana B", b.week === "B" && b.slots[0].start === "14:00");
  assert("en una semana A posterior a la referencia, un domingo sigue siendo su semana", daySchedule([ab], D("2027-02-21"), NAMES).week === "A");

  const twoBranches = schedule([
    slot(1, 15, 20, { slot: 2, branchId: "b2" }),
    slot(1, 8, 12, { branchId: "b1" }),
    slot(2, 9, 13, { branchId: null, otherPlace: "Depósito" }),
    slot(3, 9, 13, { branchId: null }),
  ]);
  const monday = daySchedule([twoBranches], D("2027-02-08"), NAMES);
  assert("dos tramos en dos sucursales, ordenados por hora",
    monday.kind === "WORKS" && monday.slots.map((s) => `${s.start}-${s.end} ${s.place}`).join("|") === "08:00-12:00 Sucursal A|15:00-20:00 Sucursal B");
  assert("tramo en otro lugar", daySchedule([twoBranches], D("2027-02-09"), NAMES).slots[0].place === "Depósito");
  assert("tramo sin lugar: Otro lugar", daySchedule([twoBranches], D("2027-02-10"), NAMES).slots[0].place === "Otro lugar");
  assert("día que no trabaja", daySchedule([twoBranches], D("2027-02-11"), NAMES).kind === "OFF");
  assert("sin horario cargado no es lo mismo que no trabajar", daySchedule([], D("2027-02-11"), NAMES).kind === "NO_SCHEDULE");
  assert("usa el horario vigente en esa fecha", (() => {
    const old = { ...schedule([slot(1, 8, 12)]), validFrom: D("2026-01-01") };
    const next = { ...schedule([slot(1, 16, 20)]), validFrom: D("2027-02-08") };
    return daySchedule([old, next], D("2027-02-01"), NAMES).slots[0].start === "08:00"
      && daySchedule([old, next], D("2027-02-08"), NAMES).slots[0].start === "16:00";
  })());
}

console.log("\nSaldo");
{
  const bal = [{ year: 2025, days: 3 }, { year: 2026, days: 10 }];
  const p = dayBalance("PENDING_SUPERVISOR", bal, 7, 2027);
  assert("solicitada: saldo actual y cómo queda", p.effect === "PENDING" && p.current === 13 && p.after === 6 && !p.insufficient);
  const q = dayBalance("PENDING_RRHH", bal, 20, 2027);
  assert("no alcanza: se avisa y queda negativo", q.after === -7 && q.insufficient);
  const a = dayBalance("APPROVED", bal, 7, 2027);
  assert("aprobada: ya descontó, no se resta otra vez", a.effect === "DISCOUNTED" && a.current === 13 && a.after === 13);
  for (const s of ["REJECTED", "CANCELLED"] as VacationStatus[]) {
    const x = dayBalance(s, bal, 7, 2027);
    assert(`${s}: no descuenta`, x.effect === "NONE" && x.after === 13);
  }
  assert("sin saldo cargado", !dayBalance("PENDING_SUPERVISOR", [], 7, 2027).loaded);
}

console.log("\nFechas");
assert("isIsoDay solo acepta días reales", isIsoDay("2027-02-08") && !isIsoDay("2027-02-30") && !isIsoDay("08/02/2027") && !isIsoDay(null));

for (const zone of ["UTC", "America/Argentina/Buenos_Aires"]) {
  process.env.TZ = zone;
  console.log(`\nFeriados con el proceso en TZ=${zone}`);
  const mark = (value: string | Date) => getHolidayByISO(toLocalISODate(parseCalendarDate(value)));
  assert("08/02/2027 Carnaval", !!mark("2027-02-08") && holidayShortName(mark("2027-02-08")!) === "Carnaval");
  assert("09/02/2027 Carnaval", !!mark("2027-02-09") && holidayShortName(mark("2027-02-09")!) === "Carnaval");
  assert("23/11/2026 marcado, con nombre corto y completo",
    holidayShortName(mark("2026-11-23")!) === "Soberanía" && holidayFullName(mark("2026-11-23")!) === "Día de la Soberanía Nacional");
  assert("el puente también", holidayShortName(mark("2026-12-07")!) === "Puente turístico");
  assert("un día común: sin marca", mark("2027-02-10") === null);
  assert("un año sin datos: sin marca y sin error", mark("2031-02-08") === null);
  assert("fecha de solo día que llega con hora UTC: no se corre al día anterior", toLocalISODate(parseCalendarDate("2027-02-08T00:00:00.000Z")) === "2027-02-08");
  const grid = getMonthGrid(2027, 1).flat().map(toLocalISODate);
  assert("en la grilla de febrero 2027 los dos Carnaval son los únicos feriados", grid.filter((d) => getHolidayByISO(d)).join() === "2027-02-08,2027-02-09");
}
assert("todos los feriados tienen nombre corto que entra en la celda",
  [...AR_HOLIDAYS_2026, ...AR_HOLIDAYS_2027].every((h) => holidayShortName(h).length <= 20));
assert("un feriado sin confirmar lo aclara", holidayFullName(getHolidayByISO("2027-11-20")!).includes("a confirmar"));

console.log("\nPermisos");
{
  const statuses: VacationStatus[] = ["PENDING_SUPERVISOR", "PENDING_RRHH", "APPROVED", "REJECTED", "CANCELLED"];
  const none = (role: UserRole) => statuses.every((s) => {
    const a = vacationActionsFor(role, s);
    return !a.showApprovalPanel && !a.canChangeCoverage && a.actions.length === 0;
  });
  assert("RRHH: sin ningún botón en ningún estado", none("HR"));
  const sup = vacationActionsFor("SUPERVISOR", "PENDING_SUPERVISOR");
  assert("supervisión: panel de aprobación en una solicitada", sup.showApprovalPanel && sup.actions.includes("cancel"));
  const app = vacationActionsFor("ADMIN", "APPROVED");
  assert("admin: deshacer, cancelar y cambiar cobertura en una aprobada", app.canChangeCoverage && app.actions.join() === "undo-approval,cancel");
  const bm = vacationActionsFor("BRANCH_MANAGER", "PENDING_SUPERVISOR");
  assert("encargado: puede cancelar, no aprobar", !bm.showApprovalPanel && bm.actions.join() === "cancel");
  assert("sin rol o sin estado: nada", vacationActionsFor(undefined, "APPROVED").actions.length === 0 && vacationActionsFor("ADMIN", undefined).actions.length === 0);
}

console.log("\nFiltros");
{
  const sp = (s: string) => new URLSearchParams(s);
  const admin = { role: "ADMIN", branchId: null };
  const w = vacationFilterWhere(sp("branchId=b1&status=APPROVED&employeeId=e1&withoutCoverage=true&withWarnings=true"), admin)!;
  assert("sucursal, estado, persona y marcas", w.branchId === "b1" && w.status === "APPROVED" && w.employeeId === "e1" && w.withoutCoverage === true && w.approvedWithWarnings === true);
  assert("encargado: su sucursal, aunque pida otra", vacationFilterWhere(sp("branchId=b2"), { role: "BRANCH_MANAGER", branchId: "b1" })!.branchId === "b1");
  assert("encargado sin sucursal: nada", vacationFilterWhere(sp(""), { role: "BRANCH_MANAGER", branchId: null }) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
