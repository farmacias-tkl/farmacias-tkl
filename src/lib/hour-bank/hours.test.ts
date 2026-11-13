/**
 * Tests PUROS del banco de horas: cuentas (hours.ts) y cómo cuenta un día o
 * franja en cruces y disponibilidad de rotativos (personal/coverage.ts).
 * Datos SINTÉTICOS.
 *
 *   npx tsx src/lib/hour-bank/hours.test.ts
 */
import { fmtHours, requestsOverlap, roundHours, scheduleHours, sumHours, toHours, windowError } from "./hours";
import { clipToWindow, findScheduleOverlaps, rotativeAvailability, type OtherPerson } from "@/lib/personal/coverage";
import type { Schedule, ScheduleSlot } from "@/lib/personal/schedule";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const slot = (dayOfWeek: number, start: number, end: number, extra: Partial<ScheduleSlot> = {}): ScheduleSlot =>
  ({ week: "ALL", dayOfWeek, slot: 1, startMinute: start, endMinute: end, branchId: "bA", otherPlace: null, ...extra });

// Lunes a viernes de 8 a 14 (6 h) y sábado de 9 a 13 (4 h).
const weekdays: Schedule = { validFrom: D("2026-01-01"), abReferenceDate: null, slots: [...[1, 2, 3, 4, 5].map((d) => slot(d, 480, 840)), slot(6, 540, 780)] };

console.log("\nHoras que descuenta por defecto (según el horario)");
{
  assert("un día de semana: las 6 h del turno", scheduleHours([weekdays], D("2027-02-01"), D("2027-02-01")) === 6);
  assert("sábado: 4 h", scheduleHours([weekdays], D("2027-02-06"), D("2027-02-06")) === 4);
  assert("domingo: tiene horario y no trabaja → 0", scheduleHours([weekdays], D("2027-02-07"), D("2027-02-07")) === 0);
  assert("lunes a domingo: 5 × 6 + 4 = 34 h", scheduleHours([weekdays], D("2027-02-01"), D("2027-02-07")) === 34);
  assert("franja de 10 a 12 dentro del turno: 2 h", scheduleHours([weekdays], D("2027-02-01"), D("2027-02-01"), { startMinute: 600, endMinute: 720 }) === 2);
  assert("franja de 13 a 16: solo cuenta la hora que cae en el turno", scheduleHours([weekdays], D("2027-02-01"), D("2027-02-01"), { startMinute: 780, endMinute: 960 }) === 1);
  assert("franja fuera del turno: 0", scheduleHours([weekdays], D("2027-02-01"), D("2027-02-01"), { startMinute: 900, endMinute: 960 }) === 0);
  assert("sin horario cargado: null (hay que escribir las horas)", scheduleHours([], D("2027-02-01"), D("2027-02-01")) === null);
  assert("antes de la vigencia del horario: null", scheduleHours([weekdays], D("2025-06-02"), D("2025-06-02")) === null);

  // Turno cortado: 8 a 12 y 16 a 20 → 8 h.
  const split: Schedule = { validFrom: D("2026-01-01"), abReferenceDate: null, slots: [slot(1, 480, 720), slot(1, 960, 1200, { slot: 2 })] };
  assert("turno cortado: suma los dos tramos", scheduleHours([split], D("2027-02-01"), D("2027-02-01")) === 8);
  assert("turno cortado con franja de 11 a 17: 1 h + 1 h", scheduleHours([split], D("2027-02-01"), D("2027-02-01"), { startMinute: 660, endMinute: 1020 }) === 2);

  // Semanas A/B: el sábado solo se trabaja en la semana A (referencia: lunes 01/02/2027).
  const ab: Schedule = { validFrom: D("2026-01-01"), abReferenceDate: D("2027-02-01"), slots: [slot(1, 480, 840), slot(6, 540, 780, { week: "A" })] };
  assert("semana A: el sábado cuenta", scheduleHours([ab], D("2027-02-06"), D("2027-02-06")) === 4);
  assert("semana B: ese sábado no trabaja", scheduleHours([ab], D("2027-02-13"), D("2027-02-13")) === 0);

  // Cambio de horario: desde el 01/03/2027 pasa a 8 h.
  const later: Schedule = { validFrom: D("2027-03-01"), abReferenceDate: null, slots: [slot(1, 480, 960)] };
  assert("usa el horario vigente en cada fecha", scheduleHours([weekdays, later], D("2027-02-22"), D("2027-02-22")) === 6
    && scheduleHours([weekdays, later], D("2027-03-01"), D("2027-03-01")) === 8);
  assert("media hora: 7,5 h", scheduleHours([{ ...weekdays, slots: [slot(1, 480, 930)] }], D("2027-02-01"), D("2027-02-01")) === 7.5);
}

console.log("\nSaldo");
{
  assert("suma movimientos con signo (Decimal como texto)", sumHours([{ hours: "8.00" }, { hours: "-6.00" }, { hours: 2.5 }]) === 4.5);
  assert("puede quedar en negativo", sumHours([{ hours: "4" }, { hours: "-12" }]) === -8);
  assert("sin movimientos: 0", sumHours([]) === 0);
  assert("sin errores de coma flotante (0,1 + 0,2)", sumHours([{ hours: 0.1 }, { hours: 0.2 }]) === 0.3);
  assert("redondea a centésimas", roundHours(1.005) === 1.01 && roundHours(2.3333) === 2.33 && toHours("7.50") === 7.5);
  assert("formato", fmtHours(7.5) === "7 h 30 min" && fmtHours(-3) === "-3 h" && fmtHours(0) === "0 min" && fmtHours(0.75) === "45 min");
}

console.log("\nFranja");
{
  assert("sin franja = día completo: válido", windowError(null, null) === null && windowError(undefined, undefined) === null);
  assert("franja válida", windowError(600, 720) === null && windowError(0, 1440) === null);
  assert("falta una de las dos horas", windowError(600, null) !== null && windowError(null, 720) !== null);
  assert("fin antes o igual que inicio", windowError(720, 600) !== null && windowError(600, 600) !== null);
  assert("fuera del día", windowError(-10, 60) !== null && windowError(600, 1500) !== null);
}

console.log("\nDos pedidos de la misma persona");
{
  const day = (s: string, a: number | null = null, b: number | null = null) => ({ startDate: D(s), endDate: D(s), startMinute: a, endMinute: b });
  assert("mismo día completo: se pisan", requestsOverlap(day("2027-02-01"), day("2027-02-01")));
  assert("días distintos: no", !requestsOverlap(day("2027-02-01"), day("2027-02-02")));
  assert("día completo y una franja ese día: se pisan", requestsOverlap(day("2027-02-01"), day("2027-02-01", 600, 720)));
  assert("dos franjas separadas el mismo día: no", !requestsOverlap(day("2027-02-01", 480, 600), day("2027-02-01", 600, 720)));
  assert("dos franjas superpuestas: sí", requestsOverlap(day("2027-02-01", 480, 660), day("2027-02-01", 600, 720)));
  assert("rango de días que incluye el otro", requestsOverlap({ startDate: D("2027-02-01"), endDate: D("2027-02-05"), startMinute: null, endMinute: null }, day("2027-02-03", 600, 720)));
}

console.log("\nCuenta en los cruces de vacaciones");
{
  const other = (absences: OtherPerson["absences"]): OtherPerson => ({
    employeeId: "otra", name: "Otra Prueba", positionName: "Cajero/a", positionKeys: ["CAJERO"], absences, schedules: [weekdays],
  });
  const cross = (absences: OtherPerson["absences"]) => findScheduleOverlaps({
    positionKey: "CAJERO", startDate: D("2027-02-01"), endDate: D("2027-02-07"), schedules: [weekdays], others: [other(absences)],
  });
  const full = cross([{ id: "hb1", kind: "BANCO", startDate: D("2027-02-03"), endDate: D("2027-02-03") }]);
  assert("día completo por banco de horas de otra cajera: cruce ese día, al 100 %",
    full.length === 1 && full[0].kind === "BANCO" && full[0].dates.join() === "2027-02-03" && full[0].days[0].percent === 100);
  const pending = cross([{ id: "hb2", kind: "BANCO_PEDIDO", startDate: D("2027-02-03"), endDate: D("2027-02-03") }]);
  assert("un pedido todavía sin autorizar también cuenta", pending.length === 1 && pending[0].kind === "BANCO_PEDIDO");
  const short = cross([{ id: "hb3", kind: "BANCO", startDate: D("2027-02-03"), endDate: D("2027-02-03"), window: { startMinute: 480, endMinute: 600 } }]);
  assert("franja de 2 h sobre un turno de 6: no llega a la mitad, no advierte", short.length === 0);
  const long = cross([{ id: "hb4", kind: "BANCO", startDate: D("2027-02-03"), endDate: D("2027-02-03"), window: { startMinute: 480, endMinute: 720 } }]);
  assert("franja de 4 h sobre un turno de 6: supera la mitad, advierte con la franja real",
    long.length === 1 && long[0].ranges.join() === "08:00–12:00" && long[0].days[0].overlapMinutes === 240);
  assert("clipToWindow sin franja devuelve lo mismo", clipToWindow([{ startMinute: 1, endMinute: 2 }], null).length === 1);
}

console.log("\nCuenta en la disponibilidad de rotativos");
{
  const needed = [1, 2, 3].map((d) => ({ date: `2027-02-0${d}`, startMinute: 480, endMinute: 840, branchId: "bA" }));
  const avail = (absences: OtherPerson["absences"]) => rotativeAvailability({
    positionKey: "CAJERO", startDate: D("2027-02-01"), endDate: D("2027-02-03"), needed,
    candidates: [{ employeeId: "rot", name: "Rotativa Prueba", positionKeys: ["CAJERO"], zone: "CABA", weeklyHours: 40, absences, coverages: [] }],
  })[0];
  assert("sin ausencias: libre todo el período", avail([]).freeAll === true);
  const day = avail([{ id: "hb", kind: "BANCO", startDate: D("2027-02-02"), endDate: D("2027-02-02") }]);
  assert("rotativa con día por banco de horas: ocupada ese día, con el motivo",
    !day.freeAll && day.busyDays.length === 1 && day.busyDays[0].date === "2027-02-02" && day.busyDays[0].reason === "banco de horas autorizado");
  const asked = avail([{ id: "hb", kind: "BANCO_PEDIDO", startDate: D("2027-02-02"), endDate: D("2027-02-02") }]);
  assert("pedido sin autorizar: también la ocupa", asked.busyDays[0]?.reason === "banco de horas pedido");
  const outside = avail([{ id: "hb", kind: "BANCO", startDate: D("2027-02-02"), endDate: D("2027-02-02"), window: { startMinute: 900, endMinute: 1020 } }]);
  assert("franja fuera del horario a cubrir: sigue libre", outside.freeAll === true);
  const inside = avail([{ id: "hb", kind: "BANCO", startDate: D("2027-02-02"), endDate: D("2027-02-02"), window: { startMinute: 780, endMinute: 900 } }]);
  assert("franja que pisa el horario a cubrir: ocupada ese día", inside.busyDays.length === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
